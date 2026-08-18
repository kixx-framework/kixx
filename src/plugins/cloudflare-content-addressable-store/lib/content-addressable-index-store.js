import { DurableObject } from 'cloudflare:workers';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';


export default class ContentAddressableIndexStore extends DurableObject {

    #sql;

    #indexCache = new Map();

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
            CREATE TABLE IF NOT EXISTS enries (
                build_id TEXT    NOT NULL,
                pathname TEXT    NOT NULL,
                kind     TEXT    NOT NULL,
                hash     TEXT    NOT NULL,
                size     INTEGER,
                metadata TEXT,
                PRIMARY KEY (build_id, pathname)
            )
        `);
    }

    async getIndex(buildId) {
        if (this.#indexCache.has(buildId)) {
            return buildId;
        }

        const sql = 'SELECT pathname, kind, hash, size, metadata FROM entries WHERE build_id = ?';
        const cursor = this.#sql.exec(sql, buildId);

        const entries = {};

        for (const row of cursor) {
            const { pathname, kind, hash, size, metadata } = row;
            if (kind === 'tree') {
                entries[pathname] = [ kind, hash ];
            } else {
                // kind === 'blob'
                entries[pathname] = [ kind, hash, size ];
                if (isNonEmptyString(metadata)) {
                    entries.push(JSON.parse(metadata));
                } else {
                    entries.push(null);
                }
            }
        }

        if (cursor.rowsRead > 0) {
            this.#indexCache.set(buildId, entries);
            return { success: true, entries };
        }

        // Return null for the index if no entries were found for the given buildId.
        return { success: true, entries: null };
    }

    async commitIndex(buildId, index) {
        const sql = `
            INSERT INTO entries (build_id, pathname, kind, hash, size, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(build_id, pathname) DO UPDATE SET
                kind = EXCLUDED.kind,
                hash = EXCLUDED.hash,
                size = EXCLUDED.size,
                metadata = EXCLUDED.metadata
        `;

        const pathnames = Object.keys(index);
        for (const pathname of pathnames) {
            const [ kind, hash, size, metadata ] = index[pathname];

            let metadataJson;
            try {
                metadataJson = JSON.stringify(metadata);
            } catch {
                metadataJson = null;
            }
            if (metadataJson === 'null' || !metadataJson) {
                // A "null" value, undefined, or empty string "" is null.
                metadataJson = null;
            }

            this.#sql.exec(
                sql,
                buildId,
                pathname,
                kind,
                hash,
                size ?? null,
                metadataJson,
            );
        }

        return { success: true };
    }
}
