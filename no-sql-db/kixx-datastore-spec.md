# Kixx DataStore Specification

**Version:** 1.0.0-draft
**Date:** 2026-03-18
**Author:** Kixx Framework Contributors

---

## 1. Overview

The Kixx DataStore is a schemaless document database embedded within the Kixx Framework. It stores JSON documents identified by a composite key of `type` and `id`, supports optimistic concurrency control via document versioning, and provides indexed queries on top-level document attributes.

The DataStore follows the dependency inversion pattern used throughout Kixx: a high-level `DataStore` class defines the public API while delegating all storage operations to a pluggable `StorageEngine` implementation. Today we ship a single engine backed by Node.js built-in SQLite. Future engines may target DynamoDB, Cloudflare D1/KV, or other backends with zero changes to application code.

### Design Goals

- **Zero external dependencies.** Ships inside the Kixx npm package. Uses only Node.js built-ins (the `node:sqlite` module).
- **Cross-platform.** Works identically on Linux, macOS, and Windows under Node.js <= 24.
- **Schemaless.** Any valid JSON object can be stored provided it includes `id` and `type` attributes.
- **Explicit concurrency control.** The engine prevents partial overwrites through optimistic locking. Conflict resolution remains the application developer's responsibility.
- **Portable interface.** The abstract StorageEngine contract can be implemented on top of DynamoDB, Cloudflare D1, or any key-value / document store without changing the DataStore API.


## 2. Core Concepts

### 2.1 Document

A Document is a plain JSON-serializable JavaScript object supplied by the application developer. It must contain at least two top-level attributes:

| Attribute  | Type     | Required | Description |
|-----------|----------|----------|-------------|
| `id`      | `string` | Yes      | Unique identifier within its type. Must be a non-empty string suitable for hashing (ASCII-safe, no whitespace control characters). |
| `type`    | `string` | Yes      | Logical collection name (e.g., `"Customer"`, `"Product"`). Must be a non-empty string matching `/^[A-Za-z][A-Za-z0-9_-]*$/`. |
| `sortKey` | `string` | No       | Optional default sort value. When present, enables range queries on the built-in `type+sortKey` index. |

Beyond these, the document may contain any number of additional top-level attributes with JSON-serializable values (strings, numbers, booleans, nulls, nested objects, arrays). The DataStore does not inspect or validate nested structures.

### 2.2 DocumentRecord

A DocumentRecord is the envelope returned by all read and write operations. It wraps the original document with metadata managed by the engine:

```javascript
{
    doc: {
        id: "cust_001",
        type: "Customer",
        sortKey: "2026-03-18T12:00:00.000Z",
        name: "Acme Corp",
        email: "hello@acme.com"
    },
    version: 3,
    createdAt: "2026-03-18T10:00:00.000Z",
    updatedAt: "2026-03-18T12:00:00.000Z"
}
```

| Field       | Type      | Description |
|-------------|-----------|-------------|
| `doc`       | `Object`  | The stored JSON document exactly as provided by the application (plus any defaults applied at creation). |
| `version`   | `integer` | Monotonically increasing integer starting at `1`. Incremented on every successful write. |
| `createdAt` | `string`  | ISO 8601 UTC timestamp set on first write, never changed. |
| `updatedAt` | `string`  | ISO 8601 UTC timestamp set on every write. |

### 2.3 Indexes

An Index enables efficient queries over documents of a given type, ordered by a specific top-level attribute.

**Built-in Index:** Every DataStore instance has an implicit index on `type` + `sortKey`. Documents without a `sortKey` value are queryable through this index but sort as `null` (appearing first in ascending order, last in descending order).

**Custom Indexes:** Application developers declare custom indexes by calling `configureIndexes()` on the DataStore instance. This can be done at startup or at any point during the application lifecycle — indexes can be added dynamically without restarting. Each custom index specifies a single top-level attribute name. The index covers all documents of a given type ordered by that attribute's value.

