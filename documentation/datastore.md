# Kixx DataStore

The DataStore is a schemaless document database embedded in the Kixx framework. It stores JSON documents identified by a composite `(type, id)` key, enforces optimistic concurrency control through document versioning, and supports indexed queries on top-level document attributes.

It is built on the same Ports and Adapters pattern as the rest of Kixx: a platform-neutral `DataStore` class delegates all persistence work to a pluggable `StorageEngine` adapter. Today the only available adapter is `SQLiteStorageEngine` (backed by the Node.js built-in `node:sqlite` module). Future adapters can target DynamoDB, Cloudflare D1/KV, or any other backend without changing application code.

---

## Imports

```javascript
import { DataStore } from 'kixx/datastore';
import { SQLiteStorageEngine } from 'kixx/datastore/sqlite';
```

Error classes are also exported from `kixx/datastore`:

```javascript
import {
    DataStoreClosedError,
    DataStoreNotInitializedError,
    DocumentNotFoundError,
    VersionConflictError,
    IndexNotConfiguredError,
} from 'kixx/datastore';
```

---

## Setup

```javascript
import { DataStore } from 'kixx/datastore';
import { SQLiteStorageEngine } from 'kixx/datastore/sqlite';

const engine = new SQLiteStorageEngine({ path: './data/app.db' });
const store = new DataStore(engine);

// initialize() must be called once before any other operation.
await store.initialize();

// Configure custom indexes (optional; can be called at any time after initialize).
await store.configureIndexes([
    { type: 'Customer', attribute: 'email' },
    { type: 'Customer', attribute: 'region' },
    { type: 'Product',  attribute: 'category' },
]);
```

The SQLite engine creates the database file and any missing parent directories automatically on `initialize()`. The database is opened in WAL (Write-Ahead Logging) mode.

---

## Documents

A document is any plain JSON-serializable object. It must include:

| Attribute  | Type     | Required | Constraints |
|------------|----------|----------|-------------|
| `id`       | `string` | Yes      | Non-empty; no control characters (`\x00`–`\x1F`). |
| `type`     | `string` | Yes      | Matches `/^[A-Za-z][A-Za-z0-9_-]*$/`. |
| `sortKey`  | `string` | No       | Enables range queries on the built-in sort index. |

Any additional top-level attributes are allowed as long as their values are JSON-serializable. Nested objects and arrays are supported.

---

## DocumentRecord

All read and write operations return a `DocumentRecord`:

```javascript
{
    doc: {
        id: 'cust_001',
        type: 'Customer',
        sortKey: '2026-03-18T12:00:00.000Z',
        name: 'Acme Corp',
    },
    version: 3,
    createdAt: '2026-03-18T10:00:00.000Z',
    updatedAt: '2026-03-18T12:00:00.000Z',
}
```

| Field       | Description |
|-------------|-------------|
| `doc`       | The stored document exactly as provided. |
| `version`   | Monotonically increasing integer, starting at `1`. Incremented on every successful write. |
| `createdAt` | ISO 8601 UTC timestamp. Set on first write; never changed. |
| `updatedAt` | ISO 8601 UTC timestamp. Updated on every write. |

---

## API

### `store.initialize()`

```javascript
await store.initialize();
```

Prepares the storage engine. Must be called before `put()`, `get()`, `delete()`, `query()`, or `configureIndexes()`. Idempotent — repeated calls are a no-op.

---

### `store.close()`

```javascript
await store.close();
```

Releases any resources held by the underlying engine. Idempotent — repeated calls are a no-op.

---

### `store.put(doc, options?)`

Write a document.

```javascript
// Upsert — creates the document if it does not exist, overwrites it if it does.
const record = await store.put({
    id: 'cust_001',
    type: 'Customer',
    sortKey: '2026-03-18',
    name: 'Acme Corp',
});
// record.version === 1 (new document)

// Optimistic update — pass { version } to guard against concurrent writes.
const updated = await store.put(
    { ...record.doc, name: 'Acme Corporation' },
    { version: record.version }
);
// updated.version === 2
```

Behavior is determined by `options.version`:
- **No `version`** — upsert. Creates the document if it does not exist; overwrites it if it does.
- **`version` provided** — optimistic update. Fails if the document does not exist or the stored version does not match.

**Throws:**

| Error | Condition |
|-------|-----------|
| `ValidationError` | Invalid `doc` or `options.version`. |
| `DocumentNotFoundError` | Update when `(type, id)` does not exist. |
| `VersionConflictError` | Update when stored version ≠ provided version. |

---

### `store.get(type, id)`

```javascript
const record = await store.get('Customer', 'cust_001');
if (record) {
    console.log(record.doc.name, record.version);
}
```

Returns the `DocumentRecord`, or `null` if no document exists for `(type, id)`.

---

### `store.delete(type, id, options?)`

