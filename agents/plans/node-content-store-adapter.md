# Node ContentStore Adapter Implementation Plan

## Implementation Approach

Add a Node.js implementation of `ContentStoreInterface` using a hybrid local
store: immutable blob bytes live in hash-addressed files, while immutable index
closures and mutable build pointers live in SQLite. The adapter is registered
as `ContentStore` by a new `node-content-store` plugin and receives one required
`CONTENT_STORE.rootDirectory` resolved from application configuration during
registration.

Persisted data is isolated by the framework's numeric content-addressing
`FORMAT`:

```text
<rootDirectory>/format-<FORMAT>/
    index.sqlite
    blobs/
        <first-two-hash-characters>/
            <full-hash>
```

Blob publication uses a temporary file in the destination shard, synchronizes
the staged bytes, atomically creates the final path without replacement,
synchronizes the shard directory, and removes the temporary file on a
best-effort basis after publication. A preflight existence check avoids staging
an already-present blob; the atomic no-replacement operation still resolves a
race between concurrent writers. Byte size is derived from the supplied UTF-8
or `ArrayBuffer` payload, relying on the port's caller-owned same-hash/same-bytes
invariant. Crash-orphaned temporary files are deliberately not scanned or
garbage-collected in this work.

The filesystem design assumes local storage supporting atomic hard-link
creation and directory synchronization. These constraints are documented on
the Node adapter but are not probed at runtime. Filesystem permissions remain
controlled by the process umask.

SQLite stores one JSON document per closure and one pointer per build:

```text
closures(root_hash PRIMARY KEY, entries_json NOT NULL)
builds(build_id PRIMARY KEY, root_hash FOREIGN KEY)
```

The database is opened and initialized lazily. It uses WAL mode, foreign-key
enforcement, a 5-second busy timeout, `synchronous = FULL`, and explicit
`PRAGMA user_version` migrations serialized with `BEGIN IMMEDIATE`. Version 1
creates the two tables. A newer unsupported schema is a programmer error;
failures reading or applying a supported migration are operational errors.
`saveIndex()` is insert-if-absent and never compares, replaces, or re-hashes a
closure. `assignBuild()` uses one conditional upsert sourced from `closures`,
so missing closures are rejected and pointer changes are atomic across
processes. Index reads are not cached in process memory.

Complete encoded-index validation belongs to the framework, before the port
call. An exported `assertValidIndexTable(entries)` in
`content-addressable-index.js` becomes the single validator used by both the
`ContentAddressableIndex` constructor and
`ContentAddressableStore#commitChanges()`. It covers canonical pathnames,
exact tuple arity and fields, tree structure, and recursive JSON fidelity.
Adapters retain only checks needed at their storage boundary. They serialize
with `JSON.stringify()` and translate thrown serialization failures into
`AssertionError`; they do not repeat recursive validation. Because the
Cloudflare adapter flattens tuples into columns, it additionally checks exact
tuple arity before its RPC so invalid input remains a programmer error and is
not reinterpreted or translated at the Durable Object boundary.

The existing Cloudflare implementation must be brought into conformance before
the Node implementation is judged against the shared contract. In addition to
pre-RPC arity and serialization checks, it must validate `buildId` before
`getIndex()` and translate a Durable Object's structured missing-closure result
into `AssertionError`. Both adapters validate non-empty hashes and bulk file
descriptors; Node also rejects hashes unsafe as filesystem path segments.

A shared ContentStore conformance suite runs through adapter-specific factories
for both platforms. It covers portable observable behavior only. Node-specific
tests use real temporary directories and `node:sqlite` databases for layout,
durability mechanics, persistence across instances, immediate reassignment
visibility, schema handling, streaming, error translation, and lifecycle.

Cross-cutting decisions settled with the user:

- The required configuration key is `CONTENT_STORE.rootDirectory`, not
  `CONTENT_STORE.path`.
- Development uses `./data/nodejs_app/content_store`; staging and production
  use `../data/nodejs_app/content_store`.
- Obsolete Node ContentStore cache TTL, pages-directory, and
  templates-directory settings are removed. There is no bootstrap, import, or
  migration from those directories.
- The adapter exposes only the six port operations plus a Node-specific,
  idempotent `close()`. `close()` is not added to the interface or Cloudflare
  adapter because the latter owns no releasable resource.
- After close, all Node store operations throw `AssertionError`. An injected
  SQLite connection remains caller-owned unless explicitly claimed, but the
  adapter remains closed.
- `pathname` is accepted and ignored without validation. Hash alone addresses
  a blob.
