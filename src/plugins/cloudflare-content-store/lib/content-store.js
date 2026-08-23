import {
    AssertionError,
    OperationalError,
} from '../../../kixx/errors/mod.js';
import {
    assert,
    assertNonEmptyString,
    isString,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';


const ACCEPTED_TYPES = [ 'text', 'arrayBuffer' ];

// WARNING: This names the Durable Object instance holding every committed
// closure and build pointer. It only looks like it is derived from the class
// name — it is a persistent storage identity, and changing it (by renaming
// the class, or otherwise) silently repoints the adapter at a fresh, empty
// Durable Object rather than failing. Change it only as a deliberate
// migration, alongside a wire format version change.
const DURABLE_OBJECT_NAME = 'ContentAddressableStore';

// Not a real destination, only a stable Cache API key; index cache entries
// never leave the colo that wrote them.
const INDEX_CACHE_URL_PREFIX = 'https://content-addressable-store.internal/index';

// Retry policy for Durable Object calls, per Cloudflare's documented
// guidance: https://developers.cloudflare.com/durable-objects/best-practices/error-handling/
const DURABLE_OBJECT_MAX_ATTEMPTS = 3;
const DURABLE_OBJECT_BACKOFF_BASE_MS = 100;
const DURABLE_OBJECT_BACKOFF_MAX_MS = 20000;

// Properties the Workers runtime stamps onto an exception that actually
// crossed the Durable Object RPC boundary (thrown by the DO's own code, or
// raised by DO infrastructure). Their absence means the exception was
// raised locally by our own callback, not by the Durable Object, so it is
// a programmer error here and must not be retried or wrapped.
const DURABLE_OBJECT_ERROR_MARKERS = [ 'remote', 'retryable', 'overloaded' ];


export default class ContentStore {

    #logger;
    #kvBindingName;
    #durableObjectBindingName;
    #wireFormat;
    #blobReadCacheTtlSeconds;
    #indexCacheTtlSeconds;
    #edgeCache;
    #scheduler;

    #pendingIndexes = new Map();

    constructor(options) {
        this.#logger = options.logger.createChild('CloudflareContentStore');
        this.#kvBindingName = options.kvBindingName;
        this.#durableObjectBindingName = options.durableObjectBindingName;
        this.#wireFormat = options.wireFormat;
        this.#blobReadCacheTtlSeconds = options.blobReadCacheTtlSeconds ?? 0;
        this.#indexCacheTtlSeconds = options.indexCacheTtlSeconds ?? 0;
        // The Cache API's default cache is a true platform global rather than
        // a request-scoped context.env binding, so it is injectable here
        // (options.edgeCache), allowing tests to supply a fake without a
        // Workers runtime.
        this.#edgeCache = options.edgeCache ?? caches.default;
        // The Scheduler API is likewise a platform global, injectable here for
        // the same reason: it lets Durable Object retry-backoff tests run
        // without a Workers runtime and without waiting out real backoff delays.
        this.#scheduler = options.scheduler ?? scheduler;
    }

    #resolveKvStore(context) {
        const kvStore = context.env[this.#kvBindingName];
        assert(kvStore, `CloudflareContentStore KV binding "${ this.#kvBindingName }" is not bound on context.env`);
        return kvStore;
    }

    #resolveDurableObject(context) {
        const namespace = context.env[this.#durableObjectBindingName];
        assert(namespace, `CloudflareContentStore KV DurableObject Namespace "${ this.#durableObjectBindingName }" is not bound on context.env`);
        return namespace.getByName(`${ DURABLE_OBJECT_NAME }#${ this.#wireFormat }`);
    }

    // Re-resolves the DurableObjectStub on every attempt because Cloudflare
    // leaves a stub "broken" after it throws — reusing it just replays the
    // same failure. Only errors flagged .retryable are retried (never
    // .overloaded ones, which would worsen the overload), and only up to
    // DURABLE_OBJECT_MAX_ATTEMPTS, with jittered exponential backoff between
    // attempts. This is safe because every ContentAddressableIndexStore
    // method called through here (getIndex, commitClosure, assignBuild) is
    // idempotent.
    async #callDurableObject(context, methodName, callback) {
        let attempt = 0;

        for (;;) {
            const durableObject = this.#resolveDurableObject(context);

            try {
                return await callback(durableObject);
            } catch (cause) {
                const isDurableObjectError = DURABLE_OBJECT_ERROR_MARKERS.some((prop) => prop in Object(cause));
                if (!isDurableObjectError) {
                    throw cause;
                }

                attempt += 1;

                if (!cause?.retryable || attempt >= DURABLE_OBJECT_MAX_ATTEMPTS) {
                    throw new OperationalError(
                        `failed to call ContentStore#${ methodName }()`,
                        { cause },
                    );
                }

                const backoffMs = Math.min(
                    DURABLE_OBJECT_BACKOFF_MAX_MS,
                    DURABLE_OBJECT_BACKOFF_BASE_MS * Math.random() * (2 ** attempt),
                );

                this.#logger.warn('durable object call failed, retrying', { methodName, attempt, backoffMs });

                await this.#scheduler.wait(backoffMs);
            }
        }
    }

    #buildIndexCacheRequest(buildId) {
        return new Request(`${ INDEX_CACHE_URL_PREFIX }/${ this.#wireFormat }/${ buildId }`);
    }

    #buildFileKey(hash) {
        return `${ hash }#${ this.#wireFormat }`;
    }

    async #fetchIndex(context, buildId) {
        const cache = this.#edgeCache;
        const cacheKey = this.#buildIndexCacheRequest(buildId);

        // The edge Cache API is shared by every isolate hitting this colo, so
        // a cache hit here avoids a Durable Object call regardless of which
        // isolate served the last request for this build.
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            return await cachedResponse.json();
        }

        this.#logger.info('index colo cache miss', { cacheKey });

        const result = await this.#callDurableObject(
            context,
            'getIndex',
            (durableObject) => durableObject.getIndex(buildId),
        );
        if (!result.success) {
            throw new OperationalError(`ContentAddressableStore#fetchIndex() was unsuccessful: ${ result.message }`);
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

        return entries;
    }

    async getIndex(context, buildId) {
        // Cache pending and resolved index promises in runtime memory, scoped
        // to the build which produced them. Freshness is checked lazily on
        // read (against cachedAt) rather than through a scheduled eviction.
        const cached = this.#pendingIndexes.get(buildId);
        if (cached && Date.now() - cached.cachedAt < this.#indexCacheTtlSeconds * 1000) {
            return cached.promise;
        }

        this.#logger.info('index instance cache miss', { buildId });

        const promise = this.#fetchIndex(context, buildId);
        const entry = { promise, cachedAt: Date.now() };

        this.#pendingIndexes.set(buildId, entry);

        // Drop a failed fetch immediately so the next call retries instead of
        // waiting out the TTL on a rejected promise, but only if this entry
        // is still current. A slow, failed fetch must not evict a newer one.
        promise.catch(() => {
            if (this.#pendingIndexes.get(buildId) === entry) {
                this.#pendingIndexes.delete(buildId);
            }
        });

        return await promise;
    }

    async getFile(context, type, _pathname, hash) {
        assertValidType(type, 'getFile');
        const kv = this.#resolveKvStore(context);

        const key = this.#buildFileKey(hash);

        return await kv.get(key, {
            type,
            cacheTtl: this.#blobReadCacheTtlSeconds,
        });
    }

    async putFile(context, type, _pathname, hash, blob) {
        assertValidType(type, 'putFile');
        if (type === 'text') {
            assert(isString(blob), 'The blob passed into putFile() must be a string when type=text');
        }
        if (type === 'arrayBuffer') {
            assert(blob instanceof ArrayBuffer, 'The blob passed into putFile() must be an ArrayBuffer when type=arrayBuffer');
        }
        const kv = this.#resolveKvStore(context);
        const key = this.#buildFileKey(hash);
        await kv.put(key, blob, { type });
    }

    async getFiles(context, type, files) {
        assertValidType(type, 'getFiles');
        const kv = this.#resolveKvStore(context);

        const keys = files.map(({ hash }) => this.#buildFileKey(hash));

        const map = await kv.get(keys, {
            type,
            cacheTtl: this.#blobReadCacheTtlSeconds,
        });

        return keys.map((key) => map.get(key));
    }

    async saveIndex(context, rootHash, entries) {
        assertNonEmptyString(rootHash, 'put index requires rootHash to be a non-empty string');
        assert(isPlainObject(entries), 'put index requires entries to be a plain Object');
        const result = await this.#callDurableObject(
            context,
            'saveIndex',
            (durableObject) => durableObject.saveIndex(rootHash, entries),
        );
        if (!result.success) {
            throw new OperationalError(`ContentStore#saveIndex() was unsuccessful: ${ result.message }`);
        }
    }

    async assignBuild(context, buildId, rootHash) {
        assertNonEmptyString(buildId, 'put index requires buildId to be a non-empty string');
        assertNonEmptyString(rootHash, 'put index requires rootHash to be a non-empty string');
        const result = await this.#callDurableObject(
            context,
            'assignBuild',
            (durableObject) => durableObject.assignBuild(buildId, rootHash),
        );
        if (!result.success) {
            throw new OperationalError(`ContentStore#assignBuild() was unsuccessful: ${ result.message }`);
        }
    }
}

function assertValidType(value, method) {
    if (!ACCEPTED_TYPES.includes(value)) {
        throw new AssertionError(`Invalid type "${ value }" passed into ContentStore#${ method }`);
    }
}