```javascript
// Delete without a version check — returns false if the document did not exist.
const deleted = await store.delete('Customer', 'cust_001');

// Optimistic delete — pass { version } to guard against concurrent writes.
const deleted = await store.delete('Customer', 'cust_001', { version: record.version });
```

Behavior is determined by `options.version`:
- **No `version`** — delete. Returns `true` if deleted, `false` if the document did not exist.
- **`version` provided** — optimistic delete. Fails if the document does not exist or the stored version does not match.

**Throws:**

| Error | Condition |
|-------|-----------|
| `ValidationError` | Invalid arguments or non-integer version. |
| `DocumentNotFoundError` | Versioned delete when `(type, id)` does not exist. |
| `VersionConflictError` | Versioned delete when stored version ≠ provided version. |

---

### `store.configureIndexes(indexes)`

Declares the complete set of custom indexes the store should maintain. Declarative and idempotent.

```javascript
await store.configureIndexes([
    { type: 'Customer', attribute: 'email' },
    { type: 'Product',  attribute: 'category' },
]);

// Later — add an index without restarting; pass the full desired set each time.
await store.configureIndexes([
    { type: 'Customer', attribute: 'email' },
    { type: 'Customer', attribute: 'signupDate' },
    { type: 'Product',  attribute: 'category' },
]);

// Remove all custom indexes.
await store.configureIndexes([]);
```

Each `IndexDefinition` has a `type` (document type pattern) and an `attribute` (top-level attribute name). Attribute names may include letters, numbers, underscores, and hyphens, so document keys such as `signup-date` are valid custom-index targets.

- **Adding** a new index over existing data causes the engine to backfill the index automatically.
- **Removing** an index removes query support for that custom index.
- Calling with the same list twice is a no-op.

---

### `store.query(type, options?)`

Retrieve a page of documents for a given type using an index.

```javascript
// Default index (sort by sortKey)
const page = await store.query('Customer', {
    greaterThanOrEqualTo: '2026-01-01',
    lessThanOrEqualTo:    '2026-12-31',
    limit: 25,
    reverse: true,
});

// Custom index
const byEmail = await store.query('Customer', {
    index: 'email',
    beginsWith: 'alice',
    limit: 50,
});

// Next page
if (page.cursor) {
    const page2 = await store.query('Customer', {
        greaterThanOrEqualTo: '2026-01-01',
        lessThanOrEqualTo:    '2026-12-31',
        limit: 25,
        reverse: true,
        cursor: page.cursor,
    });
}
```

Returns a `QueryResult`:

```javascript
{
    records: [ /* DocumentRecord[] */ ],
    cursor: 'eyJ2Ij...',   // opaque token; null when no more results
}
```

---

## Query Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `index` | `string` | — | Attribute name of a custom index. Omit to use the built-in `sortKey` index. |
| `greaterThanOrEqualTo` | `string` | — | Inclusive lower bound. |
| `lessThanOrEqualTo` | `string` | — | Inclusive upper bound. |
| `greaterThan` | `string` | — | Exclusive lower bound. |
| `lessThan` | `string` | — | Exclusive upper bound. |
| `beginsWith` | `string` | — | Prefix match. Cannot be combined with other range operators. |
| `limit` | `number` | `100` | Page size (1–1000). |
| `reverse` | `boolean` | `false` | Descending order. |
| `cursor` | `string` | — | Opaque token from a previous result to fetch the next page. |

**Mutual exclusivity rules:**
- `greaterThan` and `greaterThanOrEqualTo` are mutually exclusive.
- `lessThan` and `lessThanOrEqualTo` are mutually exclusive.
- `beginsWith` cannot be combined with any other range operator.

All range bound values must be strings.

---

## Indexes

### Built-in index

Every type has an implicit index on `sortKey`. Documents without a `sortKey` are included in results but sort as `null` (first ascending, last descending).

### Custom indexes

Custom indexes allow ordering and range queries on any top-level attribute. Declare them with `configureIndexes()`. An index named `email` enables queries like:

```javascript
await store.query('Customer', {
    index: 'email',
    greaterThanOrEqualTo: 'a',
    lessThan: 'b',
});
```

Index values are treated as strings for comparison purposes. Documents missing the indexed attribute sort with a `null` index value.

Storage engines are responsible for translating public attribute names into whatever internal schema objects they need. SQLite uses generated columns and SQL indexes internally, but those names are an adapter detail rather than part of the public API.

---

## Cursor Pagination

`query()` uses seek-based cursor pagination, not SQL `OFFSET`. When a result has more pages, `cursor` is an opaque token. Pass it unchanged on the next call to get the next page.

```javascript
let cursor = null;
const allRecords = [];

do {
    const page = await store.query('Customer', { limit: 100, cursor });
    allRecords.push(...page.records);
    cursor = page.cursor;
} while (cursor);
```

