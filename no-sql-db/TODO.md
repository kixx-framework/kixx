# Kixx DataStore — Implementation TODO

**Spec:** `no-sql-db/kixx-datastore-spec.md`
**Branch:** `no-sql-db`
**Last updated:** 2026-03-18

---

## Decisions Made

### Error Classes
The spec defines a `DataStoreError` base and its own `ValidationError`. We drop the `DataStoreError` base
entirely. All DataStore errors extend `WrappedError` from `lib/vendor/kixx-server-errors`. The existing
`ValidationError` from `lib/errors.js` is used directly for validation failures. Three new error classes
are created in `lib/datastore/errors.js`:

| Class | CODE | Notes |
|---|---|---|
| `DocumentAlreadyExistsError` | `DOCUMENT_EXISTS` | `expected: true` |
| `DocumentNotFoundError` | `DOCUMENT_NOT_FOUND` | `expected: true` |
| `VersionConflictError` | `VERSION_CONFLICT` | `expected: true`; carries `.type`, `.id`, `.expectedVersion`, `.actualVersion` |
| `IndexNotConfiguredError` | `INDEX_NOT_CONFIGURED` | `expected: true` |

### Directory / Naming Conventions
Follow existing `lib/node-*` convention for the Node.js adapter:

| Spec import | Actual directory | Actual export path |
|---|---|---|
| `kixx/datastore` | `lib/datastore/` | `"./datastore"` in package.json |
| `kixx/datastore/sqlite` | `lib/node-datastore/` | `"./datastore/sqlite"` in package.json |

### `close()`
Not delegated through `DataStore`. Callers use `engine.close()` directly.

### Index Tracking
`DataStore` maintains a `Map<type, Set<attribute>>` in memory. Populated / replaced each time
`configureIndexes()` is called. `query()` validates against this map; no extra engine round-trip.

---

## File Map

```
lib/
  ports/
    storage-engine.js             [new] Port contract — JSDoc typedef for StorageEngine
  datastore/
    errors.js                     [new] DocumentAlreadyExistsError, DocumentNotFoundError,
                                         VersionConflictError, IndexNotConfiguredError
    data-store.js                 [new] DataStore class (core, platform-neutral)
    mod.js                        [new] export { default as DataStore } + export * from errors.js
  node-datastore/
    sqlite-storage-engine.js      [new] SQLiteStorageEngine — Node.js node:sqlite adapter
    mod.js                        [new] export { default as SQLiteStorageEngine }

test/
  conformance/
    storage-engine.js             [new] Shared conformance tests for any StorageEngine implementation
  lib/
    datastore/
      errors.test.js              [new] Unit tests for each DataStore error class
      data-store-put.test.js      [new] DataStore#put() — create + update + error paths
      data-store-get.test.js      [new] DataStore#get()
      data-store-delete.test.js   [new] DataStore#delete()
      data-store-query.test.js    [new] DataStore#query() — index validation, pagination, bounds
      data-store-configure-indexes.test.js  [new] DataStore#configureIndexes()
    node-datastore/
      sqlite-storage-engine.test.js  [new] Integration tests (conformance helper + SQLite-specific)

package.json                      [edit] Add "./datastore" and "./datastore/sqlite" export entries
```

---

## Implementation Order

Work top-down through the port/core/adapter stack so each layer can be tested as it is built.

### Step 1 — Port contract
**File:** `lib/ports/storage-engine.js`

Pure JSDoc typedef file (no runtime code). Define:
- `StorageEngine` typedef — `initialize`, `configureIndexes`, `put`, `get`, `delete`, `query`, `close`
- `IndexDefinition` typedef — `{ type: string, attribute: string }`
- `QueryOptions` typedef — all fields from spec §3.1
- `QueryResult` typedef — `{ records: DocumentRecord[], cursor: string|null }`
- `DocumentRecord` typedef — `{ doc: Object, version: number, createdAt: string, updatedAt: string }`

Cross-reference spec §3 for the full behavioral invariants to document in comments.

---

### Step 2 — Error classes
**File:** `lib/datastore/errors.js`

Import `WrappedError` from `../../vendor/kixx-server-errors/mod.js`.