```javascript
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Customer", attribute: "region" },
    { type: "Product",  attribute: "category" },
]);

// Later, add another index without restarting:
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Customer", attribute: "region" },
    { type: "Customer", attribute: "signupDate" },
    { type: "Product",  attribute: "category" },
]);
```

`configureIndexes()` is declarative: you pass the complete desired set of indexes each time. The engine compares the desired set against the current set, creates any that are new, and removes any that are no longer listed. This is idempotent — calling it with the same list twice is a no-op.

Index values are coerced to strings for ordering. Documents missing the indexed attribute are included in the index with a `null` sort position. This matches how DynamoDB sparse indexes and SQLite NULL ordering behave, keeping future portability straightforward.


## 3. Abstract StorageEngine Interface

The `StorageEngine` is the lower-level contract that concrete implementations must fulfill. The `DataStore` class delegates all I/O to the engine. The engine is responsible for persistence, indexing, and atomicity of individual operations.

```javascript
/**
 * @typedef {Object} StorageEngine
 *
 * @property {function(): Promise<void>} initialize
 *   Called once before any other method. The engine should create the core
 *   table/structures needed for document storage (but not custom indexes,
 *   which are managed via configureIndexes).
 *
 * @property {function(IndexDefinition[]): Promise<void>} configureIndexes
 *   Accepts the complete desired set of custom index definitions. The engine
 *   compares this against its current indexes, creates any that are new, and
 *   removes any that are no longer listed. Must be idempotent.
 *
 * @property {function(Object, Object?): Promise<DocumentRecord>} put
 *   Create or update a single document. Behavior depends on options.version:
 *   - No version: create. Must reject with DocumentAlreadyExistsError if
 *     a document with the same (type, id) already exists.
 *   - Version provided: update. Must reject with VersionConflictError if
 *     the stored version does not match. Must reject with
 *     DocumentNotFoundError if no document exists for (type, id).
 *   Returns the DocumentRecord with version and timestamps set.
 *
 * @property {function(string, string): Promise<DocumentRecord|null>} get
 *   Retrieve a single document by (type, id). Returns null if not found.
 *
 * @property {function(string, string, number): Promise<boolean>} delete
 *   Delete a document by (type, id) with optimistic version check.
 *   Must reject with VersionConflictError if versions do not match.
 *   Returns true if deleted, false if the document did not exist.
 *
 * @property {function(string, QueryOptions): Promise<QueryResult>} query
 *   Retrieve a page of DocumentRecords for the given type. See QueryOptions
 *   and QueryResult definitions below.
 *
 * @property {function(): Promise<void>} close
 *   Release resources (close database handles, file locks, connections).
 */
```

### 3.1 QueryOptions

```javascript
/**
 * @typedef {Object} QueryOptions
 * @property {string}  [index]              - Attribute name of a custom index.
 *                                            Omit to use the built-in
 *                                            type+sortKey index.
 * @property {string}  [greaterThanOrEqualTo] - Include records where the
 *                                              indexed value is >= this string.
 * @property {string}  [lessThanOrEqualTo]    - Include records where the
 *                                              indexed value is <= this string.
 * @property {string}  [greaterThan]          - Include records where the
 *                                              indexed value is > this string.
 * @property {string}  [lessThan]             - Include records where the
 *                                              indexed value is < this string.
 * @property {string}  [startKey]             - Inclusive lower bound. Alias for
 *                                              greaterThanOrEqualTo.
 * @property {string}  [endKey]               - Inclusive upper bound. Alias for
 *                                              lessThanOrEqualTo.
 * @property {string}  [beginsWith]           - Include records where the indexed
 *                                              value starts with this prefix.
 *                                              Cannot be combined with other
 *                                              range operators.
 * @property {number}  [limit=100]            - Maximum records to return
 *                                              (1..1000).
 * @property {boolean} [reverse=false]        - If true, return results in
 *                                              descending order of the indexed
 *                                              attribute.
 * @property {string}  [cursor]               - Opaque pagination token from a
 *                                              previous QueryResult.
 */
```

**Operator precedence and mutual exclusivity:**

