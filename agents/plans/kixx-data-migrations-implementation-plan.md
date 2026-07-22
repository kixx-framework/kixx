# Kixx Remote Data Migrations — Implementation Plan

**Specification:** `tmp/kixx-data-migrations-specification.md` (v1.0)
**Status:** Complete

## Implementation Approach

This plan implements the Remote Data Migrations facility from the specification: a
privileged, JSON:API admin surface that applies one bounded migration batch per
request, backed by a durable, version-guarded `Migration` ledger in the Document
Store, driven remotely by an out-of-band operator client.

### Confirmed scope decisions

- **Example migration:** ship one documented **no-op** example module plus the
  `migrations/README.md`. No real data transformation is authored here.
- **Operator driver tooling:** **deferred.** This plan builds the conformant HTTP
  surface only (spec §3.2 — the driver is explicitly out of scope). The caller
  obligations in §11.5 are honored by the HTTP contract, not by bundled tooling.
- **Testing:** **test-first, red/green TDD.** Every task writes failing tests
  first, then implements to green. There are currently no app-layer
  (transaction-script/collection) tests in `test/`, so this work also establishes
  the file-local context/collection test-double pattern described in
  `test/README.md`. This overrides the repo default of "no tests unless asked" —
  the user explicitly asked for TDD here.
- **Authentication:** a **single shared Basic-auth inbound middleware** on a
  `/admin-api/v1/migrations` route subtree (not per-handler auth). Both endpoints
  authenticate every request and set `context.user` with a stable admin id for
  `startedBy`.

### Cross-cutting architectural decisions

These decisions are settled for the whole plan; individual tasks must not
re-litigate them.

1. **Layer ownership (spec §3.2).**
   - *Migration modules* own only the application-specific bounded transform.
   - *Transaction Scripts* own lifecycle rules, result-contract enforcement,
     cursor/ledger conflict translation, and failed-state bookkeeping.
   - *Presentation* owns HTTP parsing, authentication, Form validation, JSON:API
     serialization, and the dry-run `InvalidCursorError → 400` translation.

2. **Pure vs. I/O split for testability.** The execution-framework logic — batch
   result validation (§5.1, §5.3), stats accumulation (§5.1), and the state-machine
   computations (§8.1, §8.2, §10) — is implemented as **pure, dependency-free
   functions** in `app/transaction-scripts/migrations/lib/`. The `run-migration`
   Transaction Script orchestrates I/O (registry lookup, ledger reads/writes,
   migration invocation) around those pure functions. This keeps the hardest logic
   trivially unit-testable red/green and keeps the I/O orchestrator thin.

3. **Ledger access pattern.** The `Migration` ledger is a Document Store Collection
   (type `Migration`, record id === migration id). It is accessed only by
   `get(id)`, `create()` (first run), and version-guarded `update()` (lifecycle).
   It uses **no** secondary index and **no** sort key — the admin list is ordered by
   registry iteration order, never by a ledger scan (§4.2, §11.3). `put()` and
   `updateWithRetry()` are forbidden for lifecycle changes (§7.1).

4. **Reused framework surface (already present, do not rebuild):**
   - `app/presentation/lib/json-api.js`: `parseBasicAuthCredentials`,
     `assertJsonApiContentType`, `parseJsonApiResource`, `jsonApiResource`,
     `JSON_API_CONTENT_TYPE`.
   - `verifyAdminCredentials(context, { emailAddress, password })` →
     `{ id, type, emailAddress, userCreationDate }`. `admin.id` is `startedBy`.
   - `jsonApiErrorHandler` already attached to the `/admin-api/v1` route; expected
     errors with a `code` option serialize into the JSON:API `code` field.
   - Document Store error names for translation: `DocumentAlreadyExistsError`,
     `VersionConflictError`, `DocumentNotFoundError`, `InvalidCursorError`.
   - `createPublishingApiToken` handler is the reference template for admin Basic
     auth + JSON:API request/response shape.

5. **Error taxonomy (spec §10, §11.4; project `server-error-handling.md`).**
   Expected → specific HTTP error class with a client-safe message and, for
   conflicts, a stable `code`:
   - `MigrationAlreadyAppliedError` (409, applied without force)
   - `MigrationConcurrencyError` (409, create/version race)
   - `MigrationCursorConflictError` (409, invalid stored cursor → restart with force)
   Unknown/broken-contract/unexpected storage failures → `AssertionError` with
   `cause`. Migration-function throw during a real run → best-effort failed-state
   bookkeeping that never masks the original error.

### Recommended file layout (spec §12)

```text
src/app/
├── collections/
│   ├── migration-collection.js
│   └── migration-record.js
├── migrations/
│   ├── README.md
│   ├── mod.js                       # `migrations` Map + validated getMigration/listMigrations
│   └── 2026-07-17-example-noop.js   # documented no-op example
├── presentation/
│   ├── forms/migrations/run-migration-form.js
│   ├── middleware/admin-api-authentication.js   # shared Basic-auth middleware
│   └── request-handlers/admin-api/
│       ├── list-migrations.js
│       └── run-migration.js
└── transaction-scripts/migrations/
    ├── lib/
    │   ├── validate-batch-result.js  # §5.1, §5.3 (pure)
    │   ├── accumulate-stats.js       # §5.1 (pure)
    │   └── migration-state.js        # §8.1, §8.2, §10 state computations (pure)
    ├── list-migrations.js
    └── run-migration.js

test/app/                            # mirrors src/app/ for the new test files
```

