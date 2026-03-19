import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WrappedError } from '../errors.js';
import {
    DocumentNotFoundError,
    IndexNotConfiguredError,
    VersionConflictError
} from '../datastore/errors.js';

const DOCUMENTS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS documents (
        type       TEXT    NOT NULL,
        id         TEXT    NOT NULL,
        sort_key   TEXT,
        doc        TEXT    NOT NULL,
        version    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL,
        PRIMARY KEY (type, id)
    )
`;

const DEFAULT_INDEX_SQL = `
    CREATE INDEX IF NOT EXISTS idx_type_sort_key
        ON documents (type, sort_key)
`;

const CONFIGURED_INDEXES_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS configured_indexes (
        type      TEXT NOT NULL,
        attribute TEXT NOT NULL,
        PRIMARY KEY (type, attribute)
    )
`;

/**
 * Node.js SQLite implementation of the StorageEngine port.
 *
 * Persists all documents in a single SQLite database file opened in WAL mode for
 * improved concurrent read performance. Custom indexes are implemented as generated
 * columns with corresponding SQL indexes — see configureIndexes() for details.
 *
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export default class SQLiteStorageEngine {

    /** Absolute path to the SQLite database file. */
    #path = null;

    /** @type {DatabaseSync|null} */
    #db = null;

    /**
     * @param {Object} options
     * @param {string} options.path - File path for the SQLite database.
     */
    constructor({ path }) {
        this.#path = path;
    }

    /**
     * Creates the database file and directory if needed, enables WAL mode, and
     * ensures the core documents table and built-in sort_key index exist.
     * @public
     * @returns {Promise<void>}
     * @throws {WrappedError} When the database file or directory cannot be created.
     */
    async initialize() {
        try {
            await mkdir(dirname(this.#path), { recursive: true });
        } catch (cause) {
            throw new WrappedError(
                `SQLiteStorageEngine: unable to create directory for database at ${ this.#path }`,
                { cause }
            );
        }

        this.#db = new DatabaseSync(this.#path);
        this.#db.exec('PRAGMA journal_mode=WAL');
        this.#db.exec(DOCUMENTS_TABLE_SQL);
        this.#db.exec(DEFAULT_INDEX_SQL);
        this.#db.exec(CONFIGURED_INDEXES_TABLE_SQL);
    }

    /**
     * Reconciles the live set of custom index columns and SQL indexes against the
     * desired set. New indexes are created (with backfill via STORED generated columns).
     * Removed indexes have their SQL index dropped; the generated column is retained
     * because SQLite does not support dropping generated columns, but it becomes inert
     * once its SQL index is gone.
     *
     * @public
     * @param {import('../ports/storage-engine.js').IndexDefinition[]} indexes
     * @returns {Promise<void>}
     */
    async configureIndexes(indexes) {
        // Use PRAGMA table_xinfo (which includes generated/hidden columns) to discover
        // which idx_* columns are already present.
        const tableInfo = this.#db.prepare('PRAGMA table_xinfo(documents)').all();
        const existingColumns = new Set(tableInfo.map((row) => row.name));

        const existingConfiguredIndexes = this.#db.prepare(
            'SELECT type, attribute FROM configured_indexes'
        ).all();
        const existingAttributes = new Set(existingConfiguredIndexes.map((row) => row.attribute));
        const desiredAttributes = new Set(indexes.map((def) => def.attribute));

        // Add columns and indexes for newly declared attributes.
        for (const attribute of desiredAttributes) {
            const columnName = toIndexColumnName(attribute);
            const quotedColumnName = quoteIdentifier(columnName);
            const quotedIndexName = quoteIdentifier(toIndexName(attribute));

            if (!existingColumns.has(columnName)) {
                // SQLite restrictions on ALTER TABLE ADD COLUMN:
                // - Does not support IF NOT EXISTS — so we guard with the PRAGMA check above.
                // - STORED generated columns cannot be added to a non-empty table; VIRTUAL
                //   generated columns have no such restriction and are equally indexable.
                this.#db.exec(
                    `ALTER TABLE documents ADD COLUMN ${ quotedColumnName }`
                    + ` TEXT GENERATED ALWAYS AS (json_extract(doc, '${ toJSONPath(attribute) }')) VIRTUAL`
                );
            }

            this.#db.exec(
                `CREATE INDEX IF NOT EXISTS ${ quotedIndexName } ON documents (type, ${ quotedColumnName })`
            );
        }

        // Drop SQL indexes for attributes that are no longer desired.
        // The generated column stays (SQLite limitation) but becomes inert without its index.
        for (const attribute of existingAttributes) {
            if (!desiredAttributes.has(attribute)) {
                this.#db.exec(`DROP INDEX IF EXISTS ${ quoteIdentifier(toIndexName(attribute)) }`);
            }
        }

        this.#db.exec('DELETE FROM configured_indexes');

        const insertConfiguredIndex = this.#db.prepare(
            'INSERT INTO configured_indexes (type, attribute) VALUES (?, ?)'
        );
        for (const { type, attribute } of indexes) {
            insertConfiguredIndex.run(type, attribute);
        }
    }

    /**
     * Write a document, creating or overwriting it depending on options.
     * @public
     * @param {Object} doc - Document to store (must include type and id).
     * @param {Object} [options]
     * @param {number} [options.version] - Required for optimistic updates; absent for upsert.
     * @returns {Promise<import('../ports/storage-engine.js').DocumentRecord>}
     * @throws {DocumentNotFoundError} On update when (type, id) does not exist.
     * @throws {VersionConflictError} On update when the stored version does not match.
     */
    async put(doc, options) {
        const now = new Date().toISOString();
        const serialized = JSON.stringify(doc);
        const sortKey = doc.sortKey !== undefined ? doc.sortKey : null;
        const version = options && options.version;

        if (version === undefined) {
            return this.#upsertDocument(doc, serialized, sortKey, now);
        }
        return this.#updateDocument(doc, serialized, sortKey, version, now);
    }

    /**
     * Retrieve a document by its composite key.
     * @public
     * @param {string} type
     * @param {string} id
     * @returns {Promise<import('../ports/storage-engine.js').DocumentRecord|null>}
     */
    async get(type, id) {
        const row = this.#db.prepare(
            'SELECT doc, version, created_at, updated_at FROM documents WHERE type = ? AND id = ?'
        ).get(type, id);

        if (!row) {
            return null;
        }

        return rowToRecord(row);
    }

    /**
     * Delete a document with an optimistic version check.
     * @public
     * @param {string} type
     * @param {string} id
     * @param {number} version - Expected current version.
     * @returns {Promise<boolean>} True if deleted, false if the document did not exist.
     * @throws {VersionConflictError} When the stored version does not match.
     */
    async delete(type, id, version) {
        const result = this.#db.prepare(
            'DELETE FROM documents WHERE type = ? AND id = ? AND version = ?'
        ).run(type, id, version);

        if (result.changes > 0) {
            return true;
        }

        // Distinguish not-found from version conflict.
        const row = this.#db.prepare(
            'SELECT version FROM documents WHERE type = ? AND id = ?'
        ).get(type, id);

        if (!row) {
            return false;
        }

        throw new VersionConflictError(type, id, version, row.version);
    }

    /**
     * Retrieve a page of documents for the given type using an index.
     *
     * The DataStore normalizes all input before calling this method, so the engine
     * receives only canonical range operators (no startKey/endKey aliases, no beginsWith).
     *
     * @public
     * @param {string} type
     * @param {import('../ports/storage-engine.js').QueryOptions} options
     * @returns {Promise<import('../ports/storage-engine.js').QueryResult>}
     */
    async query(type, options) {
        const {
            index,
            greaterThanOrEqualTo,
            lessThanOrEqualTo,
            greaterThan,
            lessThan,
            limit = 100,
            reverse = false,
            cursor,
        } = options || {};

        if (index && !this.#isIndexConfigured(type, index)) {
            throw new IndexNotConfiguredError(type, index);
        }

        const col = index ? quoteIdentifier(toIndexColumnName(index)) : 'sort_key';
        const direction = reverse ? 'DESC' : 'ASC';

        const conditions = [ 'type = ?' ];
        const params = [ type ];

        if (greaterThanOrEqualTo !== undefined) {
            conditions.push(`${ col } >= ?`);
            params.push(greaterThanOrEqualTo);
        }
        if (lessThanOrEqualTo !== undefined) {
            conditions.push(`${ col } <= ?`);
            params.push(lessThanOrEqualTo);
        }
        if (greaterThan !== undefined) {
            conditions.push(`${ col } > ?`);
            params.push(greaterThan);
        }
        if (lessThan !== undefined) {
            conditions.push(`${ col } < ?`);
            params.push(lessThan);
        }

        if (cursor) {
            const { v: cursorValue, id: cursorId } = decodeCursor(cursor);
            appendCursorCondition(conditions, params, col, cursorValue, cursorId, reverse);
        }

        const sql = [
            `SELECT doc, version, created_at, updated_at, ${ col } AS index_value, id`,
            'FROM documents',
            `WHERE ${ conditions.join(' AND ') }`,
            `ORDER BY ${ col } ${ direction }, id ${ direction }`,
            'LIMIT ?',
        ].join(' ');

        // Fetch one extra record to determine whether a next page exists.
        params.push(limit + 1);

        const rows = this.#db.prepare(sql).all(...params);

        let nextCursor = null;

        if (rows.length > limit) {
            rows.pop();
            const last = rows[rows.length - 1];
            nextCursor = encodeCursor(last.index_value, last.id);
        }

        return {
            records: rows.map(rowToRecord),
            cursor: nextCursor,
        };
    }

    /**
     * Closes the database connection and releases the file lock.
     * @public
     * @returns {Promise<void>}
     */
    async close() {
        if (this.#db) {
            this.#db.close();
            this.#db = null;
        }
    }

    #isIndexConfigured(type, attribute) {
        const row = this.#db.prepare(
            'SELECT 1 FROM configured_indexes WHERE type = ? AND attribute = ?'
        ).get(type, attribute);

        return Boolean(row);
    }

    #upsertDocument(doc, serialized, sortKey, now) {
        // ON CONFLICT DO UPDATE preserves created_at when overwriting an existing document.
        // RETURNING version and created_at avoids a separate SELECT to detect insert vs update.
        const row = this.#db.prepare(
            'INSERT INTO documents (type, id, sort_key, doc, version, created_at, updated_at)'
            + ' VALUES (?, ?, ?, ?, 1, ?, ?)'
            + ' ON CONFLICT(type, id) DO UPDATE SET'
            + '     doc = excluded.doc,'
            + '     sort_key = excluded.sort_key,'
            + '     version = version + 1,'
            + '     updated_at = excluded.updated_at'
            + ' RETURNING version, created_at'
        ).get(doc.type, doc.id, sortKey, serialized, now, now);

        return {
            doc,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: now,
        };
    }

    #updateDocument(doc, serialized, sortKey, version, now) {
        // RETURNING lets us retrieve created_at and the new version in a single statement,
        // avoiding a separate SELECT after the UPDATE. SQLite 3.35+ (ships with Node.js 24).
        const updated = this.#db.prepare(
            'UPDATE documents'
            + ' SET doc = ?, sort_key = ?, version = version + 1, updated_at = ?'
            + ' WHERE type = ? AND id = ? AND version = ?'
            + ' RETURNING version, created_at'
        ).get(serialized, sortKey, now, doc.type, doc.id, version);

        if (updated) {
            return {
                doc,
                version: updated.version,
                createdAt: updated.created_at,
                updatedAt: now,
            };
        }

        // Zero rows affected: determine whether the document was absent or the version mismatched.
        const row = this.#db.prepare(
            'SELECT version FROM documents WHERE type = ? AND id = ?'
        ).get(doc.type, doc.id);

        if (!row) {
            throw new DocumentNotFoundError(doc.type, doc.id);
        }

        throw new VersionConflictError(doc.type, doc.id, version, row.version);
    }
}

