import ContentAddressableIndex, {
    assertValidIndexTable,
    getRootHash,
    flattenContentTree,
} from './content-addressable-index.js';
import ContentSnapshot from './content-snapshot.js';
import { hashSet, hashString, isValidHash } from './addressing.js';
import { getStaticAssetPath, normalizePathname, isValidPathname } from './content-layout.js';
import { assert } from '../assertions/mod.js';

/**
 * @typedef {import('./content-addressable-index.js').ContentTree} ContentTree
 */

/**
 * The framework-facing entry point to published site content.
 *
 * Site content — page metadata, page templates, template bundles, email
 * bundles, and static assets — is not stored as mutable files. It is stored the
 * way a version control system stores a commit: every file is an immutable blob
 * named by the hash of its bytes, every directory is an immutable tree named by
 * the hash of its children, and one whole published site is a *closure* named by
 * the hash of its root tree. Publishing a new version writes only the blobs that
 * actually changed, then moves a single pointer — the build id — to name the new
 * closure. Rolling back moves that pointer back and re-uploads nothing.
 *
 * This class owns three operations against that model:
 *
 * - {@link ContentAddressableStore#commitChanges} publishes a closure and points
 *   a build id at it.
 * - {@link ContentAddressableStore#openSnapshot} resolves a build id to the
 *   closure it names and returns a {@link ContentSnapshot} for reading it.
 * - {@link ContentAddressableStore#getStaticAssetByHash} reads an asset blob by
 *   content address without resolving a closure.
 *
 * Everything about *how* content is persisted lives behind the
 * {@link ContentStoreInterface} port supplied at initialization, so the same
 * framework code runs on every deploy target.
 *
 * ## Why reads go through a snapshot
 * A snapshot pins one closure for the life of a request. A deploy that lands
 * mid-request reassigns the build pointer, but an in-flight render keeps reading
 * the index it opened with, so it can never compose a page from a mix of two
 * publications. This is the reason reads are not exposed as methods on this
 * class: there would be no request-scoped boundary to pin them to. The sole
 * exception is a direct static-asset blob read by its content address. That
 * read is deliberately closure-independent, so putting it on a snapshot would
 * force an index read solely to bypass the index.
 *
 * ## Lifecycle
 * The instance is registered as a service before the store it depends on is
 * available, so construction takes no arguments and
 * {@link ContentAddressableStore#initialize} supplies the dependency in a second
 * phase. Every other method requires initialize() to have run.
 * @see ContentStoreInterface in ./content-store-interface.js for the persistence contract
 * @see ContentSnapshot in ./content-snapshot.js for the read and write API
 */
export default class ContentAddressableStore {

    #store;

    /**
     * Supplies the persistence port. Called by the plugin's `initialize()`
     * phase, once the platform adapter has registered its ContentStore.
     * @param {Object} args
     * @param {ContentStoreInterface} args.contentStore - Platform adapter implementing the persistence contract
     */
    initialize(args) {
        const { contentStore } = args ?? {};
        assert(contentStore, 'ContentAddressableStore requires a ContentStore');
        this.#store = contentStore;
    }

    /**
     * Folds a pathname to the canonical form the index is keyed by.
     *
     * Re-exported as a method so callers holding only this service — request
     * handlers and the Hyperview service — can reach the layout rules without
     * importing the layout module directly.
     * @param {string} pathname - Pathname to normalize
     * @returns {string} The pathname folded to canonical form
     * @throws {TypeError} When pathname is not a string
     */
    normalizePathname(pathname) {
        return normalizePathname(pathname);
    }

    /**
     * Reports whether a pathname satisfies the canonical pathname rules.
     * @param {string} pathname - Pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    /**
     * Hashes a string under the framework's string domain. Used for deriving
     * short, opaque cache keys from arbitrarily long logical identities.
     * @param {string} value - String to hash
     * @returns {Promise<string>} Digest in the current wire format
     * @throws {TypeError} When value is not a string
     */
    async hashString(value) {
        return await hashString(value);
    }

