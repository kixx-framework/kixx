# Document Store Metadata Separation — Implementation Plan

## Implementation Approach

The document store persists its own bookkeeping inside the user's document payload. Every
engine write does `JSON.stringify(doc)` on an object that still carries `type`, `id`, and
`sortKey`, so those three land inside the stored JSON blob *in addition to* the row columns
that already hold them. On the way back out, `Record.fromRecord()` strips `type` and `id`
but not `sortKey`, so the sort key arrives in the DTO as a user-defined attribute.

The observable damage is in the DTO, not the database:

- `record.toObject()` emits a `sortKey` field that appears in no `static schema` — visible in
  JSON responses for `AdminUser`, `AdminInvite`, and `PublishingApiToken`, the three
  collections that override `generateSortKey()`.
- `record.get('sortKey')` returns store bookkeeping that no `validate()` knows about.
- The schema documents the record's fields and is wrong about what the record contains.

**The leak is load-bearing, and that is the trap in this work.** `engine.get()` returns no
top-level `sortKey` — only `scan()` does. So after a `get()`, the copy inside `#attributes`
is the *only* surviving sort key, and the default
`generateSortKey(doc) { return doc?.sortKey; }` reads it back out on the next write. Simply
adding `'sortKey'` to the strip list in `fromRecord()` would null the `sort_key` column on
any read-modify-write through the default hook, and the affected documents would silently
drop out of bounded `scan()` ranges, which exclude NULL sort keys. Nothing would throw.

This plan fixes the root cause rather than the symptom: **store metadata stops being written
into the document payload, and every engine method returns it as a top-level record field.**
The Record DTO then carries `sortKey` as read-only metadata beside `version`, `createdAt`,
and `updatedAt`, which is what it has always been.

### Decisions

- **The write-side input shape does not change.** Callers keep passing `doc.sortKey` into
  `DocumentStore.create/put/update`, and the facade keeps validating it
  (`document-store.js:280`, `:317`, `:357`). The engine lifts it into the column and excludes
  it from the persisted JSON. This confines the change to the storage and return shapes.
- **All three metadata fields are stripped from the persisted payload**, not just `sortKey`.
  `type` and `id` are already carried as columns and already discarded on read, so leaving
  them in the blob preserves an inconsistency this plan exists to remove. After this change
  the stored blob is exactly the user-defined document — the same set of keys the DTO holds
  in `#attributes`, making the round-trip lossless and unambiguous.
- **Absent metadata is `null`, never `undefined`.** The engines already normalize
  `sortKey = isUndefined(doc.sortKey) ? null : doc.sortKey` for the column; returns and the
  Record slot adopt the same convention.
- **`sortKey` joins `meta` in `toObject()`.** It is store metadata, and the alternative is a
  value that cannot be projected into a JSON response at all.
- **The write path becomes symmetric with the read path.** `#coerceToRecord()` lifts
  `sortKey` out of plain-object input into the Record's metadata slot, exactly as it already
  lifts `id`, so `create({ title, sortKey })` never routes it through attributes either.
- **`query()` is renamed to return `sortKey`, not `key`.** Both engines return the sort key
  under `sortKey` from `scan()` and under `key` from `query()`
  (node `:417`/`:353`, cloudflare `:402`/`:333`). Nothing consumes either field today, so
  this is a free rename now and a required one under this plan.

### Cross-cutting concerns

- **Task order is a correctness constraint, not a preference.** The engine tasks (DSM-2,
  DSM-3) must land before the Record task (DSM-5). Reversed, there is an interval where
  `fromRecord()` strips `sortKey` from attributes while `engine.get()` still does not return
  it, which is exactly the silent sort-key loss described above. Because this lands as one
  branch, ordering the commits is sufficient; no compatibility fallback is needed, and none
  should be added — a permanent branch reading `doc.sortKey` would be dead code the moment
  the engines are correct.
- **No data migration is required.** The `sort_key` column has always been populated
  correctly, so rows written before this change read back correctly from the column. Their
  stale in-blob copy is stripped on read and ignored. New writes stop producing it. Old and
  new rows coexist indefinitely with no reconciliation step.
- **Existing tests barely touch this.** `document-store-engine.test.js` contains zero
  `sortKey` references and asserts document payloads only as `record.doc.title`
  (`:76`, `:97`). `document-store.test.js` exercises `sortKey` only on the input-validation
  path this plan does not change, plus cursor internals against a mock engine. There are **no
  Cloudflare document-store-engine tests**. The change is therefore well within reach of the
  suite but poorly *covered* by it, which DSM-7 addresses.