- `startKey` is an alias for `greaterThanOrEqualTo`. Providing both is a `ValidationError`.
- `endKey` is an alias for `lessThanOrEqualTo`. Providing both is a `ValidationError`.
- `greaterThan` and `greaterThanOrEqualTo`/`startKey` are mutually exclusive.
- `lessThan` and `lessThanOrEqualTo`/`endKey` are mutually exclusive.
- `beginsWith` cannot be combined with any other range operator (`greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`, `startKey`, `endKey`). Providing both is a `ValidationError`.

**`beginsWith` implementation:** The engine translates `beginsWith: "foo"` into an equivalent inclusive range: `greaterThanOrEqualTo: "foo"` and `lessThan: "foo"` with the last character incremented (e.g., `"fop"`). This works across all future backends — DynamoDB supports `begins_with()` natively, and SQLite can use `>=` / `<` with a computed upper bound on a B-tree index.

### 3.2 QueryResult

```javascript
/**
 * @typedef {Object} QueryResult
 * @property {DocumentRecord[]} records - The page of matching records, ordered
 *                                        by the indexed attribute.
 * @property {string|null}      cursor  - Opaque token to fetch the next page.
 *                                        Null when no more results exist.
 */
```


## 4. DataStore Public API

The `DataStore` class is the only interface application developers interact with. It validates inputs, delegates to the StorageEngine, and translates engine errors into well-defined error types.

### 4.1 Constructor and Initialization

```javascript
import DataStore from 'kixx/datastore';

const store = new DataStore(engine);

// Must be called before any operations.
await store.initialize();

// Configure custom indexes (can be called at any time after initialize).
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Product",  attribute: "category" },
]);
```

`initialize()` is async because the engine may need to create database tables, directories, or other structures. It must be called exactly once before any read/write operations.

### 4.2 configureIndexes(indexes)

Declare the complete set of custom indexes the DataStore should maintain. This method is declarative: the engine compares the provided list against the current state, adds new indexes, and drops any that are no longer listed.

**Parameters:**

| Name      | Type                | Required | Description |
|-----------|---------------------|----------|-------------|
| `indexes` | `IndexDefinition[]` | Yes      | The complete desired set of custom indexes. |

Each `IndexDefinition` must have a `type` (string matching the document type pattern) and an `attribute` (non-empty string naming a top-level document property).

**Returns:** `Promise<void>`

**Behavior:**

- Can be called at any time after `initialize()`.
- Can be called multiple times. Each call replaces the previous index configuration.
- Adding a new index over existing data causes the engine to backfill the index for all documents of that type.
- Removing an index drops the underlying storage structure (e.g., the generated column and SQL index in SQLite).
- Calling with an empty array removes all custom indexes.

**Example:**

```javascript
// Initial setup
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
]);

// Later, add a second index without restarting
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Customer", attribute: "signupDate" },
]);
```

### 4.3 put(doc, options?)

Create or update a single document. Behavior is inferred from the `options.version` parameter:

- **No `version` provided (or `undefined`):** Treat as a **create**. Fails if a document with the same `(type, id)` already exists.
- **`version` provided (integer):** Treat as an **update**. Fails if the stored version does not match the provided version.

**Parameters:**

| Name              | Type      | Required | Description |
|-------------------|-----------|----------|-------------|
| `doc`             | `Object`  | Yes      | The JSON document. Must include `id` and `type`. |
| `options`         | `Object`  | No       | Write options. |
| `options.version` | `integer` | No       | Expected current version for optimistic update. |

**Returns:** `Promise<DocumentRecord>`

**Throws:**

| Error                       | Condition |
|-----------------------------|-----------|
| `ValidationError`           | Missing or invalid `id`, `type`, or `version`. |
| `DocumentAlreadyExistsError`| Create attempted but `(type, id)` already exists. |
| `DocumentNotFoundError`     | Update attempted but `(type, id)` does not exist. |
| `VersionConflictError`      | Update attempted but stored version ≠ provided version. |

**Example:**