- `putFile()` accepts exactly `string` and `ArrayBuffer`; typed-array views are
  rejected.
- `getFiles()` validates the 100-item cap before concurrently reading all
  requested text blobs with `Promise.all()`, preserving positions and
  duplicates.
- Missing files resolve `null`. Filesystem and SQLite failures are wrapped in
  `OperationalError` with `cause`. Corrupt stored index JSON and unsupported
  schema versions throw `AssertionError` with `cause` where applicable.
- A successfully published blob remains a successful write if only temporary
  file cleanup fails; emit a warning and leave the inert temporary file.
- Documentation changes are limited to `ContentStoreInterface`, relevant
  inline JSDoc, and Node configuration. Do not modify `src/plugins/README.md`.
- Do not add dependencies, run the development server, or add/run end-to-end
  tests.

---

### Task CS-1: Centralize encoded-index validation before persistence

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

Make `ContentAddressableStore` the owner of complete encoded-index validation,
so every platform receives a structurally valid and JSON-faithful table before
the persistence port is invoked. Preserve read-side validation through the same
single validator.

**Scope**

- In: export a complete encoded-index assertion; reuse it in the index
  constructor; invoke it immediately before `saveIndex()`; document the new
  validation boundary in the port and relevant JSDoc; add focused unit tests.
- Out: adapter-specific serialization and validation (CS-2 and CS-3); storage
  implementation; application publishing behavior beyond validation.

**Design and invariants**

- Export `assertValidIndexTable(entries)` from
  `content-addressable-index.js`. Move the existing tuple and tree-structure
  checks behind it rather than creating a second definition of index validity.
- Validate that the table is a plain object; pathnames are safe and canonical;
  tree tuples contain exactly two elements; blob tuples contain exactly four;
  hashes are non-empty strings; blob sizes are non-negative integers; metadata
  is `null` or a plain object; the root is present and is a tree; parents exist
  and are trees; and non-root trees are non-empty.
- Add recursive JSON-fidelity validation for the complete table. Accepted
  values are JSON data which round-trips without reinterpretation: `null`,
  booleans, finite numbers, strings, dense arrays, and plain objects. Reject
  cycles, `undefined`, functions, symbols, `BigInt`, sparse arrays, non-finite
  numbers, non-plain nested objects, and values relying on `toJSON()`.
- The constructor calls `assertValidIndexTable()` before making its existing
  defensive clone. `commitChanges()` calls it on the completed table before
  reading the root hash or invoking the port.
- Validation failures are programmer errors (`AssertionError`), not user-input
  `ValidationError`; malformed publishing input should already have been
  rejected while building the index.
- Update `ContentStoreInterface` to state that `saveIndex()` receives a
  framework-validated encoded table, while an adapter remains responsible for
  refusing any value its backing representation cannot store faithfully.

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-index.js` — export
  and reuse the complete validator.
- `src/kixx/content-addressable-store/content-addressable-store.js` — validate
  the completed table before persistence and update JSDoc.
- `src/kixx/content-addressable-store/content-store-interface.js` — clarify
  validation ownership and adapter serialization responsibility.
- `test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js`
  — cover the exported validator and JSON-fidelity rejection cases.
- `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
  — prove an invalid completed table cannot reach `saveIndex()` and valid
  commits retain save-before-assign ordering.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] One exported function defines encoded-table validity and the constructor
      uses it.
- [ ] `commitChanges()` validates before any persistence call.
- [ ] Exact tuple arity, tree structure, and all listed non-JSON-faithful value
      categories are rejected with `AssertionError`.
- [ ] Valid metadata containing nested plain objects and dense arrays survives
      validation unchanged.
- [ ] Existing valid index construction, snapshot opening, root hashing, and
      commit ordering remain unchanged.