- **Verify no SQL reads the stripped fields.** Secondary indexes extract user fields
  (`$.emailAddress`), not metadata, but each engine task must confirm that no generated
  column, index expression, or query references `$.type`, `$.id`, or `$.sortKey` before
  removing them from the payload.
- **Unrelated observation, not in scope:** `document-store.js:69` has an `@see
  docs/document-store.md` pointing at a file that does not exist. Left alone; noted so a
  later agent does not go looking for it.

---

### Task DSM-1: Engine record contract declares store metadata

**Status:** Complete
**Depends on:** None
**Documentation:** `src/plugins/README.md` (ports are JSDoc-only modules with no executable code)

**Objective**

The engine interface states that a stored record carries `sortKey` as a top-level field
returned by every read and write method, and that the persisted document payload contains
only user-defined fields. Adapter authors can implement DSM-2 and DSM-3 from the contract
alone, without reading an existing adapter.

**Scope**

- In: the `DocumentStoreRecord` typedef, the per-method return descriptions, and a statement
  of the payload/metadata separation invariant.
- Out: all runtime code (DSM-2, DSM-3), the facade (DSM-4), the DTO layer (DSM-5, DSM-6).

**Design and invariants**

- The port is a JSDoc-only module. Do not add an exported constant or any executable code.
- `sortKey` is `string|null` on a returned record — `null` when the document has none.
- Every method that returns a record (`get`, `create`, `put`, `update`, `scan`, `query`)
  returns `sortKey`. `get()` returning it is the specific gap that made the old behavior
  load-bearing, so state it explicitly.
- `doc` holds only user-defined fields. `type`, `id`, and `sortKey` MUST NOT be written into
  the persisted payload; they are row metadata surfaced as top-level record fields.
- Record shape is uniform across methods: `query()` uses `sortKey`, not `key`.

**Expected touch points**

- `src/kixx/document-store/document-store-engine-interface.js` — record typedef, method
  return contracts, payload/metadata separation invariant

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The `DocumentStoreRecord` typedef declares `sortKey` as `string|null`.
- [x] Every record-returning method's contract states that `sortKey` is included.
- [x] The contract states that `type`, `id`, and `sortKey` are excluded from the stored `doc`.
- [x] The contract states the uniform record shape across `scan()` and `query()`.
- [x] The module remains free of executable code.

**Validation**

- `node run-linter.js src/kixx/document-store/document-store-engine-interface.js`
- Read-through: an adapter author can derive the required return shape without opening an
  adapter.

**Progress and handoff**

- Completed: Added `sortKey` to the uniform `DocumentStoreRecord`, documented the
  payload/metadata separation invariant, and made every record-returning method explicitly
  promise `sortKey`.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: No SQL or generated-index expression references `$.type`,
  `$.id`, or `$.sortKey`; secondary index JSON paths remain user-defined payload fields.
- Actual files changed: `src/kixx/document-store/document-store-engine-interface.js`.
- Validation run: `node run-linter.js
  src/kixx/document-store/document-store-engine-interface.js` exited 0; read-through
  confirmed the required adapter return and payload shapes are stated without consulting an
  implementation.
- Blockers: None.

---

### Task DSM-2: Node engine separates payload from metadata

**Status:** Complete
**Depends on:** DSM-1
**Documentation:** `src/kixx/document-store/document-store-engine-interface.js` (as revised by DSM-1)

**Objective**

The Node SQLite engine persists only user-defined fields in the `doc` column and returns
`sortKey` as a top-level field from every record-returning method, including `get()`.

**Scope**

- In: `create()`, `put()`, `update()`, `get()`, `scan()`, `query()` in the Node engine —
  payload serialization and returned record shape.
- Out: the Cloudflare engine (DSM-3), the facade (DSM-4), delete paths and cursor encoding,
  which carry no document payload.

**Design and invariants**

- Build the persisted payload by excluding `type`, `id`, and `sortKey` from the incoming
  `doc` before `JSON.stringify()`. The column bindings continue to read those values from
  the *input* object, so binding order and the unique-conflict translation are unaffected.
- `get()` must select `sort_key` and return it; today its `SELECT` omits the column entirely
  (`:439`). This is the change that removes the round-trip dependency on the blob.
- `update()` and `create()`/`put()` currently return the caller's input `doc` object
  (`:566`, `:625`, `:506`). They must return the stored payload — the metadata-free object —
  so a caller cannot observe fields that were not persisted.
