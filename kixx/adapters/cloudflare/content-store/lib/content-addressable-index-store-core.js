import { assert, assertNonEmptyString, isPlainObject } from '../../../../assertions/mod.js';
import { HISTORY_LIMITS } from '../../../../content-addressable-store/publishing-history.js';
import assignBuild, { BUILD_POINTER_COLUMNS, pointerFromRow } from './assign-build.js';
import initializeSchema from './initialize-schema.js';
import { decodeStorageRow, encodeStorageRow } from './index-entry-codec.js';


// Maximum number of closures held in #closureCache at once. Bounds memory
// in a long-lived Durable Object instance while keeping the working set
// (the current build plus recent rollback targets) resident.
const CLOSURE_CACHE_MAX_SIZE = 10;

const ACTIVATION_COLUMNS = `
    sequence, build_id, assignment_id, from_release_id, to_release_id, activated_at,
    reason, actor_type, actor_id, actor_name, source_revision, summary, force_reason
`;

/**
 * @typedef {import('./index-entry-codec.js').IndexEntryTuple} IndexEntryTuple
 */

/**
 * Persists immutable content-addressable index closures, the build pointers
 * that select them, and the Activation recorded with each changed assignment.
 *
 * A closure is identified by its root hash and is independent of any build.
 * Assigning or rolling back a build updates only its pointer; it does not
 * rewrite closure entries. History is append-only.
 *
 * This class holds all the behavior of the ContentAddressableIndexStore
 * Durable Object. It imports no platform module and takes the Durable Object
 * state from its caller, so unit tests can run it on a fake state.
 */
export default class ContentAddressableIndexStoreCore {

    #ctx;

    #sql;

    #now;

    #randomUUID;

    // LRU cache keyed by root hash, bounded to CLOSURE_CACHE_MAX_SIZE entries.
    // Individual entries are safe to cache indefinitely because a closure's
    // entries never change once committed; the bound exists only to cap
    // total memory, evicting the least-recently-used closure first.
    #closureCache = new Map();

    /**
     * @param {Object} options
     * @param {DurableObjectState} options.ctx - Durable Object state, provided by the runtime.
     * @param {Object} [options.env] - Worker environment bindings, provided by the runtime. Accepted for the Durable Object's constructor shape; nothing reads it today.
     * @param {function(): number} [options.now] - Clock returning milliseconds; stamps assignments and Release records; helpful for testing
     * @param {function(): string} [options.randomUUID] - Source of assignment identities; helpful for testing
     */
    constructor(options) {
        const { ctx } = options;

        this.#ctx = ctx;
        this.#sql = ctx.storage.sql;
        this.#now = options.now ?? (() => Date.now());
        this.#randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

        /**
         * Settles when the schema is initialized. Rejects when the storage
         * holds an incompatible schema.
         * @name ready
         * @type {Promise<void>}
         */
        // Durable Object requests must not observe a partially initialized
        // schema.
        this.ready = ctx.blockConcurrencyWhile(async () => {
            await this.migrate();
        });
    }

    /**
     * Creates the index schema without modifying existing rows.
     * @returns {Promise<void>}
     */
    async migrate() {
        this.#ctx.storage.transactionSync(() => initializeSchema(this.#sql));
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
     * @returns {Promise<{success: true, pointer: (import('../../../../content-addressable-store/content-store-interface.js').ContentBuildPointer|null)}>} Pointer result
     */
    async getBuildPointer(buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableIndexStore#getBuildPointer: buildId');
        const [ row ] = this.#sql.exec(
            `SELECT ${ BUILD_POINTER_COLUMNS } FROM builds WHERE build_id = ?`,
            buildId,
        ).toArray();
        return { success: true, pointer: row ? pointerFromRow(row) : null };
    }