Seek-based cursors give us:
- Fetching page N is O(log n), not O(n).
- The model maps directly to DynamoDB's `ExclusiveStartKey` for future portability.
- Engines resume from the last seen record instead of re-counting rows with `OFFSET`.
- If records are inserted between pages, the cursor may occasionally skip or repeat a record at the boundary — this is expected and consistent with DynamoDB behavior.

---

## Errors

All errors extend `WrappedError` (from `lib/errors.js`) and carry `expected: true`, making them operational errors.

| Class | `code` | `httpStatusCode` | When thrown |
|-------|--------|-----------------|-------------|
| `DataStoreNotInitializedError` | `DATASTORE_NOT_INITIALIZED` | — | Any operation other than `initialize()` before initialization completes. |
| `DataStoreClosedError` | `DATASTORE_CLOSED` | — | Any operation after `close()`. |
| `DocumentNotFoundError` | `DOCUMENT_NOT_FOUND` | 404 | Update or delete when `(type, id)` does not exist. |
| `VersionConflictError` | `VERSION_CONFLICT` | 409 | Write or delete when stored version ≠ provided version. |
| `IndexNotConfiguredError` | `INDEX_NOT_CONFIGURED` | 400 | Query referencing an undeclared index. |

Datastore errors carry structured properties so callers do not need to parse message text:
- `DataStoreNotInitializedError` and `DataStoreClosedError` expose `operation`.
- `DocumentNotFoundError` exposes `type` and `id`.
- `IndexNotConfiguredError` exposes `type` and `attribute`.
- `VersionConflictError` exposes `type`, `id`, `expectedVersion`, and `actualVersion`.

For example, `VersionConflictError` includes extra version details for retry or merge logic:

```javascript
try {
    await store.put(doc, { version: staleVersion });
} catch (err) {
    if (err.code === 'VERSION_CONFLICT') {
        console.log(err.type);            // document type
        console.log(err.id);              // document id
        console.log(err.expectedVersion); // version the caller provided
        console.log(err.actualVersion);   // version currently in storage
    }
}
```

---

## Graceful Shutdown

Call `store.close()` during shutdown to release any resources held by the underlying engine. Applications using a process manager (PM2, systemd) should call `store.close()` on `SIGTERM`.

---

## Architecture

```
┌──────────────────────────────────────────┐
│              APPLICATION CODE            │
│     store.put()  store.query()  ...      │
└──────────────────┬───────────────────────┘
                   │ uses
┌──────────────────▼───────────────────────┐
│         DataStore  (lib/datastore/)      │
│  Validates inputs, owns lifecycle,       │
│  normalizes query options, delegates I/O │
└──────────────────┬───────────────────────┘
                   │ depends on
┌──────────────────▼───────────────────────┐
│  StorageEngine port (lib/ports/)         │
│  Pure JSDoc contract — no runtime code   │
└──────────────────┬───────────────────────┘
                   │ implemented by
┌──────────────────▼───────────────────────┐
│  SQLiteStorageEngine                     │
│  (lib/node-datastore/)                   │
│  node:sqlite · WAL mode · generated cols │
└──────────────────────────────────────────┘
```

The `DataStore` class:
- Validates all inputs and throws typed errors for invalid arguments.
- Owns the public lifecycle so callers get datastore-specific errors instead of adapter-specific failures when they use the store before `initialize()` or after `close()`.
- Expands `beginsWith` into a canonical `greaterThanOrEqualTo + lessThan` range before calling the engine. Engines receive only the canonical operators.

The SQLite engine persists the configured index catalog in the database itself. That keeps index availability durable across process restarts and makes the engine, not the `DataStore` instance, the source of truth for custom-index queries. SQLite still retains generated columns for removed indexes because of SQLite schema limitations, but those columns become inert once query support for the removed index is dropped.

The `StorageEngine` port is defined in `lib/ports/storage-engine.js` as a pure JSDoc file with no runtime code. The port documents behavioral invariants that go beyond method signatures — read it before writing a new adapter.

---

## Adding a New Storage Engine

1. **Read `lib/ports/storage-engine.js`** — the invariants section documents requirements that are not obvious from the method signatures alone (cursor semantics, version conflict semantics, etc.).

2. **Create your adapter** in a new directory, e.g. `lib/cloudflare-d1-datastore/`. Add a `@see` reference to the port in the class JSDoc.

3. **Run the conformance tests** — they exercise the core behavioral requirements of the port contract over a static dataset:

   ```javascript
   // In your adapter's test file:
   import { testStorageEngineConformance } from '../../conformance/storage-engine.js';
   import { MyEngine } from '../../../lib/my-datastore/mod.js';

   testStorageEngineConformance(async () => {
       const engine = new MyEngine({ /* options */ });
       await engine.initialize();
       return engine;
   });
   ```

4. **Write adapter-specific tests** for constructor validation, platform-specific error paths, and anything the conformance suite does not cover.

If the conformance tests pass, the adapter satisfies the shared core contract expected by `DataStore`. Add adapter-specific tests for any backend behaviors or edge cases the shared suite does not cover.
