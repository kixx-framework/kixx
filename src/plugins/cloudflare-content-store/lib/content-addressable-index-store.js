import { DurableObject } from 'cloudflare:workers';
import { assert, assertNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';
import { BUILD_ASSIGNMENT_OUTCOME } from '../../../kixx/content-addressable-store/content-store-interface.js';
import { decodeStorageRow, encodeStorageRow } from './index-entry-codec.js';


// Maximum number of closures held in #closureCache at once. Bounds memory
// in a long-lived Durable Object instance while keeping the working set
// (the current build plus recent rollback targets) resident.
const CLOSURE_CACHE_MAX_SIZE = 10;

/**
 * @typedef {import('./index-entry-codec.js').IndexEntryTuple} IndexEntryTuple
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
                build_id   TEXT    NOT NULL PRIMARY KEY,
                root_hash  TEXT    NOT NULL,
                assigned_at TEXT   NOT NULL
            )
        `);

        this.#sql.exec(`
            CREATE TABLE IF NOT EXISTS objects (
                hash TEXT    NOT NULL PRIMARY KEY,
                size INTEGER NOT NULL
            )
        `);
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
            entries[row.pathname] = decodeStorageRow(row);
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
     * Looks up the closure currently assigned to a build.
     * @param {string} buildId - Build identifier to resolve
     * @returns {Promise<{success: true, rootHash: (string|null), entries: (Object<string, IndexEntryTuple>|null)}>} The assigned root hash and its closure entries, both null when the build is not registered
     */
    async getBuild(buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#getBuild: buildId');

        const rootHash = this.#getBuildRootHash(buildId);

        if (!rootHash) {
            return { success: true, rootHash: null, entries: null };
        }

        return { success: true, rootHash, entries: this.#getClosureEntries(rootHash) };
    }

    async getIndex(rootHash) {
        assertNonEmptyString(rootHash, 'ContentAddressableIndexStore#getIndex: rootHash');
        const entries = this.#getClosureEntries(rootHash);
        return { success: true, entries: Object.keys(entries).length ? entries : null };
    }

    /**
     * Retrieves pointer metadata without loading closure entries.
     * @param {string} buildId - Build identifier to resolve
     * @returns {Promise<{success: true, pointer: ({rootHash: string, assignedAt: string}|null)}>} Pointer result
     */
    async getBuildPointer(buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#getBuildPointer: buildId');
        const [ row ] = this.#sql.exec(
            'SELECT root_hash, assigned_at FROM builds WHERE build_id = ?',
            buildId,
        ).toArray();
        const pointer = row ? { rootHash: row.root_hash, assignedAt: row.assigned_at } : null;
        return { success: true, pointer };
    }

    /**
     * Lists every build pointer newest assignment first.
     * @returns {Promise<{success: true, builds: Array<{buildId: string, rootHash: string, assignedAt: string}>}>}
     */
    async listBuilds() {
        const cursor = this.#sql.exec(`
            SELECT build_id, root_hash, assigned_at
            FROM builds
            ORDER BY assigned_at DESC, build_id ASC
        `);
        const builds = Array.from(cursor, (row) => ({
            buildId: row.build_id,
            rootHash: row.root_hash,
            assignedAt: row.assigned_at,
        }));
        return { success: true, builds };
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
    async saveIndex(rootHash, index) {
        assertNonEmptyString(rootHash, 'ContentAddressableIndexStore#saveIndex: rootHash');
        assert(isPlainObject(index), 'ContentAddressableIndexStore#saveIndex: index must be a plain object');

        const sql = `
            INSERT OR IGNORE INTO closure_entries (root_hash, pathname, kind, hash, size, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const pathnames = Object.keys(index);
        for (const pathname of pathnames) {
            const { kind, hash, size, metadata } = encodeStorageRow(pathname, index[pathname]);

            this.#sql.exec(
                sql,
                rootHash,
                pathname,
                kind,
                hash,
                size,
                metadata,
            );
        }

        return { success: true };
    }

    /**
     * Records a blob after its KV write succeeds.
     *
     * Keeping this registry in the Durable Object makes positive existence
     * results strongly consistent without fetching potentially large KV
     * values. The additional write accompanies an object transfer which
     * already dominates the operation's cost.
     * @param {string} hash - Content hash identifying the blob
     * @param {number} size - Stored payload size in bytes
     * @returns {Promise<{success: true}>}
     */
    async registerFile(hash, size) {
        assertNonEmptyString(hash, 'ContentAddressableIndexStore#registerFile: hash');
        assert(Number.isInteger(size) && size >= 0, 'ContentAddressableIndexStore#registerFile: size');
        this.#sql.exec('INSERT OR REPLACE INTO objects (hash, size) VALUES (?, ?)', hash, size);
        return { success: true };
    }

    /**
     * Reports registered blob sizes in the same order as the requested hashes.
     * @param {string[]} hashes - Content hashes to inspect
     * @returns {Promise<{success: true, files: Array<({size: number}|null)>}>}
     */
    async statFiles(hashes) {
        assert(Array.isArray(hashes), 'ContentAddressableIndexStore#statFiles: hashes');
        assert(hashes.length <= 100, 'ContentAddressableIndexStore#statFiles accepts at most 100 hashes');

        const statement = 'SELECT size FROM objects WHERE hash = ?';
        const files = hashes.map((hash, index) => {
            assertNonEmptyString(hash, `ContentAddressableIndexStore#statFiles: hashes[${ index }]`);
            const [ row ] = this.#sql.exec(statement, hash).toArray();
            return row ? { size: row.size } : null;
        });
        return { success: true, files };
    }

    /**
     * Atomically points a build at a non-empty, previously committed closure,
     * optionally only when the build's current pointer still equals
     * `expectedRootHash`.
     *
     * A Durable Object instance runs at most one method at a time, and every
     * check and write below is synchronous SQLite storage access with no
     * `await` between them, so the read-compare-write sequence cannot be
     * interleaved by a concurrent call.
     * @param {string} buildId - Build identifier to assign
     * @param {{rootHash: string, expectedRootHash?: (string|null)}} assignment - Desired closure and optional pointer precondition
     * @returns {Promise<{success: true, outcome: import('../../../kixx/content-addressable-store/content-store-interface.js').ContentBuildAssignmentOutcome}>}
     */
    async assignBuild(buildId, assignment) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#assignBuild: buildId');
        assert(isPlainObject(assignment), 'ContentAddressableIndexStore#assignBuild: assignment must be a plain object');

        const { rootHash, expectedRootHash } = assignment;
        assertNonEmptyString(rootHash, 'ContentAddressableIndexStore#assignBuild: rootHash');

        const closureRows = this.#sql.exec(
            'SELECT 1 FROM closure_entries WHERE root_hash = ? LIMIT 1',
            rootHash,
        ).toArray();
        if (closureRows.length === 0) {
            return { success: true, outcome: BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE };
        }

        if (expectedRootHash !== undefined) {
            if (expectedRootHash !== null) {
                assertNonEmptyString(expectedRootHash, 'ContentAddressableIndexStore#assignBuild: expectedRootHash');
            }
            if (this.#getBuildRootHash(buildId) !== expectedRootHash) {
                return { success: true, outcome: BUILD_ASSIGNMENT_OUTCOME.CONFLICT };
            }
        }

        const assignedAt = new Date().toISOString();
        this.#sql.exec(`
            INSERT INTO builds (build_id, root_hash, assigned_at)
            VALUES (?, ?, ?)
            ON CONFLICT(build_id) DO UPDATE SET
                root_hash = EXCLUDED.root_hash,
                assigned_at = EXCLUDED.assigned_at
        `, buildId, rootHash, assignedAt);

        return { success: true, outcome: BUILD_ASSIGNMENT_OUTCOME.ASSIGNED };
    }
}
