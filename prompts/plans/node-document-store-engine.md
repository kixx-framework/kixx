# Node.js DocumentStore Engine Implementation Plan

## Implementation Approach

Implement the Node.js storage adapter as a runtime-specific engine under `lib/node/document-store/` while keeping `lib/document-store/` as the runtime-neutral port and facade layer. The Node engine should use Node >=24's built-in `node:sqlite` `DatabaseSync` API, owning a long-lived application-scope SQLite connection by default while preserving the existing `DocumentStoreEngineInterface` async method shape. The Node implementation should mirror the Cloudflare D1 adapter's observable document, index, cursor, and error semantics, but keep its SQLite statement composition, schema preparation, and error translation private to the Node adapter. The plan stays scoped to the Node storage engine and directly relevant documentation.

- [x] **Create Node engine shell**
  - **Story**: Node applications can configure `DocumentStore` with a SQLite storage engine.
  - **What**: Add a `DocumentStoreEngine` class that imports `DatabaseSync` from `node:sqlite`, accepts `{ logger, path, sqliteOptions, database, ownsDatabase }`, creates a named child logger, tracks index definitions, and implements `setIndexDefinitions()` and idempotent `close()`. When `database` is supplied, default `ownsDatabase` to `false`; when the engine opens `path`, default `ownsDatabase` to `true`. Preserve the port method signatures even though Node methods can ignore the `context` argument.
  - **Where**: `lib/node/document-store/document-store-engine.js`
  - **Documentation**: `lib/document-store/document-store-engine-interface.js`, `lib/node/logger/logger-writer.js`, Node.js `node:sqlite` documentation
  - **Acceptance criteria**: The class can be constructed for `':memory:'` or a file path, refuses invalid configuration with assertion errors, and `close()` is safe to call more than once.
  - **Depends on**: none

- [x] **Add Node private SQLite utilities**
  - **Story**: Node storage owns its adapter-specific SQL mechanics while preserving the DocumentStore contract.
  - **What**: Add private helpers or module-private functions inside the Node engine for index-name conversion, SQL string-literal quoting for configured JSON paths, keyset query statement composition, cursor encoding/decoding, pagination validation, and unique secondary-index conflict translation. Keep this logic local to the Node adapter instead of extracting shared SQLite code.
  - **Where**: `lib/node/document-store/document-store-engine.js`
  - **Documentation**: `docs/code-quality.md`, `docs/code-style-guide.md`, `lib/document-store/document-store-engine-interface.js`, `lib/cloudflare/document-store/document-store-engine.js`, Node.js `node:sqlite` documentation
  - **Acceptance criteria**: Node-private helpers compose scan/query SQL, reject invalid cursors and incompatible range options with `AssertionError`, safely quote generated-column JSON path literals, and translate composite unique errors such as `documents.type, documents.key_email`.
  - **Depends on**: Create Node engine shell

- [x] **Implement Node schema preparation**
  - **Story**: Node storage initializes and reconciles the document schema without app-level migration code.
  - **What**: Implement `prepareDatabase()` and `#ensurePrepared()` using `DatabaseSync#exec()`, `prepare().all()`, and `prepare().run()`. Create the `documents` table, built-in `(type, sort_key)` index, generated columns for configured secondary indexes, unique or non-unique composite indexes, and stale generated-column cleanup in the Node adapter.
  - **Where**: `lib/node/document-store/document-store-engine.js`
  - **Documentation**: `lib/cloudflare/document-store/document-store-engine.js`, `lib/document-store/document-store-engine-interface.js`, Node.js `DatabaseSync` documentation
  - **Acceptance criteria**: First use prepares the database once, repeated prepares are safe, generated columns can be added to existing tables, uniqueness changes are reconciled by dropping and recreating the affected index, and stale configured index columns are removed.
  - **Depends on**: Add Node private SQLite utilities

