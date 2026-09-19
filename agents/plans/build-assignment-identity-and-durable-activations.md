# Implementation Approach

Fix [#152](https://github.com/kixx-framework/kixx/issues/152) and
[#155](https://github.com/kixx-framework/kixx/issues/155) by giving each changed
build assignment a unique identity and committing its pending audit event in
the same storage transaction as the pointer. Publish that identity in Build
JSON and require it in conditional writes. Deliver pending events to the
existing Activation Collection idempotently, with automatic recovery after
crashes on Node.js and Cloudflare.

ID1 is complete; ID2 is next. This intermediate state is not deployable.
Baseline: `ff3e9e65` on `fix-publishing`.
The completed `build-assignment-preconditions-and-results.md` fixes #153/#154:
preconditions run before no-op detection, and storage returns operation-owned
metadata. Preserve those behaviors throughout this work. This document
supersedes older plans for assignment concurrency and Activation delivery.

## Decisions agreed on 2026-09-18

- Replace header/hash write preconditions outright; coordinate client upgrades.
  No legacy write compatibility period.
- A clean reset is allowed. No migration or backfill of old pointers or audit
  history is required.
- Repair missing Activation documents automatically after crashes, without
  waiting for another publishing request.
- Keep deployment CLI implementation outside this repository. Document its
  required changes and make them an explicit rollout dependency.

## Boundaries

- Implement both Node SQLite and Cloudflare Durable Object storage contracts.
  Keep application code platform-neutral and persistence behind registered
  services/Collections.
- Retain the existing Build and Activation endpoints, permissions, and history
  pagination. Add assignment identity; change the write-precondition protocol.
- This is audit delivery idempotency, not request idempotency. A lost successful
  assignment response can still yield 412 on retry; clients read and reconcile.
- No generic job framework, queue dependency, new public repair endpoint,
  historical reconstruction, or automatic deletion of unpublished Releases.
- Implementation tasks do not deploy, reset remote data, change GitHub issues,
  install dependencies, or edit the external CLI. Rollout is a separately
  coordinated operation with the concrete prerequisites in task RL1.

## Assignment identity and public protocol

Use an opaque server-generated UUID (`crypto.randomUUID()`) called
`assignmentId`. Generate it inside the storage operation only for a changed
assignment. Timestamps and Release hashes are not identities or ordering
tokens. Valid no-ops preserve both `assignmentId` and `assignedAt`.

All successful pointer reads, list entries, and assignment results contain:

`{ rootHash, assignedAt, assignmentId }`

Public Build attributes are:

`{ releaseId, assignedAt, assignmentId }`

`PUT /publishing-api/v1/builds/:buildId` accepts:

```json
{
  "data": {
    "type": "Build",
    "id": "build-123",
    "attributes": {
      "releaseId": "<Release content hash>",
      "expectedAssignmentId": "<assignmentId from Build JSON>",
      "reason": "publish"
    }
  }
}
```

For first assignment, send `expectedAssignmentId: null`. Presence matters:
omission is not equivalent to null. Preserve existing request validation and
error mapping, with these explicit cases:

| Input/state | Result |
| --- | --- |
| Missing `expectedAssignmentId`, including a legacy header-only request | 428 `PreconditionRequired` |
| Present but malformed token/type | 422 `InvalidBuildAssignment` with field error |
| Valid body precondition plus `If-Match` or `If-None-Match` | 400; explain that write preconditions belong in JSON |
| Null and no pointer | 200, changed assignment |
| Null and existing pointer, even the same Release | 412 `BuildPointerConflict` |
| Matching identity and different Release | 200, new identity and timestamp |
| Matching identity and same Release | 200, preserved identity/timestamp, no new event |
| Stale identity, even after A→B→A or for the current Release | 412; nothing changes |
| Valid request naming a missing Release | 404 `ReleaseNotFound`, preserving missing-closure precedence over conflict |

Use a shared framework identity predicate for server-owned UUIDs, distinct from
`isValidHash`. Clients treat the value as opaque and copy it verbatim.

Keep `Cache-Control: no-transform`. The single-Build GET and PUT may emit a
strong ETag derived from the returned assignment ID, but no write consumes it.
Body and ETag must describe the same captured result. Internal outcome flags,
event metadata, and delivery state stay out of public Build JSON.

Discovery adds `buildAssignmentProtocolVersion: 2`. Absence means the old
protocol for client negotiation. Do not bump `CONTENT_CONTRACT_VERSION` for
this API change: that constant controls the compatibility marker embedded in
Releases, not the assignment HTTP protocol.

The portable store replaces `expectedRootHash` with `expectedAssignmentId`.
The facade and transaction scripts use the same explicit name; remove the
ambiguous `precondition` argument. Internal omission may retain unconditional
semantics, but every public/API/admin path requires a precondition. Change
local-target seeding to explicit null. Audit obligations apply to internal
changed assignments too.

## Storage reset and schema strategy

Use the existing format isolation mechanism: advance `FORMAT` from 3 to 4 and
document the assignment-schema reset in its history. This selects a fresh Node
`format-4` directory and Cloudflare `ContentAddressableStore#4` instance and
namespaces newly published content. Republish source content into format 4;
do not pretend old-format Release IDs are assignable in the new namespace.

Keep the established Durable Object base name and binding names. Do not rename
the class or hard-code a second namespace mechanism. Define the fresh Node
schema as version 3; Cloudflare creates the equivalent tables in its fresh
format namespace. Reopening either initialized store must preserve identities
and pending events. Incompatible schemas fail clearly rather than partially
booting or silently resetting data.

Old namespaces remain untouched by application startup. The rollout runbook
clears obsolete `Release` and `Activation` documents in the explicitly selected
document store during maintenance, before republishing. Preserve accounts,
publishing tokens, sessions, files, and all unrelated document types. Do not
delete a whole D1 database or `DATA_DIRECTORY`. No old history backfill and no
inference of missing actor/reason fields are part of the reset.

## Atomic assignment and pending-event contract

The ContentStore owns the indivisible pointer/event write. Extend its existing
port rather than inventing an independent outbox store whose transaction could
not cover the pointer.

The complete assignment input is:

`{ rootHash, expectedAssignmentId, metadata }`

`metadata` is a required plain JSON object whose values are strings. Snapshot
and validate it before asynchronous storage acquisition. Framework code treats
it as caller-owned metadata; it does not import application Activation types or
interpret reasons. The application supplies:

`{ eventType: 'activation', schemaVersion: '1', activatedBy, reason }`

Validate actor and reason before the pointer can move. Every real application
assignment caller must supply this metadata, including seed/internal workflows.
Do not put bearer tokens, request bodies, or mutable user records in it.

For a changed assignment, persist one event containing the immutable fields:

`{ assignmentId, buildId, rootHash, previousRootHash, assignedAt, metadata }`

Use a pending table with an internal increasing integer sequence for queue
ordering, unique assignment ID, immutable event fields, and separate mutable
delivery fields `attemptCount` and `nextAttemptAt`. The sequence is not a public
concurrency token. Index due-event selection; do not scan content closures.

Within one transaction: validate closure existence, read the pointer, compare
the identity, decide the no-op, then generate the ID/timestamp, update the
pointer, and insert the event. Any pointer or event insertion failure rolls
back both. No-op, conflict, and missing-closure outcomes create no event.

Node retains `BEGIN IMMEDIATE` through COMMIT with no intervening `await`.
Cloudflare wraps the synchronous production SQL helper in
`ctx.storage.transactionSync()` so an exception after the pointer update rolls
back that update as well as the event. Do not execute SQL BEGIN/COMMIT statements
through Cloudflare's SQL handle. See the
[Cloudflare storage transaction contract](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).

Keep discriminated results:

- `assigned`: captured `pointer`, `previousRootHash`, and the captured
  `assignmentEvent` for immediate delivery.
- `unchanged`: stored `pointer` and `previousRootHash`; no new event.
- `conflict` / `missingClosure`: outcome only.

Return success only after the storage commit guarantee. Never reread the
current pointer to reconstruct this operation's result or audit event. Do not
invalidate caches on no-op/failure; preserve changed-assignment invalidation.

Add narrowly scoped operations to the ContentStore port and expose them through
the ContentAddressableStore facade:

- `listPendingBuildAssignments(context, { dueBefore, limit })`: materialized
  immutable events due by the supplied timestamp, ordered by `nextAttemptAt`
  then internal sequence; limit 1–100, default 50.
- `acknowledgeBuildAssignment(context, assignmentId)`: idempotently remove only
  that delivered pending event. An absent event is success.
- `deferBuildAssignment(context, assignmentId, { nextAttemptAt })`: update only
  an existing pending event and increment its attempt count; never resurrect an
  acknowledged event. Concurrent deferrals must not move its due time earlier.
- `getPendingBuildAssignmentStats(context)`: pending count and oldest assignment
  timestamp for diagnostics, including events deferred into the future.

Pending-list results also carry the delivery fields needed to compute backoff.
Consume SQL cursors before any await. These internal APIs expose no public raw
cursor or unrestricted SQL. DeveloperContentStore continues to reject writes
and does not run a repair loop.

## Idempotent delivery and crash recovery

Keep the Activation Collection as the history read model. A new record includes
`assignmentId`. Derive its document ID inside the Collection as:

`build:<encodeURIComponent(buildId)>:assignment:<assignmentId>`

Encoding the build component avoids delimiter ambiguity. The ID is stable on
every delivery attempt and different for distinct assignments at the same
timestamp, including repeated assignments to the same Release.

`Activation.append()` creates the deterministic record. On
`DocumentAlreadyExistsError`, read it and verify every immutable audit field
matches; then treat the operation as successful without rewriting it. A
different payload under the same identity is an unexpected invariant failure.
Do not overwrite a conflicting audit record with `put()`. A failed/unconfirmed
read after a duplicate response is not permission to acknowledge the event.

Map event fields to `fromReleaseId`, `toReleaseId`, `activatedAt`, actor, and
reason. Keep existing primary and build-history sort keys; the unique document
ID supplies the tie-breaker for equal timestamps. Do not promise causal order
from wall-clock timestamps. Validate all new required fields on writes.

A small application transaction script owns delivery: append or confirm the
Activation, then acknowledge that exact pending event. The assignment script
attempts this immediately for its newly committed event. Expected delivery or
acknowledgement failures leave the assignment successful and its event pending;
log assignment identity and preserve the original cause. Unexpected failures
propagate under the project's fatal-error policy. A no-op creates and appends
nothing; background repair handles any older pending obligation independently.

| Interruption | Durable state and recovery |
| --- | --- |
| Before commit, including event-insert failure | Neither pointer change nor event survives |
| After commit, before Activation append | Pointer and pending event survive; repair delivers it |
| Activation committed, response/ack lost | Retry confirms the same deterministic document, then acknowledges |
| After acknowledgement | Activation survives; no pending obligation remains |
| A later assignment overwrites the pointer | Older pending events remain independently deliverable |

Multiple processes/invocations may deliver the same event. Correctness comes
from deterministic create-and-verify plus idempotent acknowledgement, not an
in-memory mutex or a distributed lease. Successful delivery means one logical
Activation per changed assignment; network attempts are at least once.

Repair processes bounded batches and defers operational failures using capped
exponential backoff (60 seconds initially, up to one hour). No maximum attempt
count and no silent discard/TTL. Other eligible events must make progress when
one event repeatedly fails. Do not sleep inside a batch. Report attempted,
delivered, deferred, pending count, and oldest pending age. Unexpected malformed
events remain pending and surface loudly; repair must not acknowledge them.

## Automatic execution

- Node: a runtime-owned runner calls the application repair script once after
  startup and every 60 seconds, without overlapping its own runs. Shutdown
  stops future runs and awaits in-flight work before closing stores, subject
  to the existing shutdown deadline. A restart rediscovers pending work from
  SQLite; timer memory is not the work ledger.
- Cloudflare: `scheduled(controller, env, ctx)` creates an execution context
  from the event's bindings and awaits the same application script. Configure
  a `* * * * *` Cron Trigger. Repeated/overlapping invocations are safe; pending
  work survives missed invocations. Follow the
  [scheduled-handler contract](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).
- Per-environment `ACTIVATION_DELIVERY` configuration owns enabled state, batch
  size, retry limits, and Node interval/Cloudflare schedule. Enable on writable
  deployments and local targets, disable for read-only development. Validate
  bounds at startup; no new secrets or per-deploy settings are needed.
- A scoped Node maintenance command runs one repair batch or reports backlog
  against its configured target using normal bootstrap and Collections. It
  never reassigns a build. Cloudflare uses its scheduled execution path; do not
  add an unauthenticated HTTP repair endpoint.

The external deployment CLI must provision/reconcile the Cron Trigger; merely
adding a handler does not schedule it. Its current supported Worker-version
keys do not include cron configuration, so do not invent a `WORKER_VERSION`
field. Document the agreed CLI configuration separately in RL1. Cloudflare
trigger changes can require propagation time; verify actual invocations before
calling automatic recovery operational. See
[Cron Trigger configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Task dependencies

`ID1 → ID2`; `ID1 → AU1 → AU2 → AU3`; `ID2 + AU3 → VR1 → RL1`.
Intermediate commits are not individually deployable. Complete the entire
assignment/audit path before rollout. ID1 and AU1 deliberately change internal
contracts before their consumer tasks. Run the full suite at each boundary;
record failures from unmigrated consumers against ID2 or AU2, fix unrelated
regressions immediately, and do not claim integrated validation until those
consumers pass. Do not add temporary compatibility paths to hide this staging.

Each task's touch points are orientation, not an exhaustive file allowance.
Record actual changed files, decisions, commands/results, and the next unfinished
step in its handoff. Mark acceptance boxes only after verification.

### Task ID1: Persist unique identities for atomic build assignments

**Status:** Complete
**Depends on:** None
**Documentation:** This plan, Assignment identity and Storage reset sections;
`src/plugins/README.md`; `src/kixx/content-addressable-store/content-store-interface.js`;
`src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`;
`src/docs/server-error-handling.md`; `test/unit-tests/README.md`.

**Objective**

Every changed assignment has a unique stored identity, and every conditional
storage write compares that identity atomically, closing the A→B→A hole.

**Scope**

- In: format-4 baseline, final fresh storage schema, identity validation, portable
  pointer/result contracts, facade, both adapters, affected test doubles.
- Out: public/admin request migration (ID2); audit events and repair (AU1–AU3).

**Design and invariants**

- Preserve the #153/#154 ordering, no-op, cache, and captured-result guarantees.
- Replace hash preconditions completely; do not accept both internal contracts.
- Add identity to pointer reads and lists without loading closure entries.
- Keep content-contract version 1; format 4 is a deliberate clean storage reset.
- Create the pending-event table and indexes specified above in this final fresh
  schema even though AU1 implements their use. Do not reuse schema version 3
  for a different table layout later in the plan.
- Reopen existing format-4 stores without changing their identities.

**Expected touch points**

- `src/kixx/content-addressable-store/addressing.js` — format history/reset.
- `src/kixx/content-addressable-store/build-assignment.js` — focused identity
  predicate and shared assignment types if needed; no application policy.
- `src/kixx/content-addressable-store/content-store-interface.js` and
  `content-addressable-store.js` — new pointer and argument contract.
- `src/plugins/node-content-store/lib/content-store.js` — fresh schema and CAS.
- `src/plugins/cloudflare-content-store/lib/assign-build.js`,
  `content-addressable-index-store.js`, and `content-store.js` — SQL/RPC results.
- Corresponding `test/unit-tests/kixx/content-addressable-store/` and
  `test/unit-tests/plugins/{node,cloudflare}-content-store/` tests.

**Acceptance criteria**

- [x] A→B→A produces three distinct IDs; a token from the first A fails.
- [x] Current-token no-op preserves exact historical timestamp and identity.
- [x] Stale/null same-target requests conflict; missing closures retain precedence.
- [x] Every successful result describes its own operation despite a later writer.
- [x] Failure releases Node locks and preserves state; two connections exercise
      stale tokens against committed state; no await occurs inside the transaction.
- [x] Fresh/reopened format-4 stores work; incompatible schemas fail explicitly.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — identity, SQL, facade, and cache regressions.
- `node run-linter.js src/kixx/content-addressable-store src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — style.
- `node run-tests.js` — full unit suite after internal contract migration.

**Progress and handoff**

- Completed: Format 4 and schema version 3; UUID identity validation, generation,
  atomic comparison, captured assignment results, pointer reads/lists, and fresh
  pending-event tables/indexes on both backends. Updated internal doubles and
  regression coverage for A→B→A, no-op identity/timestamp preservation, null/stale
  conflicts, missing-closure precedence, Node rollback/connection reuse,
  cross-connection CAS, schema rejection, and disk close/reopen on both SQL paths.
- Current state: Complete. No server or target was started and no external
  state was changed.
- Remaining: None for ID1. Begin ID2 by reading its documentation and migrating
  API/admin scripts, request handlers, forms, seed callers, and HTTP helpers.
  AU1 owns pending-event writes/queue operations; the tables are intentionally
  empty until then. Do not deploy this intermediate state.
- Decisions and discoveries:
  - Removed `precondition` (facade) and `expectedRootHash` (adapters) arguments
    assert rather than silently becoming unconditional writes. ID2 consumers
    still use the removed facade argument and must be migrated. Their unit
    doubles currently hide that integration gap despite the full suite passing.
  - Cloudflare schema initialization lives in `initialize-schema.js`, exercised
    through the real production SQL in the SQLite bridge. It uses a persisted
    `content_schema` version row, rejects incompatible/unversioned stores, and
    ignores SQLite/Cloudflare internal tables. Production initialization uses
    `ctx.storage.transactionSync()`. AU1 still must wrap assignment's future
    pointer-plus-event writes in transactionSync and test rollback.
  - Node uses `PRAGMA user_version = 3` in the format-4 directory. Existing
    format namespaces are untouched. CONTENT_CONTRACT_VERSION remains 1.
  - Reviewed Cloudflare's linked SQLite storage/transaction contract. SQL bridge
    and disk reopen tests are not Workers runtime evidence; RL1 retains that gate.
  - Stopped after this task because less than half the context remains, per the
    executor instructions.
- Actual files changed:
  - `src/kixx/content-addressable-store/addressing.js`
  - `src/kixx/content-addressable-store/build-assignment.js` (new)
  - `src/kixx/content-addressable-store/content-store-interface.js`
  - `src/kixx/content-addressable-store/content-addressable-store.js`
  - `src/plugins/node-content-store/lib/content-store.js`
  - `src/plugins/cloudflare-content-store/lib/assign-build.js`
  - `src/plugins/cloudflare-content-store/lib/initialize-schema.js` (new)
  - `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js`
  - `src/plugins/cloudflare-content-store/lib/content-store.js`
  - `test/unit-tests/kixx/content-addressable-store/addressing.test.js`
  - `test/unit-tests/kixx/content-addressable-store/build-assignment.test.js` (new)
  - `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
  - `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  - `test/unit-tests/plugins/node-content-store/lib/content-store.test.js`
  - `test/unit-tests/plugins/cloudflare-content-store/lib/assign-build.test.js`
  - `test/unit-tests/plugins/cloudflare-content-store/lib/content-store.test.js`
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/discovery.test.js`
    (format-4 expectation only)
  - `agents/plans/build-assignment-identity-and-durable-activations.md`
- Validation run:
  - Listed focused test command: 329 passed, 0 disabled.
  - Listed lint command plus
    `test/unit-tests/app/presentation/request-handlers/publishing-api/discovery.test.js`:
    passed without diagnostics.
  - `node run-tests.js`: 1,465 passed, 0 disabled. Initial stale format-3
    discovery expectation was corrected; final run has no failures.
  - `git diff --check`: passed.
  - Inspected Node BEGIN IMMEDIATE through COMMIT: no intervening await; UUID
    generation occurs only after closure/precondition/no-op checks.
- Blockers: None for ID2. Integrated publishing and durable audit delivery remain
  unfinished until the remaining tasks complete.

### Task ID2: Require JSON assignment tokens across public and admin workflows

**Status:** Not started
**Depends on:** ID1
**Documentation:** This plan, Assignment identity and public protocol;
`docs/publishing-api.md`; `src/app/presentation/README.md`;
`src/app/transaction-scripts/README.md`; `src/templates/README.md`;
`src/docs/frontend-development-guide.md`; code style/documentation/error guides;
`test/unit-tests/README.md`; `test/end-to-end/README.md`.

**Objective**

Clients and admin forms make conditional writes from the assignment identity
they observed, independently of response-header rewriting.

**Scope**

- In: API parsing, discovery, serialization, admin forms/templates, transaction
  script arguments, local seeding, all in-repository HTTP helpers and callers.
- Out: external CLI code (RL1 handoff), delivery changes (AU1–AU3).

**Design and invariants**

- Follow the exact protocol matrix above; distinguish absent from explicit null.
- Admin forms carry `expected_assignment_id` captured when the page renders.
  Never substitute a freshly read token at submission time. Retain the running
  build-ID guard and infer reason only from a pointer matching that token; the
  storage CAS remains authoritative if another write follows that read.
- Keep CSRF and permission checks. Reuse existing conflict notices.
- Preserve token-aware compare-and-swap in running-build E2E restoration; a
  concurrent assignment must prevent cleanup from overwriting newer state.
- Discovery versioning must not change Release compatibility.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/builds.js`,
  `discovery.js`, and `constants.js` — protocol and discovery.
- `src/app/transaction-scripts/publishing/assign-release.js` and
  `assign-release-to-running-build.js` — explicit identity argument.
- `src/app/presentation/forms/publishing/assign-release-form.js` and
  `request-handlers/admin-panel/admin-publishing.js` — captured form token.
- `src/pages/admin/publishing/page.html` and `releases/page.html` — hidden input.
- `tools/local-target/seed.js` — explicit first-assignment precondition.
- `test/end-to-end/test-helpers/publishing-workflows.js`, publishing E2E callers,
  and corresponding form, handler, transaction-script, and discovery unit tests.

**Acceptance criteria**

- [ ] GET/list/PUT Build JSON includes assignment identity; PUT enforces the matrix.
- [ ] Changed, weakened, missing, or proxy-generated GET ETags do not affect a
      subsequent write constructed from JSON.
- [ ] Old header-only writes fail and cannot silently bypass concurrency checks.
- [ ] An admin form from before A→B→A conflicts rather than reassigning the build.
- [ ] Public JSON excludes private event/delivery fields; body and ETag agree.
- [ ] All in-repository publishing callers and restoration paths use JSON tokens.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js test/unit-tests/app/presentation/forms/publishing test/unit-tests/app/transaction-scripts/publishing` — API and admin contracts.
- `rg -n 'expectedRootHash|expectedReleaseId|expected_release_id|ifMatch|ifNoneMatch' src tools test/end-to-end` — inspect remaining hits; retain only deliberate rejection tests or unrelated HTTP behavior.
- `node run-linter.js src/app/presentation src/app/transaction-scripts/publishing tools/local-target test/unit-tests/app test/end-to-end/200-publishing-api test/end-to-end/test-helpers/publishing-workflows.js` — affected JavaScript.
- `node run-tests.js` — full unit suite.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Current admin controls store a Release hash in two
  hidden inputs; changing only the Publishing API would leave that stale-write hole.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task AU1: Commit recoverable audit obligations with every changed pointer

**Status:** Not started
**Depends on:** ID1
**Documentation:** This plan, Atomic assignment and pending-event contract;
`src/plugins/README.md`; ContentStore interface; code style/documentation/error
guides; `test/unit-tests/README.md`; linked Cloudflare transaction documentation.

**Objective**

A committed pointer change always leaves enough durable information to create
its Activation, even if the process dies before returning to application code.

**Scope**

- In: metadata capture, use of ID1's pending-event schema, atomic pointer/event writes,
  captured event results, bounded listing, acknowledgement, deferral, and stats.
- Out: document projection (AU2), automatic execution (AU3), public event APIs.

**Design and invariants**

- Define metadata shape/serialization once at the portable boundary. Adapters
  store it without importing application business rules.
- No await or external I/O between pointer comparison and event insertion.
- Node uses its existing write transaction; Cloudflare must use transactionSync
  around the exact production helper, including both writes.
- Event insertion failure is assignment failure, never a logged delivery failure.
- Queue operations key on assignment ID, not the build's latest pointer.
- Deferral never recreates acknowledged work; no-op creates no duplicate event.

**Expected touch points**

- ContentStore interface and ContentAddressableStore facade — queue contract.
- Both content-store adapter schemas and assignment operations — event transaction.
- Adapter-local pending-assignment SQL modules where ownership/readability warrants.
- `test/unit-tests/plugins/cloudflare-content-store/lib/assign-build.test.js` —
  production SQL with transaction-capable Node SQLite bridge.
- Node adapter tests, shared conformance, facade tests, and affected doubles.

**Acceptance criteria**

- [ ] Every changed assignment atomically persists exactly one complete event.
- [ ] Failure injected after pointer update rolls back pointer and event on both
      backends; Node commit failure also returns no success.
- [ ] Pending events survive store close/reopen and later assignments.
- [ ] Input mutation after an await cannot change the captured actor/reason.
- [ ] Bounded due ordering, attempt count, defer/ack races, duplicate ack, and
      backlog statistics behave consistently across adapters.
- [ ] No-op/conflict/missing closure leave queue and caches untouched.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — transaction and queue conformance.
- `node run-linter.js src/kixx/content-addressable-store src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — style.
- `node run-tests.js` — full unit suite.
- Inspect Cloudflare transactionSync wiring; the SQLite bridge must execute
  production SQL and real rollback rather than reproducing assignment decisions.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The current synchronous Cloudflare helper performs
  one write; adding a second durable write requires explicit rollback coverage.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task AU2: Project pending assignments into one immutable Activation each

**Status:** Not started
**Depends on:** AU1
**Documentation:** This plan, Idempotent delivery and crash recovery;
`src/app/collections/README.md`; `src/app/transaction-scripts/README.md`;
code style/documentation/error guides; `test/unit-tests/README.md`.

**Objective**

Immediate delivery and retries create one logical Activation per assignment,
using only the immutable event captured by storage.

**Scope**

- In: deterministic Activation IDs, required identity fields, duplicate
  verification, event projection, assignment orchestration, bounded repair batch.
- Out: timer/scheduled entry points (AU3), legacy document migration, a new UI.

**Design and invariants**

- Validate app metadata before assignment; translate event fields through the
  application transaction script and persist through the Activation Collection.
- Duplicate create is success only after immutable payload verification.
- Acknowledge only confirmed durable documents; never drop work after timeouts.
- Immediate delivery handles its captured event, not a reread of the pointer.
- Operational failures remain retryable; unexpected failures propagate. Preserve
  causes and avoid classifying all caught exceptions as storage outages.
- Keep history query keys and pagination; explicitly test timestamp ties.

**Expected touch points**

- `src/app/collections/activation-collection.js` and `activation-record.js` —
  deterministic identity, validation, and duplicate handling.
- `src/app/transaction-scripts/publishing/assign-release.js` — metadata input,
  immediate projection, and successful-result preservation on delivery failure.
- `src/app/transaction-scripts/publishing/deliver-activation.js` and
  `repair-activations.js` — single-event delivery and bounded retry policy.
- Corresponding collection/script tests; caller doubles and local-target seed.

**Acceptance criteria**

- [ ] Repeated/concurrent delivery stores one document without mutating its fields.
- [ ] Same ID with different audit payload fails loudly and remains pending.
- [ ] First assignment records null predecessor; replacements use captured values.
- [ ] Append success followed by lost response/ack is safely retried.
- [ ] Valid no-op performs no append, even when an older pending event exists.
- [ ] A repeatedly failing event is deferred while unrelated due events progress.
- [ ] Two assignments in one millisecond remain distinct and paginate correctly.
- [ ] Public assignment success survives operational delivery/defer/ack failures;
      unexpected failures are not swallowed.

**Validation**

- `node run-tests.js test/unit-tests/app/collections test/unit-tests/app/transaction-scripts/publishing test/unit-tests/app/presentation/request-handlers/publishing-api` — idempotency and application behavior.
- `node run-linter.js src/app/collections src/app/transaction-scripts/publishing test/unit-tests/app/collections test/unit-tests/app/transaction-scripts/publishing` — style.
- `node run-tests.js` — full unit suite.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Collection.create() already distinguishes duplicate
  document IDs; its existing random ID generation is the duplication source.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task AU3: Run repair automatically on both deployment runtimes

**Status:** Not started
**Depends on:** AU2
**Documentation:** This plan, Automatic execution; `src/plugins/README.md`;
`docs/configuration.md`; code style/documentation/error guides;
`test/unit-tests/README.md`; linked Cloudflare scheduled-handler documentation.

**Objective**

Durable pending events are retried after process restarts or missed execution,
without another publishing request or manual intervention.

**Scope**

- In: Node runner lifecycle, Cloudflare scheduled handler, per-environment
  configuration, backlog diagnostics, scoped Node maintenance command.
- Out: external Cron Trigger provisioning (RL1), a generic job subsystem.

**Design and invariants**

- Entry points own runtime execution. Pass the application repair callback into
  the Node runner; adapters do not import application transaction scripts.
- Do not start background timers from ordinary application bootstrap used by
  local-target seeding and other one-shot tools.
- Stop/await the runner before appContext.close(); fatal repair errors invoke
  Node shutdown. Operational outages defer/retry and remain observable.
- Cloudflare uses event-provided bindings and awaits the batch. Unexpected
  failures reject scheduled execution rather than being reported as success.
- Batch size bounds invocation work; timer ticks do not overlap in one Node
  process. Cross-process/cross-invocation duplication remains safe via AU2.
- The read-only development configuration never touches pending-write methods.

**Expected touch points**

- `src/node-server.js` — start/stop lifecycle and fatal-error integration.
- `src/plugins/node-activation-delivery/lib/activation-delivery-runner.js` —
  runtime-specific timer owner, with injected callback/timer for tests.
- `src/cloudflare-server.js` — scheduled execution entry point.
- `src/node-config.js`, `src/cloudflare-config.js`, and `src/app/app.js` —
  configuration and validation as appropriate to ownership.
- `tools/repair-activations.js` — normal Node bootstrap, one batch/stats, cleanup.
- New runner, execution-handler, configuration, and maintenance-command tests.

**Acceptance criteria**

- [ ] Node startup discovers durable pending work before any new publish.
- [ ] Repeated timer ticks do not overlap; shutdown waits before closing stores.
- [ ] Cloudflare scheduled execution forwards its own bindings and awaits repair.
- [ ] Operational outages retain work for later execution; fatal errors surface.
- [ ] Backlog count/age and batch results are observable without logging secrets.
- [ ] Developer mode and one-shot bootstrap do not start timers.
- [ ] Maintenance repair leaves pointers/assignment identities unchanged.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-activation-delivery test/unit-tests/app/transaction-scripts/publishing test/unit-tests/tools` — runner, policy, and command tests; create the named runner test directory.
- `node run-linter.js src/node-server.js src/cloudflare-server.js src/node-config.js src/cloudflare-config.js src/app/app.js src/plugins/node-activation-delivery tools/repair-activations.js` — runtime code.
- `node run-tests.js` — includes any new Cloudflare execution/configuration tests.
- Use controlled timers and deferred promises for lifecycle tests; avoid sleeps.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Neither current entry point has scheduled audit
  work. Cloudflare Cron Trigger provisioning is a distinct deployment concern.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None for implementation; operational activation depends on RL1.

### Task VR1: Prove concurrency and recovery through the complete workflows

**Status:** Not started
**Depends on:** ID2, AU3
**Documentation:** This plan's protocol and crash matrices;
`README.md`; `test/unit-tests/README.md`; `test/end-to-end/README.md`.

**Objective**

Demonstrate that the new API detects intervening assignments and that audit
delivery recovers without duplicating or inventing history.

**Scope**

- In: deterministic failure tests, fresh-store/restart integration, Publishing
  API/admin HTTP coverage, and final local verification.
- Out: remote deployment and remote reset; rollout/runtime evidence belongs in RL1.

**Design and invariants**

- Use a disposable writable local target, never read-only developer-mode skips.
- Inject interruptions at commit, append, and acknowledgement boundaries using
  test-only adapters/hooks, not a public failure-control endpoint.
- Exercise real Node databases across restart, including a second assignment
  made before repairing the first event.
- Test production Cloudflare SQL through the existing bridge, but distinguish
  that from Workers transaction/scheduling behavior; record the runtime gap.
- Preserve the #153/#154 regression cases under the new token protocol.

**Expected touch points**

- `test/end-to-end/200-publishing-api/050-build-pointers.test.js` and
  `060-running-build.test.js` — JSON tokens, A→B→A, no-op, restoration.
- Admin HTTP tests — stale form identity and same-state return.
- New assignment-recovery integration tests under the applicable unit-test tree,
  or a standalone test harness if subprocess restart exceeds unit-test limits.
- Shared HTTP helpers and `test/end-to-end/README.md` — updated execution rules.

**Acceptance criteria**

- [ ] A stale A token fails after A→B→A over HTTP and through admin submission.
- [ ] Header rewriting/removal is simulated deterministically; body-token writes
      still succeed without consulting the ETag.
- [ ] Valid no-op preserves identity/timestamp and creates neither event nor row.
- [ ] Crash/reopen after pointer commit yields the missing Activation automatically.
- [ ] Lost append acknowledgement and concurrent repair yield one Activation.
- [ ] Repeated delivery failures retain obligations and allow other work to progress.
- [ ] Full unit suite, affected-file lint, and local publishing E2E pass with no
      relevant disabled cases; record counts and any runtime limitations.

**Validation**

- `node run-tests.js` — complete unit/fault-injection suite.
- `node run-linter.js` — final lint; distinguish unrelated pre-existing findings.
- `node tools/local-target.js create assignment-audit` — fresh isolated target;
  choose a different unused name if it exists.
- `node tools/local-target.js seed assignment-audit` — seed the new format.
- `node tools/local-target.js serve assignment-audit` — serve in its own session.
- Set `E2E_TESTS_BASE_URL`, `E2E_TESTS_ROOT_USERNAME`, and
  `E2E_TESTS_ROOT_PASSWORD` from credentials without printing secrets.
- `node run-tests.js --e2e test/end-to-end/200-publishing-api` — full local
  publishing workflow including token-aware restoration.
- Stop the server, then `node tools/local-target.js destroy assignment-audit`.
- `git diff --check` — final whitespace check.
- Record the exact additional admin/restart-harness commands implemented here
  in the handoff; the current repository has no existing restart harness.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: `test/README.md` is absent; the root README and
  unit/E2E guides define validation. No dependency installation is authorized.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None for local validation.

### Task RL1: Document the client transition and make rollout prerequisites explicit

**Status:** Not started
**Depends on:** VR1
**Documentation:** This plan; `docs/publishing-api.md`; `docs/configuration.md`;
`README.md`; linked Cloudflare Cron Trigger documentation.

**Objective**

An operator and the external CLI maintainer can coordinate the breaking change,
clean reset, and automatic-repair activation without guessing the contract.

**Scope**

- In: final API examples, CLI handoff, reset/rollback runbook, operational
  validation checklist, and accurate implementation handoff.
- Out: executing deployments/resets, changing the external CLI, or closing issues.

**Design and invariants**

- CLI handoff must specify discovery negotiation, format-4 publication, body
  tokens/null, all assignment modes (publish/carry-forward/rollback/restore),
  token-aware restoration, and read/reconcile on 412 or uncertain completion.
  No automatic unconditional retry and no hash/ETag fallback on protocol 2.
- The upgraded CLI may support both server generations via discovery, but a
  new server accepts only the new contract. Fail unsupported combinations
  before uploading content or changing infrastructure.
- CLI deployment support must reconcile the configured Cloudflare Cron Trigger,
  preserving unrelated triggers. Record its chosen configuration location and
  exact operational command once agreed with that repository; it is not an
  existing supported field of this application's WORKER_VERSION configuration.
- Treat format 4 as a clean cutover: pause old publishing/background writers,
  retain a valid API token, snapshot the selected publishing state, clear only
  obsolete Release/Activation documents, deploy the new server, republish and
  assign content with the upgraded CLI, enable/verify scheduling, then resume.
  Public rendering may be unavailable until the new build is assigned; plan
  the maintenance window accordingly.
- Document the scoped history reset SQL for the selected document database:
  `DELETE FROM documents WHERE type IN ('Release', 'Activation')`.
  Validate database identity and counts first and retain an export for recovery.
  Do not run it from application startup or this implementation plan.
- Old-format storage can remain for recovery. Rollback after new assignments
  requires restoring a coherent old server, pointer namespace, and history
  snapshot; do not mix old/new writer versions against a shared history store.

**Expected touch points**

- `docs/publishing-api.md` — JSON examples, discovery, no-op/retry/audit semantics.
- `docs/configuration.md` — activation-delivery settings and scheduling ownership.
- `docs/build-assignment-rollout.md` — external CLI handoff, reset, recovery,
  target-specific operational checklist, and runtime evidence.
- `README.md` — link the rollout/maintenance documentation where appropriate.
- This plan — actual files, completed acceptance checks, validation and blockers.

**Acceptance criteria**

- [ ] Documentation consistently uses the JSON identity contract and explains
      eventual history visibility during document-store outages.
- [ ] External CLI work is specified as a blocking rollout dependency, with a
      place to record its implementation revision and validation evidence.
- [ ] Reset scope, affected content, maintenance requirements, and recovery are
      explicit; accounts and unrelated application data are excluded.
- [ ] Runbook requires a real Cloudflare transaction/failure check and scheduled
      recovery with no publishing traffic, using an authorized test deployment.
- [ ] Runbook requires observed Cron Trigger invocations and Node restart recovery
      before claiming automatic repair operational.
- [ ] Repository implementation completion and unperformed operational gates are
      reported separately; missing remote evidence is never described as a pass.

**Validation**

- `rg -n 'If-Match|If-None-Match|expectedRootHash|expectedReleaseId|expected_release_id|best-effort|assignmentId' docs README.md src` — inspect references for stale claims; historical rejection notes may remain.
- `git diff --check` — document formatting.
- Walk API examples against VR1 results and trace each crash-matrix case to its test.
- Record external CLI revision, chosen target, exact deployment/scheduling
  commands, and Cloudflare runtime test results when rollout is authorized.
  This documentation task can finish with these gates explicitly pending;
  deployment readiness cannot.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: User chose a separate CLI follow-up. No CLI repository
  was placed in scope, and no remote deployment/reset was requested.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None for documentation. Rollout depends on the external CLI upgrade,
  trigger provisioning, selected target/maintenance coordination, and runtime checks.