```javascript
class DocumentAlreadyExistsError extends WrappedError {
    static CODE = 'DOCUMENT_EXISTS';
    static HTTP_STATUS_CODE = 409;
    constructor(type, id, options, sourceFunction) { ... }
}

class DocumentNotFoundError extends WrappedError {
    static CODE = 'DOCUMENT_NOT_FOUND';
    static HTTP_STATUS_CODE = 404;
    constructor(type, id, options, sourceFunction) { ... }
}

class VersionConflictError extends WrappedError {
    static CODE = 'VERSION_CONFLICT';
    static HTTP_STATUS_CODE = 409;
    // Carries: this.type, this.id, this.expectedVersion, this.actualVersion
    constructor(type, id, expectedVersion, actualVersion, options, sourceFunction) { ... }
}

class IndexNotConfiguredError extends WrappedError {
    static CODE = 'INDEX_NOT_CONFIGURED';
    static HTTP_STATUS_CODE = 400;
    constructor(type, attribute, options, sourceFunction) { ... }
}
```

All pass `{ expected: true }` merged into options.

---

### Step 3 — DataStore core class
**File:** `lib/datastore/data-store.js`

Constructor:
```javascript
constructor(engine) {
    // store engine reference
    // initialize _configuredIndexes = new Map()  (type -> Set<attribute>)
}
```

Methods:

**`async initialize()`**
- Delegates to `this._engine.initialize()`.

**`async configureIndexes(indexes)`**
- Validate: `indexes` must be an array; each entry needs `type` (string, type-pattern) and `attribute`
  (non-empty string).
- Rebuild `this._configuredIndexes` as a fresh `Map<type, Set<attribute>>` from the input array.
- Delegate to `this._engine.configureIndexes(indexes)`.

**`async put(doc, options)`**
- Validate (throw `ValidationError` on failure):
  1. `doc` is a non-null plain object
  2. `doc.type` matches `/^[A-Za-z][A-Za-z0-9_-]*$/`
  3. `doc.id` is non-empty string, no control chars `\x00–\x1F`
  4. `doc.sortKey`, if present, is a string
  5. `options.version`, if present, is a positive integer
  6. `doc` is JSON-serializable (`JSON.stringify` does not throw)
  7. Reserved attributes `version`, `createdAt`, `updatedAt` not in `doc`
- Delegate to `this._engine.put(doc, options)`.

**`async get(type, id)`**
- Validate: `type` is non-empty string, `id` is non-empty string.
- Delegate to `this._engine.get(type, id)`. Return value as-is (null or DocumentRecord).

**`async delete(type, id, options)`**
- Validate: `type`, `id` non-empty strings; `options.version` is a positive integer (required for delete).
- Delegate to `this._engine.delete(type, id, options.version)`.

**`async query(type, options)`**
- Validate `type` matches pattern.
- Validate `options.index`, if provided, is in `this._configuredIndexes.get(type)` — throw
  `IndexNotConfiguredError` if not.
- Validate all QueryOptions per spec §7:
  - `limit` in [1, 1000] (default 100)
  - `reverse` is boolean (default false)
  - Range bounds are strings if present
  - Mutual exclusivity rules (startKey ↔ greaterThanOrEqualTo, endKey ↔ lessThanOrEqualTo,
    greaterThan exclusive of gte, lessThan exclusive of lte, beginsWith exclusive of all range ops)
- Delegate to `this._engine.query(type, normalizedOptions)`.

**Normalization notes:**
- Resolve alias pairs before passing to engine: `startKey → greaterThanOrEqualTo`, `endKey → lessThanOrEqualTo`.
- Apply default `limit: 100`, `reverse: false`.

---

### Step 4 — DataStore entry point
**File:** `lib/datastore/mod.js`

```javascript
export { default as DataStore } from './data-store.js';
export * from './errors.js';
```

---

### Step 5 — SQLiteStorageEngine
**File:** `lib/node-datastore/sqlite-storage-engine.js`

Constructor:
```javascript
constructor({ path }) {
    // store path; db is null until initialize()
}
```

**`async initialize()`**
1. `mkdir -p` for the directory containing `path` (use `node:fs/promises` `mkdir` with `{ recursive: true }`).
2. Open `new DatabaseSync(path)` from `node:sqlite`.
3. `PRAGMA journal_mode=WAL`.
4. Create the `documents` table and `idx_type_sort_key` index (CREATE TABLE IF NOT EXISTS).