- [x] **Implement Node reads and pagination**
  - **Story**: Collection callers can read, scan, and query documents in Node with the same shapes they receive in Cloudflare.
  - **What**: Implement `get()`, `scan()`, and `query()` using `DatabaseSync` prepared statements and the Node adapter's private query helpers. Parse the stored JSON document, return `sortKey` for scans and `key` for secondary-index queries, fetch `limit + 1` rows for cursor detection, and reject unconfigured query indexes.
  - **Where**: `lib/node/document-store/document-store-engine.js`
  - **Documentation**: `lib/document-store/document-store-engine-interface.js`, `lib/cloudflare/document-store/document-store-engine.js`, Node.js `StatementSync` documentation
  - **Acceptance criteria**: `get()` returns a record or `null`, `scan()` and `query()` return `{ records, cursor }`, cursors are opaque and reusable only with matching query options, and null sort/index values paginate consistently with the D1 adapter.
  - **Depends on**: Implement Node schema preparation

- [x] **Implement Node writes and deletes**
  - **Story**: Node storage preserves create, upsert, optimistic update, unique index, and delete semantics from the DocumentStore port.
  - **What**: Implement `create()`, `put()`, `update()`, and `delete()` using SQLite `INSERT ... ON CONFLICT`, `UPDATE ... RETURNING`, and `DELETE` change counts. Return stored version and timestamp metadata, increment existing versions on overwrite/update, distinguish not found from version conflict, and translate configured secondary unique-index failures into `DocumentUniqueIndexViolationError`.
  - **Where**: `lib/node/document-store/document-store-engine.js`
  - **Documentation**: `lib/document-store/document-store-engine-interface.js`, `lib/document-store/document-already-exists-error.js`, `lib/document-store/document-not-found-error.js`, `lib/document-store/document-unique-index-violation-error.js`, `lib/document-store/version-conflict-error.js`, Node.js `StatementSync` documentation
  - **Acceptance criteria**: Missing `put()` creates version 1, existing `put()` increments the version, `create()` rejects existing primary keys, `update()` rejects missing or stale records, versioned `delete()` rejects missing or stale records, unversioned `delete()` returns `false` when absent, and unique secondary conflicts report the configured index name.
  - **Depends on**: Implement Node reads and pagination

- [x] **Document adapter lifecycle**
  - **Story**: Framework users can understand how the DocumentStore port is wired to runtime-specific storage adapters.
  - **What**: Update public JSDoc cross-references and add a focused DocumentStore guide explaining the facade, engine interface, separate Cloudflare D1 and Node SQLite adapters, index definitions, request context pass-through, connection lifecycle, and runtime boundaries.
  - **Where**: `lib/document-store/document-store.js`, `lib/document-store/document-store-engine-interface.js`, `docs/document-store.md`, `docs/index.md`
  - **Documentation**: `docs/code-documentation-guide.md`, `docs/code-quality.md`, `lib/context/application-context.js`, `lib/context/request-context.js`
  - **Acceptance criteria**: `docs/index.md` links to the new guide, the guide names which code belongs under `lib/document-store/`, `lib/cloudflare/`, and `lib/node/`, and the guide explicitly states that runtime adapters are intentionally implemented separately.
  - **Depends on**: Implement Node writes and deletes

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the Node engine satisfies the same port contract as the Cloudflare adapter.
  - **What**: If explicitly approved, add focused tests for the Node engine using `':memory:'` databases. Cover schema preparation, create/put/update/delete, unique secondary indexes, range filters, cursor pagination, null sort/index values, stale version errors, and idempotent close behavior.
  - **Where**: `test/lib/node/document-store/document-store-engine.test.js`
  - **Documentation**: `docs/unit-testing-guide.md`, `lib/document-store/document-store-engine-interface.js`
  - **Acceptance criteria**: Tests exercise the documented engine interface without requiring external services and are only written or run after the user explicitly asks for test work.
  - **Depends on**: Implement Node writes and deletes

- [x] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on changed JavaScript source files after implementation, then fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js lib/node/document-store lib/document-store/document-store.js lib/document-store/document-store-engine-interface.js`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for changed source files.
  - **Depends on**: Document adapter lifecycle
