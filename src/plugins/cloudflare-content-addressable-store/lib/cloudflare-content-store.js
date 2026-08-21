import {
    AssertionError,
    OperationalError,
    ValidationError,
} from '../../../kixx/errors/mod.js';
import {
    isNonEmptyString,
    assert,
} from '../../../kixx/assertions/mod.js';
import ContentAddressableIndex, { getRootHash } from './content-addressable-index.js';
import ContentSnapshot from './content-snapshot.js';
import {
    FORMAT,
    KEY,
    stringToUint8Array,
    typedArrayToBuffer,
    hashBlob,
    hashEtag,
    hashValue,
    canonicalize,
} from './addressing.js';


const DURABLE_OBJECT_NAME = `ContentAddressableStore:${ FORMAT }`;
// Not a real destination, only a stable Cache API key; index cache entries
// never leave the colo that wrote them.
const INDEX_CACHE_URL_PREFIX = `https://content-addressable-store.internal/index/${ FORMAT }/`;
const BLOB_READ_CONCURRENCY = 6;
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


/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 * @typedef {import('./content-addressable-index.js').IndexEntry} IndexEntry
 * @typedef {import('./content-addressable-index.js').IndexSourceFile} IndexSourceFile
 */

/**
 * Coordinates content-addressable persistence through request-scoped
 * Cloudflare KV and Durable Object bindings.
 *
 * Blobs are read and written directly against a KV binding. The index — the
 * mapping of a build to the closure of paths it serves — is read through an
 * in-memory promise cache and the platform's edge Cache API before falling
 * back to a Durable Object, and is always written straight through to the
 * Durable Object, which is the single source of truth.
 *
 * Blob retention is intentionally unbounded: blobs are immutable, have no
 * KV TTL, and are never deleted. This keeps cached blob reads safe without
 * invalidation and permits rollback to every historical closure. If storage
 * reclamation becomes necessary, it must first define a closure-retention
 * policy, then sweep only blob hashes absent from the union of closures
 * reachable through every build pointer.
 *
 * @implements {import('../../../kixx/content-store/content-addressable-store-interface.js').ContentAddressableStoreInterface}
 */
export default class CloudflareContentStore {

