import ContentAddressableIndex, { getRootHash } from './content-addressable-index.js';
import ContentSnapshot from './content-snapshot.js';
import { hashString } from './addressing.js';
import { normalizePathname, isValidPathname } from './content-layout.js';
import { assert } from '../assertions/mod.js';


export default class ContentAddressableStore {

    #store;

    initialize(args) {
        const { contentStore } = args ?? {};
        assert(contentStore, 'ContentAddressableStore requires a ContentStore');
        this.#store = contentStore;
    }

    normalizePathname(pathname) {
        return normalizePathname(pathname);
    }

    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    async hashString(value) {
        return await hashString(value);
    }

    async openSnapshot(context) {
        const buildId = context.runtime.build.id ?? null;
        const entries = await this.#store.getIndex(context, buildId);
        const index = new ContentAddressableIndex(entries);
        return new ContentSnapshot(this.#store, index);
    }

    /**
     * Derives and persists an immutable closure — the directory tree implied
     * by `files` — under its own root hash. Does not point any build at the
     * closure; pair with `assignBuild`, or use `commitChanges` to do both.
     * Idempotent: committing the same closure content again is a no-op.
     * @param {RequestContext} context - Request context carrying the Durable Object binding
     * @param {IndexSourceFile[]} files - Blob descriptors to include in the closure, typically returned from `putBlob`
     * @returns {Promise<{rootHash: string, nodeCount: number}>} Stable descriptor identifying the committed closure
     * @throws {AssertionError} When `files` is not an array
     * @throws {ValidationError} When any file entry is malformed or collides with another
     * @throws {OperationalError} When the index store call fails or reports an unsuccessful result
     */
    async commitClosure(context, files) {
        // buildIndex() validates `files` and derives the encoded table the
        // Durable Object stores. The table is persisted as-is rather than
        // wrapped in a ContentAddressableIndex: the constructor's assertions
        // are the read-side check, and a table built from a validated file
        // list already satisfies them.
        const entries = await ContentAddressableIndex.buildIndex(files);
        const rootHash = getRootHash(entries);

        await this.#store.saveIndex(context, rootHash, entries);

        return { rootHash, nodeCount: Object.keys(entries).length };
    }

    /**
     * Points `buildId` at a previously committed closure's root hash. This
     * is the only write a build's pointer ever needs, for both deploying a
     * new closure and rolling back to one committed earlier — it never
     * rewrites closure content.
     * @param {RequestContext} context - Request context carrying the Durable Object binding
     * @param {string} buildId - The build to repoint
     * @param {string} rootHash - Root hash of an already-committed closure, such as one named by `getRootHash`
     * @returns {Promise<void>}
     * @throws {OperationalError} When the index store call fails or reports an unsuccessful result. An unknown `rootHash` asserts inside the Durable Object; crossing the Workers RPC boundary marks that error `remote`, so #callDurableObject wraps it and it surfaces here as an OperationalError with the assertion as its `cause`
     */
    async assignBuild(context, buildId, rootHash) {
        await this.#store.assignBuild(context, buildId, rootHash);
    }

    /**
     * Commits a new closure from `files` and assigns `buildId` to it in one
     * call — the combination of `commitClosure` and `assignBuild` used to
     * deploy a new build.
     * @param {RequestContext} context - Request context carrying the Durable Object binding
     * @param {string} buildId - The build to deploy
     * @param {IndexSourceFile[]} files - Blob descriptors to include in the new closure, typically returned from `putBlob`
     * @returns {Promise<{rootHash: string, nodeCount: number}>} Stable descriptor identifying the newly committed closure
     * @throws {AssertionError} When `files` is not an array
     * @throws {ValidationError} When any file entry is malformed or collides with another
     * @throws {OperationalError} When either index store call fails or reports an unsuccessful result
     */
    async commitChanges(context, buildId, files) {
        const result = await this.commitClosure(context, files);
        await this.assignBuild(context, buildId, result.rootHash);
        return result;
    }
}
