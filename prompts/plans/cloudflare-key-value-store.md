# Key/Value Store Interface and Cloudflare Implementation Plan

## Implementation Approach

Add a runtime-neutral key/value cache store alongside the existing document and
Hyperview stores, following the interface-only adapter pattern used by
`TemplateFileStore` and `PageDataStore` rather than the heavier facade-plus-engine
split of `DocumentStore`. The port is a JSDoc `KeyValueStoreInterface` contract
under `src/kixx/key-value-store/`; the Cloudflare adapter is a `KeyValueStore`
class under `src/plugins/cloudflare-key-value-store/lib/` that implements it
directly and owns its own validation. The contract is deliberately scoped to the
portable intersection of memcached, redis, and Cloudflare KV — `get`, `put`, and
`delete` plus relative/absolute TTL — and is honest about Cloudflare KV's
binding constraints: eventual consistency, a 60-second minimum TTL, a 512-byte
key cap, and a `delete` that cannot report prior existence. Values are typed
explicitly by the caller on both read and write (`text` | `json` | `arrayBuffer`)
with no inference and no stored type metadata, mirroring raw Cloudflare KV. This
plan covers the interface, the Cloudflare adapter, plugin registration, and
linting; Node.js, Deno, and AWS adapters are deferred to a later phase.

- [ ] **Define the KeyValueStoreInterface contract**
  - **Story**: Framework code can depend on a runtime-agnostic key/value cache port whose semantics are defined independently of any backing store.
  - **What**: Author the JSDoc-only interface module describing a key/value cache with three methods. Document: `get(context, key, options?)` resolving to `string | Object | ArrayBuffer | null` (null on miss) with `options.type` of `'text'` (default) | `'json'` | `'arrayBuffer'`; `put(context, key, value, options?)` resolving to `Promise<void>` with the same `options.type` enum declaring `value`'s encoding plus mutually-exclusive `options.ttlSeconds` (positive integer, relative) and `options.expiresAt` (unix seconds, future, absolute); and `delete(context, key)` resolving to `Promise<void>`. Specify the invariants: construction takes an options object with a required `logger`; keys must be non-empty strings, must not contain control characters, and must not be `"."` or `".."`; the contract notes a 512-byte key recommendation for portability and that adapters MAY impose a stricter limit; `value` must be non-null and must match the declared `type` (string for `text`, JSON-serializable non-null for `json`, `ArrayBuffer`/typed-array view for `arrayBuffer`); the store records no type metadata, so read/write `type` symmetry is the caller's responsibility; `ttlSeconds` and `expiresAt` are mutually exclusive and adapters MAY enforce a minimum TTL; there is no `namespace` (flat keyspace, unlike the template/page stores); and the store is honest about eventual consistency (no read-after-write guarantee at the contract floor). Include `@typedef` definitions and a `@see` cross-reference to the Cloudflare implementation. No executable code.
  - **Where**: `src/kixx/key-value-store/key-value-store-interface.js`
  - **Documentation**: `src/kixx/hyperview/page-data-store-interface.js`, `src/kixx/hyperview/template-file-store-interface.js`, `src/kixx/document-store/document-store-engine-interface.js`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: The module defines `KeyValueStoreInterface` and supporting typedefs covering all three methods, both `options.type` enums, both expiry options and their mutual exclusivity, the key and value validation rules, the no-namespace decision, and the eventual-consistency / `delete`-returns-void / minimum-TTL caveats, with a `@see` link to the Cloudflare adapter.
  - **Depends on**: none