- `query()` returns `sortKey` where it currently returns `key` (`:353`).
- Absent sort key is `null`, matching the existing column normalization.
- Confirm no generated index column or SQL expression references `$.type`, `$.id`, or
  `$.sortKey` before removing them from the payload.

**Expected touch points**

- `src/plugins/node-document-store-engine/lib/document-store-engine.js` — payload
  construction in the three write methods, `SELECT` and return shape in `get()`, return
  shape in `scan()`/`query()`/`update()`/`create()`/`put()`

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The stored `doc` column contains no `type`, `id`, or `sortKey` key on any write path.
- [x] `get()` returns `sortKey` from the `sort_key` column, `null` when the row has none.
- [x] `create()`, `put()`, `update()`, `scan()`, and `query()` all return `sortKey`.
- [x] `query()` no longer returns the sort key under the name `key`.
- [x] Write methods return the stored payload, not the caller's input object.
- [x] Rows written before this change still read back with the correct `sortKey` from the
      column, and their in-blob copy is not surfaced.

**Validation**

- `node run-linter.js src/plugins/node-document-store-engine/lib/document-store-engine.js`
- Manual: write a document with a sort key through a collection, read it back with `get()`,
  and confirm the returned record carries `sortKey` at the top level and that the parsed
  `doc` has no `type`/`id`/`sortKey` keys. The dev server's `.json` URL suffix renders the
  template context and is the quickest way to see a projected record.
- Manual: against a database file containing rows written before this change, confirm reads
  still return the correct sort key and that `scan()` ordering is unchanged.

**Progress and handoff**

- Completed: All write paths serialize and return a metadata-free payload; all read paths
  strip stale metadata from legacy payloads; all record-returning paths expose the
  column-backed `sortKey`; `query()` retains its secondary-index value only for its private
  cursor.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: Repository search confirmed generated index expressions use
  configured user-field JSON paths; no SQL references `$.type`, `$.id`, or `$.sortKey`.
- Actual files changed:
  `src/plugins/node-document-store-engine/lib/document-store-engine.js`.
- Validation run: `node run-linter.js
  src/plugins/node-document-store-engine/lib/document-store-engine.js` exited 0; return-shape
  and SQL read-through passed. The plan's database/dev-server manual checks were not run
  because project verification rules prohibit smoke testing unless requested.
- Blockers: None.

---

### Task DSM-3: Cloudflare engine separates payload from metadata

**Status:** Complete
**Depends on:** DSM-1
**Documentation:** `src/kixx/document-store/document-store-engine-interface.js` (as revised by DSM-1)

**Objective**

The Cloudflare D1 engine makes the identical payload and record-shape change as DSM-2, so the
two adapters remain behaviorally interchangeable.

**Scope**

- In: `create()`, `put()`, `update()`, `get()`, `scan()`, `query()` in the Cloudflare engine.
- Out: the Node engine (DSM-2), D1 batching or binding concerns unrelated to payload shape.

**Design and invariants**

- Mirror DSM-2 exactly: same excluded keys, same `null` convention, same `sortKey` naming in
  `query()` (currently `key` at `:333`), same "return the stored payload" rule.
- `get()` (`:434`) must select and return `sort_key`, as in DSM-2.
- This adapter has **no unit tests**, so its correctness rests on matching DSM-2 line for line
  in behavior. Where the two engines' SQL differs for platform reasons, the returned record
  shape must still be identical — that shape is the contract.
- Confirm no generated index column or SQL expression references `$.type`, `$.id`, or
  `$.sortKey` before removing them from the payload.

**Expected touch points**

- `src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js` — same methods
  as DSM-2

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Every acceptance criterion from DSM-2 holds for this adapter.
- [x] A diff review against the Node engine confirms the two return shapes are identical
      field for field.

**Validation**

- `node run-linter.js src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js`
- Side-by-side read of both engines' return statements, confirming identical field sets.
- End-to-end: `node run-tests.js --e2e --cloudflare` against a deployed build exercises the
  admin flows that read and list documents. Requires the deploy target to be up.

**Progress and handoff**

- Completed: Mirrored the Node adapter's metadata-free write payloads, legacy-payload
  normalization, column-backed `sortKey`, and public return shapes across all record methods.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: As established in DSM-2, secondary-index values remain private
  cursor data while `record.sortKey` is sourced from the built-in `sort_key` column.
- Actual files changed:
  `src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js`.