```javascript
// Create
const record = await store.put({
    id: "cust_001",
    type: "Customer",
    sortKey: "2026-03-18T12:00:00.000Z",
    name: "Acme Corp",
    email: "hello@acme.com"
});

console.log(record.version); // 1
console.log(record.doc.name); // "Acme Corp"

// Update
const updated = await store.put(
    { ...record.doc, name: "Acme Corporation" },
    { version: record.version }
);

console.log(updated.version); // 2
console.log(updated.doc.name); // "Acme Corporation"
```

### 4.4 get(type, id)

Retrieve a single document by its composite key.

**Parameters:**

| Name   | Type     | Required | Description |
|--------|----------|----------|-------------|
| `type` | `string` | Yes      | Document type. |
| `id`   | `string` | Yes      | Document identifier. |

**Returns:** `Promise<DocumentRecord | null>` — Returns `null` if no document exists.

**Example:**

```javascript
const record = await store.get("Customer", "cust_001");

if (record) {
    console.log(record.doc.name);
    console.log(record.version);
}
```

### 4.5 delete(type, id, options)

Delete a document with optimistic version check.

**Parameters:**

| Name              | Type      | Required | Description |
|-------------------|-----------|----------|-------------|
| `type`            | `string`  | Yes      | Document type. |
| `id`              | `string`  | Yes      | Document identifier. |
| `options`         | `Object`  | Yes      | Delete options. |
| `options.version` | `integer` | Yes      | Expected current version. Must match to proceed. |

**Returns:** `Promise<boolean>` — `true` if deleted, `false` if the document did not exist.

**Throws:**

| Error                  | Condition |
|------------------------|-----------|
| `VersionConflictError` | Stored version ≠ provided version. |

**Example:**

```javascript
const deleted = await store.delete("Customer", "cust_001", {
    version: record.version
});
```

### 4.6 query(type, options?)

Query documents of a given type using an index.

**Parameters:**

| Name      | Type           | Required | Description |
|-----------|----------------|----------|-------------|
| `type`    | `string`       | Yes      | Document type to query. |
| `options` | `QueryOptions` | No       | Filtering, pagination, and ordering. See §3.1. |

**Returns:** `Promise<QueryResult>` — See §3.2.

**Example:**

```javascript
// Query customers by sortKey (default index), newest first
const page1 = await store.query("Customer", {
    startKey: "2026-01-01",
    endKey: "2026-12-31",
    limit: 25,
    reverse: true,
});

for (const record of page1.records) {
    console.log(record.doc.name, record.doc.sortKey);
}

// Fetch next page
if (page1.cursor) {
    const page2 = await store.query("Customer", {
        startKey: "2026-01-01",
        endKey: "2026-12-31",
        limit: 25,
        reverse: true,
        cursor: page1.cursor,
    });
}

// Query using a custom index with beginsWith
const results = await store.query("Product", {
    index: "category",
    beginsWith: "Electronics",
    limit: 50,
});

// Query using exclusive bounds
const range = await store.query("Customer", {
    index: "email",
    greaterThanOrEqualTo: "a",
    lessThan: "b",
    limit: 50,
});
```


## 5. Error Handling

All errors extend a common `DataStoreError` base class. Each carries a `code` property for programmatic matching.

```javascript
class DataStoreError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "DataStoreError";
        this.code = code;
    }
}
```

| Error Class                  | Code                    | Description |
|------------------------------|-------------------------|-------------|
| `ValidationError`            | `VALIDATION_ERROR`      | Invalid input (missing `id`, bad `type` format, non-integer `version`, etc.) |
| `DocumentAlreadyExistsError` | `DOCUMENT_EXISTS`       | Create failed because `(type, id)` is already occupied. |
| `DocumentNotFoundError`      | `DOCUMENT_NOT_FOUND`    | Update failed because `(type, id)` does not exist. |
| `VersionConflictError`       | `VERSION_CONFLICT`      | Write or delete rejected because the stored version ≠ expected version. |
| `IndexNotConfiguredError`    | `INDEX_NOT_CONFIGURED`  | Query referenced an index attribute not declared via `configureIndexes()`. |