- [ ] The interface and inline JSDoc describe the agreed ownership without
      adding `close()` to the port.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store` — framework
  ContentStore and index tests pass.
- `node run-linter.js src/kixx/content-addressable-store test/unit-tests/kixx/content-addressable-store`
  — changed framework and test JavaScript is clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task CS-2: Align Cloudflare ContentStore with the portable contract

**Status:** Not started
**Depends on:** CS-1
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`; `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

Correct the existing Cloudflare adapter's programmer-error boundaries and
establish a reusable conformance suite defining behavior the Node adapter must
match.

**Scope**

- In: pre-RPC identifier, tuple-arity, and serialization checks; structured
  missing-closure response handling; baseline hash and bulk-descriptor
  assertions; shared ContentStore conformance tests; Cloudflare-specific test
  updates and JSDoc.
- Out: Cloudflare caching, retry, wire-key, or storage-layout changes; Node
  implementation (CS-3); edits to `src/plugins/README.md`.

**Design and invariants**

- `getIndex()` asserts a non-empty `buildId` before cache or Durable Object
  access.
- `getFile()` and `putFile()` assert a non-empty hash. `getFiles()` asserts an
  array of descriptors with non-empty string hashes before enforcing the
  existing 100-key cap.
- `saveIndex()` keeps thin outer assertions for non-empty `rootHash` and a
  plain-object table, checks exact tuple arity before RPC because the Durable
  Object's column format cannot preserve extra elements, and calls
  `JSON.stringify(entries)` as a serialization preflight. Wrap only thrown JSON
  serialization errors in `AssertionError` with `cause`; recursive fidelity was
  already established by CS-1.
- Keep the Durable Object codec's field checks as defensive storage-shape
  assertions. Add exact arity there as defense in depth if the outer adapter is
  bypassed.
- Change Durable Object `assignBuild()` to return a structured missing-closure
  result instead of throwing across RPC. The outer adapter translates only
  that result into `AssertionError`; unsuccessful infrastructure/storage
  results remain `OperationalError`.
- Preserve every existing caching, bounded-staleness, retry, and invalidation
  behavior.
- Add a non-collected shared suite, mirrored with the port, following the unit
  testing guide's conformance-suite pattern. It accepts the enclosing
  `describe` handle and an adapter factory. Cover only portable behavior:
  construction requires a logger; supported and unsupported read types;
  text/ArrayBuffer/stream reads; missing blobs; UTF-8 byte sizes; positional
  bulk reads with missing and duplicate hashes; 100-key cap; idempotent blob
  writes; immutable/idempotent closure saves; tuple round-trip fidelity;
  missing and reassigned builds; missing-closure assignment; and common
  argument assertions.
- Run the conformance suite from the Cloudflare adapter test using its existing
  fake bindings/cache/scheduler patterns. Cloudflare-only caching and Durable
  Object retry tests stay local.

**Expected touch points**

- `src/plugins/cloudflare-content-store/lib/content-store.js` — outer adapter
  validation and error translation.
- `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js`
  — structured missing-closure result.
- `src/plugins/cloudflare-content-store/lib/index-entry-codec.js` — exact tuple
  arity defense.
- `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  — shared portable contract suite.
- `test/unit-tests/plugins/cloudflare-content-store/lib/content-store.test.js`
  — invoke conformance and cover Cloudflare-specific boundaries.
- `test/unit-tests/plugins/cloudflare-content-store/lib/index-entry-codec.test.js`
  — exact tuple-arity tests.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Malformed build IDs, hashes, descriptors, tuple arity, and thrown JSON
      serialization errors fail as `AssertionError` before RPC.
- [ ] Assigning an absent closure fails as `AssertionError`, not
      `OperationalError`, while genuine Durable Object failures retain existing
      retry and operational wrapping behavior.
- [ ] Valid tree and blob tuples return with their exact respective arity.
- [ ] The shared conformance suite runs against Cloudflare without encoding
      Cloudflare-specific APIs or guarantees.
- [ ] Existing blob/index cache, retry, invalidation, and wire-format tests
      remain green.
- [ ] No change is made to `src/plugins/README.md`.

**Validation**

- `node run-tests.js test/unit-tests/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store`
  — Cloudflare-specific and shared contract tests pass.
