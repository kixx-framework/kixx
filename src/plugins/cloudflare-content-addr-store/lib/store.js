import { AssertionError } from '../../kixx/errors/mod.js';
import ContentAddressableIndex from './content-addressable-index.js';
import { KEY } from './addressing.js';


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

    async listStats(context, prefix) {
        const index = await this.getIndex(context);
        return index.listNodes(prefix);
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
}