Route wiring lives in `src/virtual-hosts.js`; ledger registration in
`src/app/app.js`.

---

## Task M1: Migration ledger Collection and Record

**Status:** Complete
**Depends on:** None
**Documentation:** Spec §7 (ledger), §3.1; `src/app/collections/README.md`;
`src/docs/code-style-guide.md`; `test/README.md`

**Objective**

A registered `Migration` Document Store Collection and its paired Record exist,
enforcing the §7.2 schema and lifecycle invariants before persistence. This is the
durable, version-guarded progress store every later task reads and writes.

**Scope**

- In: `migration-record.js` (schema + `validate()` + status/derivation getters),
  `migration-collection.js` (`TYPE = 'Migration'`, ledger helper methods),
  registration in `app.js`, and their tests.
- Out: lifecycle *decisions* (which state to write) — those live in the pure
  state module (M3) and the run Transaction Script (M4). This task only enforces
  that whatever is written is internally consistent.

**Design and invariants**

- Record id === migration id. No sort key, no secondary index.
- `MigrationRecord.validate()` MUST enforce the §7.2 invariants and throw
  `ValidationError` on violation:
  - `status ∈ { running, applied, failed }`.
  - `running` ⇒ `completedAt === null` and `error === null`.
  - `applied` ⇒ `cursor === null`, non-null `completedAt`, `error === null`.
  - `failed` ⇒ non-null `completedAt` and non-empty `error`.
  - `batchCount` is a non-negative integer; `batchCount === 0` ⇒ `lastBatchAt === null`.
  - every value in `stats` is a finite number.
  - `cursor` is `null` or a non-empty string; `startedBy` non-empty; `startedAt`
    a valid ISO date-time.
- Collection helpers wrap the raw store calls so callers never see storage shapes:
  - `getByMigrationId(context, id)` → Record | null.
  - `createLedgerRecord(context, id, attributes)` → uses `create()` (first run).
  - `updateLedgerRecord(context, record)` → uses version-guarded `update()`.
  - Do **not** add `put()`/`updateWithRetry()` lifecycle helpers.
- Follow the `publishing-api-token-record.js` / `publishing-api-token-collection.js`
  shape for schema/validate/getters and Collection method docs.

**Expected touch points**

- `src/app/collections/migration-record.js` — schema, `validate()`, getters.
- `src/app/collections/migration-collection.js` — `TYPE`, `Record`, helpers.
- `src/app/app.js` — `registerCollection('Migration', new MigrationCollection({ db: documentStore }))`.
- `test/app/collections/migration-record.test.js` — invariant coverage.

**Acceptance criteria**

- [ ] `MigrationRecord.validate()` accepts each valid `running`/`applied`/`failed`
      shape and rejects each invariant violation with `ValidationError`.
- [ ] Non-finite or non-numeric stat values are rejected.
- [ ] `batchCount === 0` with a non-null `lastBatchAt` is rejected.
- [ ] `MigrationCollection` is registered in `app.js` and accessible via
      `context.getCollection('Migration')`.
- [ ] Ledger helpers use `create()`/`update()` only (asserted by reading the code;
      no `put`/`updateWithRetry`).

**Validation**

- `node run-tests.js test/app/collections/migration-record.test.js` — invariants.
- `node run-linter.js src/app/collections/migration-record.js src/app/collections/migration-collection.js src/app/app.js` — clean.

**Progress and handoff**

