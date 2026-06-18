# Node.js Key/Value Store Implementation Plan

## Implementation Approach

Add a Node.js adapter for the existing runtime-neutral `KeyValueStoreInterface`,
following the interface-only adapter pattern already used by the Cloudflare
`KeyValueStore` and the Node `PageDataStore`/`TemplateFileStore` ports. The
backing store is **SQLite via Node's built-in `node:sqlite` `DatabaseSync`** — the
same engine the `node-document-store-engine` already depends on — chosen because
it introduces no remote database dependency (no Redis/memcached) and keeps cache
state in a single on-disk file shared by every process on the machine rather than
in any one process's heap. A dedicated cache database file (separate from the
document store's file) holds a flat `kv` table keyed by `key`, with the value
stored as an opaque `BLOB` and an optional `expires_at` Unix-seconds column;
values carry no stored type metadata, so the caller's declared `type`
(`text` | `json` | `arrayBuffer`) drives symmetric encode-on-write /
decode-on-read exactly as on Cloudflare KV. The adapter opens its connection
lazily in WAL mode with a `busy_timeout` so concurrent writers from sibling
processes retry instead of failing with `SQLITE_BUSY`. Two deliberate divergences
from the Cloudflare adapter are honest about SQLite's different capabilities: there
is **no 60-second minimum TTL** (any positive-integer TTL is accepted) and reads
are read-after-write consistent on the local machine (a compatible superset of the
contract's eventual-consistency floor). Expired entries are filtered out lazily on
every read, and dead rows are reclaimed by an **opportunistic, sampled sweep on
write** so no background timer is needed. This plan covers the Node adapter,
plugin registration, an interface cross-reference, linting, and approval-gated
tests.

- [ ] **Implement the Node SQLite KeyValueStore adapter**
  - **Story**: A Node.js application can read, write, and delete cache entries with optional TTL through the `KeyValueStore` port, backed by a local SQLite file shared across processes on the same machine.
  - **What**: Add a `KeyValueStore` class implementing `KeyValueStoreInterface` on `node:sqlite` `DatabaseSync`. The constructor accepts `{ logger, path, sqliteOptions, database, ownsDatabase }`, asserts `logger` is present and creates a `KeyValueStore` child logger, and (mirroring `node-document-store-engine`) accepts either a pre-opened `database` (caller-owned by default) or a non-empty `path` to open lazily (engine-owned by default). Defer opening the connection until first use. On first use, run a coalesced `#ensurePrepared()` (cache the in-flight promise; clear it on failure so the next call retries) that sets `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = <ms>` and creates the table `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, expires_at INTEGER)`. Ignore the `context` argument on every method. `get(context, key, options?)` validates the key, resolves `options.type` (default `'text'`), selects with an expiry guard (`WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)` using `Math.floor(Date.now()/1000)`), and on a hit decodes the stored `BLOB` (`Uint8Array`) per type: `'text'` → UTF-8 decode, `'json'` → UTF-8 decode then `JSON.parse`, `'arrayBuffer'` → return an `ArrayBuffer`; returns `null` on miss or expiry. `put(context, key, value, options?)` validates the key, resolves and validates `options.type`, validates `value` against the declared type (non-empty string for `text`; non-null JSON-serializable for `json`; `ArrayBuffer`/typed-array view for `arrayBuffer`), encodes the value to a `Uint8Array` BLOB, validates the mutually-exclusive expiry options and computes `expires_at` (`ttlSeconds` → `now + ttlSeconds`; `expiresAt` → the supplied Unix-seconds value; neither → `NULL`), upserts with `INSERT INTO kv (...) VALUES (...) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`, then triggers the opportunistic sweep. `delete(context, key)` validates the key, runs `DELETE FROM kv WHERE key = ?`, and resolves to `undefined`. Add private helpers: `#assertValidKey` (non-empty string, no control characters, not `"."`/`".."`, ≤512 bytes by `TextEncoder` length — kept for cross-adapter portability); `#resolveType`; `#encodeValue(type, value)` → `Uint8Array`; `#resolveExpiresAt(options)` that rejects supplying both expiry options, rejects non-positive-integer `ttlSeconds`, and rejects `expiresAt` that is not an integer or not in the future, but imposes **no** 60-second floor; and `#sweepExpired()` which runs `DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?` only on a sampled fraction of writes (e.g. when `Math.random()` falls under a small probability) so the cost is amortized rather than paid on every `put`. Add `close()` that closes the connection only when the engine owns it and is idempotent. Use `assert`, `assertNonEmptyString`, `isUndefined`, `isBoolean`, and related helpers from `src/kixx/assertions/mod.js`. Document the class and methods per the documentation guide, including the no-minimum-TTL and stronger-consistency divergences and the opportunistic-sweep behavior.
  - **Where**: `src/plugins/node-key-value-store/lib/key-value-store.js`
  - **Documentation**: `src/kixx/key-value-store/key-value-store-interface.js`, `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`, `src/plugins/node-document-store-engine/lib/document-store-engine.js`, `src/plugins/node-hyperview-page-data-store/lib/page-data-store.js`, `src/kixx/assertions/mod.js`, `docs/code-quality.md`, `docs/code-style-guide.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: The class is constructable with a logger plus either a `database` or a non-empty `path`, and rejects construction without a logger or without either source; `get` returns the typed value for text/json/arrayBuffer and `null` for a miss or an expired entry; `put` stores each type (including `json` serialization and binary blobs round-tripping byte-for-byte), overwrites existing keys, rejects values that do not match the declared type, rejects `null`/`undefined` values, rejects supplying both expiry options, and accepts a positive-integer `ttlSeconds` below 60 seconds; an entry written with `ttlSeconds`/`expiresAt` becomes invisible to `get` once its `expires_at` passes; `delete` resolves to `undefined`; invalid keys (empty, control chars, `"."`/`".."`, over 512 bytes) are rejected with `AssertionError`; the connection is opened lazily in WAL mode with a busy timeout; and `close()` closes only an engine-owned connection and is safe to call repeatedly.
  - **Depends on**: none

- [ ] **Register the Node KeyValueStore plugin**
  - **Story**: An application assembling the framework on Node.js can install the SQLite key/value store as a named service.
  - **What**: Add a `plugin.js` that imports `KeyValueStore` from `./lib/key-value-store.js` and exports `register(context)`, which reads `logger` from the plugin context and `{ path, sqliteOptions }` from `context.env.KEY_VALUE_STORE`, then calls `context.registerService('KeyValueStore', new KeyValueStore({ logger, path, sqliteOptions }))` — matching the `node-document-store-engine` plugin shape, which resolves its file path and SQLite options from the corresponding `context.env` entry.
  - **Where**: `src/plugins/node-key-value-store/plugin.js`
  - **Documentation**: `src/plugins/node-document-store-engine/plugin.js`, `src/plugins/cloudflare-key-value-store/plugin.js`
  - **Acceptance criteria**: `register(context)` constructs the adapter with the context logger and the `path`/`sqliteOptions` from `context.env.KEY_VALUE_STORE` and registers it under the service name `'KeyValueStore'`, following the existing Node plugin registration convention.
  - **Depends on**: Implement the Node SQLite KeyValueStore adapter

- [ ] **Cross-reference the Node adapter from the interface**
  - **Story**: A developer reading the port contract can find the Node.js implementation alongside the Cloudflare one.
  - **What**: Add a `@see` line in the `KeyValueStoreInterface` module-level JSDoc pointing to the Node `KeyValueStore` at `../../plugins/node-key-value-store/lib/key-value-store.js`, mirroring the existing Cloudflare `@see`. No executable code changes.
  - **Where**: `src/kixx/key-value-store/key-value-store-interface.js`
  - **Documentation**: `docs/code-documentation-guide.md`
  - **Acceptance criteria**: The interface's "Runtime adapters" section references both the Cloudflare and Node adapters via `@see`.
  - **Depends on**: Implement the Node SQLite KeyValueStore adapter

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the Node SQLite KeyValueStore adapter satisfies the port contract.
  - **What**: If explicitly approved, add focused tests constructing the adapter against an in-memory or temp-file SQLite database. Cover: typed `get` for text/json/arrayBuffer and the `null` miss; `put` for each type including `json` serialization and byte-for-byte `arrayBuffer` round-tripping; overwrite of an existing key; rejection of mismatched value types, `null` values, and both-expiry-options; acceptance of a sub-60-second `ttlSeconds` (the Node divergence from Cloudflare); expiry behavior where a past `expires_at` makes `get` return `null`; `delete` resolving to `undefined` and being a no-op on an absent key; key-validation rejections; and `close()` idempotency. Only write or run tests after the user explicitly asks for test work.
  - **Where**: `test/plugins/node-key-value-store/key-value-store.test.js`
  - **Documentation**: `docs/unit-testing-guide.md`, `src/kixx/key-value-store/key-value-store-interface.js`, `test/plugins/cloudflare-key-value-store/lib/key-value-store.test.js`
  - **Acceptance criteria**: Tests exercise the documented interface against a local SQLite database without external services, and are only added or run after explicit user approval.
  - **Depends on**: Implement the Node SQLite KeyValueStore adapter

- [ ] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on the changed source files after implementation and fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js src/plugins/node-key-value-store src/kixx/key-value-store`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for the changed source files.
  - **Depends on**: Register the Node KeyValueStore plugin
