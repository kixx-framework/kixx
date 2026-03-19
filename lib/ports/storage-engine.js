/**
 * StorageEngine port — the low-level persistence contract for the DataStore.
 *
 * The DataStore class delegates all I/O to a StorageEngine implementation.
 * Implement this interface to support different persistence backends (SQLite,
 * DynamoDB, Cloudflare D1, etc.) without changing any DataStore or application code.
 *
 * ## Invariants
 * - initialize() MUST be called exactly once before any other method.
 * - All methods MUST return Promises (even if the underlying work is synchronous).
 * - put() with no version MUST upsert: create if not found, overwrite if found.
 * - put() with a version MUST reject with DocumentNotFoundError if (type, id) does not exist.
 * - put() with a version MUST reject with VersionConflictError if the stored version differs.
 * - delete() with no version MUST return false if (type, id) does not exist.
 * - delete() with a version MUST reject with DocumentNotFoundError if (type, id) does not exist.
 * - delete() with a version MUST reject with VersionConflictError on version mismatch.
 * - query() cursor tokens are opaque — engines may encode them however they choose.
 *   Engines MUST resume from the supplied cursor without using OFFSET-style pagination,
 *   but inserts between pages may skip or repeat records at the page boundary.
 *   Seek-based cursors are strongly recommended for backend portability.
 *
 * @module ports/storage-engine
 */

/**
 * @typedef {Object} DocumentRecord
 * @property {Object} doc - The stored document exactly as provided by the application.
 * @property {number} version - Monotonically increasing integer starting at 1.
 * @property {string} createdAt - ISO 8601 UTC timestamp set on first write, never changed.
 * @property {string} updatedAt - ISO 8601 UTC timestamp updated on every write.
 */

/**
 * @typedef {Object} IndexDefinition
 * @property {string} type - Document type this index covers (e.g. "Customer").
 * @property {string} attribute - Top-level document attribute to index (e.g. "email").
 */

/**
 * Options for querying a page of documents.
 *
 * Range operators (`greaterThan`, `greaterThanOrEqualTo`/`startKey`, `lessThan`,
 * `lessThanOrEqualTo`/`endKey`) filter by the indexed column value.
 * `beginsWith` is a convenience that the DataStore resolves into an equivalent
 * `greaterThanOrEqualTo` + `lessThan` range before calling the engine — engines
 * receive only the canonical range operators, never `beginsWith`.
 *
 * @typedef {Object} QueryOptions
 * @property {string}  [index]                - Attribute name of a custom index. Omit to use the
 *                                              built-in type+sortKey index.
 * @property {string}  [greaterThanOrEqualTo] - Inclusive lower bound on the indexed value.
 * @property {string}  [lessThanOrEqualTo]    - Inclusive upper bound on the indexed value.
 * @property {string}  [greaterThan]          - Exclusive lower bound on the indexed value.
 * @property {string}  [lessThan]             - Exclusive upper bound on the indexed value.
 * @property {number}  [limit=100]            - Maximum records per page (1–1000).
 * @property {boolean} [reverse=false]        - If true, return results in descending index order.
 * @property {string}  [cursor]               - Opaque token from a previous QueryResult to fetch
 *                                              the next page.
 */

/**
 * @typedef {Object} QueryResult
 * @property {DocumentRecord[]} records - The page of matching records ordered by the indexed attribute.
 * @property {string|null}      cursor  - Opaque token to fetch the next page, or null when exhausted.
 */

/**
 * @typedef {Object} StorageEngine
 *
 * @property {function(): Promise<void>} initialize
 *   Called once before any other method. The engine creates the core storage
 *   structures (table, built-in index) but does not create custom indexes here;
 *   those are managed via configureIndexes().
 *
 * @property {function(IndexDefinition[]): Promise<void>} configureIndexes
 *   Accepts the complete desired set of custom index definitions. The engine
 *   compares this against its current indexes, creates any that are new, and
 *   removes any that are no longer listed. Must be idempotent.
 *
 * @property {function(Object, Object=): Promise<DocumentRecord>} put
 *   Write a single document.
 *   - No options.version → upsert. Creates the document if it does not exist; overwrites it if it does.
 *   - options.version provided → optimistic update. Rejects with DocumentNotFoundError if not found.
 *     Rejects with VersionConflictError if the stored version does not match.
 *   Returns the saved DocumentRecord.
 *
 * @property {function(string, string): Promise<DocumentRecord|null>} get
 *   Retrieve a document by (type, id). Returns null if not found.
 *
 * @property {function(string, string, number=): Promise<boolean>} delete
 *   Delete a document by (type, id).
 *   - No version → delete. Returns true if deleted, false if not found.
 *   - version provided → optimistic delete. Rejects with DocumentNotFoundError if not found.
 *     Rejects with VersionConflictError if the stored version does not match.
 *
 * @property {function(string, QueryOptions): Promise<QueryResult>} query
 *   Retrieve a page of DocumentRecords for the given type using an index.
 *   The DataStore normalizes all input (applies defaults, expands beginsWith) before
 *   calling this method. When QueryOptions.index is present,
 *   the engine is the source of truth for whether that custom index is configured.
 *
 * @property {function(): Promise<void>} close
 *   Release resources (close database handles, file locks, connections).
 */