- Completed: Added the Migration ledger schema, lifecycle/field invariant validation, domain getters, create/update-only Collection helpers, application registration, and invariant coverage for all three valid states and invalid field/state combinations.
- Current state: Complete; every M1 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: The existing Collection write path calls Record.validate() before all persistence operations, so MigrationCollection keeps its helpers narrow and delegates validation/concurrency mechanics to create()/update(). ISO date-time fields require an ISO-shaped value with a valid parsed Date. The Collection defines no sort key, secondary indexes, put helper, or updateWithRetry helper.
- Actual files changed: `src/app/collections/migration-record.js`, `src/app/collections/migration-collection.js`, `src/app/app.js`, `test/app/collections/migration-record.test.js`, `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: `node run-tests.js test/app/collections/migration-record.test.js` — passed, 12 tests, 0 disabled; `node run-linter.js src/app/collections/migration-record.js src/app/collections/migration-collection.js src/app/app.js` — passed with no diagnostics.
- Blockers: None.

---

## Task M2: Static registry, example migration module, and migrations README

**Status:** Complete
**Depends on:** None
**Documentation:** Spec §4 (registry), §5 (module contract), §6 (deployment),
§13 (authoring checklist); `src/app/collections/README.md`; `test/README.md`

**Objective**

The application exports a validated static `migrations` `Map`, imported explicitly
with no I/O at load, plus one documented no-op example module and an authoring
README. Registry lookups and the status list reject any Map-key/entry-id mismatch
before use.

**Scope**

- In: `migrations/mod.js` (the `Map` + `getMigration(id)` + `listMigrations()`),
  `migrations/2026-07-17-example-noop.js`, `migrations/README.md`, and tests.
- Out: how the ledger is read for status (M5) and how a batch is run (M4). This
  task exposes only the registry and its validation.

**Design and invariants**

- `mod.js` exports `migrations` (a `Map<id, { id, description, migrate }>`) built
  from explicit imports; registry construction performs no I/O (§4.2).
- Registry-integrity validation (§4.2): before resolving by id or listing, every
  Map key MUST equal `entry.id`. A mismatch is an **unexpected** configuration
  error → throw `AssertionError` (do not fall back to "missing"). Provide:
  - `getMigration(id)` → validated entry, or `null` when the id is not registered
    (a *missing* id is an expected 404 case handled by the caller, distinct from a
    key/id *mismatch* which is unexpected).
  - `listMigrations()` → entries in **registry iteration order** (§4.2, §11.3).
- The example module exports `async function migrate(context, params)` honoring
  §5.1: returns `{ done: true, cursor: null, stats: { scanned: 0 } }` immediately,
  performs no reads or writes, and documents the contract (cursor opacity,
  idempotency, dry-run equivalence, bounded work) in comments as a template.
- `README.md` documents: id format (`YYYY-MM-DD-short-kebab-description`),
  registration steps, the module contract, the §6 expand/contract deployment
  sequence, and the §13 authoring checklist.

**Expected touch points**

- `src/app/migrations/mod.js`
- `src/app/migrations/2026-07-17-example-noop.js`
- `src/app/migrations/README.md`
- `test/app/migrations/registry.test.js`

**Acceptance criteria**

- [ ] `getMigration('unregistered')` returns `null`; `getMigration(exampleId)`
      returns the entry.
- [ ] A registry whose Map key differs from its entry `id` causes `getMigration`
      and `listMigrations` to throw `AssertionError` (tested with a fixture Map).
- [ ] `listMigrations()` preserves insertion order.
- [ ] Example module returns a spec-valid terminal result and touches no I/O.
- [ ] README covers id rules, contract, expand/contract, and authoring checklist.

**Validation**

- `node run-tests.js test/app/migrations/registry.test.js`
- `node run-linter.js src/app/migrations/mod.js src/app/migrations/2026-07-17-example-noop.js`

**Progress and handoff**

- Completed: Added the explicit static registry, full registry-entry validation, validated lookup/list APIs, the documented terminal no-op migration, the migration authoring/deployment README, and red/green tests for lookup, malformed registries, ordering, and no-op execution.
- Current state: Complete; every M2 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: The registry-validation function must be exported (or
  a testable inner accepting an injected Map) so the key/id mismatch case can be
  tested without corrupting the real registry. `getMigration` and `listMigrations`
  will accept an optional registry Map so tests exercise the production lookup/list
  paths rather than a separate validator-only path. Validation also enforces the
  id format, non-empty description, and callable migration contract required by
  specification §4.2. Lookup validates the complete registry before resolving an
  id, so malformed configuration cannot fall through as an expected missing id.
- Actual files changed: `src/app/migrations/mod.js`, `src/app/migrations/2026-07-17-example-noop.js`, `src/app/migrations/README.md`, `test/app/migrations/registry.test.js`, `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial `node run-tests.js test/app/migrations/registry.test.js` failed red with `ERR_MODULE_NOT_FOUND`; after implementation, the same command passed 6 tests with 0 disabled. `node run-linter.js src/app/migrations/mod.js src/app/migrations/2026-07-17-example-noop.js` passed with no diagnostics.
- Blockers: None.

---

## Task M3: Pure execution-framework helpers (result validation, stats, state machine)

**Status:** Complete
**Depends on:** None
**Documentation:** Spec §5.1, §5.3 (result/cursor contract), §8.1, §8.2 (state
table + successful batch), §10.1, §10.2 (failure/cursor state); `test/README.md`

**Objective**

Pure, dependency-free functions encode the entire execution-framework decision
logic so it can be exhaustively tested without I/O. The run Transaction Script (M4)
composes these; they never touch a Collection, context, or clock directly (time is
passed in).

**Scope**

- In: `validate-batch-result.js`, `accumulate-stats.js`, `migration-state.js`, and
  their tests.
- Out: registry lookup, ledger reads/writes, migration invocation, and error
  translation (all in M4). These helpers return decisions/values; they do not
  perform effects.

**Design and invariants**

- `validateBatchResult(result, inputCursor)` (§5.1, §5.3):
  - `result` is a plain object; `done` is boolean.
  - `cursor === null` **iff** `done === true`; otherwise `cursor` is a non-empty
    string.
  - when `done === false`, `cursor !== inputCursor` (non-advance is a broken
    contract — §5.3, §10.1).
  - `stats` is a plain object whose values are all finite numbers.
  - On any violation, throw a distinguishable error the caller converts to
    `AssertionError` (broken result contract is unexpected). Keep validation pure;
    do not decide HTTP status here.
- `accumulateStats(previousStats, batchStats)` (§5.1): returns a new object adding
  same-named finite counters, treating a missing previous value as zero. Never
  mutates inputs.
