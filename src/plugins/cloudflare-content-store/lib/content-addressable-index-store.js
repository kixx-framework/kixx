import { DurableObject } from 'cloudflare:workers';
import { assert, assertNonEmptyString, isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';


// Maximum number of closures held in #closureCache at once. Bounds memory
// in a long-lived Durable Object instance while keeping the working set
// (the current build plus recent rollback targets) resident.
const CLOSURE_CACHE_MAX_SIZE = 10;

/**
 * @typedef {['tree'|'blob', string, (number|null)?, (Object|null)?]} IndexEntryTuple
 */

/**
 * Persists immutable content-addressable index closures and the build
 * pointers that select them.
 *
 * A closure is identified by its root hash and is independent of any build.
 * Assigning or rolling back a build updates only its pointer; it does not
 * rewrite closure entries.
 * @extends DurableObject
 */
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

        // Durable Object requests must not observe a partially initialized
        // schema.
        ctx.blockConcurrencyWhile(async () => {
            await this.migrate();
        });
    }

    /**
     * Creates the index schema without modifying existing rows.
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
     * @param {string} buildId - Build identifier to resolve
     * @returns {Promise<{success: true, entries: (Object<string, IndexEntryTuple>|null)}>} Encoded index table, or null when the build is not registered
     */
    async getIndex(buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#getIndex: buildId');

        const rootHash = this.#getBuildRootHash(buildId);

        if (!rootHash) {
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
     * Persists an immutable closure under its root hash.
     *
     * Existing entries with the same root hash and pathname are preserved, so
     * repeating a successful commit is idempotent.
     * @param {string} rootHash - Root hash identifying the closure
     * @param {Object<string, IndexEntryTuple>} index - Encoded index table keyed by pathname
     * @returns {Promise<{success: true}>} Successful commit result
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

            // INSERT OR IGNORE also suppresses NOT NULL violations, so validate
            // required columns before relying on it for idempotency.
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
     * Atomically points a build at a non-empty, previously committed closure.
     * @param {string} buildId - Build identifier to assign
     * @param {string} rootHash - Root hash of the closure the build should serve
     * @returns {Promise<{success: true}>} Successful assignment result
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