- Validation run: `node run-linter.js
  src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js` exited 0;
  side-by-side field and SQL inspection confirmed parity with Node. Cloudflare end-to-end
  tests were not run because the user did not request tests or deploy-target verification.
- Blockers: None.

---

### Task DSM-4: Facade preserves metadata on the update path

**Status:** Complete
**Depends on:** DSM-2, DSM-3
**Documentation:** None

**Objective**

`DocumentStore` passes the engines' record shape through unchanged, including `sortKey`, and
its own documentation describes the returned record accurately.

**Scope**

- In: `DocumentStore#update()`'s post-engine `Object.assign`, and the `@returns` descriptions
  on `get`, `create`, `put`, `update`, `scan`, `query`.
- Out: input validation (unchanged by design), cursor sealing, engine selection.

**Design and invariants**

- `update()` re-attaches `type` and `id` to the engine's return (`:367`). Once the engines
  return a complete record this re-attachment is redundant; either drop it or extend it to
  cover `sortKey`. Dropping it is preferred — the engine contract now guarantees the fields,
  and a facade that patches a record it did not build invites drift.
- The facade must not reintroduce metadata into `doc`.
- `@returns` text currently reads "with `type`, `id`, `version`, `createdAt`, `updatedAt`, and
  `doc`" in several places; add `sortKey`.

**Expected touch points**

- `src/kixx/document-store/document-store.js` — `update()` return handling, method `@returns`
  descriptions

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `update()` returns a record carrying `sortKey` alongside the other metadata.
- [x] The facade no longer patches fields the engine contract already guarantees, or the
      remaining patch is justified in a comment.
- [x] Every record-returning method's `@returns` names `sortKey`.

**Validation**

- `node run-linter.js src/kixx/document-store/document-store.js`
- `node run-tests.js test/unit-tests/kixx/document-store` — the facade suite uses a mock
  engine and must still pass; its mock records may need `sortKey` added, which is test work
  gated by DSM-7.

**Progress and handoff**

- Completed: Removed redundant update-result patching and documented `sortKey` in every
  record-returning facade method.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: Engine metadata is now authoritative, so facade-side repair of
  returned records would duplicate and weaken the port contract.
- Actual files changed: `src/kixx/document-store/document-store.js`.
- Validation run: `node run-linter.js src/kixx/document-store/document-store.js` exited 0.
  Facade unit tests were not run because the user did not explicitly request tests.
- Blockers: None.

---

### Task DSM-5: Record carries sortKey as store metadata

**Status:** Complete
**Depends on:** DSM-2, DSM-3, DSM-4
**Documentation:** `src/app/collections/README.md` (Properties, Attribute Accessors, Serialization)

**Objective**

`sortKey` is a read-only Record property alongside `version`, `createdAt`, and `updatedAt`;
it never appears in `#attributes`; and it round-trips through `toDocument()` so the default
`generateSortKey()` hook keeps working.

**Scope**

- In: `base-document-store-record.js` — constructor validation, the defined-property block,
  `fromRecord()`, `forWrite()`, `toDocument()`, `toObject()`.
- Out: collection-side input normalization (DSM-6), the key/value Record, which has no sort
  key.

**Design and invariants**

- **Do not start this task until DSM-2 and DSM-3 are complete.** `fromRecord()` reads
  `sortKey` from the raw record's top-level field only. If the engines still omit it from
  `get()`, every read-modify-write through the default hook silently nulls the sort key.
- `fromRecord()` strips `sortKey` from the attributes copy unconditionally, alongside `type`
  and `id`. Rows written before DSM-2/DSM-3 still carry it in the blob and must not surface
  it.
- Add no fallback to `doc.sortKey`. With correct engines it is unreachable, and an
  unreachable branch here is what would hide a future engine regression.
- `sortKey` is `string|null`. Validate it as such in the constructor, consistent with the
  existing per-field checks.
- `toDocument()` emits `sortKey` only when non-null, preserving the facade's "string when
  present" input rule and the collection's existing `delete doc.sortKey` path.
- `toObject()` places `sortKey` inside `meta` beside `version`, `createdAt`, and `updatedAt`.
- `forWrite()` accepts `spec.sortKey`, defaulting to `null`.

**Expected touch points**

- `src/app/collections/base-document-store-record.js` — constructor, `Object.defineProperties`
  block, `fromRecord()`, `forWrite()`, `toDocument()`, `toObject()`

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `record.get('sortKey')` returns `undefined` for a document read from the store.
- [x] `record.sortKey` returns the stored sort key, or `null` when there is none.
- [x] `record.toObject().meta.sortKey` is present; no top-level `sortKey` appears in the
      projection.