- `migration-state.js` — pure transition computations over `(existing, force,
  adminId, now)` and `(preparedState, batchResult, now)`:
  - `computeRunPreparation({ existing, force, adminId, now })` implements the §8.1
    table exactly, returning one of:
    - `{ action: 'create', seed }` — no record; seed is the fresh `running` record
      at `cursor: null`.
    - `{ action: 'resume', startCursor }` — `running`: resume from stored cursor
      (`force` does not reset an active run).
    - `{ action: 'resume-failed', startCursor }` — `failed` + `!force`: continue
      the same logical run — flip to `running`, retain committed
      cursor/stats/count/`startedBy`/`startedAt`, clear `completedAt`/`error`.
    - `{ action: 'reset', seed }` — (`failed` + `force`) or (`applied` + `force`):
      full reset seed at `cursor: null` with new `startedBy`/`startedAt`.
    - `{ action: 'reject-applied' }` — `applied` + `!force`: caller raises
      `MigrationAlreadyAppliedError`.
  - `computeCommittedState({ base, batchResult, accumulatedStats, now })` implements
    §8.2: store returned cursor, set accumulated stats, `batchCount += 1`,
    `lastBatchAt = now`; when `done` false keep `running`/`completedAt:null`/
    `error:null`; when `done` true set `applied`/`cursor:null`/`completedAt:now`/
    `error:null`.
  - `computeFailedState({ base, errorMessage, now })` implements §10.1: preserve
    last committed `cursor`/`stats`/`batchCount`, set `failed`, `completedAt = now`,
    `error = errorMessage`.
- The reset seed shape MUST match §8.1 exactly.

**Expected touch points**

- `src/app/transaction-scripts/migrations/lib/validate-batch-result.js`
- `src/app/transaction-scripts/migrations/lib/accumulate-stats.js`
- `src/app/transaction-scripts/migrations/lib/migration-state.js`
- `test/app/transaction-scripts/migrations/lib/*.test.js`

**Acceptance criteria**

- [ ] `validateBatchResult` rejects: non-object result, non-boolean `done`,
      `done:true` with non-null cursor, `done:false` with null/empty cursor,
      `done:false` with cursor equal to input, non-finite stat values.
- [ ] `accumulateStats` sums same-named counters, defaults missing to zero, and
      mutates neither argument.
- [ ] `computeRunPreparation` returns the correct action for all six §8.1 rows
      (no record / running / failed×{force,!force} / applied×{force,!force}), and a
      non-forced failed-resume retains original `startedBy`/`startedAt`.
- [ ] `computeCommittedState` produces the correct running and applied shapes.
- [ ] `computeFailedState` preserves committed progress and sets a client-safe error.

**Validation**

- `node run-tests.js test/app/transaction-scripts/migrations/lib/`
- `node run-linter.js src/app/transaction-scripts/migrations/lib/`

**Progress and handoff**

