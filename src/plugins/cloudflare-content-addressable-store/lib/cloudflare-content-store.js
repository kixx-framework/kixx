import {
    AssertionError,
    OperationalError,
    ValidationError,
} from '../../../kixx/errors/mod.js';
import {
    isUndefined,
    isNonEmptyString,
    assert,
} from '../../../kixx/assertions/mod.js';
import ContentAddressableIndex from './content-addressable-index.js';
import {
    FORMAT,
    KEY,
    compareStrings,
    typedArrayToBuffer,
    hashBlob,
    hashEtag,
    hashSet,
} from './addressing.js';


const DURABLE_OBJECT_NAME = `ContentAddressableStore:${ FORMAT }`;
const BLOB_READ_CONCURRENCY = 6;
const PROGRAMMER_ERROR_NAMES = new Set([
    'AggregateError',
    'AssertionError',
    'EvalError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TypeError',
    'URIError',
]);


/**
 * Coordinates content-addressable persistence through request-scoped
 * Cloudflare KV and Durable Object bindings.
 */
export default class CloudflareContentStore {

    #logger;
    #kvBindingName;
    #durableObjectBindingName;
    #pendingIndexes = new Map();

    constructor(options) {
        this.#logger = options.logger;
        this.#kvBindingName = options.kvBindingName;
        this.#durableObjectBindingName = options.durableObjectBindingName;
        this.blobReadCacheTtlSeconds = options.blobReadCacheTtlSeconds;
        this.indexCacheTtlSeconds = options.indexCacheTtlSeconds;
    }

    #resolveKvStore(context) {
        const kvStore = context.env[this.#kvBindingName];
        assert(kvStore, `ContentAddressableStore KV binding "${ this.#kvBindingName }" is not bound on context.env`);
        return kvStore;
    }

    #resolveDurableObject(context) {
        const namespace = context.env[this.#durableObjectBindingName];
        assert(namespace, `ContentAddressableStore KV DurableObject Namespace "${ this.#durableObjectBindingName }" is not bound on context.env`);
        return namespace.getByName(DURABLE_OBJECT_NAME);
    }

    #invalidateIndex(buildId) {
        this.#pendingIndexes.delete(buildId);
    }

    async #callDurableObject(methodName, callback) {
        try {
            return await callback();
        } catch (cause) {
            if (PROGRAMMER_ERROR_NAMES.has(cause?.name)) {
                throw cause;
            }

            throw new OperationalError(
                `ContentAddressableStore failed to call ContentAddressableIndexStore#${ methodName }()`,
                { cause },
            );
        }
    }

    #assertSuccessfulResponse(methodName, result) {
        assert(
            result && typeof result === 'object',
            `ContentAddressableIndexStore#${ methodName }() must return a result object`,
        );
        assert(
            typeof result.success === 'boolean',
            `ContentAddressableIndexStore#${ methodName }() result.success must be a boolean`,
        );

        if (!result.success) {
            const cause = new Error(result.message ?? 'The Durable Object reported an unsuccessful operation');
            throw new OperationalError(
                `ContentAddressableIndexStore#${ methodName }() was unsuccessful`,
                { cause },
            );
        }
    }

    async getIndex(context) {
        const buildId = context.runtime.build.id;

        // Cache both pending and resolved index promises for a few moments in
        // runtime memory, scoped to the build which produced them.
        const cached = this.#pendingIndexes.get(buildId);
        if (cached) {
            return cached.promise;
        }

        const durableObject = this.#resolveDurableObject(context);

        this.#logger.info('fetching index', { buildId });

        const entry = {};
        const pending = this.#callDurableObject('getIndex', () => durableObject.getIndex(buildId))
            .then((result) => {
                this.#assertSuccessfulResponse('getIndex', result);
                const { entries } = result;
                if (!entries) {
                    // If the index does not exist, then the system is not recoverable.
                    throw new AssertionError(`No registered content index for BUILD_ID ${ buildId }`);
                }
                return new ContentAddressableIndex(entries);
            })
            .catch((error) => {
                if (this.#pendingIndexes.get(buildId) === entry) {
                    this.#pendingIndexes.delete(buildId);
                }

                return Promise.reject(error);
            });

        entry.promise = pending;
        this.#pendingIndexes.set(buildId, entry);

        setTimeout(() => {
            if (this.#pendingIndexes.get(buildId) === entry) {
                this.#pendingIndexes.delete(buildId);
            }
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
        if (!prefix.endsWith('/')) {
            prefix = prefix + '/';
        }
        return index.listNodes(prefix, { recursive });
    }

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

    async putBlob(context, pathname, blob, metadata, etag) {
        const hash = await hashBlob(blob);
        const computedEtag = await hashEtag(hash, metadata);
        if (isNonEmptyString(etag) && etag !== computedEtag) {
            throw new ValidationError(
                `PUT blob hash integrity check failed for ${ pathname }`,
                { code: 'INTEGRITY_CHECK_FAILED', etag: computedEtag },
            );
        }

        const kv = this.#resolveKvStore(context);

        const size = blob.byteLength;
        const key = KEY.blob + hash;

        this.#logger.info('put blob', { pathname, key });

        await kv.put(key, typedArrayToBuffer(blob));

        return {
            pathname,
            hash,
            size,
            metadata,
        };
    }

    async commitClosure(context, files) {
        const durableObject = this.#resolveDurableObject(context);

        const index = await ContentAddressableIndex.buildIndex(files);
        const rootHash = index['/'][1];

        this.#logger.info('commit closure', { rootHash });

        const result = await this.#callDurableObject(
            'commitClosure',
            () => durableObject.commitClosure(rootHash, index),
        );
        this.#assertSuccessfulResponse('commitClosure', result);

        return index;
    }

    async assignBuild(context, buildId, rootHash) {
        const durableObject = this.#resolveDurableObject(context);

        this.#logger.info('assign build', { buildId, rootHash });

        const result = await this.#callDurableObject(
            'assignBuild',
            () => durableObject.assignBuild(buildId, rootHash),
        );
        this.#assertSuccessfulResponse('assignBuild', result);
        this.#invalidateIndex(buildId);
    }

    async commitChanges(context, buildId, files) {
        const index = await this.commitClosure(context, files);
        await this.assignBuild(context, buildId, index['/'][1]);
        return index;
    }

    async getBlob(context, hash) {
        const kv = this.#resolveKvStore(context);

        const key = KEY.blob + hash;
        this.#logger.debug('get blob', { key });
        const buff = await kv.get(key, {
            type: 'arrayBuffer',
            cacheTtl: this.blobReadCacheTtlSeconds,
        });

        return buff ? new Uint8Array(buff) : null;
    }

    async getBlobs(context, hashes) {
        const kv = this.#resolveKvStore(context);

        const keys = hashes.map((hash) => KEY.blob + hash);
        this.#logger.debug('get blobs', { count: keys.length });

        const resultsArray = [];
        for (let offset = 0; offset < keys.length; offset += BLOB_READ_CONCURRENCY) {
            const batch = keys.slice(offset, offset + BLOB_READ_CONCURRENCY);
            const buffers = await Promise.all(batch.map((key) => {
                return kv.get(key, {
                    type: 'arrayBuffer',
                    cacheTtl: this.blobReadCacheTtlSeconds,
                });
            }));

            for (const buff of buffers) {
                resultsArray.push(buff ? new Uint8Array(buff) : null);
            }
        }

        return resultsArray;
    }
}
