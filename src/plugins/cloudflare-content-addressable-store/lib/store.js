import { AssertionError, ValidationError } from '../../../kixx/errors/mod.js';
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
    canonicalize,
    hashBlob,
    hashEtag,
    hashSet,
} from './addressing.js';


const DURABLE_OBJECT_NAME = `ContentAddressableStore:${ FORMAT }`;


export default class Store {

    #logger;
    #kvBindingName;
    #d1BindingName;
    #durableObjectBindingName;
    #pendingIndex = null;

    constructor(options) {
        this.#logger = options.logger;
        this.#kvBindingName = options.kvBindingName;
        this.#d1BindingName = options.d1BindingName;
        this.#durableObjectBindingName = options.durableObjectBindingName;
        this.blobReadCacheTtlSeconds = options.blobReadCacheTtlSeconds;
        this.indexCacheTtlSeconds = options.indexCacheTtlSeconds;
    }

    #resolveKvStore(context) {
        const kvStore = context.env[this.#kvBindingName];
        assert(kvStore, `ContentAddressableStore KV binding "${ this.#kvBindingName }" is not bound on context.env`);
        return kvStore;
    }

    #resolveD1Database(context) {
        const db = context.env[this.#d1BindingName];
        assert(db, `ContentAddressableStore D1 binding "${ this.#d1BindingName }" is not bound on context.env`);
        return db;
    }

    #resolveDurableObject(context) {
        const namespace = context.env[this.#durableObjectBindingName];
        assert(namespace, `ContentAddressableStore KV DurableObject Namespace "${ this.#durableObjectBindingName }" is not bound on context.env`);
        return namespace.getByName(DURABLE_OBJECT_NAME);
    }

    async getIndex(context) {
        // We cache pending index promises for a few moments in runtime memory.
        if (this.#pendingIndex) {
            return this.#pendingIndex;
        }

        const durableObject = this.#resolveDurableObject(context);
        const buildId = context.runtime.build.id;

        this.#logger.info('fetching index', { buildId });

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
                { code: 'CA_STORE_INTEGRITY_CHECK_FAILED', etag: computedEtag },
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

    async touchBlob(context, stats) {
        const {
            pathname,
            hash,
            size,
            metadata,
        } = stats;

        const db = this.#resolveD1Database(context);

        const etag = await hashEtag(hash, metadata);

        const now = new Date().toISOString();
        const updatedAt = now;
        const createdAt = now;

        const sql = `
            INSERT INTO staged_blobs (pathname, hash, etag, metadata, size, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pathname) DO UPDATE SET
                hash = EXCLUDED.hash,
                etag = EXCLUDED.etag,
                metadata = EXCLUDED.metadata,
                size = EXCLUDED.size,
                updated_at = EXCLUDED.updated_at
            RETURNING created_at, updated_at
        `;

        const stmt = db.prepare(sql).bind(
            pathname,
            hash,
            etag,
            canonicalize(metadata),
            size,
            createdAt,
            updatedAt,
        );

        const row = await stmt.first();

        return {
            pathname,
            hash,
            etag,
            metadata,
            size,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
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