- Completed: Implemented complete batch-result validation, immutable finite stat accumulation, all six real-run preparation rows, successful running/applied commits, and failure-state bookkeeping. Added red/green coverage for each acceptance criterion plus malformed stat inputs and finite-sum overflow.
- Current state: Complete; every M3 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: Broken batch results throw the dedicated `InvalidMigrationBatchResultError` so M4 can distinguish and wrap that contract failure. State computations return new plain objects and clone stats to avoid mutable aliasing. Failed-resume includes a prepared `state` for M4 to merge into the versioned Record without reproducing lifecycle rules. `now` is an explicit ISO date-time string supplied by the caller; helpers never read a clock.
- Actual files changed: `src/app/transaction-scripts/migrations/lib/validate-batch-result.js`, `src/app/transaction-scripts/migrations/lib/accumulate-stats.js`, `src/app/transaction-scripts/migrations/lib/migration-state.js`, `test/app/transaction-scripts/migrations/lib/validate-batch-result.test.js`, `test/app/transaction-scripts/migrations/lib/accumulate-stats.test.js`, `test/app/transaction-scripts/migrations/lib/migration-state.test.js`, `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial `node run-tests.js test/app/transaction-scripts/migrations/lib/` failed red with `ERR_MODULE_NOT_FOUND`; after implementation, the same command passed 19 tests with 0 disabled. `node run-linter.js src/app/transaction-scripts/migrations/lib/` passed with no diagnostics.
- Blockers: None.

---

## Task M4: `run-migration` Transaction Script (execution state machine)

**Status:** Complete
**Depends on:** M1, M2, M3
**Documentation:** Spec §8 (state machine), §9 (concurrency), §10 (failure),
§5 (module contract); `src/app/transaction-scripts/README.md`;
`src/docs/server-error-handling.md`

**Objective**

`runMigration(context, { id, dryRun, force, cursor, startedBy, now })` advances one
real or dry-run batch and returns the caller-facing result derived from the
committed ledger state. It orchestrates the registry, ledger, and pure helpers, and
translates all persistence outcomes into the correct expected/unexpected errors.

**Scope**

- In: the `run-migration.js` Transaction Script — real-run preparation, single
  migration invocation, version-guarded commit, dry-run bypass, and all §10 error
  translation. Tests using fake context/collection doubles.
- Out: HTTP parsing, Form validation, Basic auth, and the dry-run
  `InvalidCursorError → 400` translation (M6/M7 presentation). This script may
  *throw* `InvalidCursorError` outward on a dry run; presentation translates it.

**Design and invariants**

- **Real run (§8.2):** the runner passes **only the ledger cursor** to `migrate()`;
  a client-supplied cursor MUST NOT influence a real run (§8.2, §11.2). Sequence:
  1. `getMigration(id)`; `null` → `NotFoundError` (404).
  2. Load ledger record; apply `computeRunPreparation`.
  3. `reject-applied` → `ConflictError('… already applied …', { code: 'MigrationAlreadyAppliedError' })`.
  4. Persist preparation: `create()` for a new run, version-guarded `update()` for
     resume/resume-failed/reset. Translate `DocumentAlreadyExistsError` and
     `VersionConflictError` → `ConflictError({ code: 'MigrationConcurrencyError' })`.
  5. Invoke `migrate(context, { cursor: startCursor, dryRun: false })`.
  6. `validateBatchResult(result, startCursor)`; on failure → best-effort
     `computeFailedState` + version-guarded update, then rethrow as `AssertionError`
     (broken contract is unexpected — §10.1). Bookkeeping failure MUST NOT mask the
     original error.
  7. On valid result: `accumulateStats` + `computeCommittedState`, then one
     version-guarded `update()`. Return a result **derived from the committed
     record** (§8.2), not from the raw migration return.
- **Real-run failures (§10.1, §10.2):**
  - `migrate()` throws → best-effort `computeFailedState` update; propagate. Known
    Kixx operational/HTTP errors with safe messages MAY pass through unchanged;
    otherwise wrap as `AssertionError` with `cause`.
  - Stored cursor rejected (`InvalidCursorError` from the store during a real run)
    → best-effort failed-state, then `ConflictError('… restart with force …',
    { code: 'MigrationCursorConflictError' })` (§10.2).
- **Dry run (§8.3):** bypass the state table and the ledger entirely — never read,
  create, or update the ledger. Invoke `migrate(context, { cursor: callerCursor ??
  null, dryRun: true })`, run `validateBatchResult`, and return the validated batch
  result tagged `status: 'dry-run'`. A broken dry-run contract propagates as
  `AssertionError` with no ledger access (§10.1). An `InvalidCursorError` from a
  dry-run propagates **unchanged** for presentation to translate to 400 (§10.2).
- `force` and `dryRun` are mutually exclusive — enforced upstream by the Form (M6),
  but assert defensively here.
- Ledger error translation lives at this Transaction Script boundary (§10.3);
  unrecognized ledger errors → `AssertionError` with `cause`.

**Expected touch points**

- `src/app/transaction-scripts/migrations/run-migration.js`
- `test/app/transaction-scripts/migrations/run-migration.test.js`
- Possibly a shared `test/app/helpers/` factory for fake context + fake Migration
  collection doubles (new pattern for this repo).

**Acceptance criteria**

- [ ] First real run with no record creates a `running` ledger record at
      `cursor: null` and commits the first batch.
- [ ] A real run ignores a client-supplied cursor and uses ledger state.
- [ ] `done: true` transitions the ledger to `applied` with `cursor: null` and a
      `completedAt`; response reflects committed state.
- [ ] `applied` + `!force` → `MigrationAlreadyAppliedError` (409) without invoking
      the migration.
- [ ] `applied`/`failed` + `force` reset to a fresh run; `failed` + `!force`
      resumes retaining `startedBy`/`startedAt`.
- [ ] Create race (`DocumentAlreadyExistsError`) and commit race
      (`VersionConflictError`) → `MigrationConcurrencyError` (409).
- [ ] Migration throw and broken result contract both record a best-effort
      `failed` state and propagate; bookkeeping failure never masks the original.
- [ ] Invalid **stored** cursor → failed-state + `MigrationCursorConflictError`;
      invalid **dry-run** cursor propagates `InvalidCursorError` unchanged with no
      ledger access.
- [ ] Dry run performs zero ledger reads/writes and returns `status: 'dry-run'`.

**Validation**

- `node run-tests.js test/app/transaction-scripts/migrations/run-migration.test.js`
- `node run-linter.js src/app/transaction-scripts/migrations/run-migration.js`

**Progress and handoff**

- Completed: Added the complete real/dry one-batch orchestrator, defensive input
  assertions, registry/not-found resolution, all preparation actions, create/update
  race translation, committed-state response projection, result validation/stat
  accumulation, safe best-effort failed bookkeeping, invalid-cursor classification,
  and a file-local versioned Collection test double with the full acceptance matrix.
- Current state: Complete; every M4 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: Invalid cursor classification is by active run kind,
  regardless of the migration/store call that surfaces it. Preparation returns a
  persisted Record whose version guards the later success/failure write; resume,
  failed-resume, and reset merge into the loaded Record before versioned update.
  Both create and version conflicts use `MigrationConcurrencyError`; unknown ledger
  errors remain unexpected assertions. Failure bookkeeping catches computation,
  Record mutation, and persistence failures so none can mask the original error.
  Unknown migration messages are not stored; the ledger receives a generic safe
  failure message, while known expected Kixx errors may retain their safe message.
  Real results expose only the §11.2 response fields and derive them from the Record
  returned by the successful final update.
- Actual files changed: `src/app/transaction-scripts/migrations/run-migration.js`,
  `test/app/transaction-scripts/migrations/run-migration.test.js`,
  `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial
  `node run-tests.js test/app/transaction-scripts/migrations/run-migration.test.js`
  failed red with `ERR_MODULE_NOT_FOUND`; after implementation, the same command
  passed 10 tests with 0 disabled. `node run-linter.js src/app/transaction-scripts/migrations/run-migration.js`
  passed with no diagnostics. Final `git diff --check` passed.
- Blockers: None.

---

## Task M5: `list-migrations` Transaction Script

**Status:** Complete
**Depends on:** M1, M2
**Documentation:** Spec §11.3 (list), §4.2 (registry authority);
`src/app/transaction-scripts/README.md`