- [x] `record.toDocument()` includes `sortKey` when non-null and omits it when null.
- [x] A document read and then written back through `update()` retains its sort key under the
      default `generateSortKey()` hook.
- [x] A record read from a row written before DSM-2 exposes no `sortKey` attribute.

**Validation**

- `node run-linter.js src/app/collections/base-document-store-record.js`
- Manual: load an admin invite list page with the `.json` suffix and confirm no top-level
  `sortKey` appears on the projected records and that `meta.sortKey` does.
- Manual: revoke an invite (a read-modify-write through `update()`) and confirm the invite
  list still orders correctly afterward — this is the regression the ordering constraint
  protects against.

**Progress and handoff**

- Completed: Added validated read-only `sortKey` metadata; wired it through `forWrite()` and
  `fromRecord()`; excluded it from attributes; emitted it conditionally from `toDocument()`;
  projected it as `meta.sortKey`.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: `sortKey` will be sourced only from top-level engine metadata;
  no payload fallback will be introduced.
- Actual files changed: `src/app/collections/base-document-store-record.js`.
- Validation run: `node run-linter.js
  src/app/collections/base-document-store-record.js` exited 0; code-path read-through
  confirmed read/update retention and legacy-payload stripping. Manual page and mutation
  checks were not run because project verification rules prohibit smoke testing unless
  requested.
- Blockers: None.

---

### Task DSM-6: Collection input normalization matches the read path

**Status:** Complete
**Depends on:** DSM-5
**Documentation:** `src/app/collections/README.md` (ID Generation and Sort Keys)

**Objective**

A plain-object write that supplies `sortKey` routes it to Record metadata rather than to
attributes, so the write path and the read path agree on what a user-defined field is.

**Scope**

- In: `#coerceToRecord()` and the `generateSortKey()` documentation in
  `base-document-store-collection.js`.
- Out: `#toDocument()`'s sort-key resolution, which is already correct and stays as-is;
  Record internals (DSM-5).

**Design and invariants**

- `#coerceToRecord()` excludes `sortKey` from the copied attributes alongside `type` and `id`,
  and passes it to `Record.forWrite()` as metadata.
- The default `generateSortKey(doc)` continues to read `doc.sortKey`, which now arrives from
  the Record's metadata slot via `toDocument()` rather than from an attribute. Behavior is
  unchanged; only the route is. Update the JSDoc so a reader is not misled into thinking an
  attribute is consulted.
- Collections overriding `generateSortKey()` are unaffected — they ignore the incoming value
  and compute their own.

**Expected touch points**

- `src/app/collections/base-document-store-collection.js` — `#coerceToRecord()`,
  `generateSortKey()` JSDoc

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `create(context, { title, sortKey })` stores `sortKey` as metadata; the resulting record
      exposes it as `record.sortKey` and not via `record.get('sortKey')`.
- [x] The document persisted for that call carries the supplied sort key in its column.
- [x] `generateSortKey()`'s documentation describes the metadata route accurately.
- [x] Collections with an overridden `generateSortKey()` behave exactly as before.

**Validation**

- `node run-linter.js src/app/collections/base-document-store-collection.js`
- Manual: create a document supplying `sortKey` in the input object, read it back, and
  confirm it is absent from the projected attributes and present as metadata.

**Progress and handoff**

- Completed: Plain-object normalization excludes `sortKey` from attributes and passes it to
  `Record.forWrite()` metadata; hook documentation now describes the Record-to-document
  metadata route.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: Existing direct `new MigrationRecord(...)` calls in two unit
  test files omit `sortKey`; these are recorded for DSM-7 and will not be edited without
  explicit test approval.
- Actual files changed: `src/app/collections/base-document-store-collection.js`.
- Validation run: `node run-linter.js
  src/app/collections/base-document-store-collection.js` exited 0; code-path read-through
  confirmed supplied and computed sort keys converge in `#toDocument()`. Manual persistence
  checks were not run because project verification rules prohibit smoke testing unless
  requested.
- Blockers: None.

---

### Task DSM-7: Documentation and test reconciliation

**Status:** Complete
**Depends on:** DSM-5, DSM-6
**Documentation:** `src/app/collections/README.md`, `test/unit-tests/README.md`

**Objective**

The Data Source Layer documentation describes `sortKey` as store metadata, and the test suite
covers the payload/metadata separation that the rest of this plan establishes.

**Scope**

