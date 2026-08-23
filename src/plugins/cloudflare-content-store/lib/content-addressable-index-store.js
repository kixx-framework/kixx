import { DurableObject } from 'cloudflare:workers';
import { assert, assertNonEmptyString, isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';


/**
 * Durable persistence for content-addressable tree closures and the build
 * pointers that reference them.
 *
 * A "closure" is an immutable set of index entries identified by its own
 * root hash, independent of any build. A "build" is a single row mapping a
 * build ID to the root hash of the closure it currently serves. Deploying
 * or rolling back a build is always a single-row write to the build's
 * pointer; it never rewrites closure content.
 */

// Maximum number of closures held in #closureCache at once. Bounds memory
// in a long-lived Durable Object instance while keeping the working set
// (the current build plus recent rollback targets) resident.
const CLOSURE_CACHE_MAX_SIZE = 10;

export default class ContentAddressableIndexStore extends DurableObject {

    #sql;

    // LRU cache keyed by root hash, bounded to CLOSURE_CACHE_MAX_SIZE entries.
    // Individual entries are safe to cache indefinitely because a closure's
    // entries never change once committed; the bound exists only to cap
    // total memory, evicting the least-recently-used closure first.
    #closureCache = new Map();

    /**
     * @param {DurableObjectState} ctx - Durable Object state, provided by the runtime.
     * @param {Object} env - Worker environment bindings, provided by the runtime.
     */
    constructor(ctx, env) {
        super(ctx, env);
        this.#sql = ctx.storage.sql;

        // Use blockConcurrencyWhile() in the constructor to run migrations and
        // initialize state before any requests are processed. This ensures the
        // schema is ready and prevents race conditions during initialization.
        ctx.blockConcurrencyWhile(async () => {
            await this.migrate();
        });
    }

    /**
     * Creates the closure_entries and builds tables if they do not already
     * exist. Safe to call repeatedly; only the constructor does so.
     * @returns {Promise<void>}
     */
    async migrate() {
        this.#sql.exec(`
            CREATE TABLE IF NOT EXISTS closure_entries (
                root_hash TEXT    NOT NULL,
                pathname  TEXT    NOT NULL,
                kind      TEXT    NOT NULL,
                hash      TEXT    NOT NULL,
                size      INTEGER,
                metadata  TEXT,
                PRIMARY KEY (root_hash, pathname)
            )
        `);

        this.#sql.exec(`
            CREATE TABLE IF NOT EXISTS builds (
                build_id  TEXT    NOT NULL PRIMARY KEY,
                root_hash TEXT    NOT NULL
            )
        `);
    }

    /**
     * Looks up the closure entries served by a build.
     * @param {string} buildId - The build to resolve.
     * @returns {Promise<{success: boolean, entries: (Object<string, import('./content-addressable-index.js').IndexEntryTuple>|null)}>} `entries` is null when no build is registered for `buildId`.
     */
    async getIndex(buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#getIndex: buildId');

        const rootHash = this.#getBuildRootHash(buildId);

        if (!rootHash) {
            // Return null for the index if no build is registered for the given buildId.
            return { success: true, entries: null };
        }

        return { success: true, entries: this.#getClosureEntries(rootHash) };
    }

    #getBuildRootHash(buildId) {
        const cursor = this.#sql.exec('SELECT root_hash FROM builds WHERE build_id = ?', buildId);
        const [ row ] = cursor.toArray();
        return row ? row.root_hash : null;
    }

    #getClosureEntries(rootHash) {
        if (this.#closureCache.has(rootHash)) {
            return this.#touchClosureCacheEntry(rootHash);
        }

        const sql = 'SELECT pathname, kind, hash, size, metadata FROM closure_entries WHERE root_hash = ?';
        const cursor = this.#sql.exec(sql, rootHash);

        const entries = {};

        for (const row of cursor) {
            const { pathname, kind, hash, size, metadata } = row;
            const parsedMetadata = isNonEmptyString(metadata) ? JSON.parse(metadata) : null;
            entries[pathname] = {
                kind,
                hash,
                size,
                metadata: parsedMetadata,
            };
        }

        this.#setClosureCacheEntry(rootHash, entries);
        return entries;
    }

    // Map preserves insertion order, so re-inserting a key on access moves it
    // to the end, making the first key in iteration order the least recently
    // used one.
    #touchClosureCacheEntry(rootHash) {
        const entries = this.#closureCache.get(rootHash);
        this.#closureCache.delete(rootHash);
        this.#closureCache.set(rootHash, entries);
        return entries;
    }

    #setClosureCacheEntry(rootHash, entries) {
        this.#closureCache.set(rootHash, entries);

        if (this.#closureCache.size > CLOSURE_CACHE_MAX_SIZE) {
            const leastRecentlyUsedKey = this.#closureCache.keys().next().value;
            this.#closureCache.delete(leastRecentlyUsedKey);
        }
    }

    /**
     * Writes an immutable closure's entries, keyed by its own root hash.
     * Idempotent: a closure already present under rootHash is left
     * untouched, since the same hash always implies the same content.
     * @param {string} rootHash - Root hash identifying the closure.
     * @param {Object<string, import('./content-addressable-index.js').IndexEntryTuple>} index - Encoded index table to persist, keyed by pathname.
     * @returns {Promise<{success: boolean}>}
     */
    async commitClosure(rootHash, index) {
        assertNonEmptyString(rootHash, 'ContentAddressableIndexStore#commitClosure: rootHash');
        assert(isPlainObject(index), 'ContentAddressableIndexStore#commitClosure: index must be a plain object');

        const sql = `
            INSERT OR IGNORE INTO closure_entries (root_hash, pathname, kind, hash, size, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const pathnames = Object.keys(index);
        for (const pathname of pathnames) {
            const [ kind, hash, size, metadata ] = index[pathname];

            // Validate every column bound for insertion, not just metadata:
            // closure_entries.kind and .hash are NOT NULL, and this statement
            // uses INSERT OR IGNORE for commit idempotency, which would
            // otherwise silently drop a malformed row on a NOT NULL
            // violation instead of failing loudly.
            assert(
                kind === 'tree' || kind === 'blob',
                `ContentAddressableIndexStore#commitClosure: entry "${ pathname }" kind must be "tree" or "blob"`,
            );
            assertNonEmptyString(hash, `ContentAddressableIndexStore#commitClosure: entry "${ pathname }" hash`);
            assert(
                metadata === null || isPlainObject(metadata),
                `ContentAddressableIndexStore#commitClosure: entry "${ pathname }" metadata must be a plain object or null`,
            );

            const metadataJson = metadata === null ? null : JSON.stringify(metadata);

            this.#sql.exec(
                sql,
                rootHash,
                pathname,
                kind,
                hash,
                size ?? null,
                metadataJson,
            );
        }

        return { success: true };
    }

    /**
     * Atomically points a build at a closure. Used for both deploying a new
     * version and rolling back to a previously committed one — in either
     * case this is the only write a build ever needs.
     * @param {string} buildId - The build to assign.
     * @param {string} rootHash - Root hash of an already-committed closure.
     * @returns {Promise<{success: boolean}>}
     */
    async assignBuild(buildId, rootHash) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#assignBuild: buildId');
        assertNonEmptyString(rootHash, 'ContentAddressableIndexStore#assignBuild: rootHash');

        const closureRows = this.#sql.exec(
            'SELECT 1 FROM closure_entries WHERE root_hash = ? LIMIT 1',
            rootHash,
        ).toArray();
        assert(
            closureRows.length > 0,
            `ContentAddressableIndexStore#assignBuild: no closure exists for root hash "${ rootHash }"`,
        );

        this.#sql.exec(`
            INSERT INTO builds (build_id, root_hash)
            VALUES (?, ?)
            ON CONFLICT(build_id) DO UPDATE SET root_hash = EXCLUDED.root_hash
        `, buildId, rootHash);

        return { success: true };
    }
}