The `VersionConflictError` includes the current stored version so the application developer can implement retry or merge logic:

```javascript
class VersionConflictError extends DataStoreError {
    constructor(type, id, expectedVersion, actualVersion) {
        super(
            `Version conflict on ${type}:${id} — expected ${expectedVersion}, found ${actualVersion}`,
            "VERSION_CONFLICT"
        );
        this.type = type;
        this.id = id;
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
    }
}
```


## 6. Node.js SQLite StorageEngine Implementation

### 6.1 Database File

The engine persists all data in a single SQLite database file. The file path is provided at engine construction. The engine opens the database in WAL (Write-Ahead Logging) mode for improved concurrent read performance.

```javascript
import { SQLiteStorageEngine } from 'kixx/datastore/sqlite';

const engine = new SQLiteStorageEngine({
    path: './data/myapp.db'
});
```

If the directory does not exist, the engine creates it recursively on `initialize()`.

### 6.2 Schema

The engine uses a single `documents` table. Custom indexes are implemented as SQLite generated columns with corresponding SQL indexes.

```sql
-- Core table
CREATE TABLE IF NOT EXISTS documents (
    type       TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    sort_key   TEXT,
    doc        TEXT    NOT NULL,   -- JSON-serialized document
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (type, id)
);

-- Built-in default index: type + sortKey
CREATE INDEX IF NOT EXISTS idx_type_sort_key
    ON documents (type, sort_key);
```

### 6.3 Custom Index Columns

For each declared custom index `{ type, attribute }`, the engine adds a generated column and a SQL index when `configureIndexes()` is called:

```sql
-- Example for { type: "Customer", attribute: "email" }
ALTER TABLE documents ADD COLUMN IF NOT EXISTS
    idx_email TEXT GENERATED ALWAYS AS (json_extract(doc, '$.email')) STORED;

CREATE INDEX IF NOT EXISTS idx_type_email
    ON documents (type, idx_email);
```

Generated columns are **STORED** (not VIRTUAL) so they participate in SQL indexes.

When an index is removed via a subsequent `configureIndexes()` call, the engine drops the SQL index. SQLite does not support `ALTER TABLE ... DROP COLUMN` for generated columns, so the generated column remains in the schema but its SQL index is dropped, making it inert. The column is harmless — it occupies no significant space when unused and does not affect query plans once its index is dropped.

> **Note:** Because generated columns are global to the table, a column named `idx_email` is created once and applies across all document types. The SQL index on `(type, idx_email)` means queries are still scoped to a single type, and the column value is simply `null` for document types that don't use that attribute. This is efficient: SQLite handles null-valued index entries gracefully.

### 6.4 Write Operations

**Create (put without version):**

```sql
INSERT INTO documents (type, id, sort_key, doc, version, created_at, updated_at)
VALUES (?, ?, ?, ?, 1, ?, ?);
```

A `UNIQUE constraint` violation on `(type, id)` is caught and re-thrown as `DocumentAlreadyExistsError`.

**Update (put with version):**

```sql
UPDATE documents
SET doc = ?, sort_key = ?, version = version + 1, updated_at = ?
WHERE type = ? AND id = ? AND version = ?;
```

If zero rows are affected, the engine performs a follow-up `SELECT version FROM documents WHERE type = ? AND id = ?` to distinguish between `DocumentNotFoundError` (no row) and `VersionConflictError` (row exists, version mismatch). The follow-up SELECT returns the actual version so it can be included in the error.

**Delete:**

```sql
DELETE FROM documents WHERE type = ? AND id = ? AND version = ?;
```

Same zero-rows-affected logic as update.

### 6.5 Read Operations

**Get:**

```sql
SELECT doc, version, created_at, updated_at
FROM documents
WHERE type = ? AND id = ?;
```

**Query (default index):**