    #logger;
    #kvBindingName;
    #durableObjectBindingName;
    #edgeCache;
    #scheduler;
    #pendingIndexes = new Map();

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Logger used for index-fetch and Durable Object retry diagnostics
     * @param {string} options.kvBindingName - Name of the `context.env` binding for the blob KV namespace
     * @param {string} options.durableObjectBindingName - Name of the `context.env` binding for the index Durable Object namespace
     * @param {Cache} [options.edgeCache] - Cache API instance backing the index cache; defaults to `caches.default`. Injectable so tests can supply a fake without a Workers runtime.
     * @param {{wait: function(number): Promise<void>}} [options.scheduler] - Scheduler used to back off between Durable Object retries; defaults to the platform `scheduler` global. Injectable so tests can supply a fake without a Workers runtime.
     * @param {number} options.blobReadCacheTtlSeconds - `cacheTtl` passed to KV reads for blob bytes
     * @param {number} options.indexCacheTtlSeconds - Time-to-live, in seconds, for both the in-memory pending-index cache and the edge Cache API's `cache-control: max-age`
     */
    constructor(options) {
        this.#logger = options.logger;
        this.#kvBindingName = options.kvBindingName;
        this.#durableObjectBindingName = options.durableObjectBindingName;
        // The Cache API's default cache is a true platform global rather than
        // a request-scoped context.env binding, so it is injectable here
        // (options.edgeCache) the same way ContentAddressableStore injects a
        // whole #store, allowing tests to supply a fake without a Workers runtime.
        this.#edgeCache = options.edgeCache ?? caches.default;
        // The Scheduler API is likewise a platform global, injectable here for
        // the same reason: it lets Durable Object retry-backoff tests run
        // without a Workers runtime and without waiting out real backoff delays.
        this.#scheduler = options.scheduler ?? scheduler;
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
                        `CloudflareContentStore failed to call ContentAddressableIndexStore#${ methodName }()`,
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

    /**
     * Resolves the content-addressable index for the current build, the
     * table of every pathname it serves. Reads are served, in order, from an
     * in-memory promise cache, the edge Cache API, and finally a Durable
     * Object call, each layer refreshed lazily once `indexCacheTtlSeconds`
     * elapses.
     * @param {RequestContext} context - Request context carrying the current build ID and platform bindings
     * @returns {Promise<import('./content-addressable-index.js').default>} Index for `context.runtime.build.id`
     * @throws {AssertionError} When no index has been committed for the current build
     * @throws {OperationalError} When the index store call fails or reports an unsuccessful result
     */
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

    /**
     * Computes a deterministic digest for a primitive or canonicalizable value.
     * @param {*} value - Value to hash
     * @returns {Promise<string>} Content digest in the current wire format
     * @throws {TypeError} When a non-primitive value cannot be canonicalized
     */
    async hashValue(value) {
        return await hashValue(value);
    }

    /**
     * Opens a request-scoped view pinned to one immutable content index.
     * All reads through the returned snapshot use the index resolved here,
     * even if the build is reassigned before the request completes.
     * @param {RequestContext} context - Request context carrying the current build ID and platform bindings
     * @returns {Promise<ContentSnapshot>} Snapshot valid only for this request
     */
    async openSnapshot(context) {
        const index = await this.getIndex(context);
        return new ContentSnapshot({ store: this, context, index });
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

        this.#logger.info('fetching index', { buildId });

        const result = await this.#callDurableObject(
            context,
            'getIndex',
            (durableObject) => durableObject.getIndex(buildId),
        );
        if (!result.success) {
            throw new OperationalError(`CloudflareContentStore#fetchIndex() was unsuccessful: ${ result.message }`);
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

    /**
     * Looks up a single node in the current build's index by exact pathname.
     * @param {RequestContext} context - Request context carrying the current build ID
     * @param {string} pathname - The pathname to look up, including a leading slash "/"
     * @returns {Promise<IndexEntry|null>} The matching node, or null when no entry exists at that pathname
     */
    async statPath(context, pathname) {
        const index = await this.getIndex(context);
        return index.getNode(pathname);
    }

    /**
     * Lists the nodes under a directory in the current build's index.
     * @param {RequestContext} context - Request context carrying the current build ID
     * @param {string} prefix - Directory pathname; a trailing slash "/" is added if missing
     * @param {Object} [options]
     * @param {boolean} [options.recursive=true] - When false, only list the prefix's immediate children — nested nodes are skipped
     * @returns {Promise<IndexEntry[]>} Matching nodes in pathname sort order
     */
    async listStats(context, prefix, options) {
        const { recursive = true } = options ?? {};
        const index = await this.getIndex(context);
        if (!prefix.endsWith('/')) {
            prefix = prefix + '/';
        }
        return index.listNodes(prefix, { recursive });
    }

    /**
     * Writes a blob's bytes to KV under its content hash, independent of the
     * `commitClosure`/`assignBuild` step that makes it reachable through a
     * build's index.
     * @param {RequestContext} context - Request context carrying the KV binding
     * @param {string} pathname - Logical pathname the blob will be indexed under; carried through to the returned descriptor only, not used as the storage key
     * @param {Uint8Array} blob - Blob bytes to store
     * @param {Object|null} metadata - Caller-supplied metadata to associate with the blob, carried through to the returned descriptor
     * @param {string} [etag] - Previously computed etag to verify against; when supplied it must match the etag recomputed from `blob` and `metadata`
     * @returns {Promise<{pathname: string, hash: string, size: number, metadata: (Object|null)}>} Descriptor suitable for inclusion in the `files` array passed to `commitClosure`/`commitChanges`
     * @throws {ValidationError} When `etag` is supplied and does not match the recomputed etag
     */
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

    /**
     * Encodes text as UTF-8 and writes it through the blob write path.
     * @param {RequestContext} context - Request context carrying the KV binding
     * @param {string} pathname - Logical pathname the blob will be indexed under
     * @param {string} text - Text to encode and store
     * @param {Object|null} metadata - Caller-supplied metadata to associate with the blob
     * @param {string} [etag] - Previously computed etag to verify against
     * @returns {Promise<{pathname: string, hash: string, size: number, metadata: (Object|null)}>} Descriptor suitable for inclusion in `files`
     * @throws {ValidationError} When `etag` does not match the recomputed etag
     */
    async putUtf8(context, pathname, text, metadata, etag) {
        return await this.putBlob(context, pathname, stringToUint8Array(text), metadata, etag);
    }

    /**
     * Canonically serializes a value and writes it through the blob write path.
     * @param {RequestContext} context - Request context carrying the KV binding
     * @param {string} pathname - Logical pathname the blob will be indexed under
     * @param {*} value - JSON-compatible value to canonically serialize and store
     * @param {Object|null} metadata - Caller-supplied metadata to associate with the blob
     * @param {string} [etag] - Previously computed etag to verify against
     * @returns {Promise<{pathname: string, hash: string, size: number, metadata: (Object|null)}>} Descriptor suitable for inclusion in `files`
     * @throws {TypeError} When `value` cannot be canonically serialized
     * @throws {ValidationError} When `etag` does not match the recomputed etag
     */
    async putObject(context, pathname, value, metadata, etag) {
        return await this.putUtf8(context, pathname, canonicalize(value), metadata, etag);
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

        this.#logger.info('commit closure', { rootHash });

        const result = await this.#callDurableObject(
            context,
            'commitClosure',
            (durableObject) => durableObject.commitClosure(rootHash, entries),
        );

        if (!result.success) {
            throw new OperationalError(`CloudflareContentStore#commitClosure() was unsuccessful: ${ result.message }`);
        }

        // The encoded table is private to this write path; no caller outside
        // this adapter needs it. Compute the stable descriptor here, while the
        // table is still in hand, rather than exposing it for callers to
        // re-derive the same two values.
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
        this.#logger.info('assign build', { buildId, rootHash });

        const result = await this.#callDurableObject(
            context,
            'assignBuild',
            (durableObject) => durableObject.assignBuild(buildId, rootHash),
        );
        if (!result.success) {
            throw new OperationalError(`CloudflareContentStore#assignBuild() was unsuccessful: ${ result.message }`);
        }
        this.#invalidateIndex(buildId);

        // Purge this colo's edge cache entry so the deploying request sees the
        // new build immediately. Every other colo still picks it up within
        // indexCacheTtlSeconds via the cache-control max-age set in
        // #fetchIndex().
        await this.#edgeCache.delete(this.#buildIndexCacheRequest(buildId));
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

    /**
     * Reads a single blob's bytes by content hash.
     * @param {RequestContext} context - Request context carrying the KV binding
     * @param {string} hash - Content hash identifying the blob, such as one returned from `putBlob` or an `IndexEntry.hash`
     * @returns {Promise<Uint8Array|null>} The blob's bytes, or null when no blob exists under `hash`
     */
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

    /**
     * Reads several blobs' bytes by content hash, in batches of
     * `BLOB_READ_CONCURRENCY` concurrent KV reads.
     * @param {RequestContext} context - Request context carrying the KV binding
     * @param {string[]} hashes - Content hashes to read
     * @returns {Promise<Array<Uint8Array|null>>} Bytes for each hash, in the same order as `hashes`; an entry is null when no blob exists under that hash
     */
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