// --- Helpers -----------------------------------------------------------------

function rowToRecord(row) {
    return {
        doc: JSON.parse(row.doc),
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function encodeCursor(indexValue, id) {
    return btoa(JSON.stringify({ v: indexValue, id }));
}

function decodeCursor(cursor) {
    try {
        return JSON.parse(atob(cursor));
    } catch (cause) {
        throw new WrappedError('SQLiteStorageEngine: invalid cursor token', { cause });
    }
}

/**
 * Appends the seek condition for cursor-based pagination to the WHERE clause.
 *
 * Null index values need special handling because SQL comparison operators against
 * NULL always evaluate to NULL (never true), so standard `col > ?` does not work.
 *
 * Ascending order (nulls sort first):
 *   - If cursor value is null: remaining nulls with id > lastId, then all non-nulls.
 *   - If cursor value is non-null: standard `(col > val OR (col = val AND id > lastId))`.
 *
 * Descending order (nulls sort last):
 *   - If cursor value is null: remaining nulls with id < lastId only.
 *   - If cursor value is non-null: standard `(col < val OR (col = val AND id < lastId))`.
 */
function appendCursorCondition(conditions, params, col, cursorValue, cursorId, reverse) {
    if (cursorValue === null) {
        if (reverse) {
            // Descending, nulls last — only nulls with a lower id remain.
            conditions.push(`(${ col } IS NULL AND id < ?)`);
            params.push(cursorId);
        } else {
            // Ascending, nulls first — remaining nulls with higher id, then all non-nulls.
            conditions.push(`((${ col } IS NULL AND id > ?) OR ${ col } IS NOT NULL)`);
            params.push(cursorId);
        }
    } else if (reverse) {
        conditions.push(`(${ col } < ? OR (${ col } = ? AND id < ?))`);
        params.push(cursorValue, cursorValue, cursorId);
    } else {
        conditions.push(`(${ col } > ? OR (${ col } = ? AND id > ?))`);
        params.push(cursorValue, cursorValue, cursorId);
    }
}

function toIndexColumnName(attribute) {
    return `idx_attr_${ Buffer.from(attribute).toString('hex') }`;
}

function toIndexName(attribute) {
    return `idx_type_attr_${ Buffer.from(attribute).toString('hex') }`;
}

function quoteIdentifier(identifier) {
    return `"${ identifier }"`;
}

function toJSONPath(attribute) {
    return `$."${ attribute.replace(/"/g, '""') }"`;
}