- [ ] **Implement the Cloudflare KeyValueStore adapter**
  - **Story**: A Cloudflare Workers application can read, write, and delete cache entries with optional TTL through the KeyValueStore port, backed by a Cloudflare KV namespace.
  - **What**: Add a `KeyValueStore` class implementing `KeyValueStoreInterface`. The constructor accepts `{ logger }`, asserts it is present, and creates a `KeyValueStore` child logger. Resolve the KV binding from `context.env.KEY_VALUE_STORE` in each method. `get()` validates the key, maps `options.type` to KV's native `get(key, { type })` (`'text'` default, `'json'`, `'arrayBuffer'`), and returns the value or `null`. `put()` validates the key, validates `value` against the declared `type`, validates that at most one of `ttlSeconds`/`expiresAt` is present, serializes `json` values with `JSON.stringify`, and maps `ttlSeconds` → KV `expirationTtl` and `expiresAt` → KV `expiration`; it rejects `ttlSeconds < 60` and `expiresAt` less than ~60 seconds in the future with an `AssertionError` surfacing Cloudflare KV's floor rather than silently clamping. `delete()` validates the key, calls KV `delete(key)`, and resolves to `undefined`. Add a private key-validation helper (non-empty string, no control characters, not `"."`/`".."`, reject keys exceeding KV's 512-byte limit) and a private value/expiry-validation helper. Use `assert`, `assertNonEmptyString`, `isObjectNotNull`, and related helpers from `src/kixx/assertions/mod.js`. Document the class and methods per the documentation guide, including the eventual-consistency, minimum-TTL, and `delete`-returns-void caveats.
  - **Where**: `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`
  - **Documentation**: `src/kixx/key-value-store/key-value-store-interface.js`, `src/plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js`, `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`, `src/kixx/assertions/mod.js`, `docs/code-quality.md`, `docs/code-style-guide.md`, Cloudflare KV API documentation
  - **Acceptance criteria**: The class is constructable only with a logger; `get` returns the typed value or `null` for a miss; `put` stores text/json/arrayBuffer values, rejects values that do not match the declared `type`, rejects `null`/`undefined` values, rejects supplying both expiry options, and rejects sub-60-second TTLs; `delete` resolves to `undefined`; and invalid keys (empty, control chars, `"."`/`".."`, over 512 bytes) are rejected with `AssertionError`.
  - **Depends on**: Define the KeyValueStoreInterface contract

- [ ] **Register the KeyValueStore plugin**
  - **Story**: An application assembling the framework can install the Cloudflare key/value store as a named service.
  - **What**: Add a `plugin.js` that imports `KeyValueStore` from `./lib/key-value-store.js` and exports a `register(context)` function which reads `logger` from the plugin context and calls `context.registerService('KeyValueStore', new KeyValueStore({ logger }))`, matching the `cloudflare-document-store-engine` plugin shape.
  - **Where**: `src/plugins/cloudflare-key-value-store/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-document-store-engine/plugin.js`
  - **Acceptance criteria**: `register(context)` constructs the adapter with the context logger and registers it under the service name `'KeyValueStore'`, following the existing plugin registration convention.
  - **Depends on**: Implement the Cloudflare KeyValueStore adapter

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the Cloudflare KeyValueStore adapter satisfies the port contract.
  - **What**: If explicitly approved, add focused tests using a mock KV binding on `context.env.KEY_VALUE_STORE`. Cover: typed `get` for text/json/arrayBuffer and the `null` miss; `put` for each type including `json` serialization; rejection of mismatched value types, `null` values, both-expiry-options, and sub-60-second TTLs; `ttlSeconds`/`expiresAt` mapping to `expirationTtl`/`expiration`; `delete` resolving to `undefined`; and key validation rejections. Only write or run tests after the user explicitly asks for test work.
  - **Where**: `test/plugins/cloudflare-key-value-store/key-value-store.test.js`
  - **Documentation**: `docs/unit-testing-guide.md`, `src/kixx/key-value-store/key-value-store-interface.js`
  - **Acceptance criteria**: Tests exercise the documented interface against a mock KV binding without external services, and are only added or run after explicit user approval.
  - **Depends on**: Implement the Cloudflare KeyValueStore adapter

- [ ] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on the changed source files after implementation and fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js src/kixx/key-value-store src/plugins/cloudflare-key-value-store`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for the changed source files.
  - **Depends on**: Register the KeyValueStore plugin