Schema:
```sql
CREATE TABLE IF NOT EXISTS documents (
    type       TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    sort_key   TEXT,
    doc        TEXT    NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (type, id)
);
CREATE INDEX IF NOT EXISTS idx_type_sort_key
    ON documents (type, sort_key);
```

**`async configureIndexes(indexes)`**

1. Get current generated columns via `PRAGMA table_info(documents)` — extract all column names
   starting with `idx_`.
2. Build `desiredColumns` set: for each `{ attribute }` in `indexes`, column name = `idx_<attribute>`.
3. **Add new columns:** For each desired column not yet in the table:
   - `ALTER TABLE documents ADD COLUMN idx_<attribute> TEXT GENERATED ALWAYS AS (json_extract(doc, '$.<attribute>')) STORED`
   - Note: SQLite does not support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN` — must check
     `PRAGMA table_info` first.
   - `CREATE INDEX IF NOT EXISTS idx_type_<attribute> ON documents (type, idx_<attribute>)`
4. **Drop removed indexes:** For each existing `idx_*` column no longer in desired set, drop the
   SQL index: `DROP INDEX IF EXISTS idx_type_<attribute>`.
   - Do NOT try to drop the generated column (SQLite doesn't support it). Leave it, it becomes inert.
5. Store the desired set in `this._currentIndexColumns` for bookkeeping.

**`async put(doc, options)`**

- Timestamp: `new Date().toISOString()`
- **Create** (no `options.version`):
  ```sql
  INSERT INTO documents (type, id, sort_key, doc, version, created_at, updated_at)
  VALUES (?, ?, ?, ?, 1, ?, ?);
  ```
  Catch UNIQUE constraint violation → throw `DocumentAlreadyExistsError`.
- **Update** (`options.version` provided):
  ```sql
  UPDATE documents
  SET doc = ?, sort_key = ?, version = version + 1, updated_at = ?
  WHERE type = ? AND id = ? AND version = ?;
  ```
  If 0 rows affected: follow-up SELECT to distinguish `DocumentNotFoundError` vs `VersionConflictError`.

Both return a `DocumentRecord` built from the resulting state.

**`async get(type, id)`**

```sql
SELECT doc, version, created_at, updated_at FROM documents WHERE type = ? AND id = ?;
```

Return `null` if no row; otherwise `{ doc: JSON.parse(row.doc), version, createdAt, updatedAt }`.

**`async delete(type, id, version)`**

```sql
DELETE FROM documents WHERE type = ? AND id = ? AND version = ?;
```

0 rows affected → SELECT to distinguish not-found vs version conflict (same as update).
Return `true` if deleted, `false` if not found.

**`async query(type, options)`**

Build SQL dynamically based on options. Full logic:

1. Determine the column to order by:
   - `options.index` present → `idx_<index>` column
   - Otherwise → `sort_key`
2. Resolve `beginsWith`:
   - Translate `beginsWith: prefix` → `greaterThanOrEqualTo: prefix` + `lessThan: computeUpperBound(prefix)`
   - `computeUpperBound(prefix)` → `prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)`
3. Build WHERE clauses:
   - `type = ?`
   - `col >= ?` for `greaterThanOrEqualTo`
   - `col <= ?` for `lessThanOrEqualTo`
   - `col > ?` for `greaterThan`
   - `col < ?` for `lessThan`
4. Cursor seek (if `options.cursor`):
   - Decode: `JSON.parse(atob(cursor))` → `{ v, id }`
   - Ascending: `AND (col > ? OR (col = ? AND id > ?))`
   - Descending: `AND (col < ? OR (col = ? AND id < ?))`
5. `ORDER BY col ASC/DESC, id ASC/DESC`
6. `LIMIT options.limit + 1` (fetch one extra to determine if there's a next page)
7. If results length > limit, pop the last record and encode a cursor from the last *kept* record.
8. Return `{ records, cursor }`.

**Cursor encoding:**
```javascript
const cursor = btoa(JSON.stringify({ v: lastColValue, id: lastId }));
```

**`async close()`**

`this._db.close()`

---

### Step 6 — Node-datastore entry point
**File:** `lib/node-datastore/mod.js`

```javascript
export { default as SQLiteStorageEngine } from './sqlite-storage-engine.js';
```

---

### Step 7 — Package exports
**File:** `package.json`

Add to `"exports"`:
```json
"./datastore": "./lib/datastore/mod.js",
"./datastore/sqlite": "./lib/node-datastore/mod.js"
```

---

### Step 8 — StorageEngine conformance tests
**File:** `test/conformance/storage-engine.js`

Provide a `testStorageEngineConformance(createEngine)` function.
The factory function must return a fresh, already-initialized `StorageEngine`.

Test groups:

**`initialize()`**
- Calling it once does not throw.

**`put()` — create**
- Returns a `DocumentRecord` with `version === 1`, `createdAt`, `updatedAt` set.
- `doc` in the record matches the input.
- Calling with same `(type, id)` twice throws `DocumentAlreadyExistsError`.

**`put()` — update**
- With correct version, returns record with `version === 2`, `updatedAt` changed.
- With wrong version, throws `VersionConflictError` with correct `.expectedVersion` and `.actualVersion`.
- With non-existent document, throws `DocumentNotFoundError`.

**`get()`**
- Returns null for unknown `(type, id)`.
- Returns the DocumentRecord after a put.

**`delete()`**
- Returns `false` for unknown `(type, id)`.
- Returns `true` after deleting an existing document.
- Throws `VersionConflictError` with wrong version.
- Document is no longer returned by `get()` after deletion.

**`query()` — basic**
- Returns `{ records: [], cursor: null }` for empty type.
- Returns records in ascending order by `sort_key` by default.
- `reverse: true` returns records in descending order.
- `limit` caps the number of records returned.
- `cursor` from a previous result fetches the next page.

**`query()` — range operators**
- `greaterThanOrEqualTo` filters correctly.
- `lessThanOrEqualTo` filters correctly.
- `greaterThan` filters correctly (exclusive).
- `lessThan` filters correctly (exclusive).
- `beginsWith` returns only matching prefix records.

**`configureIndexes()`**
- Adding an index allows querying by that attribute.
- Removing an index (calling with subset) removes the ability to query by it.
- Backfills existing documents into a newly added index.

**`close()`**
- Does not throw when database has been used.

---

### Step 9 — Error unit tests
**File:** `test/lib/datastore/errors.test.js`

- Each error class sets the correct `.code`.
- `VersionConflictError` exposes `.type`, `.id`, `.expectedVersion`, `.actualVersion`.
- All errors have `expected === true`.
- All are instances of `WrappedError`.

---

### Step 10 — DataStore unit tests (with mock engine)
Build a `MockStorageEngine` (a Sinon stub or hand-rolled fake) in each test file's `before` block.

**`test/lib/datastore/data-store-put.test.js`**
- Delegates to `engine.put()` with correct args.
- Throws `ValidationError` for missing `id`, missing `type`, bad type format, control chars in id,
  non-integer version, reserved attribute in doc, non-serializable doc.

**`test/lib/datastore/data-store-get.test.js`**
- Delegates to `engine.get()` with correct args.
- Returns null passthrough.
- Throws `ValidationError` for empty `type` or `id`.

**`test/lib/datastore/data-store-delete.test.js`**
- Delegates to `engine.delete()` with `version` as third arg.
- Throws `ValidationError` when `options.version` is missing or not a positive integer.

**`test/lib/datastore/data-store-query.test.js`**
- Throws `IndexNotConfiguredError` when querying an unknown index.
- Does not throw for the built-in sort_key index (no `options.index`).
- Resolves `startKey` → `greaterThanOrEqualTo` before delegating.
- Resolves `endKey` → `lessThanOrEqualTo` before delegating.
- Applies default `limit: 100` and `reverse: false`.
- Throws `ValidationError` for each mutual-exclusivity violation.
- Throws `ValidationError` for `limit` out of range.

**`test/lib/datastore/data-store-configure-indexes.test.js`**
- Populates `_configuredIndexes` correctly after call.
- Replaces previous index set on subsequent calls.
- Delegates to `engine.configureIndexes()`.
- Calling with `[]` clears all tracked indexes.

---

### Step 11 — SQLite integration tests
**File:** `test/lib/node-datastore/sqlite-storage-engine.test.js`

```javascript
import { testStorageEngineConformance } from '../../../conformance/storage-engine.js';
import { SQLiteStorageEngine } from '../../../lib/node-datastore/mod.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Factory creates a fresh engine in a temp directory per test block.
let tmpDir;
testStorageEngineConformance(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
    const engine = new SQLiteStorageEngine({ path: join(tmpDir, 'test.db') });
    await engine.initialize();
    return engine;
});
```

Cleanup `tmpDir` in `after` hooks.

Also add SQLite-specific tests:
- Database file is created on `initialize()`.
- WAL mode is enabled (`PRAGMA journal_mode` returns `wal`).
- `initialize()` is idempotent (can be called on existing database).
- Parallel reads don't block each other (or at minimum, they don't error).

---

## Edge Cases and Implementation Notes

### SQLite `ALTER TABLE ADD COLUMN` caveat
SQLite does not support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`. The engine must query
`PRAGMA table_info(documents)` and check whether the column already exists before attempting the ALTER.