**Objective**

`listMigrations(context)` returns one status object per registry entry, in registry
order, merging registry description with ledger state and reporting the `pending`
shape when no ledger record exists.

**Scope**

- In: `list-migrations.js` Transaction Script and tests.
- Out: JSON:API serialization (M7).

**Design and invariants**

- Iterate `listMigrations()` (registry order). For each entry, load its ledger
  record by id.
- With a ledger record, report: `description` (from registry), `status`, `stats`,
  `batchCount`, `startedBy`, `startedAt`, `completedAt`, `error`. (`cursor`,
  `lastBatchAt` are internal and not part of the list attributes per §11.3.)
- Without a ledger record, report the exact §11.3 `pending` shape:
  `{ status: 'pending', stats: null, batchCount: null, startedBy: null,
  startedAt: null, completedAt: null, error: null }` plus `description`.
- Ledger records whose ids are **absent from the registry** MUST NOT appear (§11.3):
  the registry is authoritative; never scan the ledger to build the list.
- The description is registry data and is not duplicated into the ledger (§7.2).

**Expected touch points**

- `src/app/transaction-scripts/migrations/list-migrations.js`
- `test/app/transaction-scripts/migrations/list-migrations.test.js`

**Acceptance criteria**

- [ ] Output order matches registry iteration order.
- [ ] A registered migration with no ledger record yields the `pending` shape.
- [ ] A registered migration with a ledger record surfaces the eight §11.3
      attributes with ledger values.
- [ ] A ledger record for an unregistered id never appears in the output.

**Validation**

- `node run-tests.js test/app/transaction-scripts/migrations/list-migrations.test.js`
- `node run-linter.js src/app/transaction-scripts/migrations/list-migrations.js`

**Progress and handoff**

- Completed: Added the registry-authoritative listing Transaction Script and
  red/green coverage for registry order, exact pending state, stored lifecycle
  projection, internal-field omission, and orphan-ledger exclusion.
- Current state: Complete; every M5 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: The script builds exclusively from validated registry
  iteration and keyed `getByMigrationId()` calls; it never scans the ledger.
  `Promise.all()` retains registry result order while allowing independent keyed
  reads to proceed together. Results include `id` for M7 JSON:API resource identity,
  use the registry-owned description, and omit internal cursor/lastBatchAt fields.
  Unexpected ledger read failures are wrapped as unexpected `AssertionError` at
  the Transaction Script boundary.
- Actual files changed: `src/app/transaction-scripts/migrations/list-migrations.js`,
  `test/app/transaction-scripts/migrations/list-migrations.test.js`,
  `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial
  `node run-tests.js test/app/transaction-scripts/migrations/list-migrations.test.js`
  failed red with `ERR_MODULE_NOT_FOUND`; after implementation, the same command
  passed 3 tests with 0 disabled. `node run-linter.js src/app/transaction-scripts/migrations/list-migrations.js`
  passed with no diagnostics.
- Blockers: None.

---

## Task M6: `run-migration` API Form

**Status:** Complete
**Depends on:** None
**Documentation:** Spec §11.2 (request document + validation);
`src/app/presentation/README.md` (API-Only Forms); `src/docs/server-error-handling.md`

**Objective**

An API-only Form parses and validates the `MigrationRun` request attributes,
enforcing types, cursor shape, and the `dryRun`/`force` mutual-exclusion rule,
producing `ValidationError` (→ 422) on failure.

**Scope**

- In: `run-migration-form.js` (`schema`, constructor normalization, `validate()`,
  `toJSON()`, `fromJsonApi()`) and tests.
- Out: `Content-Type` assertion and Basic auth (handler M7); it has no `method`/
  `target`/`getFormContext` because it is never rendered as HTML.

**Design and invariants**

- Defaults: `dryRun: false`, `force: false`, `cursor: null` — all attributes
  optional (§11.2).
- `validate()` (§11.2) collects field errors on a `ValidationError`:
  - `dryRun` and `force` are booleans.
  - `cursor` is `null` or a non-empty string.
  - `dryRun` and `force` are not both `true`.
- `toJSON()`/getters expose `{ dryRun, force, cursor }` for the handler.
- `fromJsonApi(resource)` reads `resource.attributes` (matching the existing
  `parseJsonApiResource` return shape).

**Expected touch points**

- `src/app/presentation/forms/migrations/run-migration-form.js`
- `test/app/presentation/forms/migrations/run-migration-form.test.js`

**Acceptance criteria**

- [ ] Omitted attributes yield the documented defaults.
- [ ] Non-boolean `dryRun`/`force`, and a non-string/empty-string `cursor`, each
      produce a field-level `ValidationError`.
- [ ] `dryRun: true` + `force: true` produces a `ValidationError`.
- [ ] Valid input produces `{ dryRun, force, cursor }`.

**Validation**

- `node run-tests.js test/app/presentation/forms/migrations/run-migration-form.test.js`
- `node run-linter.js src/app/presentation/forms/migrations/run-migration-form.js`

**Progress and handoff**

- Completed: Added the API-only migration run Form with schema defaults,
  constructor normalization, field-level validation, mutual-exclusion validation,
  `toJSON()`, `fromJsonApi()`, and focused red/green coverage for every acceptance
  criterion.
- Current state: Complete; every M6 acceptance criterion is satisfied.
- Remaining: None.
- Decisions and discoveries: Apply defaults only to omitted (`undefined`)
  attributes so explicit `null` or wrong-typed boolean input remains invalid. The
  cursor remains byte-for-byte opaque and is not trimmed. The test assertion API
  compares objects and arrays by identity, so structured results are asserted by
  their individual observable fields.
- Actual files changed: `src/app/presentation/forms/migrations/run-migration-form.js`,
  `test/app/presentation/forms/migrations/run-migration-form.test.js`,
  `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial
  `node run-tests.js test/app/presentation/forms/migrations/run-migration-form.test.js`
  failed red with `ERR_MODULE_NOT_FOUND`; after implementation and correcting
  deep-equality assumptions in the tests, the same command passed 5 tests with 0
  disabled. `node run-linter.js src/app/presentation/forms/migrations/run-migration-form.js`
  passed with no diagnostics.