- In: the collections README's Properties table, Serialization section, and ID Generation and
  Sort Keys section; identification of every existing test that encodes the old record shape.
- Out: the review findings unrelated to `sortKey`, which are tracked separately.

**Design and invariants**

- The README's Properties table (`:207`) gains a `sortKey` row.
- The Serialization section (`:306`) must list `sortKey` among the `meta` keys.
- The "Attribute Accessors" prohibition already says document fields are not top-level
  properties; ensure the new metadata property is described as metadata so the two statements
  do not appear to contradict each other.
- **Writing or changing tests requires explicit approval per the project's testing rules.**
  This task's default deliverable is the documentation plus a written inventory of the test
  changes needed. Do not create or modify test files without that approval.
- Known test impact from the pre-implementation survey:
  - `test/unit-tests/kixx/document-store/document-store.test.js` — mock engine records may
    need `sortKey` to match the revised contract; input-validation cases are unaffected.
  - `test/unit-tests/plugins/node-document-store-engine/lib/document-store-engine.test.js` —
    contains no `sortKey` references and asserts payloads only as `record.doc.title`, so it
    should pass unchanged. It provides no coverage of this plan's invariant, which is the gap
    worth closing.
  - No Cloudflare document-store-engine tests exist.
- Coverage worth adding, if approved: the stored blob excludes metadata; `get()` returns
  `sortKey`; a `get()` → `update()` round trip preserves the sort key under the default hook;
  `scan()` and `query()` return the same record shape.

**Expected touch points**

- `src/app/collections/README.md` — Properties table, Serialization, ID Generation and Sort Keys
- Test inventory delivered in the handoff notes rather than as file changes, absent approval

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The Properties table documents `sortKey`.
- [x] The Serialization section documents `meta.sortKey`.
- [x] The sort-key section explains that the value is metadata, not an attribute, and that
      supplying it on a plain-object write is still supported.
- [x] A written inventory of required test changes exists in the handoff notes.
- [x] No test file is modified without explicit approval.

**Validation**

- `node run-tests.js` — full unit suite, to confirm the implementation tasks did not break
  existing coverage. Run only when asked, per the project's testing rules.
- Read-through: an agent with no context can implement a new sorted collection from the
  README alone and end up with `sortKey` in the right place.

**Progress and handoff**

- Completed: Documented `sortKey` as Record/store metadata in the Properties, write
  normalization, sort-key, factory, and Serialization sections. Reconciled stored-Record and
  facade fixtures with the new contract. Added regression coverage for metadata-free
  persistence and uniform engine records, legacy-blob normalization, and a Collection
  get/update round trip that preserves sort metadata.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries:
  - Test changes and unit-test execution were initially deferred; the user subsequently
    authorized both in a follow-up task.
  - `test/unit-tests/kixx/document-store/document-store.test.js`: the update pass-through
    fixture now returns the complete engine record and asserts the facade returns it
    unchanged.
  - `test/unit-tests/plugins/node-document-store-engine/lib/document-store-engine.test.js`:
    added coverage for metadata-free raw JSON on create/put/update, column-backed `sortKey`
    from get/scan/query, identical record shapes, legacy payload normalization, and the
    Collection read/update round trip.
  - No Cloudflare engine unit test exists. Add adapter-contract coverage when Cloudflare test
    infrastructure is available, mirroring the Node cases.
  - `test/unit-tests/app/presentation/request-handlers/admin-api/run-migration.test.js` and
    `test/unit-tests/app/transaction-scripts/migrations/run-migration.test.js`: direct
    `new MigrationRecord(...)` factories now supply `sortKey: null`.
  - The integration-style Node engine test covers `get('sortKey')` isolation,
    `meta.sortKey` projection, plain-object normalization, and a get/update round trip
    through the default hook.
- Actual files changed: `src/app/collections/README.md`,
  `test/unit-tests/app/presentation/request-handlers/admin-api/run-migration.test.js`,
  `test/unit-tests/app/transaction-scripts/migrations/run-migration.test.js`,
  `test/unit-tests/kixx/document-store/document-store.test.js`, and
  `test/unit-tests/plugins/node-document-store-engine/lib/document-store-engine.test.js`.
- Validation run: Documentation read-through passed. Lint over all changed implementation
  and test JavaScript files exited 0, and `git diff --check` exited 0. The focused test run
  passed 66 tests with no failures. The final `node run-tests.js` run passed 1,115 tests with
  zero disabled tests and no failures.
- Blockers: None.
