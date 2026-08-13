import { AssertionError } from '../../kixx/errors/mod.js';
import ContentAddressableIndex from './content-addressable-index.js';
import {
    KEY,
    compareStrings,
    typedArrayToBuffer,
    hashBlob,
    hashSet,
} from './addressing.js';


export default class Store {

    #pendingIndex = null;

    constructor() {
        // TODO: Pass in blobReadCacheTtlSeconds
        this.blobReadCacheTtlSeconds = 60 * 60 * 36;
    }

    #resolveDurableObject() {
        // TODO: Implement resolveDurableObject()
    }

    #resolveKvStore() {
        // TODO: Implement resolveKvStore()
    }

    async getIndex(context) {
        // We cache pending index promises for a few moments in runtime memory.
        if (this.#pendingIndex) {
            return this.#pendingIndex;
        }

        const durableObject = this.#resolveDurableObject(context);
        const buildId = context.runtime.build.id;

        const pending = durableObject.getContentAddressableIndex(buildId)
            .then((result) => {
                if (!result) {
                    // If the index does not exist, then the system is not recoverable.
                    throw new AssertionError(`No registered content index for BUILD_ID ${ buildId }`);
                }
                return new ContentAddressableIndex(result);
            })
            .catch((error) => {
                if (this.#pendingIndex === pending) {
                    this.#pendingIndex = null;
                }

                return Promise.reject(error);
            });

        this.#pendingIndex = pending;

        setTimeout(() => {
            this.#pendingIndex = null;
        }, this.indexCacheTtlSeconds * 1000);

        return pending;
    }

    async statPath(context, pathname) {
        const index = await this.getIndex(context);
        return index.getNode(pathname);
    }

    async listStats(context, prefix, options) {
        const { recursive = true } = options ?? {};
        const index = await this.getIndex(context);
        return index.listNodes(prefix, { recursive });
    }

    async computeHashFromStats(stats) {
        const pairs = new Map();
        for (const stat of stats) {
            const tuple = [ stat.hash ];
            if (stat.metadata) {
                tuple.push(stat.metadata);
            }
            pairs.set(stat.pathname, tuple);
        }

        // Sort by key before hashing so the result is independent of the order
        // callers supplied inputs in — digest(['a','b']) === digest(['b','a']).
        const sorted = [...pairs.entries()].sort((a, b) => compareStrings(a[0], b[0]));
        return await hashSet(sorted);
    }

    async putBlob(context, pathname, blob, metadata, integrityHash) {
        const hash = await hashBlob(blob);
        if (isNonEmptyString(integrityHash) && hash !== integrityHash) {
            throw new ValidationError(
                `PUT blob hash integrity check failed for ${ pathname }`,
                { code: 'CA_STORE_INTEGRITY_CHECK_FAILED' },
            );
        }

        const kv = this.#resolveKvStore(context);
        await kv.put(`${ KEY.blob }#${ hash }`, typedArrayToBuffer(blob));

        const durableObject = this.#resolveDurableObject(context);

        const size = blob.byteLength;
        await durableObject.addFile({ pathname, hash, metadata, size });
        return { pathname, hash, metadata, size };
    }

    async getBlob(context, hash) {
        const kv = this.#resolveKvStore(context);

        const key = `${ KEY.blob }#${ hash }`;

        const buff = await kv.get(key, {
            type: 'arrayBuffer',
            cacheTtl: this.blobReadCacheTtlSeconds,
        });

        return buff ? new Uint8Array(buff) : null;
    }

    async getBlobs(context, hashes) {
        const kv = this.#resolveKvStore(context);

        const keys = hashes.map((hash) => `${ KEY.blob }#${ hash }`);

        const resultsMap = await kv.get(keys, {
            type: 'arrayBuffer',
            cacheTtl: this.blobReadCacheTtlSeconds,
        });

        const resultsArray = [];
        for (const key of keys) {
            const buff = resultsMap.get(key);
            resultsArray.push(buff ? new Uint8Array(buff) : null);
        }

        return resultsArray;
    }
}