- Blockers: None.

---

## Task M7: Admin API presentation — shared auth middleware, handlers, and routes

**Status:** Complete
**Depends on:** M4, M5, M6
**Documentation:** Spec §11 (HTTP API), §10.2 (dry-run cursor translation), §12
(layout); `src/app/presentation/README.md`; `src/kixx/static-file-server` (n/a)

**Objective**

Two authenticated JSON:API endpoints exist and conform to §11:
`POST /admin-api/v1/migrations/:id/run` and `GET /admin-api/v1/migrations`. Every
request authenticates before any migration existence or state is disclosed, and a
client dry-run cursor failure returns `400`, not `500`.

**Scope**

- In: shared Basic-auth inbound middleware for the migrations subtree; `run` and
  `list` request handlers; route wiring in `virtual-hosts.js`; the dry-run
  `InvalidCursorError → 400` translation at the handler boundary. Handler-level
  tests where practical; otherwise documented manual procedures.
- Out: domain lifecycle logic (M4/M5) and Form validation (M6).

**Design and invariants**

- **Shared auth middleware** (`admin-api-authentication.js`): parse Basic
  credentials (`parseBasicAuthCredentials`), verify via `verifyAdminCredentials`,
  and `context.setUser(admin)`. Authentication runs **before** migration existence
  or state is disclosed (§11.1). Placed as `inboundMiddleware` on a new
  `/admin-api/v1/migrations` branch route nested under the existing `/admin-api/v1`
  route (which already carries `jsonApiErrorHandler`). Rejected/missing credentials
  → `UnauthenticatedError`/`UnauthorizedError` (401).
- **Run handler** (`run-migration.js`): `assertJsonApiContentType` (→ 415 on
  mismatch); `parseJsonApiResource(request, 'MigrationRun')`;
  `RunMigrationForm.fromJsonApi(...)` + `validate()` (→ 422); call
  `runMigration(context, { id: request.pathnameParams.id, ...form, startedBy:
  context.user.id, now })`. Wrap the call so a **dry-run** `InvalidCursorError`
  becomes `BadRequestError` (400) preserving the original as `cause` and exposing a
  client-safe message (§10.2); all other errors propagate to `jsonApiErrorHandler`.
  Respond `respondWithJSON(200, jsonApiResource({ type: 'MigrationRun', id,
  attributes: { done, cursor, stats, status, dryRun } }), { contentType })`.
- **List handler** (`list-migrations.js`): call `listMigrations(context)` and
  respond with a JSON:API document containing one `Migration` resource per entry in
  registry order (id = migration id; attributes per §11.3). Not paginated.
- **Routes** (`virtual-hosts.js`): under `/admin-api/v1`, add a `migrations` branch
  route with the shared auth middleware, a leaf `GET` list target at
  `/migrations{/}`, and a `POST` run target at `/migrations/:id/run`. Order the run
  route so `:id` does not shadow the list route (list has no `:id` segment, so
  distinct patterns suffice; keep the list route reachable).
- HTTP status matrix (§11.4): 400/401/404/409/415/422/500 all reachable via the
  above error sources. Never leak secrets, causes, or storage detail in messages.

**Expected touch points**

- `src/app/presentation/middleware/admin-api-authentication.js`
- `src/app/presentation/request-handlers/admin-api/run-migration.js`
- `src/app/presentation/request-handlers/admin-api/list-migrations.js`
- `src/app/presentation/request-handlers/admin-api/mod.js` — export the new handlers.
- `src/virtual-hosts.js` — the `migrations` subtree.
- `test/app/presentation/...` and/or documented manual procedures.

**Acceptance criteria**

- [x] Both endpoints require valid admin Basic credentials; unauthenticated →
      401 before any id/state disclosure.
- [x] `POST …/:id/run` with `dryRun:false` drives one real batch and returns the
      §11.2 success document with accumulated committed stats.
- [x] Dry-run request returns per-batch stats and `status: 'dry-run'` with no
      ledger mutation.
- [x] Unregistered id → 404; already-applied without force → 409
      (`MigrationAlreadyAppliedError`); ledger race → 409
      (`MigrationConcurrencyError`); invalid stored cursor → 409
      (`MigrationCursorConflictError`).
- [x] Non-JSON:API content type → 415; failed Form validation → 422; invalid
      **client dry-run cursor** → 400 (not 500), cause preserved.
- [x] `GET /admin-api/v1/migrations` lists every registry entry in order with the
      §11.3 attributes and the `pending` shape when unrun.