```sql
SELECT doc, version, created_at, updated_at
FROM documents
WHERE type = ?
  AND (sort_key >= ? OR ? IS NULL)   -- greaterThanOrEqualTo / startKey
  AND (sort_key <= ? OR ? IS NULL)   -- lessThanOrEqualTo / endKey
  AND (sort_key >  ? OR ? IS NULL)   -- greaterThan
  AND (sort_key <  ? OR ? IS NULL)   -- lessThan
ORDER BY sort_key ASC, id ASC        -- or DESC for reverse
LIMIT ?;
```

**Query with `beginsWith`:**

The engine translates `beginsWith: "foo"` into the equivalent range query:

```sql
SELECT doc, version, created_at, updated_at
FROM documents
WHERE type = ?
  AND sort_key >= ?     -- "foo"
  AND sort_key < ?      -- "fop" (prefix with last char incremented)
ORDER BY sort_key ASC, id ASC
LIMIT ?;
```

**Query (custom index):**

Same structure, substituting the generated column name (e.g., `idx_email`) for `sort_key`.

### 6.6 Cursor Implementation

Cursors encode the last record's indexed value and `id` as a Base64-encoded JSON string:

```javascript
// Encode
const cursor = btoa(JSON.stringify({ v: lastSortValue, id: lastId }));

// Decode on next query
const { v, id } = JSON.parse(atob(cursor));
```

When a cursor is present, the query adds a seek condition:

```sql
-- Ascending
AND (sort_key > ? OR (sort_key = ? AND id > ?))

-- Descending
AND (sort_key < ? OR (sort_key = ? AND id < ?))
```

This seek-based approach avoids OFFSET, which is O(n) in SQLite and does not translate to DynamoDB's `ExclusiveStartKey` model.

### 6.7 Concurrency

SQLite in WAL mode supports concurrent reads with a single writer. The Node.js `node:sqlite` module executes SQL synchronously on the calling thread, so Node's single-threaded event loop serializes all writes naturally. No additional application-level locking is required beyond the optimistic version check.

For future multi-process scenarios (e.g., cluster mode), SQLite's built-in file-level locking and the `SQLITE_BUSY` retry mechanism provide the necessary protection.


## 7. Validation Rules

The `DataStore` class validates all inputs before delegating to the engine. Validation failures throw `ValidationError`.

**Document validation on `put()`:**

1. `doc` must be a non-null plain object.
2. `doc.type` must be a non-empty string matching `/^[A-Za-z][A-Za-z0-9_-]*$/`.
3. `doc.id` must be a non-empty string. Must not contain control characters (`\x00`–`\x1F`).
4. `doc.sortKey`, if present, must be a string.
5. `options.version`, if present, must be a positive integer.
6. The document must be JSON-serializable (`JSON.stringify` must not throw).
7. Reserved top-level attribute names (`version`, `createdAt`, `updatedAt`) must not appear in the document. These live in the DocumentRecord wrapper, not inside the document itself.

**Query validation:**

1. `type` must match the same pattern as document type.
2. `options.index`, if provided, must match a custom index declared via `configureIndexes()` for the given type.
3. `options.limit` must be an integer in the range `[1, 1000]`.
4. Range bounds (`greaterThanOrEqualTo`, `lessThanOrEqualTo`, `greaterThan`, `lessThan`, `startKey`, `endKey`, `beginsWith`) must be strings if present.
5. `greaterThan` and `greaterThanOrEqualTo`/`startKey` are mutually exclusive. `lessThan` and `lessThanOrEqualTo`/`endKey` are mutually exclusive.
6. `startKey` and `greaterThanOrEqualTo` are mutually exclusive (they are aliases).
7. `endKey` and `lessThanOrEqualTo` are mutually exclusive (they are aliases).
8. `beginsWith` cannot be combined with any other range operator.


## 8. Configuration Summary

