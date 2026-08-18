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
// Not a real destination, only a stable Cache API key; index cache entries
// never leave the colo that wrote them.
const INDEX_CACHE_URL_PREFIX = `https://content-addressable-store.internal/index/${ FORMAT }/`;
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
    #edgeCache;
    #pendingIndexes = new Map();

    constructor(options) {
        this.#logger = options.logger;
        this.#kvBindingName = options.kvBindingName;
        this.#durableObjectBindingName = options.durableObjectBindingName;
        // The Cache API's default cache is a true platform global rather than
        // a request-scoped context.env binding, so it is injectable here
        // (options.edgeCache) the same way ContentAddressableStore injects a
        // whole #store, allowing tests to supply a fake without a Workers runtime.
        this.#edgeCache = options.edgeCache ?? caches.default;
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

    #buildIndexCacheRequest(buildId) {
        return new Request(INDEX_CACHE_URL_PREFIX + buildId);
    }

    async #callDurableObject(methodName, callback) {
        try {
            return await callback();
        } catch (cause) {
            if (PROGRAMMER_ERROR_NAMES.has(cause?.name)) {
                throw cause;
            }

            throw new OperationalError(
                `CloudflareContentStore failed to call ContentAddressableIndexStore#${ methodName }()`,
                { cause },
            );
        }
    }

    async getIndex(context) {
        const buildId = context.runtime.build.id;

        // Cache pending and resolved index promises in runtime memory, scoped
        // to the build which produced them. Freshness is checked lazily on
        // read (against cachedAt) rather than through a scheduled eviction.
        const cached = this.#pendingIndexes.get(buildId);
        if (cached && Date.now() - cached.cachedAt < this.indexCacheTtlSeconds * 1000) {
            return cached.promise;
        }

        const promise = this.#fetchIndex(context, buildId);

        this.#pendingIndexes.set(buildId, { promise, cachedAt: Date.now() });

        // Drop a failed fetch immediately so the next call retries instead of
        // waiting out the TTL on a rejected promise.
        promise.catch(() => this.#invalidateIndex(buildId));

        return await promise;
    }

    async #fetchIndex(context, buildId) {
        const cache = this.#edgeCache;
        const cacheKey = this.#buildIndexCacheRequest(buildId);

        // The edge Cache API is shared by every isolate hitting this colo, so
        // a cache hit here avoids a Durable Object call regardless of which
        // isolate served the last request for this build.
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            const entries = await cachedResponse.json();
            return new ContentAddressableIndex(entries);
        }

        const durableObject = this.#resolveDurableObject(context);

        this.#logger.info('fetching index', { buildId });

        const result = await this.#callDurableObject('getIndex', () => durableObject.getIndex(buildId));
        if (!result.success) {
            throw new Error(`CloudflareContentStore#fetchIndex() was unsuccessful: ${ result.message }`);
        }

        const { entries } = result;
        if (!entries) {
            // If the index does not exist, then the system is not recoverable.
            throw new AssertionError(`No registered content index for BUILD_ID ${ buildId }`);
        }

        await cache.put(cacheKey, new Response(JSON.stringify(entries), {
            headers: {
                'content-type': 'application/json',
                'cache-control': `max-age=${ this.indexCacheTtlSeconds }`,
            },
        }));

        return new ContentAddressableIndex(entries);
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

        if (!result.success) {
            throw new Error(`CloudflareContentStore#commitClosure() was unsuccessful: ${ result.message }`);
        }

        return index;
    }

    async assignBuild(context, buildId, rootHash) {
        const durableObject = this.#resolveDurableObject(context);

        this.#logger.info('assign build', { buildId, rootHash });

        const result = await this.#callDurableObject(
            'assignBuild',
            () => durableObject.assignBuild(buildId, rootHash),
        );
        if (!result.success) {
            throw new Error(`CloudflareContentStore#assignBuild() was unsuccessful: ${ result.message }`);
        }
        this.#invalidateIndex(buildId);

        // Purge this colo's edge cache entry so the deploying request sees the
        // new build immediately. Every other colo still picks it up within
        // indexCacheTtlSeconds via the cache-control max-age set in
        // #fetchIndex().
        await this.#edgeCache.delete(this.#buildIndexCacheRequest(buildId));
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