- [x] A real run ignores any client-supplied cursor (verified end-to-end).

**Validation**

- `node run-tests.js test/app/presentation/` (handler/middleware tests as written).
- `node run-linter.js src/app/presentation/middleware/admin-api-authentication.js src/app/presentation/request-handlers/admin-api/run-migration.js src/app/presentation/request-handlers/admin-api/list-migrations.js src/app/presentation/request-handlers/admin-api/mod.js src/virtual-hosts.js`
- Manual: with the dev server running, exercise list → run (dry) → run (real to
  completion) → applied, and each error status, using an authenticated client.
  Record the procedure in handoff notes (no bundled driver in this plan).

**Progress and handoff**

- Completed: Added shared per-request Basic admin authentication for the migrations
  subtree, JSON:API run/list handlers, dry-run cursor error translation, handler
  exports, nested routes, and focused red/green middleware/handler/route tests.
- Current state: Complete; every M7 acceptance criterion is satisfied and the
  implementation plan is complete.
- Remaining: None. The manual HTTP procedure below is intentionally not executed
  because the repository work-verification instructions prohibit starting the dev
  server unless the user explicitly requests it.
- Decisions and discoveries: The `/admin-api/v1/migrations` branch inherits the
  parent `jsonApiErrorHandler`, while its inbound Basic-auth middleware is composed
  only into the list/run leaves; existing `accept-invite` and
  `publishing-api-tokens` siblings are unchanged. The handler translates
  `InvalidCursorError` only when the validated request is a dry run, because real
  cursor failures are translated to `MigrationCursorConflictError` in M4. Tests
  compile the real nested virtual-host specification and confirm the flattened
  endpoint paths. They invoke the production Transaction Scripts and replace only
  the static registry fixture, so the end-to-end real-run test proves a caller
  cursor is ignored and the committed result is serialized. No credentials,
  authorization headers, causes, or storage details are included in success or
  translated error bodies.
- Actual files changed: `src/app/presentation/middleware/admin-api-authentication.js`,
  `src/app/presentation/request-handlers/admin-api/run-migration.js`,
  `src/app/presentation/request-handlers/admin-api/list-migrations.js`,
  `src/app/presentation/request-handlers/admin-api/mod.js`, `src/virtual-hosts.js`,
  `test/app/presentation/middleware/admin-api-authentication.test.js`,
  `test/app/presentation/request-handlers/admin-api/run-migration.test.js`,
  `test/app/presentation/request-handlers/admin-api/list-migrations.test.js`, and
  `agents/plans/kixx-data-migrations-implementation-plan.md`.
- Validation run: Initial `node run-tests.js test/app/presentation/` failed red
  with `ERR_MODULE_NOT_FOUND` for `admin-api-authentication.js`; after
  implementation, the same command passed 14 tests with 0 disabled.
  `node run-linter.js src/app/presentation/middleware/admin-api-authentication.js src/app/presentation/request-handlers/admin-api/run-migration.js src/app/presentation/request-handlers/admin-api/list-migrations.js src/app/presentation/request-handlers/admin-api/mod.js src/virtual-hosts.js test/app/presentation/middleware/admin-api-authentication.test.js test/app/presentation/request-handlers/admin-api/run-migration.test.js test/app/presentation/request-handlers/admin-api/list-migrations.test.js`
  passed with no diagnostics. `git diff --check` passed.
- Manual procedure (not run): Start `node tools/devserver.js --port 2026`; use an
  authenticated client whose credentials are supplied without printing them to
  call `GET /admin-api/v1/migrations`; POST a JSON:API `MigrationRun` document with
  `dryRun:true` to the example id and confirm `status: dry-run`; POST a real run and
  confirm the no-op reaches `applied`; list again and confirm its stored status;
  repeat without force for `MigrationAlreadyAppliedError`, then restart once with
  `force:true`. Separately omit credentials (401), use an unknown id (404), send a
  non-JSON:API content type (415), and send invalid attributes (422). In a disposable
  environment with a cursor-consuming migration, tamper a dry cursor for 400,
  invalidate a persisted cursor for `MigrationCursorConflictError`, and issue two
  concurrent real requests for `MigrationConcurrencyError`; use a deliberately
  broken fixture migration only in that disposable environment to confirm 500.
- Blockers: None.

---

## Task ordering and TDD rhythm

Recommended order: **M1 → M2 → M3 → M6 (parallelizable) → M5 → M4 → M7.**
M3 and M6 have no dependencies and can be done early. M4 is the keystone and needs
M1/M2/M3. M7 integrates everything.

For every task, follow red/green:

1. Write the failing test(s) that pin the spec behavior (cite the spec clause in
   the test name/comment).
2. Run the task's `node run-tests.js <file>` and confirm red.
3. Implement to green.
4. Run `node run-linter.js` on every changed source file and fix violations.
5. Update the task's **Progress and handoff** block with actual files, decisions,
   and the validation command output before marking it complete.

## Open items to confirm during implementation (not blockers)

- Exact surfacing point of an invalid stored cursor (`InvalidCursorError` at
  `scan`/`query` time inside the migration vs. at commit) — classification is by
  run kind (real → conflict/restart; dry → 400), settled in M4.
- Whether any handler-level presentation tests are practical given the repo has no
  existing request-handler test harness; if not, M7 relies on documented manual
  procedures plus the fully unit-tested M3/M4/M5/M6 core.
