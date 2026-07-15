import DocumentAlreadyExistsError from '../../../kixx/document-store/document-already-exists-error.js';
import DocumentNotFoundError from '../../../kixx/document-store/document-not-found-error.js';
import DocumentUniqueIndexViolationError from '../../../kixx/document-store/document-unique-index-violation-error.js';
import VersionConflictError from '../../../kixx/document-store/version-conflict-error.js';
import {
    AssertionError,
    isBoolean,
    isUndefined,
    isNonEmptyString,
    isPlainObject,
    assert,
    assertArray,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';


/*
The D1Result Object:

{
  success: boolean, // true if the operation was successful, false otherwise
  meta: {
    served_by: string // the version of Cloudflare's backend Worker that returned the result
    served_by_region: string // the region of the database instance that executed the query
    served_by_primary: boolean // true if (and only if) the database instance that executed the query was the primary
    timings: {
      sql_duration_ms: number // the duration of the SQL query execution by the database instance (not including any network time)
    }
    duration: number, // the duration of the SQL query execution only, in milliseconds
    changes: number, // the number of changes made to the database
    last_row_id: number, // the last inserted row ID, only applies when the table is defined without the `WITHOUT ROWID` option
    changed_db: boolean, // true if something on the database was changed
    size_after: number, // the size of the database after the query is successfully applied
    rows_read: number, // the number of rows read (scanned) by this query
    rows_written: number // the number of rows written by this query
    total_attempts: number //the number of total attempts to successfully execute the query, including retries
  }
  results: array | null, // [] if empty, or null if it does not apply
}

The D1ExecResult Object:

{
  "count": number, // the number of executed queries
  "duration": number // the duration of the operation, in milliseconds
}
*/

const DEFAULT_BINDING_NAME = 'DOCUMENT_STORE';

/**
 * Cloudflare D1 engine adapter for the document store abstraction.
 *
 * Manages idempotent schema migration (documents table plus VIRTUAL generated-column
 * indexes) and provides typed CRUD and keyset-paginated query operations. Every
 * method receives a RequestContext `context` object and resolves the D1 binding
 * from the configured `config.env` binding.
 *
 * Secondary indexes are configured through `setIndexDefinitions()` before the
 * database is first used. This allows callers to construct the engine before all
 * collection metadata has been registered.
 *
 * All documents are stored as JSON in the `doc` column. Queryable fields are
 * exposed as VIRTUAL generated columns backed by `json_extract()`, so they are
 * always derived from the stored JSON and never stored redundantly.
 */
export default class DocumentStoreEngine {

    #logger = null;

    #indexDefinitions = null;
    #indexKeys = [];
    #prepared = false;
    // Cached in-flight promise so concurrent requests do not each trigger a
    // separate prepareDatabase() call before the first one completes.
    #preparePromise = null;

    /**
     * @param {Object} options - Configuration options
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a named child logger
     * @throws {Error} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};

        assert(logger, 'DocumentStoreEngine requires a logger');

        this.#logger = logger.createChild('DocumentStoreEngine');
    }

    /**
     * Configures the secondary indexes available to `query()` and schema preparation.
     *
     * Each index definition maps a public index name to a JSON path that will be
     * exposed as a generated D1 column. This method must be called exactly once
     * before the engine is used.
     *
     * @param {Object[]} indexDefinitions - Secondary index definitions
     * @param {string} indexDefinitions[].name - Query index name, limited to lowercase letters, numbers, and underscores
     * @param {string} indexDefinitions[].jsonPath - JSON path beginning with `$.`
     * @param {boolean} [indexDefinitions[].unique=false] - When true, the generated index is created as `UNIQUE`
     *   and conflicting writes raise `DocumentUniqueIndexViolationError`.
     * @returns {void}
     * @throws {AssertionError} When an index definition is invalid
     */
    setIndexDefinitions(indexDefinitions) {
        if (this.#indexDefinitions) {
            throw new AssertionError('DocumentStoreEngine#setIndexDefinitions() must not be called more than once');
        }

        assertArray(indexDefinitions, 'DocumentStoreEngine indexDefinitions must be an Array');

        const indexKeys = [];
        for (let i = 0; i < indexDefinitions.length; i += 1) {
            const def = indexDefinitions[i];
            assertNonEmptyString(def.name, `indexDefinitions[${ i }].name must be a non-empty string`);
            if (def.name.length > 80) {
                throw new AssertionError(`indexDefinitions[${ i }].name must not be more than 80 characters long`);
            }
            if (!/^[a-z]/.test(def.name)) {
                throw new AssertionError(`indexDefinitions[${ i }].name must start with a letter from a-z`);
            }
            if (!/^[a-z0-9_]+$/.test(def.name)) {
                throw new AssertionError(`indexDefinitions[${ i }].name may only contain characters from a-z, 0-9, and _`);
            }
            indexKeys.push(def.name);
            assertNonEmptyString(def.jsonPath, `indexDefinitions[${ i }].jsonPath must be a non-empty string`);
            // jsonPath must be at least "$.x" (3 chars) to reference a field.
            if (!def.jsonPath.startsWith('$.') || def.jsonPath.length <= 2) {
                throw new AssertionError(`indexDefinitions[${ i }].jsonPath must start with "$." followed by at least one character`);
            }
            if ('unique' in def && !isBoolean(def.unique)) {
                throw new AssertionError(`indexDefinitions[${ i }].unique must be a boolean when present`);
            }
        }

        this.#indexDefinitions = indexDefinitions;
        this.#indexKeys = indexKeys;
    }

    /**
     * Creates the `documents` table and default index if they do not exist, then
     * reconciles VIRTUAL generated-column indexes with `indexDefinitions`.
     *
     * New definitions ensure a generated column backed by `json_extract()` and
     * an accompanying composite index on `(type, col)` both exist. Definitions
     * that have been removed drop the index then the column. Safe to call on
     * every startup — DDL uses IF NOT EXISTS or is guarded by the PRAGMA pre-check.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @returns {Promise<void>}
     * @throws {Error} When table creation or the PRAGMA introspection query fails
     */
    async prepareDatabase(context) {
        assertArray(this.#indexDefinitions, 'DocumentStoreEngine#setIndexDefinitions() must be called before the database can be used');

        const db = this.#getDatabase(context);

        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS documents (
                type       TEXT    NOT NULL,
                id         TEXT    NOT NULL,
                sort_key   TEXT,
                version    INTEGER NOT NULL DEFAULT 1,
                created_at TEXT    NOT NULL,
                updated_at TEXT    NOT NULL,
                doc        TEXT    NOT NULL,
                PRIMARY KEY (type, id)
            )
        `;

        const defaultIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_type_sort_key
                ON documents (type, sort_key)
        `;

        let tableInfo;
        let indexList;
        try {
            await db.prepare(createTableSQL).run();
            await db.prepare(defaultIndexSQL).run();
            tableInfo = await db.prepare('PRAGMA table_xinfo(documents)').run();
            indexList = await db.prepare('PRAGMA index_list(documents)').run();
        } catch (cause) {
            throw new Error('Unable to prepare D1 documents table', { cause });
        }

        if (!tableInfo.success) {
            throw new Error('Preparing D1 documents table: "PRAGMA table_xinfo(documents)" failed');
        }
        if (!indexList.success) {
            throw new Error('Preparing D1 documents table: "PRAGMA index_list(documents)" failed');
        }

        // table_xinfo() is used instead of table_info() because it includes hidden and
        // generated (VIRTUAL) columns, which table_info() silently omits in some SQLite versions.
        // │ cid │ name │ type │ notnull │ dflt_value │ pk │ hidden │
        // We are only interested in the "name"
        const existingKeyColumns = tableInfo.results
            .map(({ name }) => name)
            .filter((name) => name.startsWith('key_'));

        // PRAGMA index_list returns rows like { seq, name, unique, origin, partial };
        // we only need the uniqueness flag keyed by index name.
        const existingIndexUnique = new Map(
            indexList.results.map(({ name, unique }) => [ name, unique === 1 ]),
        );

        for (const indexDefinition of this.#indexDefinitions) {
            const columnName = this.keyToColumnName(indexDefinition.name);
            const indexName = this.keyToIndexName(indexDefinition.name);
            const wantUnique = indexDefinition.unique === true;
            const createIndexSQL = `CREATE ${ wantUnique ? 'UNIQUE ' : '' }INDEX IF NOT EXISTS ${ indexName } ON documents (type, ${ columnName })`;

            if (!existingKeyColumns.includes(columnName)) {
                // SQLite restrictions on ALTER TABLE ADD COLUMN:
                // - Does not support IF NOT EXISTS — so we guard with the PRAGMA check above.
                // - STORED generated columns cannot be added to a non-empty table; VIRTUAL
                //   generated columns have no such restriction and are equally indexable.
                try {
                    await db.prepare(`
                        ALTER TABLE documents ADD COLUMN ${ columnName }
                        TEXT GENERATED ALWAYS AS (json_extract(doc, '${ indexDefinition.jsonPath }')) VIRTUAL
                    `).run();
                } catch (cause) {
                    throw new Error(`Unable to add index column "${ columnName }" to D1 documents table`, { cause });
                }
            }

            if (!existingIndexUnique.has(indexName)) {
                // A previous prepare can crash after adding the column but before
                // creating the index; reconcile the index independently.
                try {
                    await db.prepare(createIndexSQL).run();
                } catch (cause) {
                    throw new Error(`Unable to create index "${ indexName }" on D1 documents table`, { cause });
                }
            } else if (existingIndexUnique.get(indexName) !== wantUnique) {
                // Column survives; index uniqueness flag is reconciled by drop + recreate.
                // The PRAGMA above reports `unique = 1` for UNIQUE indexes only.
                try {
                    await db.prepare(`DROP INDEX IF EXISTS ${ indexName }`).run();
                    await db.prepare(createIndexSQL).run();
                } catch (cause) {
                    throw new Error(`Unable to reconcile uniqueness on index "${ indexName }"`, { cause });
                }
            }
        }

        const desiredIndexKeys = this.#indexDefinitions.map(({ name }) => name);
        for (const columnName of existingKeyColumns) {
            const keyName = this.columnNameToKey(columnName);
            if (!desiredIndexKeys.includes(keyName)) {
                try {
                    await db.prepare(`DROP INDEX IF EXISTS ${ this.keyToIndexName(keyName) }`).run();
                    await db.prepare(`ALTER TABLE documents DROP COLUMN ${ columnName }`).run();
                } catch (cause) {
                    throw new Error(`Unable to drop stale index column "${ columnName }" from D1 documents table`, { cause });
                }
            }
        }

        this.#prepared = true;
    }

    /**
     * Returns a keyset-paginated page of documents filtered and sorted by a named index.
     *
     * The index name must correspond to an entry in `indexDefinitions`. Each record in
     * the result exposes the matched index value as `key`.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {string} type - Document type used to scope the query
     * @param {Object} [options]
     * @param {string} options.index - Name of the configured index key to query
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {Object} [options.cursor] - Private continuation value returned by a previous call, replayed by the DocumentStore facade
     * @param {string} [options.equalTo] - Exact match on the index value; mutually exclusive with range bounds
     * @param {string} [options.greaterThan] - Exclusive lower bound on the index value
     * @param {string} [options.greaterThanOrEqualTo] - Inclusive lower bound on the index value
     * @param {string} [options.lessThan] - Exclusive upper bound on the index value
     * @param {string} [options.lessThanOrEqualTo] - Inclusive upper bound on the index value
     * @returns {Promise<{records: Object[], cursor: Object|null}>} Page of records and a private next-page continuation value, or null on the last page
     * @throws {AssertionError} When `options.index`, `options.limit`, or `options.cursor` are invalid, or when `equalTo` is combined with range bounds
     * @throws {Error} When the D1 query fails
     */
    async query(context, type, options) {
        options = options ?? {};

        assertNonEmptyString(options.index, 'DocumentStoreEngine#query() requires an index name');
        if (!this.#indexKeys.includes(options.index)) {
            throw new AssertionError(`DocumentStoreEngine#query() index key "${ options.index }" is not configured`);
        }

        const columnName = this.keyToColumnName(options.index);

        const limit = getPaginationLimit(options, 'DocumentStoreEngine#query()');
        const cursor = getPaginationCursor(options, 'DocumentStoreEngine#query()');
        const queryOptions = Object.assign({}, options, { cursor });

        const { sql, params } = this.#composeQueryStatement(queryOptions, type, columnName, limit);

        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const db = this.#getDatabase(context);
        const stmt = db.prepare(sql).bind(...params);
        const { success, results } = await stmt.run();

        if (!success) {
            this.#logger.error('unsuccessful query in query()', { sql });
            throw new Error(`Unsuccessful D1 query in query()`);
        }

        let nextCursor = null;

        if (results.length > limit) {
            // We fetched one extra record to determine whether a next page exists.
            results.pop();
            const last = results[results.length - 1];
            nextCursor = { key: last.key, id: last.id };
        }

        const records = results.map((row) => {
            return {
                type,
                id: row.id,
                version: row.version,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                key: row.key,
                doc: JSON.parse(row.doc),
            };
        });

        return { records, cursor: nextCursor };
    }

    /**
     * Returns a keyset-paginated page of documents sorted by the built-in `sort_key` column.
     *
     * Unlike `query()`, no named index is required — every document row carries `sort_key`.
     * Each record in the result exposes the sort key as `sortKey` (not `key`).
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {string} type - Document type used to scope the scan
     * @param {Object} [options]
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {Object} [options.cursor] - Private continuation value returned by a previous call, replayed by the DocumentStore facade
     * @param {string} [options.equalTo] - Exact match on sort_key; mutually exclusive with range bounds
     * @param {string} [options.greaterThan] - Exclusive lower bound on sort_key
     * @param {string} [options.greaterThanOrEqualTo] - Inclusive lower bound on sort_key
     * @param {string} [options.lessThan] - Exclusive upper bound on sort_key
     * @param {string} [options.lessThanOrEqualTo] - Inclusive upper bound on sort_key
     * @returns {Promise<{records: Object[], cursor: Object|null}>} Page of records and a private next-page continuation value, or null on the last page
     * @throws {AssertionError} When `options.limit` or `options.cursor` are invalid, or when `equalTo` is combined with range bounds
     * @throws {Error} When the D1 query fails
     */
    async scan(context, type, options) {
        options = options ?? {};

        const columnName = 'sort_key';

        const limit = getPaginationLimit(options, 'DocumentStoreEngine#scan()');
        const cursor = getPaginationCursor(options, 'DocumentStoreEngine#scan()');
        const scanOptions = Object.assign({}, options, { cursor });

        const { sql, params } = this.#composeQueryStatement(scanOptions, type, columnName, limit);

        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const db = this.#getDatabase(context);
        const stmt = db.prepare(sql).bind(...params);
        const { success, results } = await stmt.run();

        if (!success) {
            this.#logger.error('unsuccessful query in scan()', { sql });
            throw new Error(`Unsuccessful D1 query in scan()`);
        }

        let nextCursor = null;

        if (results.length > limit) {
            // We fetched one extra record to determine whether a next page exists.
            results.pop();
            const last = results[results.length - 1];
            nextCursor = { key: last.key, id: last.id };
        }

        const records = results.map((row) => {
            return {
                type,
                id: row.id,
                version: row.version,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                sortKey: row.key,
                doc: JSON.parse(row.doc),
            };
        });

        return { records, cursor: nextCursor };
    }

    /**
     * Retrieves a single document by type and id.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {string} type - Document type
     * @param {string} id - Document identifier
     * @returns {Promise<(Object|null)>} The stored record with parsed `doc` payload or null if not found
     */
    async get(context, type, id) {
        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const db = this.#getDatabase(context);

        const row = await db
            .prepare('SELECT doc, version, created_at, updated_at FROM documents WHERE type = ? AND id = ?')
            .bind(type, id)
            .first();

        if (!row) {
            return null;
        }

        return {
            type,
            id,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            doc: JSON.parse(row.doc),
        };
    }

    /**
     * Creates or overwrites a document without optimistic concurrency control.
     *
     * A missing row is inserted at version 1. An existing row is overwritten and
     * its version is incremented. Use `create()` when overwrites should be
     * rejected, or `update()` when the caller must prove it saw the current
     * version before writing.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {Object} doc - Document payload; must include `type` and `id` string properties
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier
     * @param {string} [doc.sortKey] - Optional sort key stored on the row; null when omitted
     * @returns {Promise<Object>} Stored record with updated `version`, `createdAt`, and `updatedAt`
     * @throws {DocumentUniqueIndexViolationError} When the write would violate a configured unique secondary index
     */
    async put(context, doc) {
        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const now = new Date().toISOString();
        const updatedAt = now;
        const createdAt = now;
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const db = this.#getDatabase(context);

        const sql = `
            INSERT INTO documents (type, id, sort_key, version, created_at, updated_at, doc)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(type, id) DO UPDATE SET
                sort_key = EXCLUDED.sort_key,
                version = version + 1,
                updated_at = EXCLUDED.updated_at,
                doc = EXCLUDED.doc
            RETURNING version, created_at, updated_at
        `;
        // RETURNING lets us retrieve created_at and the new version in a single statement,
        // avoiding a separate SELECT after the UPDATE. SQLite 3.35+ (2021-03-15).
        // See https://sqlite.org/releaselog/3_35_1.html

        let row;
        try {
            row = await db.prepare(sql).bind(type, id, sortKey, createdAt, updatedAt, json).first();
        } catch (cause) {
            const translated = this.#translateUniqueConflict(type, cause);
            if (translated) {
                throw translated;
            }
            throw cause;
        }

        return {
            type,
            id,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            doc,
        };
    }

    /**
     * Updates an existing document when its current version matches the expected version.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {Object} doc - Document payload; must include `type` and `id` string properties
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier
     * @param {string} [doc.sortKey] - Optional sort key stored on the row; null when omitted
     * @param {number} version - Expected current version for optimistic locking
     * @returns {Promise<Object>} Stored record with incremented `version`, `createdAt`, and `updatedAt`
     * @throws {AssertionError} When `version` is not a positive integer
     * @throws {DocumentNotFoundError} When the target document does not exist
     * @throws {VersionConflictError} When the stored version does not match the provided version
     * @throws {DocumentUniqueIndexViolationError} When the write would violate a configured unique secondary index
     */
    async update(context, doc, version) {
        if (!Number.isInteger(version) || version <= 0) {
            throw new AssertionError('DocumentStoreEngine#update() requires a positive integer version number');
        }

        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const updatedAt = new Date().toISOString();
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        // The version predicate makes the update atomic: one statement both writes the
        // document and proves that the caller saw the current version.
        const sql = `
            UPDATE documents
            SET doc = ?, sort_key = ?, version = version + 1, updated_at = ?
            WHERE type = ? AND id = ? AND version = ?
            RETURNING version, created_at, updated_at
        `;
        // RETURNING lets us retrieve created_at and the new version in a single statement,
        // avoiding a separate SELECT after the UPDATE. SQLite 3.35+ (2021-03-15).
        // See https://sqlite.org/releaselog/3_35_1.html

        const db = this.#getDatabase(context);

        let row;
        try {
            row = await db
                .prepare(sql)
                .bind(json, sortKey, updatedAt, type, id, version)
                .first();
        } catch (cause) {
            const translated = this.#translateUniqueConflict(type, cause);
            if (translated) {
                throw translated;
            }
            throw cause;
        }

        if (row) {
            return {
                type,
                id,
                version: row.version,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                doc,
            };
        }

        // Zero rows affected: determine whether the document was absent or the version mismatched.
        const record = await db
            .prepare('SELECT version FROM documents WHERE type = ? AND id = ?')
            .bind(type, id)
            .first();

        if (!record) {
            throw new DocumentNotFoundError(type, id);
        }

        throw new VersionConflictError(type, id, version, record.version);
    }

    /**
     * Creates a document only when no row already exists for the same type and id.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {Object} doc - Document payload; must include `type` and `id` string properties
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier
     * @param {string} [doc.sortKey] - Optional sort key stored on the row; null when omitted
     * @returns {Promise<Object>} Stored record with initial `version`, `createdAt`, and `updatedAt`
     * @throws {DocumentAlreadyExistsError} When a document already exists for the same type and id
     * @throws {DocumentUniqueIndexViolationError} When the write would violate a configured unique secondary index
     */
    async create(context, doc) {
        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const now = new Date().toISOString();
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const sql = `
            INSERT INTO documents (type, id, sort_key, version, created_at, updated_at, doc)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(type, id) DO NOTHING
            RETURNING version, created_at, updated_at
        `;

        const db = this.#getDatabase(context);
        let row;
        try {
            row = await db.prepare(sql).bind(type, id, sortKey, now, now, json).first();
        } catch (cause) {
            const translated = this.#translateUniqueConflict(type, cause);
            if (translated) {
                throw translated;
            }
            throw cause;
        }

        if (!row) {
            throw new DocumentAlreadyExistsError(type, id);
        }

        return {
            type,
            id,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            doc,
        };
    }

    /**
     * Deletes a document by type and id, with optional optimistic concurrency control.
     *
     * Two paths:
     * - **Versioned delete** (`version` is a positive integer): The row must exist at
     *   exactly that version. Missing document throws `DocumentNotFoundError`; version
     *   mismatch throws `VersionConflictError`.
     * - **Force delete** (`version` is absent): Deletes unconditionally. Returns
     *   `false` (rather than throwing) when no matching row exists.
     *
     * @param {Object} context - Cloudflare Workers execution context
     * @param {string} type - Document type
     * @param {string} id - Document identifier
     * @param {number} [version] - Expected current version; omit for an unconditional delete
     * @returns {Promise<boolean>} `true` when a row was deleted; `false` on the force-delete path when no row existed
     * @throws {AssertionError} When `version` is present but not a positive integer
     * @throws {DocumentNotFoundError} When a versioned delete targets a non-existent document
     * @throws {VersionConflictError} When the stored version does not match the provided version
     */
    async delete(context, type, id, version) {
        if (!this.#prepared) {
            await this.#ensurePrepared(context);
        }

        const db = this.#getDatabase(context);

        if (!isUndefined(version) && (!Number.isInteger(version) || version <= 0)) {
            throw new AssertionError('DocumentStoreEngine#delete() requires a positive integer version number when present');
        }

        if (!isUndefined(version)) {
            // We expect the document to exist and the version to match.
            // Use meta.changes to detect affected rows — DELETE returns no result rows.
            const result = await db
                .prepare('DELETE FROM documents WHERE type = ? AND id = ? AND version = ?')
                .bind(type, id, version)
                .run();

            if (result.meta.changes > 0) {
                return true;
            }

            // Distinguish not-found from version conflict.
            const record = await db
                .prepare('SELECT version FROM documents WHERE type = ? AND id = ?')
                .bind(type, id)
                .first();

            if (!record) {
                throw new DocumentNotFoundError(type, id);
            }

            throw new VersionConflictError(type, id, version, record.version);
        }

        // Use meta.changes to detect affected rows — DELETE returns no result rows.
        const result = await db
            .prepare('DELETE FROM documents WHERE type = ? AND id = ?')
            .bind(type, id)
            .run();

        return result.meta.changes > 0;
    }

    /**
     * No-op — present for compliance with the DocumentStoreEngine interface.
     */
    close() {
        // No-op for this class, but here for compliance with the interface spec.
    }

    columnNameToKey(columnName) {
        return columnName.replace(/^key_/, '');
    }

    keyToColumnName(keyName) {
        return `key_${ keyName }`;
    }

    keyToIndexName(keyName) {
        return `idx_type_custom_key_${ keyName }`;
    }

    #getDatabase(context) {
        const { config, env } = context;
        let { bindingName } = config?.env?.DOCUMENT_STORE ?? {};
        bindingName = bindingName || DEFAULT_BINDING_NAME;

        const db = env[bindingName];
        assert(db, `DocumentStoreEngine D1 binding "${ bindingName }" is not bound on context.env`);
        return db;
    }

    /**
     * Translates a D1/SQLite UNIQUE-constraint failure on one of this engine's
     * indexed `key_*` columns into a `DocumentUniqueIndexViolationError`.
     *
     * D1 surfaces SQLite's `SQLITE_CONSTRAINT_UNIQUE` as an exception whose
     * message includes the offending column references, e.g.
     * `UNIQUE constraint failed: documents.type, documents.key_email`.
     * Only configured `key_*` columns are translated, so unrelated unique
     * constraints keep their original error.
     *
     * @param {string} type - Document type used in the failed write.
     * @param {Error} err - Error raised by D1.
     * @returns {DocumentUniqueIndexViolationError|null} Translated error when
     *   the failure matches a configured unique index, otherwise null.
     */
    #translateUniqueConflict(type, err) {
        const message = err?.message ?? '';
        const match = /UNIQUE constraint failed:\s*(.+)$/.exec(message);
        if (!match) {
            return null;
        }

        const keyColumn = match[1]
            .split(',')
            .map((columnName) => columnName.trim())
            .find((columnName) => /^documents\.key_[A-Za-z0-9_]+$/.test(columnName));

        if (!keyColumn) {
            return null;
        }

        const indexName = this.columnNameToKey(keyColumn.replace(/^documents\./, ''));
        if (!this.#indexKeys.includes(indexName)) {
            return null;
        }
        return new DocumentUniqueIndexViolationError(type, indexName);
    }

    /**
     * Ensures the database schema is ready before executing a CRUD operation.
     *
     * Calls `prepareDatabase()` on the first invocation and caches the in-flight
     * promise so concurrent requests coalesce onto a single prepare rather than
     * each triggering a separate migration. On failure the promise is cleared so
     * the next request can retry.
     */
    async #ensurePrepared(context) {
        if (!this.#preparePromise) {
            this.#preparePromise = this.prepareDatabase(context).catch((err) => {
                // Clear on failure so the next request gets a fresh attempt.
                this.#preparePromise = null;
                throw err;
            });
        }
        return await this.#preparePromise;
    }

    /**
     * Builds the SELECT statement and bound parameter list for `query()` and `scan()`.
     *
     * The limit passed in is fetched + 1 so callers can detect whether a next page
     * exists without a separate COUNT query — if `results.length > limit`, there are
     * more rows and the extra row is discarded before encoding the cursor.
     *
     * Keyset pagination via the cursor handles null column values explicitly: standard
     * SQL comparison operators against NULL always return NULL (not false), so a
     * cursor pointing at a null value requires IS NULL / IS NOT NULL guards rather
     * than `col > ?` or `col < ?`.
     */
    #composeQueryStatement(options, type, columnName, limit) {
        const direction = options.descending ? 'DESC' : 'ASC';

        const conditions = [ 'type = ?' ];
        const params = [ type ];

        if (!isUndefined(options.equalTo)) {
            const hasBounds = !isUndefined(options.greaterThan)
                || !isUndefined(options.greaterThanOrEqualTo)
                || !isUndefined(options.lessThan)
                || !isUndefined(options.lessThanOrEqualTo);
            if (hasBounds) {
                throw new AssertionError(
                    'DocumentStoreEngine: "equalTo" cannot be combined with range bounds (greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo)',
                );
            }
            // NULL requires IS NULL rather than col = ? because SQL equality against
            // NULL always evaluates to NULL, not true.
            if (options.equalTo === null) {
                conditions.push(`${ columnName } IS NULL`);
            } else {
                conditions.push(`${ columnName } = ?`);
                params.push(options.equalTo);
            }
        }

        if (!isUndefined(options.greaterThanOrEqualTo)) {
            conditions.push(`${ columnName } >= ?`);
            params.push(options.greaterThanOrEqualTo);
        }
        if (!isUndefined(options.lessThanOrEqualTo)) {
            conditions.push(`${ columnName } <= ?`);
            params.push(options.lessThanOrEqualTo);
        }
        if (!isUndefined(options.greaterThan)) {
            conditions.push(`${ columnName } > ?`);
            params.push(options.greaterThan);
        }
        if (!isUndefined(options.lessThan)) {
            conditions.push(`${ columnName } < ?`);
            params.push(options.lessThan);
        }

        if (options.cursor) {
            const { key: cursorValue, id: cursorId } = options.cursor;

            // Null index values need special handling because SQL comparison operators against
            // NULL always evaluate to NULL (never true), so standard `col > ?` does not work.
            // Ascending order (nulls sort first):
            // - If cursor value is null: remaining nulls with id > lastId, then all non-nulls.
            // - If cursor value is non-null: standard `(col > val OR (col = val AND id > lastId))`.
            // Descending order (nulls sort last):
            // - If cursor value is null: remaining nulls with id < lastId only.
            // - If cursor value is non-null: standard `(col < val OR (col = val AND id < lastId))`.
            if (cursorValue === null) {
                if (direction === 'DESC') {
                    // Descending, nulls last — only nulls with a lower id remain.
                    conditions.push(`(${ columnName } IS NULL AND id < ?)`);
                    params.push(cursorId);
                } else {
                    // Ascending, nulls first — remaining nulls with higher id, then all non-nulls.
                    conditions.push(`((${ columnName } IS NULL AND id > ?) OR ${ columnName } IS NOT NULL)`);
                    params.push(cursorId);
                }
            } else if (direction === 'DESC') {
                // Include IS NULL so trailing null-keyed rows are not silently dropped.
                // NULL < non-null always evaluates to NULL in SQLite (never true), so without
                // this clause any records with a null sort key would be skipped entirely once
                // the cursor advances past the last non-null value.
                conditions.push(`(${ columnName } < ? OR (${ columnName } = ? AND id < ?) OR ${ columnName } IS NULL)`);
                params.push(cursorValue, cursorValue, cursorId);
            } else {
                conditions.push(`(${ columnName } > ? OR (${ columnName } = ? AND id > ?))`);
                params.push(cursorValue, cursorValue, cursorId);
            }
        }

        const sql = [
            `SELECT id, version, created_at, updated_at, ${ columnName } AS key, doc`,
            'FROM documents',
            `WHERE ${ conditions.join(' AND ') }`,
            `ORDER BY ${ columnName } ${ direction }, id ${ direction }`,
            'LIMIT ?',
        ].join(' ');

        // Fetch one extra record to determine whether a next page exists.
        params.push(limit + 1);

        return { sql, params };
    }

}

function getPaginationLimit(options, methodName) {
    if (isUndefined(options.limit)) {
        return 100;
    }

    if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new AssertionError(`${ methodName } options.limit must be an integer greater than zero`);
    }

    return options.limit;
}

// The continuation is this engine's own private shape, handed back by the
// DocumentStore facade exactly as it was issued. The facade verifies the token
// signature and query scope, so anything reaching here that does not match the
// shape is a broken internal invariant rather than bad client input.
function getPaginationCursor(options, methodName) {
    if (isUndefined(options.cursor)) {
        return undefined;
    }

    if (!isPlainObject(options.cursor)
        || !('key' in options.cursor)
        || !isNonEmptyString(options.cursor.id)) {
        throw new AssertionError(
            `${ methodName } options.cursor must be a continuation object issued by this engine`,
        );
    }

    return options.cursor;
}