    /**
     * Hashes a canonicalizable collection under the framework's set domain.
     * Used for deriving a digest from a plain object or array, such as a
     * page's props, rather than an already-composed string.
     * @param {Object|Array<*>} value - Collection to canonicalize and hash
     * @returns {Promise<string>} Digest in the current wire format
     * @throws {TypeError} When value contains a value that cannot be canonicalized
     */
    async hashSet(value) {
        return await hashSet(value);
    }

    /**
     * Resolves the running build's closure and returns a read/write view of it.
     *
     * The returned snapshot is pinned to the closure this call resolved, so a
     * deploy landing afterwards is invisible to it. Open exactly one per request
     * and thread it through the render; opening a second mid-request reintroduces
     * the torn-read the snapshot exists to prevent.
     * @param {Object} context - Request or execution context, passed through to the store
     * @returns {Promise<ContentSnapshot>} A snapshot pinned to the current build's closure
     * @throws {AssertionError} When the build id names no assigned closure, or the stored index table is malformed
     * @throws {OperationalError} When the backing store fails
     */
    async openSnapshot(context) {
        const buildId = context.runtime.build.id ?? null;
        const entries = await this.#store.getIndex(context, buildId);
        const index = new ContentAddressableIndex(entries);
        return new ContentSnapshot(this.#store, index);
    }

    /**
     * Reads a static asset blob directly by content hash, without loading an
     * index or resolving the running build's closure.
     * @param {Object} context - Request or execution context, passed through to the store
     * @param {string} pathname - Logical asset pathname, used by pathname-backed adapters
     * @param {string} hash - Content address of the blob to read
     * @returns {Promise<ReadableStream|null>} The blob stream, or null when the blob is absent
     * @throws {AssertionError} When pathname or hash is invalid, or a present blob is not a stream
     * @throws {OperationalError} When the backing store fails
     */
    async getStaticAssetByHash(context, pathname, hash) {
        assert(isValidPathname(pathname), 'getStaticAssetByHash() requires a valid pathname');
        assert(isValidHash(hash), 'getStaticAssetByHash() requires a valid hash');

        const stream = await this.#store.getFile(
            context,
            'stream',
            getStaticAssetPath(pathname),
            hash,
        );

        assert(
            stream === null || stream instanceof ReadableStream,
            `The static asset hash "${ hash }" references unreadable content`,
        );

        return stream;
    }

    /**
     * Publishes a closure built from a structured content tree and points a
     * build id at it.
     *
     * The blobs the content tree references must already have been written
     * through a snapshot's `put*` methods; this call publishes only the index
     * that makes them reachable. It is idempotent in content terms —
     * committing the same content tree always produces the same hash — but
     * not in effect, because the build pointer moves.
     * @param {Object} context - Request or execution context, passed through to the store
     * @param {string} buildId - Build id to point at the new closure
     * @param {ContentTree} contentTree - Structured commit payload naming every file in the published site
     * @returns {Promise<{hash: string, nodeCount: number}>} The published closure's root hash and its total node count, counting directories
     * @throws {ValidationError} When a content tree entry is malformed or collides with another
     * @throws {OperationalError} When the backing store fails
     */
    async commitChanges(context, buildId, contentTree) {
        // flattenContentTree() derives the flat manifest buildIndex() validates
        // and builds the encoded table persisted in the store. The table is
        // persisted as-is rather than wrapped in a ContentAddressableIndex.
        const files = flattenContentTree(contentTree);
        const entries = await ContentAddressableIndex.buildIndex(files);
        assertValidIndexTable(entries);
        const hash = getRootHash(entries);

        // Order matters and the port makes no atomicity guarantee across the
        // two calls: the closure must exist before a build can name it, and a
        // failure between them leaves an unreferenced closure, which is inert
        // because a retry re-derives the identical hash.
        await this.#store.saveIndex(context, hash, entries);
        await this.#store.assignBuild(context, buildId, hash);

        return { hash, nodeCount: Object.keys(entries).length };
    }
}
