import { DatabaseSync } from 'node:sqlite';
import DocumentAlreadyExistsError from '../../document-store/document-already-exists-error.js';
import DocumentNotFoundError from '../../document-store/document-not-found-error.js';
import DocumentUniqueIndexViolationError from '../../document-store/document-unique-index-violation-error.js';
import VersionConflictError from '../../document-store/version-conflict-error.js';
import {
    AssertionError,
    isBoolean,
    isUndefined,
    isNonEmptyString,
    isObjectNotNull,
    assert,
    assertArray,
    assertNonEmptyString,
} from '../../assertions/mod.js';


const CURSOR_TOKEN_VERSION = 1;
const CURSOR_RANGE_OPTION_KEYS = [
    'equalTo',
    'greaterThan',
    'greaterThanOrEqualTo',
    'lessThan',
    'lessThanOrEqualTo',
];


/**
 * Node.js SQLite engine adapter for the document store abstraction.
 *
 * Mirrors the observable document, index, cursor, and error semantics of the
 * Cloudflare D1 adapter, but is built on Node's built-in `node:sqlite`
 * `DatabaseSync` API and owns a long-lived, application-scope SQLite connection.
 * Unlike the D1 adapter, which resolves a binding from each request `context`,
 * this engine keeps a single connection and ignores the `context` argument that
 * the {@link DocumentStoreEngineInterface} passes to every method.
 *
 * A connection may be supplied (`database`) or opened from a file system `path`.
 * When the engine opens the connection it owns it and closes it in `close()`;
 * an injected connection is left open for the caller to manage unless
 * `ownsDatabase` is set to true.
 *
 * Secondary indexes are configured through `setIndexDefinitions()` before the
 * database is first used, so callers can construct the engine before all
 * collection metadata has been registered. All documents are stored as JSON in
 * the `doc` column; queryable fields are exposed as VIRTUAL generated columns
 * backed by `json_extract()`.
 *
 * @see DocumentStoreEngineInterface in ../../document-store/document-store-engine-interface.js for the engine contract
 * @see DocumentStoreEngine in ../../cloudflare/document-store/document-store-engine.js for the Cloudflare D1 implementation
 */
export default class DocumentStoreEngine {

    #logger = null;

    #database = null;
    #ownsDatabase = false;
    #path = null;
    #sqliteOptions = null;
    #closed = false;

    #indexDefinitions = null;
    #indexKeys = [];
    #prepared = false;
    // Cached in-flight promise so concurrent callers coalesce onto a single
    // prepareDatabase() run rather than each triggering a separate migration.
    #preparePromise = null;

    /**
     * @param {Object} options - Configuration options
     * @param {import('../../logger/logger.js').default} options.logger - Root logger used to create a named child logger
     * @param {string} [options.path] - File system path or `':memory:'` opened when no `database` is supplied
     * @param {Object} [options.sqliteOptions] - Options forwarded to the `DatabaseSync` constructor when opening `path`
     * @param {import('node:sqlite').DatabaseSync} [options.database] - Pre-opened SQLite connection to use instead of opening `path`
     * @param {boolean} [options.ownsDatabase] - Whether `close()` should close the connection. Defaults to false when
     *   `database` is supplied and true when the engine opens `path`.
     * @throws {AssertionError} When logger is missing, or when neither `database` nor a non-empty `path` is provided
     */
    constructor(options) {
        const {
            logger,
            path,
            sqliteOptions,
            database,
            ownsDatabase,
        } = options ?? {};

        assert(logger, 'DocumentStoreEngine requires a logger');

        if (database) {
            // An injected connection is owned by the caller unless explicitly claimed.
            this.#database = database;
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : false;
        } else {
            assertNonEmptyString(path, 'DocumentStoreEngine requires a "path" string when no "database" is provided');
            this.#path = path;
            this.#sqliteOptions = sqliteOptions ?? {};
            // A connection opened by the engine is owned by the engine by default.
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : true;
        }

        this.#logger = logger.createChild('DocumentStoreEngine');
    }