- `node run-linter.js src/plugins/cloudflare-content-store test/unit-tests/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  — changed adapter and test JavaScript is clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task CS-3: Implement durable Node filesystem and SQLite storage

**Status:** Not started
**Depends on:** CS-2
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`; `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

Implement a `NodeContentStore` class satisfying the shared port contract and
the agreed local durability, concurrency, layout, error, and lifecycle
semantics, independently of plugin registration.

**Scope**

- In: the Node adapter class; blob filesystem layout and operations; SQLite
  schema, migrations, closure/build operations, and lifecycle; Node invocation
  of the shared conformance suite; Node-specific unit tests and inline JSDoc.
- Out: plugin registration, platform registry, and source configuration (CS-4);
  cleanup of crash-orphaned temporary files; content deletion/GC; process cache;
  bootstrap/import behavior.

**Design and invariants**

- Add `src/plugins/node-content-store/lib/content-store.js`, tagged
  `@implements` with `ContentStoreInterface`. Constructor options:
  `logger`, resolved `rootDirectory`, positive-integer `format`, optional
  `sqliteOptions`, optional injected `DatabaseSync`, and optional
  `ownsDatabase`. Require logger/root/format. An injected database is
  caller-owned by default; an internally opened database is adapter-owned by
  default.
- Create child logger `NodeContentStore`. Debug-log blob and index operations
  using hashes/build IDs only; info-log completed migrations; warn when
  post-publication temporary cleanup fails. Do not log payloads or metadata and
  do not duplicate error logs.
- Resolve all owned paths internally under
  `<rootDirectory>/format-<format>`. Hash validation requires a non-empty,
  filesystem-safe segment and rejects separators, control characters, `.` and
  `..`; it does not validate digest alphabet, length, or content. The first two
  hash characters select the shard. Accept and ignore `context` and `pathname`.
- Initialize directories/database/schema lazily on first use. Serialize first
  initialization within the instance, then use `BEGIN IMMEDIATE` plus the
  5-second busy timeout to coordinate separate processes. Apply foreign keys,
  WAL, `synchronous = FULL`, and `user_version` handling. Reject versions newer
  than 1 with `AssertionError`; wrap supported migration/storage failures as
  `OperationalError` with `cause`.
- Blob reads:
  - Validate the method-specific type.
  - Return `null` only for `ENOENT`; wrap other filesystem failures.
  - Text reads decode UTF-8; ArrayBuffer reads return an exact-region
    `ArrayBuffer`, not a pooled Buffer's larger backing allocation.
  - Stream reads asynchronously open the file before resolving and return a
    file-handle-backed Web `ReadableStream` with automatic handle closure and
    cancellation support.
  - `getFiles()` accepts only `'text'`, validates the descriptor array and cap
    before I/O, then uses `Promise.all()` without compacting, sorting, or
    deduplicating results.
- Blob writes:
  - Accept exactly `string` and `ArrayBuffer`; obtain a byte view and size once.
  - Ensure the shard exists. If the final file already exists, return the
    payload-derived size without staging.
  - Otherwise write a unique temporary file in that shard, sync and close it,
    then atomically create the final hash path with no replacement. Treat a
    concurrent `EEXIST` winner as successful idempotency.
  - Sync the shard directory after either this call publishes the final path or
    a retry observes the path following an earlier directory-sync failure.
  - Clean this call's temporary file on normal failure and after publication.
    A cleanup failure after safe publication logs a warning and does not reject.
    Do not scan for files orphaned by prior process crashes.
  - Return the payload-derived byte size after durable success; never compare,
    verify, overwrite, or re-hash existing content.
- Store closures as `JSON.stringify(entries)` in a single row. Translate thrown
  serialization errors to `AssertionError` with `cause`. Use insert-if-absent;
  do not compare or replace existing JSON.
- Read a build and closure with one joined query, parse a fresh object on every
  call, and perform no process caching. An unassigned build throws
  `AssertionError`. Malformed persisted JSON throws `AssertionError` with the
  parse error as `cause`.
- Assign builds with one conditional SQLite upsert sourced from `closures`.
  Zero changed rows means an absent root and throws `AssertionError`.
- `close()` is synchronous and idempotent, closes only an owned connection, and
  permanently marks the adapter closed. Every subsequent public operation
  asserts. Open file streams already returned to callers are independent of the
  SQLite connection.
- Document the local-filesystem hard-link/directory-sync constraint and the
  absence of network-filesystem support in class JSDoc. Do not add runtime
  capability probes or explicit file modes.

**Expected touch points**

- `src/plugins/node-content-store/lib/content-store.js` — new adapter.
- `test/unit-tests/plugins/node-content-store/lib/content-store.test.js` — real
  filesystem/SQLite tests plus Node-specific failure and lifecycle coverage.
- `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  — imported and run by the Node test factory; change only if implementation
  work reveals a genuinely portable missing case.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Blob paths match the accepted format namespace and two-character shard
      layout, and pathname never participates in addressing.
- [ ] Text, ArrayBuffer, Web stream, missing-file, and positional bulk reads
      satisfy the shared contract.
- [ ] Writes are atomic, no-replacement, durably synchronized, idempotent under
      repeats/races, and return payload-derived UTF-8 byte sizes.
- [ ] Temporary files are removed on normal paths; post-publication cleanup
      failure only warns; no crash-orphan scan exists.
- [ ] Schema version 1, SQLite pragmas, lazy initialization, serialized
      migration, insert-if-absent closures, conditional atomic assignment, and
      cross-instance immediate reassignment visibility are covered with real
      temporary storage.
- [ ] Missing builds/closures, unsupported types, invalid hashes/descriptors,
      corrupt JSON, unsupported schema versions, and post-close operations
      throw the agreed programmer errors.