### Generated column naming collision
Column names are `idx_<attribute>`. If two types both index the same attribute name (e.g.,
`{ type: "Customer", attribute: "email" }` and `{ type: "Order", attribute: "email" }`), they share
the same generated column `idx_email`. This is correct behavior — the SQL index on `(type, idx_email)`
scopes results to one type. The spec notes this explicitly in §6.3.

### `beginsWith` upper bound with multi-byte characters
`String.fromCharCode(charCode + 1)` works for ASCII. For non-ASCII characters, use
`String.fromCodePoint(prefix.codePointAt(prefix.length - 1) + 1)` and `.slice(0, -1)` accounting
for surrogate pairs if needed. For now, spec says "ASCII-safe" ids, so `charCodeAt` is sufficient.
Flag this as a known limitation in a code comment.

### node:sqlite API
The `node:sqlite` module uses synchronous `DatabaseSync`. Wrap in `async` methods to fulfil the
`StorageEngine` interface contract (all methods return Promises), even though the work is synchronous.
The engine's methods can just `return Promise.resolve(result)` around the synchronous calls.

### Cursor stability
If records are inserted between pages, seek-based cursors may skip or repeat records at the boundary.
This is expected DynamoDB-compatible behavior. Document it in the port JSDoc.

### `doc` in DocumentRecord
The engine stores `JSON.stringify(doc)` and returns `JSON.parse(row.doc)`. The doc in the record
is a fresh object (not a reference to the input). No mutation hazard.

