import ContentAddressableIndex, {
    assertValidIndexTable,
    getRootHash,
    flattenContentTree,
} from './content-addressable-index.js';
import ContentSnapshot from './content-snapshot.js';
import { hashSet, hashString, isValidHash } from './addressing.js';
import { getStaticAssetPath, normalizePathname, isValidPathname } from './content-layout.js';
import { BUILD_ASSIGNMENT_OUTCOME } from './content-store-interface.js';
import { assert, assertNonEmptyString } from '../assertions/mod.js';
import { ConflictError, NotFoundError } from '../errors/mod.js';

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
        const build = await this.#store.getBuild(context, buildId);
        // A missing active closure here means the running deploy cannot serve
        // any content at all, which is an unrecoverable configuration fault,
        // not something a renderer could sensibly branch on.
        assert(build, `No registered content index for BUILD_ID ${ buildId }`);
        const index = new ContentAddressableIndex(build.entries);
        return new ContentSnapshot(this.#store, index);
    }

    /**
     * Resolves the closure currently assigned to the running deploy's build,
     * for callers that must report or restore it rather than read through it.
     *
     * Unlike {@link ContentAddressableStore#openSnapshot}, absence at every
     * level is reported as `null` rather than thrown: this method backs public
     * request handling (the Publishing API's Build resource) and end-to-end
     * restoration, where "no active build" is an expected outcome to report,
     * not a startup-class fault.
     * @param {Object} context - Request or execution context, passed through to the store
     * @returns {Promise<{id: string, rootHash: string}|null>} The running build's id and assigned root hash, or null when the runtime has no build id, no registered pointer, or (developer mode) no persisted pointer
     * @throws {OperationalError} When the backing store fails
     */
    async getCurrentBuild(context) {
        const buildId = context.runtime.build.id ?? null;
        if (!buildId) {
            return null;
        }

        const build = await this.#store.getBuild(context, buildId);
        if (!build || !build.rootHash) {
            return null;
        }

        return { id: buildId, rootHash: build.rootHash };
    }

    /**
     * Points the running deploy's build at a previously published closure, only
     * when its currently assigned root hash still equals `expectedRootHash`.
     *
     * This never publishes new content and never touches a build other than
     * the running deploy's own: the closure named by `rootHash` must already
     * exist, and there is no way to name a different build id.
     * @param {Object} context - Request or execution context, passed through to the store
     * @param {Object} assignment - Desired closure and required pointer precondition
     * @param {string} assignment.rootHash - Root hash of a previously saved closure
     * @param {string} assignment.expectedRootHash - Root hash the caller observed as the current pointer
     * @returns {Promise<{id: string, rootHash: string}>} The running build's id and its newly assigned root hash
     * @throws {NotFoundError} When the runtime has no build id, or `rootHash` names no saved closure
     * @throws {ConflictError} When the build's current pointer no longer equals `expectedRootHash` (code `BuildPointerConflict`)
     * @throws {OperationalError} When the backing store fails
     */
    async assignCurrentBuild(context, assignment) {
        const { rootHash, expectedRootHash } = assignment ?? {};
        assertNonEmptyString(rootHash, 'ContentAddressableStore#assignCurrentBuild: rootHash');
        assertNonEmptyString(expectedRootHash, 'ContentAddressableStore#assignCurrentBuild: expectedRootHash');

        const buildId = context.runtime.build.id ?? null;
        if (!buildId) {
            throw new NotFoundError('No active runtime build is configured.');
        }

        const outcome = await this.#store.assignBuild(context, buildId, { rootHash, expectedRootHash });

        if (outcome === BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE) {
            throw new NotFoundError(`No closure has been published for root hash "${ rootHash }".`);
        }
        if (outcome === BUILD_ASSIGNMENT_OUTCOME.CONFLICT) {
            throw new ConflictError(
                'The active build pointer no longer matches expectedRootHash.',
                { code: 'BuildPointerConflict' },
            );
        }

        return { id: buildId, rootHash };
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
     * @param {Object} [options] - Optional publication precondition
     * @param {string} [options.expectedRootHash] - When present, the build pointer is only reassigned if its current value still equals this. Omitting it preserves unconditional publication.
     * @returns {Promise<{hash: string, nodeCount: number}>} The published closure's root hash and its total node count, counting directories
     * @throws {ValidationError} When a content tree entry is malformed or collides with another
     * @throws {ConflictError} When `expectedRootHash` is present and no longer matches the build's current pointer (code `BuildPointerConflict`)
     * @throws {OperationalError} When the backing store fails
     */
    async commitChanges(context, buildId, contentTree, options) {
        const { expectedRootHash } = options ?? {};
        if (expectedRootHash !== undefined) {
            assertNonEmptyString(expectedRootHash, 'ContentAddressableStore#commitChanges: expectedRootHash');
        }

        // flattenContentTree() derives the flat manifest buildIndex() validates
        // and builds the encoded table persisted in the store. The table is
        // persisted as-is rather than wrapped in a ContentAddressableIndex.
        // expectedRootHash is assignment metadata, not content, so it never
        // enters this derivation and cannot affect the deterministic hash.
        const files = flattenContentTree(contentTree);
        const entries = await ContentAddressableIndex.buildIndex(files);
        assertValidIndexTable(entries);
        const hash = getRootHash(entries);

        // Order matters and the port makes no atomicity guarantee across the
        // two calls: the closure must exist before a build can name it, and a
        // failure between them leaves an unreferenced closure, which is inert
        // because a retry re-derives the identical hash.
        await this.#store.saveIndex(context, hash, entries);
        const outcome = await this.#store.assignBuild(context, buildId, { rootHash: hash, expectedRootHash });

        // The closure was just saved above, so a same-call missing-closure
        // outcome would mean the store failed to persist what it just
        // acknowledged, an internal invariant violation rather than an
        // outcome this layer's callers can act on.
        assert(
            outcome !== BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE,
            'ContentAddressableStore#commitChanges(): assignBuild() reported a missing closure immediately after saveIndex()',
        );

        if (outcome === BUILD_ASSIGNMENT_OUTCOME.CONFLICT) {
            throw new ConflictError(
                'The build pointer no longer matches expectedRootHash.',
                { code: 'BuildPointerConflict' },
            );
        }

        return { hash, nodeCount: Object.keys(entries).length };
    }
}