- [ ] Filesystem/SQLite failures are operational errors preserving `cause`.
- [ ] Owned and injected connection lifecycle semantics are tested.
- [ ] The Node adapter passes the shared ContentStore conformance suite.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store test/unit-tests/kixx/content-addressable-store`
  — Node-specific and shared contract behavior passes.
- `node run-linter.js src/plugins/node-content-store test/unit-tests/plugins/node-content-store`
  — new adapter and tests are clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task CS-4: Register and configure the Node ContentStore

**Status:** Not started
**Depends on:** CS-3
**Documentation:** `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

Compose the completed Node adapter into the Node runtime under the portable
`ContentStore` service name with validated configuration, environment defaults,
and shutdown ownership.

**Scope**

- In: Node plugin lifecycle module; Node platform registry entry; Node source
  configuration changes; plugin tests; final lint and full unit-suite
  verification.
- Out: application bootstrap/import; Cloudflare configuration; content/data
  migrations; edits to `src/plugins/README.md`; dev-server or end-to-end checks.

**Design and invariants**

- Add `src/plugins/node-content-store/plugin.js`. During `register(context)`,
  assert `context.config.env.CONTENT_STORE.rootDirectory` and
  `context.config.resolveFilepath`, resolve the configured directory once, and
  assert the resolved result is non-empty.
- Import `FORMAT` from framework addressing, matching the existing Cloudflare
  plugin's deliberate exception for a coordinated wire-format constant.
- Register `new ContentStore({ logger, rootDirectory, format: FORMAT,
  sqliteOptions: storeConfig.sqliteOptions ?? {} })` as `ContentStore`. No
  `initialize()` phase is needed because the adapter consumes no registered
  service.
- Add the plugin to `src/plugins/node.js` under `nodeContentStore`.
- Replace each Node environment's obsolete `CONTENT_STORE` fields with only
  `rootDirectory` (and leave room for an explicitly configured
  `sqliteOptions`):
  - development: `./data/nodejs_app/content_store`
  - staging: `../data/nodejs_app/content_store`
  - production: `../data/nodejs_app/content_store`
- Registration performs no filesystem or SQLite I/O. The adapter's `close()` is
  discovered automatically by `ApplicationContext#close()`; do not add it to
  `ContentStoreInterface` or Cloudflare.
- Add plugin tests matching existing Node plugin tests: required config,
  required resolver, resolved-path assertion, service name, constructor
  options, and optional `sqliteOptions` pass-through. Use a temporary directory
  only where a registered instance is exercised; registration itself must not
  create it.
- Do not add fallback support for the removed cache/page/template settings and
  do not import source content into a fresh store. An empty store continues to
  throw on `getIndex()` until the publishing workflow commits a build.

**Expected touch points**

- `src/plugins/node-content-store/plugin.js` — new registration module.
- `src/plugins/node.js` — add `nodeContentStore` to the platform registry.
- `src/node-config.js` — replace obsolete ContentStore settings with the agreed
  root directories.
- `test/unit-tests/plugins/node-content-store/plugin.test.js` — registration and
  configuration tests.
- `src/kixx/content-addressable-store/content-store-interface.js` and relevant
  adapter JSDoc — final cross-reference check only if CS-1/CS-3 did not already
  complete it.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The Node registry supplies `ContentStore` through the new
      `nodeContentStore` plugin.
- [ ] Missing/invalid configured or resolved `rootDirectory` and missing
      resolver fail during registration with assertions naming the exact config
      path.
- [ ] `FORMAT`, resolved root directory, logger, and optional SQLite options
      reach the adapter constructor.
- [ ] Registration causes no filesystem/database side effects.
- [ ] All three Node environments contain only the agreed ContentStore root
      settings; obsolete cache/page/template fields are absent.
- [ ] Fresh storage is not bootstrapped and missing-build behavior remains the
      port-defined startup-class assertion.
- [ ] No dependencies, `src/plugins/README.md` edits, dev-server checks, or E2E
      tests are introduced.
- [ ] All changed JavaScript passes lint and the complete unit test suite passes.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store/plugin.test.js`
  — plugin configuration and registration tests pass.
- `node run-linter.js src/plugins/node-content-store src/plugins/node.js src/node-config.js test/unit-tests/plugins/node-content-store`
  — Node composition changes are clean.
- `node run-tests.js` — the complete unit suite passes, including both adapter
  conformance runs and all existing regressions.
- `node run-linter.js` — the complete JavaScript tree is clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
