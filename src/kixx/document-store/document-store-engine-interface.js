/**
 * DocumentStoreEngineInterface - the contract for document store engines.
 *
 * Implementations persist JSON documents by `(type, id)`, expose distinct
 * create, upsert, and optimistic-update write paths, and provide keyset-paginated
 * reads over either the built-in sort key or configured secondary indexes.
 *
 * ## Invariants
 * - `type` and `id` identify one logical document.
 * - Stored records MUST include `type`, `id`, `version`, `createdAt`,
 *   `updatedAt`, and `doc`.
 * - Secondary index definitions MUST be configured exactly once before the
 *   engine is used.
 * - `create()` MUST reject when the target document already exists.
 * - `create()`, `put()`, and `update()` MUST reject with
 *   `DocumentUniqueIndexViolationError` when a write would violate a configured
 *   unique secondary index, with the conflicting index name attached.
 * - `put()` MUST create missing documents and overwrite existing documents
 *   without optimistic concurrency control.
 * - `version` MUST increase when an existing document is changed by `put()` or
 *   `update()`.
 * - `update()` MUST reject when the expected version is not a positive integer,
 *   the target document is missing, or the stored version differs from the
 *   expected version.
 * - `query()` MUST return custom index values as `record.key`.
 * - `scan()` MUST return built-in sort key values as `record.sortKey`.
 * - Pagination cursors MUST be opaque to callers and only reused with the same
 *   method, document type, index, sort direction, and range options that
 *   produced them.
 * - `close()` MUST be safe to call more than once.
 *
 * ## Context pass-through
 * Every read, write, scan, and query method receives a request or execution
 * `context` as its first argument. Runtime adapters use that context according
 * to their platform:
 * - Cloudflare adapters resolve their request-scoped D1 binding from
 *   `context.env` on every call.
 * - Node.js adapters resolve the local database file location from
 *   `context.config.env.DOCUMENT_STORE` via `context.config.resolveFilepath()`
 *   on first use, unless an explicit constructor override was supplied, then
 *   hold it fixed for the engine's lifetime.
 *
 * Implementations MUST accept the argument so callers can stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design rather than sharing a
 * SQLite base class, because their connection models and SQL drivers differ.
 * @see DocumentStoreEngine in ../../plugins/cloudflare-document-store-engine/lib/document-store-engine.js for the Cloudflare D1 implementation
 * @see DocumentStoreEngine in ../../plugins/node-document-store-engine/lib/document-store-engine.js for the Node.js SQLite implementation
 * @see docs/document-store.md for the facade, engine, and runtime-adapter overview
 */

/**
 * @typedef {Object} DocumentStoreIndexDefinition
 * @property {string} name - Secondary index name accepted by `query()`.
 * @property {string} jsonPath - JSON path used to extract the index value from the stored document.
 * @property {boolean} [unique=false] - When true, the engine MUST enforce uniqueness on
 *   `(type, indexed-value)` and reject writes that violate it with
 *   `DocumentUniqueIndexViolationError`.
 */

/**
 * @typedef {Object} DocumentStoreRecord
 * @property {string} type - Document type.
 * @property {string} id - Document identifier within the type.
 * @property {number} version - Current stored document version.
 * @property {string} createdAt - ISO timestamp for the original creation time.
 * @property {string} updatedAt - ISO timestamp for the most recent write.
 * @property {Object} doc - Stored JSON document payload.
 */

/**
 * @typedef {DocumentStoreRecord & {key: *}} DocumentStoreQueryRecord
 */

/**
 * @typedef {DocumentStoreRecord & {sortKey: string|null}} DocumentStoreScanRecord
 */

/**
 * @typedef {Object} DocumentStoreQueryOptions
 * @property {string} index - Name of the configured secondary index to query.
 * @property {boolean} [descending=false] - Sort in descending order when true.
 * @property {number} [limit=100] - Positive integer maximum number of records to return.
 * @property {string} [cursor] - Non-empty opaque pagination cursor from a previous page.
 * @property {*} [equalTo] - Exact match on the index value; mutually exclusive with range bounds.
 * @property {*} [greaterThan] - Exclusive lower bound on the index value.
 * @property {*} [greaterThanOrEqualTo] - Inclusive lower bound on the index value.
 * @property {*} [lessThan] - Exclusive upper bound on the index value.
 * @property {*} [lessThanOrEqualTo] - Inclusive upper bound on the index value.
 */

/**
 * @typedef {Object} DocumentStoreScanOptions
 * @property {boolean} [descending=false] - Sort in descending order when true.
 * @property {number} [limit=100] - Positive integer maximum number of records to return.
 * @property {string} [cursor] - Non-empty opaque pagination cursor from a previous page.
 * @property {*} [equalTo] - Exact match on the sort key; mutually exclusive with range bounds.
 * @property {*} [greaterThan] - Exclusive lower bound on the sort key.
 * @property {*} [greaterThanOrEqualTo] - Inclusive lower bound on the sort key.
 * @property {*} [lessThan] - Exclusive upper bound on the sort key.
 * @property {*} [lessThanOrEqualTo] - Inclusive upper bound on the sort key.
 */

/**
 * @typedef {Object} DocumentStoreQueryResult
 * @property {DocumentStoreQueryRecord[]} records - Page of matching records.
 * @property {string|null} cursor - Opaque cursor for the next page, or null.
 */

/**
 * @typedef {Object} DocumentStoreScanResult
 * @property {DocumentStoreScanRecord[]} records - Page of matching records.
 * @property {string|null} cursor - Opaque cursor for the next page, or null.
 */

/**
 * Document store engine.
 *
 * @typedef {Object} DocumentStoreEngineInterface
 *
 * @property {function(DocumentStoreIndexDefinition[]): void} setIndexDefinitions
 *   Configures the secondary indexes available to `query()` and schema
 *   preparation. Must be called exactly once before the first read, write,
 *   scan, or query.
 *
 * @property {function(Object, string, DocumentStoreQueryOptions): Promise<DocumentStoreQueryResult>} query
 *   Returns a keyset-paginated page of documents filtered and sorted by a
 *   configured secondary index.
 *
 * @property {function(Object, string, DocumentStoreScanOptions=): Promise<DocumentStoreScanResult>} scan
 *   Returns a keyset-paginated page of documents sorted by the built-in sort key.
 *
 * @property {function(Object, string, string): Promise<DocumentStoreRecord>} get
 *   Retrieves one document by type and id.
 *
 * @property {function(Object, Object): Promise<DocumentStoreRecord>} create
 *   Creates a document and rejects when a document already exists for the same
 *   type and id.
 *
 * @property {function(Object, Object): Promise<DocumentStoreRecord>} put
 *   Creates or overwrites a document without optimistic concurrency control.
 *   Missing documents start at version 1; existing documents are overwritten and
 *   increment their version.
 *
 * @property {function(Object, Object, number): Promise<DocumentStoreRecord>} update
 *   Updates an existing document using optimistic concurrency. The update MUST
 *   reject when the document is missing, the expected version is invalid, or the
 *   stored version differs.
 *
 * @property {function(Object, string, string, number=): Promise<boolean>} delete
 *   Deletes one document by type and id. When a version is provided, it MUST be
 *   a positive integer and the delete MUST use optimistic concurrency. The
 *   versioned delete MUST reject when the document is missing or the stored
 *   version differs. Without a version, returns false when the document did not
 *   exist.
 *
 * @property {function(): void} close
 *   Releases resources associated with the engine. Implementations with no
 *   resources to release MAY make this a no-op.
 */