```javascript
import DataStore from 'kixx/datastore';
import { SQLiteStorageEngine } from 'kixx/datastore/sqlite';

const engine = new SQLiteStorageEngine({
    // Required. Path to the SQLite database file.
    path: './data/app.db',
});

const store = new DataStore(engine);

await store.initialize();

// Configure custom indexes (can be called at any time after initialize).
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Customer", attribute: "region" },
    { type: "Product",  attribute: "category" },
    { type: "Product",  attribute: "sku" },
]);

// Use the store...

// Dynamically add an index later without restarting.
await store.configureIndexes([
    { type: "Customer", attribute: "email" },
    { type: "Customer", attribute: "region" },
    { type: "Customer", attribute: "signupDate" },
    { type: "Product",  attribute: "category" },
    { type: "Product",  attribute: "sku" },
]);

// Graceful shutdown.
await store.close();
```


## 9. Future Considerations

Items explicitly deferred from this version but accounted for in the design:

1. **Batch writes.** The StorageEngine interface can be extended with a `batchWrite(operations[])` method. The SQL implementation would wrap it in a transaction. DynamoDB supports `BatchWriteItem` natively.

2. **DynamoDB StorageEngine.** The composite key `(type, id)` maps directly to DynamoDB's partition key + sort key. Custom indexes map to Global Secondary Indexes. The cursor model maps to `ExclusiveStartKey`. Optimistic locking maps to `ConditionExpression` on `version`.

3. **Cloudflare D1/KV StorageEngine.** D1 is a SQLite wrapper, so the SQL schema ports almost directly. KV could be used for hot-path reads with D1 as the source of truth.

4. **Deno / Bun support.** The DataStore class and validation layer are pure JavaScript with no Node.js dependencies. Only the SQLiteStorageEngine imports `node:sqlite`. Alternative engines can target Deno's built-in SQLite or Bun's `bun:sqlite`.

5. **TTL / expiration.** An optional `expiresAt` timestamp on documents, with a background sweep or lazy deletion on read. DynamoDB supports TTL natively.

6. **Change streams / event hooks.** The DataStore could emit events (`put`, `delete`) for reactive patterns like cache invalidation or audit logging.

7. **Projection.** Returning only a subset of document attributes on query results to reduce payload size.


## Appendix A: Full Type Definitions

For reference in JSDoc-based codebases:

```javascript
/**
 * @typedef {Object} Document
 * @property {string} id - Unique identifier within its type.
 * @property {string} type - Logical collection/type name.
 * @property {string} [sortKey] - Optional default sort attribute.
 * Additional top-level properties are allowed.
 */

/**
 * @typedef {Object} DocumentRecord
 * @property {Document} doc - The stored document.
 * @property {number} version - Monotonic version counter (starts at 1).
 * @property {string} createdAt - ISO 8601 UTC creation timestamp.
 * @property {string} updatedAt - ISO 8601 UTC last-modified timestamp.
 */

/**
 * @typedef {Object} IndexDefinition
 * @property {string} type - Document type this index applies to.
 * @property {string} attribute - Top-level document attribute to index.
 */

/**
 * @typedef {Object} QueryOptions
 * @property {string} [index] - Custom index attribute name.
 * @property {string} [greaterThanOrEqualTo] - Inclusive lower bound.
 * @property {string} [lessThanOrEqualTo] - Inclusive upper bound.
 * @property {string} [greaterThan] - Exclusive lower bound.
 * @property {string} [lessThan] - Exclusive upper bound.
 * @property {string} [startKey] - Inclusive lower bound (alias for greaterThanOrEqualTo).
 * @property {string} [endKey] - Inclusive upper bound (alias for lessThanOrEqualTo).
 * @property {string} [beginsWith] - Prefix match on indexed value.
 * @property {number} [limit=100] - Page size (1–1000).
 * @property {boolean} [reverse=false] - Descending order.
 * @property {string} [cursor] - Opaque pagination token.
 */

/**
 * @typedef {Object} QueryResult
 * @property {DocumentRecord[]} records - Matching records.
 * @property {string|null} cursor - Next-page token, or null.
 */

/**
 * @typedef {Object} SQLiteStorageEngineOptions
 * @property {string} path - File path for the SQLite database.
 */
```