---

## Checklist

- [x] `lib/ports/storage-engine.js` — port contract
- [x] `lib/datastore/errors.js` — error classes
- [x] `lib/datastore/data-store.js` — DataStore class
- [x] `lib/datastore/mod.js` — entry point
- [x] `lib/node-datastore/sqlite-storage-engine.js` — engine
- [x] `lib/node-datastore/mod.js` — entry point
- [x] `package.json` — export entries
- [x] `test/conformance/storage-engine.js` — conformance helper
- [x] `test/lib/datastore/errors.test.js`
- [x] `test/lib/datastore/data-store-put.test.js`
- [x] `test/lib/datastore/data-store-get.test.js`
- [x] `test/lib/datastore/data-store-delete.test.js`
- [x] `test/lib/datastore/data-store-query.test.js`
- [x] `test/lib/datastore/data-store-configure-indexes.test.js`
- [x] `test/lib/node-datastore/sqlite-storage-engine.test.js`
- [x] All tests pass: `npm test` — 727 tests, 0 failures
- [x] Lint passes: `npx eslint lib/datastore/ lib/node-datastore/ lib/ports/storage-engine.js`

## SQLite Implementation Notes (discovered during build)

- `ALTER TABLE ... ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` is **not allowed** in SQLite when
  the table already has rows. Changed to `VIRTUAL` generated columns — both STORED and VIRTUAL
  generated columns can participate in SQL indexes; VIRTUAL just means values are computed on-demand
  rather than persisted.

- `PRAGMA table_info` does not include virtual/generated columns. Use `PRAGMA table_xinfo` instead
  to reliably check whether an `idx_*` column already exists before calling ALTER TABLE.