    /**
     * Configures the secondary indexes available to `query()` and schema preparation.
     *
     * Each index definition maps a public index name to a JSON path that will be
     * exposed as a generated SQLite column. This method must be called exactly
     * once before the engine is used.
     *
     * @param {Object[]} indexDefinitions - Secondary index definitions
     * @param {string} indexDefinitions[].name - Query index name, limited to lowercase letters, numbers, and underscores
     * @param {string} indexDefinitions[].jsonPath - JSON path beginning with `$.`
     * @param {boolean} [indexDefinitions[].unique=false] - When true, the generated index is created as `UNIQUE`
     *   and conflicting writes raise `DocumentUniqueIndexViolationError`.
     * @returns {void}
     * @throws {AssertionError} When called more than once or an index definition is invalid
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
     * New definitions ensure a generated column backed by `json_extract()` and an
     * accompanying composite index on `(type, col)` both exist. Definitions that
     * have been removed drop the index then the column. Uniqueness changes are
     * reconciled by dropping and recreating the affected index. Safe to call on
     * every startup — DDL uses IF NOT EXISTS or is guarded by the PRAGMA pre-check.
     *
     * @returns {Promise<void>}
     * @throws {AssertionError} When `setIndexDefinitions()` has not been called
     * @throws {Error} When table creation, schema reconciliation, or PRAGMA introspection fails
     */
    async prepareDatabase() {
        assertArray(this.#indexDefinitions, 'DocumentStoreEngine#setIndexDefinitions() must be called before the database can be used');

        const db = this.#getDatabase();

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
        let tableSchema;
        try {
            db.exec(createTableSQL);
            db.exec(defaultIndexSQL);
            // table_xinfo() is used instead of table_info() because it includes hidden and
            // generated (VIRTUAL) columns, which table_info() silently omits in some SQLite versions.
            tableInfo = db.prepare('PRAGMA table_xinfo(documents)').all();
            indexList = db.prepare('PRAGMA index_list(documents)').all();
            tableSchema = db
                .prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?')
                .get('table', 'documents');
        } catch (cause) {
            throw new Error('Unable to prepare SQLite documents table', { cause });
        }

        // We are only interested in the generated index columns, named "key_*".
        const existingKeyColumns = new Set(
            tableInfo
                .map(({ name }) => name)
                .filter((name) => name.startsWith('key_')),
        );
        const tableSQL = tableSchema?.sql ?? '';

        // PRAGMA index_list rows look like { seq, name, unique, origin, partial };
        // we only need the uniqueness flag keyed by index name.
        const existingIndexUnique = new Map(
            indexList.map(({ name, unique }) => [ name, unique === 1 ]),
        );

        for (const indexDefinition of this.#indexDefinitions) {
            const columnName = keyToColumnName(indexDefinition.name);
            const indexName = keyToIndexName(indexDefinition.name);
            const wantUnique = indexDefinition.unique === true;
            const createIndexSQL = `CREATE ${ wantUnique ? 'UNIQUE ' : '' }INDEX IF NOT EXISTS ${ indexName } ON documents (type, ${ columnName })`;

            if (existingKeyColumns.has(columnName)) {
                const existingJsonPath = getGeneratedColumnJsonPath(tableSQL, columnName);
                if (existingJsonPath !== indexDefinition.jsonPath) {
                    try {
                        db.exec(`DROP INDEX IF EXISTS ${ indexName }`);
                        db.exec(`ALTER TABLE documents DROP COLUMN ${ columnName }`);
                    } catch (cause) {
                        throw new Error(`Unable to replace changed index column "${ columnName }" in SQLite documents table`, { cause });
                    }
                    existingKeyColumns.delete(columnName);
                    existingIndexUnique.delete(indexName);
                }
            }

            if (!existingKeyColumns.has(columnName)) {
                // SQLite restrictions on ALTER TABLE ADD COLUMN:
                // - Does not support IF NOT EXISTS — so we guard with the PRAGMA check above.
                // - STORED generated columns cannot be added to a non-empty table; VIRTUAL
                //   generated columns have no such restriction and are equally indexable.
                // The jsonPath is quoted as a SQL string literal so an embedded quote cannot
                // break out of the generated-column expression.
                try {
                    db.exec(`
                        ALTER TABLE documents ADD COLUMN ${ columnName }
                        TEXT GENERATED ALWAYS AS (json_extract(doc, ${ quoteSqlString(indexDefinition.jsonPath) })) VIRTUAL
                    `);
                } catch (cause) {
                    throw new Error(`Unable to add index column "${ columnName }" to SQLite documents table`, { cause });
                }
                existingKeyColumns.add(columnName);
            }

            if (!existingIndexUnique.has(indexName)) {
                // A previous prepare can crash after adding the column but before
                // creating the index; reconcile the index independently.
                try {
                    db.exec(createIndexSQL);
                } catch (cause) {
                    throw new Error(`Unable to create index "${ indexName }" on SQLite documents table`, { cause });
                }
            } else if (existingIndexUnique.get(indexName) !== wantUnique) {
                // Column survives; index uniqueness flag is reconciled by drop + recreate.
                try {
                    db.exec(`DROP INDEX IF EXISTS ${ indexName }`);
                    db.exec(createIndexSQL);
                } catch (cause) {
                    throw new Error(`Unable to reconcile uniqueness on index "${ indexName }"`, { cause });
                }
            }
        }

        const desiredIndexKeys = this.#indexDefinitions.map(({ name }) => name);
        for (const columnName of existingKeyColumns) {
            const keyName = columnNameToKey(columnName);
            if (!desiredIndexKeys.includes(keyName)) {
                try {
                    db.exec(`DROP INDEX IF EXISTS ${ keyToIndexName(keyName) }`);
                    db.exec(`ALTER TABLE documents DROP COLUMN ${ columnName }`);
                } catch (cause) {
                    throw new Error(`Unable to drop stale index column "${ columnName }" from SQLite documents table`, { cause });
                }
            }
        }

        this.#prepared = true;
        this.#logger.debug('prepared documents database', { indexes: desiredIndexKeys });
    }

    /**
     * Returns a keyset-paginated page of documents filtered and sorted by a named index.
     *
     * The index name must correspond to an entry in `indexDefinitions`. Each record in
     * the result exposes the matched index value as `key`.
     *
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {string} type - Document type used to scope the query
     * @param {Object} [options]
     * @param {string} options.index - Name of the configured index key to query
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the index value; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the index value
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the index value
     * @param {*} [options.lessThan] - Exclusive upper bound on the index value
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the index value
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When `options.index`, `options.limit`, or `options.cursor` are invalid, or when `equalTo` is combined with range bounds
     */
    async query(_context, type, options) {
        options = options ?? {};

        assertNonEmptyString(options.index, 'DocumentStoreEngine#query() requires an index name');
        if (!this.#indexKeys.includes(options.index)) {
            throw new AssertionError(`DocumentStoreEngine#query() index key "${ options.index }" is not configured`);
        }

        const columnName = keyToColumnName(options.index);

        const limit = getPaginationLimit(options, 'DocumentStoreEngine#query()');
        const cursor = getPaginationCursor(options, 'DocumentStoreEngine#query()');
        const queryOptions = Object.assign({}, options, { cursor });
        const cursorScope = createCursorScope({
            method: 'query',
            type,
            index: options.index,
            options: queryOptions,
        });

        const { sql, params } = composeQueryStatement({
            options: queryOptions,
            type,
            columnName,
            limit,
            cursorScope,
        });

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();
        const results = db.prepare(sql).all(...params);

        let nextCursor = null;
        if (results.length > limit) {
            // We fetched one extra record to determine whether a next page exists.
            results.pop();
            const last = results[results.length - 1];
            nextCursor = encodeCursor(last.key, last.id, cursorScope);
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
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {string} type - Document type used to scope the scan
     * @param {Object} [options]
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on sort_key; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on sort_key
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on sort_key
     * @param {*} [options.lessThan] - Exclusive upper bound on sort_key
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on sort_key
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When `options.limit` or `options.cursor` are invalid, or when `equalTo` is combined with range bounds
     */
    async scan(_context, type, options) {
        options = options ?? {};

        const columnName = 'sort_key';

        const limit = getPaginationLimit(options, 'DocumentStoreEngine#scan()');
        const cursor = getPaginationCursor(options, 'DocumentStoreEngine#scan()');
        const scanOptions = Object.assign({}, options, { cursor });
        const cursorScope = createCursorScope({
            method: 'scan',
            type,
            options: scanOptions,
        });

        const { sql, params } = composeQueryStatement({
            options: scanOptions,
            type,
            columnName,
            limit,
            cursorScope,
        });

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();
        const results = db.prepare(sql).all(...params);

        let nextCursor = null;
        if (results.length > limit) {
            // We fetched one extra record to determine whether a next page exists.
            results.pop();
            const last = results[results.length - 1];
            nextCursor = encodeCursor(last.key, last.id, cursorScope);
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
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {string} type - Document type
     * @param {string} id - Document identifier
     * @returns {Promise<(Object|null)>} The stored record with parsed `doc` payload or null if not found
     */
    async get(_context, type, id) {
        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();

        const row = db
            .prepare('SELECT doc, version, created_at, updated_at FROM documents WHERE type = ? AND id = ?')
            .get(type, id);

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
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {Object} doc - Document payload; must include `type` and `id` string properties
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier
     * @param {string} [doc.sortKey] - Optional sort key stored on the row; null when omitted
     * @returns {Promise<Object>} Stored record with updated `version`, `createdAt`, and `updatedAt`
     * @throws {DocumentUniqueIndexViolationError} When the write would violate a configured unique secondary index
     */
    async put(_context, doc) {
        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const now = new Date().toISOString();
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();

        // RETURNING lets us read created_at and the new version in a single statement,
        // avoiding a separate SELECT after the write. SQLite 3.35+ (2021-03-15).
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

        let row;
        try {
            row = db.prepare(sql).get(type, id, sortKey, now, now, json);
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
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
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
    async update(_context, doc, version) {
        if (!Number.isInteger(version) || version <= 0) {
            throw new AssertionError('DocumentStoreEngine#update() requires a positive integer version number');
        }

        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const updatedAt = new Date().toISOString();
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();

        // The version predicate makes the update atomic: one statement both writes the
        // document and proves that the caller saw the current version.
        const sql = `
            UPDATE documents
            SET doc = ?, sort_key = ?, version = version + 1, updated_at = ?
            WHERE type = ? AND id = ? AND version = ?
            RETURNING version, created_at, updated_at
        `;

        let row;
        try {
            row = db.prepare(sql).get(json, sortKey, updatedAt, type, id, version);
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
        const record = db
            .prepare('SELECT version FROM documents WHERE type = ? AND id = ?')
            .get(type, id);

        if (!record) {
            throw new DocumentNotFoundError(type, id);
        }

        throw new VersionConflictError(type, id, version, record.version);
    }

    /**
     * Creates a document only when no row already exists for the same type and id.
     *
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {Object} doc - Document payload; must include `type` and `id` string properties
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier
     * @param {string} [doc.sortKey] - Optional sort key stored on the row; null when omitted
     * @returns {Promise<Object>} Stored record with initial `version`, `createdAt`, and `updatedAt`
     * @throws {DocumentAlreadyExistsError} When a document already exists for the same type and id
     * @throws {DocumentUniqueIndexViolationError} When the write would violate a configured unique secondary index
     */
    async create(_context, doc) {
        const { type, id } = doc;
        const sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey;
        const now = new Date().toISOString();
        const json = JSON.stringify(doc);

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();

        // ON CONFLICT(type, id) DO NOTHING suppresses only primary-key collisions; a
        // collision on a configured secondary unique index still raises and is translated.
        const sql = `
            INSERT INTO documents (type, id, sort_key, version, created_at, updated_at, doc)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(type, id) DO NOTHING
            RETURNING version, created_at, updated_at
        `;

        let row;
        try {
            row = db.prepare(sql).get(type, id, sortKey, now, now, json);
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
     * @param {Object} _context - Ignored; present for DocumentStoreEngineInterface compatibility
     * @param {string} type - Document type
     * @param {string} id - Document identifier
     * @param {number} [version] - Expected current version; omit for an unconditional delete
     * @returns {Promise<boolean>} `true` when a row was deleted; `false` on the force-delete path when no row existed
     * @throws {AssertionError} When `version` is present but not a positive integer
     * @throws {DocumentNotFoundError} When a versioned delete targets a non-existent document
     * @throws {VersionConflictError} When the stored version does not match the provided version
     */
    async delete(_context, type, id, version) {
        if (!isUndefined(version) && (!Number.isInteger(version) || version <= 0)) {
            throw new AssertionError('DocumentStoreEngine#delete() requires a positive integer version number when present');
        }

        if (!this.#prepared) {
            await this.#ensurePrepared();
        }

        const db = this.#getDatabase();

        if (!isUndefined(version)) {
            // We expect the document to exist and the version to match.
            // run().changes reports the affected row count; DELETE returns no result rows.
            const result = db
                .prepare('DELETE FROM documents WHERE type = ? AND id = ? AND version = ?')
                .run(type, id, version);

            if (result.changes > 0) {
                return true;
            }

            // Distinguish not-found from version conflict.
            const record = db
                .prepare('SELECT version FROM documents WHERE type = ? AND id = ?')
                .get(type, id);

            if (!record) {
                throw new DocumentNotFoundError(type, id);
            }

            throw new VersionConflictError(type, id, version, record.version);
        }

        const result = db
            .prepare('DELETE FROM documents WHERE type = ? AND id = ?')
            .run(type, id);

        return result.changes > 0;
    }

    /**
     * Releases the SQLite connection when the engine owns it.
     *
     * Safe to call more than once: subsequent calls are no-ops. An injected
     * connection that the engine does not own is left open for the caller.
     *
     * @returns {void}
     */
    close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;

        // Only close a connection the engine opened; an injected database is the caller's to manage.
        if (this.#ownsDatabase && this.#database) {
            this.#database.close();
        }
        this.#database = null;
    }

    /**
     * Translates a SQLite UNIQUE-constraint failure on one of this engine's
     * indexed `key_*` columns into a `DocumentUniqueIndexViolationError`.
     *
     * `node:sqlite` surfaces SQLITE_CONSTRAINT_UNIQUE as an error whose message
     * lists the offending columns, e.g.
     * `UNIQUE constraint failed: documents.type, documents.key_email`. Only
     * configured `key_*` columns are translated, so unrelated unique constraints
     * keep their original error.
     *
     * @param {string} type - Document type used in the failed write.
     * @param {Error} err - Error raised by `node:sqlite`.
     * @returns {DocumentUniqueIndexViolationError|null} Translated error when the
     *   failure matches a configured unique index, otherwise null.
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

        const indexName = columnNameToKey(keyColumn.replace(/^documents\./, ''));
        if (!this.#indexKeys.includes(indexName)) {
            return null;
        }
        return new DocumentUniqueIndexViolationError(type, indexName);
    }

    /**
     * Ensures the schema is prepared before a CRUD operation, coalescing
     * concurrent callers onto a single in-flight prepare. On failure the cached
     * promise is cleared so the next call retries.
     */
    #ensurePrepared() {
        if (!this.#preparePromise) {
            this.#preparePromise = this.prepareDatabase().catch((err) => {
                this.#preparePromise = null;
                throw err;
            });
        }
        return this.#preparePromise;
    }

    /**
     * Returns the owned SQLite connection, opening it lazily on first use.
     *
     * Opening is deferred so construction stays cheap and a `':memory:'` engine
     * that is closed before any operation never allocates a database.
     */
    #getDatabase() {
        if (this.#closed) {
            throw new AssertionError('DocumentStoreEngine has been closed');
        }
        if (!this.#database) {
            this.#database = new DatabaseSync(this.#path, this.#sqliteOptions);
        }
        return this.#database;
    }
}

function columnNameToKey(columnName) {
    return columnName.replace(/^key_/, '');
}

function keyToColumnName(keyName) {
    return `key_${ keyName }`;
}

function keyToIndexName(keyName) {
    return `idx_type_custom_key_${ keyName }`;
}

function quoteSqlString(value) {
    // SQLite escapes an embedded single quote inside a string literal by doubling it.
    return `'${ String(value).replace(/'/g, "''") }'`;
}

function unquoteSqlString(value) {
    return value.slice(1, -1).replace(/''/g, "'");
}

function getGeneratedColumnJsonPath(tableSQL, columnName) {
    const pattern = new RegExp(
        `\\b${ escapeRegExp(columnName) }\\b\\s+TEXT\\s+GENERATED\\s+ALWAYS\\s+AS\\s*\\(\\s*json_extract\\s*\\(\\s*doc\\s*,\\s*('(?:''|[^'])*')\\s*\\)\\s*\\)\\s+VIRTUAL`,
        'i',
    );
    const match = pattern.exec(tableSQL);
    return match ? unquoteSqlString(match[1]) : null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createCursorScope(args) {
    const {
        method,
        type,
        index,
        options,
    } = args ?? {};
    const cursorOptions = options ?? {};

    const scope = {
        method,
        type,
        descending: cursorOptions.descending === true,
        range: [],
    };

    if (!isUndefined(index)) {
        scope.index = index;
    }

    for (const optionName of CURSOR_RANGE_OPTION_KEYS) {
        if (!isUndefined(cursorOptions[optionName])) {
            scope.range.push([ optionName, cursorOptions[optionName] ]);
        }
    }

    return scope;
}

function encodeCursor(indexValue, id, scope) {
    return btoa(JSON.stringify({
        version: CURSOR_TOKEN_VERSION,
        scope,
        key: indexValue,
        id,
    }));
}

function decodeCursor(cursor, expectedScope) {
    let token;
    try {
        token = JSON.parse(atob(cursor));
    } catch (cause) {
        throw new AssertionError('DocumentStoreEngine: invalid cursor token', { cause });
    }

    if (!isValidCursorToken(token, expectedScope)) {
        throw new AssertionError('DocumentStoreEngine: invalid cursor token');
    }

    return {
        key: token.key,
        id: token.id,
    };
}

function isValidCursorToken(token, expectedScope) {
    return isObjectNotNull(token)
        && !Array.isArray(token)
        && token.version === CURSOR_TOKEN_VERSION
        && 'key' in token
        && isNonEmptyString(token.id)
        && areCursorScopesEqual(token.scope, expectedScope);
}

function areCursorScopesEqual(actualScope, expectedScope) {
    return JSON.stringify(actualScope) === JSON.stringify(expectedScope);
}

/**
 * Builds the SELECT statement and bound parameter list shared by `query()` and `scan()`.
 *
 * The limit passed in is fetched + 1 so callers can detect whether a next page
 * exists without a separate COUNT query — if `results.length > limit`, there are
 * more rows and the extra row is discarded before encoding the cursor.
 *
 * Keyset pagination handles null column values explicitly: standard SQL
 * comparison operators against NULL always return NULL (not false), so a cursor
 * pointing at a null value requires IS NULL / IS NOT NULL guards rather than
 * `col > ?` or `col < ?`.
 */
function composeQueryStatement(args) {
    const {
        options,
        type,
        columnName,
        limit,
        cursorScope,
    } = args ?? {};

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
        const { key: cursorValue, id: cursorId } = decodeCursor(options.cursor, cursorScope);

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

function getPaginationLimit(options, methodName) {
    if (isUndefined(options.limit)) {
        return 100;
    }

    if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new AssertionError(`${ methodName } options.limit must be an integer greater than zero`);
    }

    return options.limit;
}

function getPaginationCursor(options, methodName) {
    if (isUndefined(options.cursor)) {
        return undefined;
    }

    if (!isNonEmptyString(options.cursor)) {
        throw new AssertionError(`${ methodName } options.cursor must be a non-empty string when present`);
    }

    return options.cursor;
}