    /**
     * Lists every build pointer newest assignment first.
     * @returns {Promise<{success: true, builds: Array<import('../../../../content-addressable-store/content-store-interface.js').ListedContentBuildPointer>}>}
     */
    async listBuilds() {
        const cursor = this.#sql.exec(`
            SELECT build_id, ${ BUILD_POINTER_COLUMNS }
            FROM builds
            ORDER BY assigned_at DESC, build_id ASC
        `);
        const builds = Array.from(cursor, (row) => ({ buildId: row.build_id, ...pointerFromRow(row) }));
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
     * optionally only when the build's current assignment identity still equals
     * `expectedAssignmentId`.
     *
     * The checks, the pointer write, and the Activation insert run in one
     * synchronous transaction: another call cannot interleave them, and a
     * failure at any step undoes every write.
     * @param {string} buildId - Build identifier to assign
     * @param {import('../../../../content-addressable-store/content-store-interface.js').ContentBuildAssignment} assignment - Desired closure, optional pointer precondition, the Activation to record, and optional code info
     * @returns {Promise<import('../../../../content-addressable-store/content-store-interface.js').ContentBuildAssignmentResult & {success: true}>}
     */
    async assignBuild(buildId, assignment) {
        const stamps = { now: this.#now, randomUUID: this.#randomUUID };
        const result = this.#ctx.storage.transactionSync(() => assignBuild(this.#sql, buildId, assignment, stamps));
        return { success: true, ...result };
    }

    /**
     * Lists Activations newest first, for one build or across every build.
     * @param {Object} page
     * @param {(string|null)} [page.buildId] - Only this build's Activations; every build's when null
     * @param {number} page.limit - Page size, 1 to 100
     * @param {(number|null)} [page.before] - Sequence to continue after; the newest row when null
     * @returns {Promise<{success: true, items: Array<import('../../../../content-addressable-store/content-store-interface.js').ContentActivation>, nextSequence: (number|null)}>}
     */
    async listActivations(page) {
        const label = 'ContentAddressableIndexStore#listActivations: page';
        const { limit, before } = assertHistoryPage(page, label);
        const buildId = page.buildId ?? null;
        if (buildId !== null) {
            assertNonEmptyString(buildId, `${ label }.buildId`);
        }

        const conditions = [];
        const bindings = [];
        if (before !== null) {
            conditions.push('sequence < ?');
            bindings.push(before);
        }
        if (buildId !== null) {
            conditions.push('build_id = ?');
            bindings.push(buildId);
        }
        const where = conditions.length ? `WHERE ${ conditions.join(' AND ') }` : '';

        const rows = this.#sql.exec(
            `SELECT ${ ACTIVATION_COLUMNS } FROM activations ${ where } ORDER BY sequence DESC LIMIT ?`,
            ...bindings,
            limit + 1,
        ).toArray();

        return { success: true, ...pageFromRows(rows, limit, activationFromRow) };
    }
}

function assertHistoryPage(page, label) {
    assert(isPlainObject(page), `${ label } must be a plain object`);

    const { limit } = page;
    const before = page.before ?? null;
    assert(
        Number.isInteger(limit) && limit >= 1 && limit <= HISTORY_LIMITS.pageSize,
        `${ label }.limit must be an integer from 1 to ${ HISTORY_LIMITS.pageSize }`,
    );
    assert(
        before === null || (Number.isSafeInteger(before) && before >= 1),
        `${ label }.before must be a positive integer`,
    );

    return { limit, before };
}

// The query asked for one row more than the page holds. When it came back,
// another page follows, and it continues after the last row kept.
function pageFromRows(rows, limit, mapRow) {
    const kept = rows.slice(0, limit);
    const nextSequence = rows.length > limit ? kept.at(-1).sequence : null;
    return { items: kept.map(mapRow), nextSequence };
}

function activationFromRow(row) {
    return {
        buildId: row.build_id,
        assignmentId: row.assignment_id,
        fromReleaseId: row.from_release_id,
        toReleaseId: row.to_release_id,
        activatedAt: row.activated_at,
        reason: row.reason,
        actor: { type: row.actor_type, id: row.actor_id, name: row.actor_name },
        sourceRevision: row.source_revision,
        summary: row.summary,
        forceReason: row.force_reason,
    };
}
