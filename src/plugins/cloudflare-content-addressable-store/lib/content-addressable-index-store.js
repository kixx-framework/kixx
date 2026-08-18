import { DurableObject } from 'cloudflare:workers';
import { assert, isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';
import { encodeIndexEntry, decodeIndexEntryTuple } from './content-addressable-index.js';


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
export default class ContentAddressableIndexStore extends DurableObject {

    #sql;

    // Keyed by root hash. Safe to cache forever because a closure's entries
    // never change once committed.
    #closureCache = new Map();

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

    async getIndex(buildId) {
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
            return this.#closureCache.get(rootHash);
        }

        const sql = 'SELECT pathname, kind, hash, size, metadata FROM closure_entries WHERE root_hash = ?';
        const cursor = this.#sql.exec(sql, rootHash);

        const entries = {};

        for (const row of cursor) {
            const { pathname, kind, hash, size, metadata } = row;
            const parsedMetadata = isNonEmptyString(metadata) ? JSON.parse(metadata) : null;
            entries[pathname] = encodeIndexEntry(kind, { hash, size, metadata: parsedMetadata });
        }

        this.#closureCache.set(rootHash, entries);
        return entries;
    }

    /**
     * Writes an immutable closure's entries, keyed by its own root hash.
     * Idempotent: a closure already present under rootHash is left
     * untouched, since the same hash always implies the same content.
     */
    async commitClosure(rootHash, index) {
        const sql = `
            INSERT OR IGNORE INTO closure_entries (root_hash, pathname, kind, hash, size, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const pathnames = Object.keys(index);
        for (const pathname of pathnames) {
            const { kind, hash, size, metadata } = decodeIndexEntryTuple(index[pathname]);

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
     */
    async assignBuild(buildId, rootHash) {
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
