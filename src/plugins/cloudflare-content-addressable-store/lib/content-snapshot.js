import { isUndefined } from '../../../kixx/assertions/mod.js';
import { compareStrings, hashSet } from './addressing.js';


/**
 * Request-scoped view of one immutable content index.
 *
 * Every read performed through an instance resolves against the index captured
 * when its owning store opened the snapshot. Do not retain a snapshot beyond
 * the request that opened it.
 *
 * @implements {import('../../../kixx/content-store/content-addressable-store-interface.js').ContentIndexSnapshotInterface}
 */
export default class ContentSnapshot {

    #store;
    #context;
    #index;

    /**
     * @param {Object} options - Snapshot dependencies captured for one request
     * @param {Object} options.store - Backing blob store
     * @param {Object} options.context - Request context supplying blob bindings
     * @param {import('./content-addressable-index.js').default} options.index - Immutable index pinned for the snapshot lifetime
     */
    constructor(options) {
        this.#store = options.store;
        this.#context = options.context;
        this.#index = options.index;
    }

    /**
     * Root hash of the immutable index pinned for this request.
     * @returns {string} Pinned content root hash
     */
    get rootHash() {
        return this.#index.rootHash;
    }

    /**
     * Looks up a pathname in the index pinned for this snapshot.
     * @param {string} pathname - Logical pathname including a leading slash
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} Matching node, or null when absent from the pinned index
     */
    async statPath(pathname) {
        return await this.#index.getNode(pathname);
    }

    /**
     * Lists nodes from the index pinned for this snapshot.
     * @param {string} prefix - Directory pathname
     * @param {Object} [options] - Listing options
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry[]>} Matching nodes from the pinned index
     */
    async listStats(prefix, options) {
        return await this.#index.listNodes(prefix, options);
    }

    /**
     * Reads one immutable blob while retaining this snapshot's request bindings.
     * @param {string} hash - Content hash to read
     * @returns {Promise<Uint8Array|null>} Blob bytes, or null when unavailable
     */
    async getBlob(hash) {
        return await this.#store.getBlob(this.#context, hash);
    }

    /**
     * Reads immutable blobs while retaining this snapshot's request bindings.
     * @param {string[]} hashes - Content hashes to read
     * @returns {Promise<Array<Uint8Array|null>>} Bytes in the same order as `hashes`
     */
    async getBlobs(hashes) {
        return await this.#store.getBlobs(this.#context, hashes);
    }

    /**
     * Computes a deterministic digest from a set of index nodes' content and
     * metadata, independent of the order `stats` was supplied in. Suitable
     * for use as an aggregate etag over several files.
     * @param {import('./content-addressable-index.js').IndexEntry[]} stats - Nodes to fold into the digest
     * @returns {Promise<string>} Content digest in the current wire format
     */
    async computeHashFromStats(stats) {
        const pairs = new Map();
        for (const stat of stats) {
            const tuple = [ stat.hash ];
            if (!isUndefined(stat.metadata) && stat.metadata !== null) {
                tuple.push(stat.metadata);
            }
            pairs.set(stat.pathname, tuple);
        }

        // Sort by key before hashing so the result is independent of the order
        // callers supplied inputs in — digest(['a','b']) === digest(['b','a']).
        const sorted = [...pairs.entries()].sort((a, b) => compareStrings(a[0], b[0]));
        return await hashSet(sorted);
    }
}
