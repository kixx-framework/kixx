# Implementation Approach

Prevent stale publishing requests and admin forms from overwriting intervening
build assignments (#152). Each changed assignment gets a unique stored UUID;
clients send the observed identity in JSON, and storage compares it atomically.
Keep Activation history best-effort. A missing history record does not affect
serving content, the next publish, or assignment concurrency, and is accepted.

ID1 and ID2 are complete in `db02d967` and `99048d15`. CL1 is next. Remaining
work removes unused audit scaffolding, verifies the reduced scope, and documents
the breaking client transition. Baseline: `ff3e9e65` on `fix-publishing`.
Preserve the #153/#154 fixes: check preconditions before no-op detection and
return operation-owned metadata without rereading a later writer's pointer.

The filename is retained so existing references remain valid; durable Activation
delivery is no longer the objective. This plan no longer promises to implement
#155's audit-delivery guarantees. No GitHub issue status has been changed.

## Scope revision — 2026-09-19

The user explicitly rejected repairing missing Activation history: its value
does not justify the complexity. This supersedes the 2026-09-18 automatic-repair
decision and all earlier recovery requirements in this plan.

- Remove AU1, AU2, and AU3 from execution. Their IDs are retired, not completed
  or blocked, and must not be reused for unrelated tasks.
- Remove durable events, metadata envelopes, queue APIs, acknowledgements,
  deferral/backoff, deterministic duplicate verification, recovery scripts,
  Node timers, Cloudflare scheduled handlers/Cron Triggers, delivery settings,
  backlog metrics, maintenance commands, and recovery-specific tests.
- Do not substitute manual repair, lazy repair on the next publish, or another
  queue mechanism. Missing or unconfirmed Activation writes may remain missing.
- Keep the agreed JSON-token transition with no legacy write compatibility path.
  Keep the allowed format-4 clean reset; do not add migrations or backfill.
- External CLI work remains outside this repository. No deployment, remote
  reset, dependency installation, or issue modification is authorized here.

## Complexity review

| Item | Problem and value | Decision |
| --- | --- | --- |
| ID1: assignment UUID and atomic comparison | Release hashes miss A→B→A; stale writers can overwrite newer publication decisions. One identity column and comparison protect actual content changes. | Keep completed work. |
| ID1: timestamp/no-op, captured results, cache rules | False success metadata or unnecessary invalidation misrepresents writes and invites unsafe retries. | Keep existing guarantees; no extra abstraction. |
| ID1: format 4 and schema checks | Old pointers lack identities. A clean namespace is simpler than identity backfill and already uses existing format isolation. | Keep; no second format bump for audit cleanup. |
| ID1: pending-event tables | Prepare for recovery that is no longer wanted. They currently have no writer or reader. | Remove fresh-schema creation in CL1; no migration to drop inert old tables. |
| ID2: JSON token, validation, discovery | Correctness must survive transformed/missing ETags; clients need to recognize a breaking protocol before writing. | Keep completed work; one supported write protocol. |
| ID2: admin hidden token and running-build guard | A stale page can overwrite changes or target a different deploy. Small checks reuse existing form and conflict handling. | Keep completed work. |
| ID2: seeding and conditional restoration | Callers must use the same contract; test cleanup must not overwrite concurrent writes. | Keep completed work. |
| ID2: ETag/no-transform | Existing response metadata; writes no longer depend on it. | Keep current behavior; add no proxy negotiation or fallback. |
| AU1: atomic pointer/event outbox and four queue operations | Prevents missing history after a crash; adds another durable write and cross-platform queue semantics. No publishing correctness benefit. | Remove. |
| AU2: deterministic audit IDs, duplicate checks, delivery/retry scripts | Makes repeated recovery attempts safe. Those attempts no longer exist. | Remove; keep current Collection IDs and single append attempt. |
| AU3: timers, schedules, shutdown coordination, configuration and diagnostics | Runs recovery without traffic; creates ongoing operational requirements for low-value history. | Remove entirely, including manual repair. |
| VR1: concurrency/protocol tests | Demonstrates protection against content overwrite and checks callers use the contract. Most coverage already exists from ID1/ID2. | Narrow to evidence review and regression checks after CL1; reuse tests. |
| VR1: crash/ack/retry/restart harnesses | Proves the discarded history guarantee. | Remove; retain existing pointer persistence/rollback tests. |
| RL1: client handoff and scoped cutover notes | Breaking API and format changes can prevent publication or serving content if mixed incorrectly. | Keep a concise handoff and cutover checklist; no new deployment tooling. |
| RL1: cron provisioning and recovery runtime gates | Exists only to operate audit repair. | Remove. Record ordinary platform-test limits without a new recovery validation project. |

## Best-effort Activation contract

Keep `assign-release.js`'s current sequence: validate actor/reason, commit the
assignment, then attempt one Activation append using the captured predecessor,
Release and timestamp. A valid no-op, conflict, or missing Release appends nothing.

Recognized operational append failures are logged with the cause while the
successful assignment result is returned. Unexpected failures still propagate
under the project's error policy; do not broaden exception swallowing. A crash
between commit and append may leave no Activation. A timeout may leave its
presence uncertain. Neither creates persistent work or triggers a retry.

The build pointer and assignment identity remain authoritative. History is
informational, not a prerequisite for publishing. Keep existing Activation
fields, random document IDs, and pagination. Adding assignmentId to Activation
records or changing their IDs is unnecessary for this scope. Do not describe
history as complete or guaranteed to appear eventually.

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
and predecessor metadata stay out of public Build JSON.

Discovery adds `buildAssignmentProtocolVersion: 2`. Absence means the old
protocol for client negotiation. Do not bump `CONTENT_CONTRACT_VERSION` for
this API change: that constant controls the compatibility marker embedded in
Releases, not the assignment HTTP protocol.

The portable store replaces `expectedRootHash` with `expectedAssignmentId`.
The facade and transaction scripts use the same explicit name; remove the
ambiguous `precondition` argument. Internal omission may retain unconditional
semantics, but every public/API/admin path requires a precondition. Change
local-target seeding to explicit null.

## Storage reset and cleanup strategy

Retain FORMAT 4, the existing Node `format-4` directory and Cloudflare
`ContentAddressableStore#4` instance, and the existing binding/class names.
Republish content into the new namespace; do not assign old-format Releases.
CONTENT_CONTRACT_VERSION remains 1; assignment protocol version remains 2.

Keep schema version 3 and its required pointer identity columns/version checks.
CL1 removes only unused auxiliary pending-table/index creation from fresh stores.
Existing ID1/ID2 format-4 stores may retain those unused tables; their presence
is harmless and must not prevent reopening. No code reads, writes, or drops them.
This explicitly supersedes ID1's requirement to retain that auxiliary layout.
No new format bump, startup cleanup, migration framework, or deployed-data reset
is needed merely to stop creating an unused table.

The format-3 to format-4 cutover still needs a coordinated client upgrade and
republish. Retain the previously agreed narrowly scoped Release/Activation reset
in the operator notes so old-format Releases are not offered as assignable.
Preserve accounts, publishing tokens, sessions, files, and unrelated documents.
No startup deletion or whole-database/DATA_DIRECTORY reset. Rollout is not part
of implementation; retain old namespaces for recovery.

## Atomic pointer contract

Keep the implemented assignment input `{ rootHash, expectedAssignmentId }`.
The portable content store receives no actor/reason metadata and knows nothing
about Activation documents. Within the atomic operation: check closure existence,
read the pointer, compare identity, detect no-op, then generate UUID/timestamp
and update the pointer. Return only after the commit guarantee.

Keep `assigned` and `unchanged` results with captured `pointer` and
`previousRootHash`; `conflict` and `missingClosure` carry only their outcome.
No pending event or delivery state belongs in this contract. Preserve Node's
synchronous write transaction and Cloudflare's synchronous single-write helper.
No extra two-write transaction machinery is required.

## Task dependencies

`ID1 → ID2 → CL1 → VR1 → RL1`.

ID1/ID2 completion evidence below is retained. AU1–AU3 were removed by the scope
revision, not executed. Do not implement their old specifications from history.
At most one remaining task is In progress. This revision changes the plan only;
CL1's source cleanup has not started. Repository completion and external client
rollout readiness are separate claims.

Planning review evidence: working tree was clean at 99048d15; inspected both
schema definitions, Activation Collection/Record, the assignment script, and
existing tests. Only this plan changed. Checked task dependencies, required task
sections, and whitespace. No runtime tests were needed for this document edit.

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
- Out: public/admin request migration (ID2). Audit recovery was removed by the
  scope revision below; CL1 removes its unused schema scaffolding.

**Design and invariants**

- Preserve the #153/#154 ordering, no-op, cache, and captured-result guarantees.
- Replace hash preconditions completely; do not accept both internal contracts.
- Add identity to pointer reads and lists without loading closure entries.
- Keep content-contract version 1; format 4 is a deliberate clean storage reset.
- Historical scope included unused pending-event tables and indexes. CL1
  removes their creation; retain the required identity schema and its version.
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

These completion notes record the implementation at its task boundary. The
2026-09-19 scope revision and CL1 supersede references to future audit recovery.

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
  At that boundary AU1 was planned to use the empty pending tables. That work
  is now removed; CL1 removes fresh-store creation of those unused tables.
- Decisions and discoveries:
  - Removed `precondition` (facade) and `expectedRootHash` (adapters) arguments
    assert rather than silently becoming unconditional writes. At the ID1
    boundary, consumer doubles hid an integration gap; ID2 subsequently migrated
    those consumers and verified the real HTTP workflows.
  - Cloudflare schema initialization lives in `initialize-schema.js`, exercised
    through the real production SQL in the SQLite bridge. It uses a persisted
    `content_schema` version row, rejects incompatible/unversioned stores, and
    ignores SQLite/Cloudflare internal tables. Production initialization uses
    `ctx.storage.transactionSync()`. The proposed second assignment write and
    its transaction wrapper are no longer needed; assignment remains one write.
  - Node uses `PRAGMA user_version = 3` in the format-4 directory. Existing
    format namespaces are untouched. CONTENT_CONTRACT_VERSION remains 1.
  - Reviewed Cloudflare's SQLite storage/transaction contract. SQL bridge and
    disk reopen tests are not Workers runtime evidence; report that limitation
    without the now-removed recovery-runtime gate.
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
- Blockers: None at the ID1 boundary. ID2 subsequently completed.

### Task ID2: Require JSON assignment tokens across public and admin workflows

**Status:** Complete
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
- Out: external CLI code (RL1 handoff); best-effort audit behavior stays as-is.

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

- [x] GET/list/PUT Build JSON includes assignment identity; PUT enforces the matrix.
- [x] Changed, weakened, missing, or proxy-generated GET ETags do not affect a
      subsequent write constructed from JSON.
- [x] Old header-only writes fail and cannot silently bypass concurrency checks.
- [x] An admin form from before A→B→A conflicts rather than reassigning the build.
- [x] Public JSON excludes private event/delivery fields; body and ETag agree.
- [x] All in-repository publishing callers and restoration paths use JSON tokens.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js test/unit-tests/app/presentation/forms/publishing test/unit-tests/app/transaction-scripts/publishing` — API and admin contracts.
- `rg -n 'expectedRootHash|expectedReleaseId|expected_release_id|ifMatch|ifNoneMatch' src tools test/end-to-end` — inspect remaining hits; retain only deliberate rejection tests or unrelated HTTP behavior.
- `node run-linter.js src/app/presentation src/app/transaction-scripts/publishing tools/local-target test/unit-tests/app test/end-to-end/200-publishing-api test/end-to-end/test-helpers/publishing-workflows.js` — affected JavaScript.
- `node run-tests.js` — full unit suite.

**Progress and handoff**

These completion notes record the implementation at its task boundary. The
2026-09-19 scope revision and CL1 supersede references to future audit recovery.

- Completed: Build GET/list/PUT expose assignmentId, single-Build ETags use the
  captured identity, and PUT requires JSON expectedAssignmentId (explicit null
  for first assignment). Discovery advertises protocol 2 while Release contract
  version remains 1. Both admin forms capture expected_assignment_id, validate
  the UUID, and retain it through the running-build guard and storage CAS.
  Seed and all in-repository HTTP assignment/restoration callers are migrated.
  API documentation and E2E operating notes describe the new contract.
- Current state: Complete. ID1 was verified at db02d967
  before starting with a clean tree. Stopped here at the user's explicit ID2
  boundary. The disposable assignment-id2 target was stopped and destroyed.
- Remaining: None for ID2. CL1 is next under the revised scope. Best-effort
  audit writes are now the intended final behavior.
- Decisions and discoveries:
  - Required-field presence is distinct from null. Malformed supplied tokens
    produce a field ValidationError; missing tokens produce 428 after existing
    resource validation. Valid JSON tokens plus either legacy conditional header
    (including an empty header) produce 400 without calling storage.
  - Assignment tokens are copied verbatim; the hidden form UUID is not trimmed.
    An admin submission must match the observed identity before reason inference,
    and still passes that same token to storage if a later writer intervenes.
  - The application assignment script now requires a valid UUID or explicit null;
    only the lower-level framework facade retains unconditional omission.
  - ETag interference is simulated deterministically in unit tests (changed,
    weak, absent, proxy-generated). Real HTTP checks cover API A→B→A, no-op,
    listing identity, and both rendered admin forms after A→B→A.
  - New 070-admin-assignment.test.js uses the running build. It captures both
    forms while the original Release is served, temporarily assigns a fixture,
    returns to the original Release, then submits the stale forms. Its failure
    cleanup uses only its own successful assignment's token. E2E README now
    identifies both running-build tests and their temporary rendering impact.
  - Cloudflare runtime evidence remains an operational limitation. Audit-recovery
    checks were removed in the scope revision. No remote
    target, external CLI, deployment, or dependency installation was touched.
- Actual files changed:
  - `agents/plans/build-assignment-identity-and-durable-activations.md`
  - `docs/publishing-api.md`
  - `src/app/presentation/forms/publishing/assign-release-form.js`
  - `src/app/presentation/request-handlers/admin-panel/admin-publishing.js`
  - `src/app/presentation/request-handlers/publishing-api/builds.js`
  - `src/app/presentation/request-handlers/publishing-api/constants.js`
  - `src/app/presentation/request-handlers/publishing-api/discovery.js`
  - `src/app/transaction-scripts/publishing/assign-release-to-running-build.js`
  - `src/app/transaction-scripts/publishing/assign-release.js`
  - `src/pages/admin/publishing/page.html`
  - `src/pages/admin/publishing/releases/page.html`
  - `test/end-to-end/200-publishing-api/050-build-pointers.test.js`
  - `test/end-to-end/200-publishing-api/060-running-build.test.js`
  - `test/end-to-end/README.md`
  - `test/end-to-end/test-helpers/publishing-workflows.js`
  - `test/unit-tests/app/presentation/forms/publishing/assign-release-form.test.js`
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/builds.test.js`
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/discovery.test.js`
  - `test/unit-tests/app/transaction-scripts/publishing/assign-release-to-running-build.test.js`
  - `test/unit-tests/app/transaction-scripts/publishing/assign-release.test.js`
  - `tools/local-target/seed.js`
  - `test/end-to-end/200-publishing-api/070-admin-assignment.test.js` (new)
- Validation run:
  - Listed focused unit command: 70 passed, 0 disabled.
  - Listed lint command: passed without diagnostics, including the new admin
    HTTP test. Initial test formatting findings were fixed.
  - `node run-tests.js`: 1,472 passed, 0 disabled.
  - Listed `rg` audit: only ID1's explicit legacy-argument rejection, unrelated
    HTTP cache validators, and negative assertions that the old HTML field is
    absent remain. No publishing caller uses header/hash preconditions.
  - `node tools/local-target.js create assignment-id2` and
    `node tools/local-target.js seed assignment-id2`: passed, proving explicit
    null seeding on a writable format-4 store.
  - `node tools/local-target.js serve assignment-id2`: started for HTTP checks.
  - `node run-tests.js --e2e test/end-to-end/200-publishing-api`: 40 passed,
    0 disabled, including 070-admin-assignment.test.js. A Node wrapper read
    credentials.json and passed baseUrl/username/password through the three
    E2E_TESTS_* environment variables without printing secrets.
  - Local port reservation and HTTP connections initially hit sandbox EPERM;
    approved retries passed. These were environment restrictions, not test skips.
  - Stopped the server with Ctrl-C, then
    `node tools/local-target.js destroy assignment-id2`: passed.
  - `git diff --check`: passed.
- Blockers: None for CL1. Rollout still depends on client compatibility; durable
  audit delivery is no longer a requirement.

### Task CL1: Remove unused durable-audit schema scaffolding

**Status:** Complete
**Depends on:** ID2
**Documentation:** This plan, Best-effort Activation contract and Storage reset
and cleanup strategy; `src/plugins/README.md`; code style/documentation/error
guides; `test/unit-tests/README.md`.

**Objective**

Fresh stores contain only the structures needed by the retained assignment
behavior. Remove the unused preparation for audit recovery without changing
publishing or requiring another reset.

**Scope**

- In: pending-table/index creation, associated schema assertions, format-history
  wording, and tests for reopening stores with or without the unused tables.
- Out: audit delivery changes, migrations, runtime configuration, remote cleanup.

**Design and invariants**

- Remove creation of `pending_build_assignments` and its due index from both
  adapters. No production code has populated or consumed these tables.
- Keep FORMAT 4, schema version 3, required identity columns, schema checks, and
  current assignment behavior. Extra unused tables in an existing format-4
  store are tolerated; do not drop them at startup or reject that store.
- Keep the current one-attempt best-effort Activation append. No deterministic
  audit identity, metadata envelope, queue port, or repair command is needed.
- Update only tests asserting the removed scaffolding. Retain pointer rollback,
  persistence, A→B→A, no-op, and incompatible required-schema coverage.

**Expected touch points**

- `src/plugins/node-content-store/lib/content-store.js` — fresh Node schema.
- `src/plugins/cloudflare-content-store/lib/initialize-schema.js` — fresh DO schema.
- `src/kixx/content-addressable-store/addressing.js` — remove durable-event claim
  from format-4 history; retain the assignment-identity reset explanation.
- `test/unit-tests/plugins/node-content-store/lib/content-store.test.js` and
  `test/unit-tests/plugins/cloudflare-content-store/lib/assign-build.test.js` —
  schema expectations and existing-store reopen coverage.

**Acceptance criteria**

- [x] Fresh stores create neither a pending table nor a pending-event index.
- [x] Fresh and previously initialized format-4 stores preserve assignment
      identities and reopen successfully, including stores with inert old tables.
- [x] Required-schema incompatibility still fails explicitly.
- [x] No recovery runtime, queue API, or audit-schema change is introduced.
- [x] Focused/full tests and affected-file lint pass; format history is accurate.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store` — schema and assignment regressions.
- `node run-linter.js src/plugins/node-content-store src/plugins/cloudflare-content-store src/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — includes changed schema tests.
- `node run-tests.js` — complete unit suite.
- `git diff --check` — whitespace.

**Progress and handoff**

- Completed: Removed `pending_build_assignments` and its due index from the
  fresh Node and Cloudflare schemas, corrected the format-4 history comment,
  and replaced the three tests that asserted the removed scaffolding.
- Current state: Complete. No server or target was started; no external state
  changed.
- Remaining: None for CL1. VR1 is next.
- Decisions and discoveries:
  - Both adapters already tolerate extra tables: Node returns early once
    `PRAGMA user_version` matches, and Cloudflare's `initializeSchema` only
    requires a `content_schema` row at the supported version. No code change
    was needed to accept stores that still hold the inert table.
  - Node and Cloudflare tests now assert no `pending_build_assignments*` object
    exists in `sqlite_master` after a fresh initialization, and each gained one
    test proving a store carrying that inert table reopens with its assignment
    identity intact.
  - Schema version stays 3 and FORMAT stays 4. Dropping the table would have
    required a migration path, which the scope revision rejects.
- Actual files changed:
  - `src/plugins/node-content-store/lib/content-store.js`
  - `src/plugins/cloudflare-content-store/lib/initialize-schema.js`
  - `src/kixx/content-addressable-store/addressing.js`
  - `test/unit-tests/plugins/node-content-store/lib/content-store.test.js`
  - `test/unit-tests/plugins/cloudflare-content-store/lib/assign-build.test.js`
  - `agents/plans/build-assignment-identity-and-durable-activations.md`
- Validation run:
  - Listed focused test command: 331 passed, 0 disabled.
  - Listed lint command: passed without diagnostics.
  - `node run-tests.js`: 1,474 passed, 0 disabled.
  - `git diff --check`: passed.
- Blockers: None.

### Task VR1: Verify assignment correctness under the reduced scope

**Status:** Not started
**Depends on:** CL1
**Documentation:** This plan, Assignment identity and Best-effort Activation
contract; `README.md`; `test/unit-tests/README.md`; `test/end-to-end/README.md`.

**Objective**

Confirm the retained implementation prevents stale writes and remains usable
when history recording fails. Reuse completed coverage rather than building a
new failure-injection or recovery harness.

**Scope**

- In: review ID1/ID2 evidence, fill concrete coverage gaps, and verify the final
  cleaned-up state with the existing local publishing/admin workflows.
- Out: retry/acknowledgement tests, recovery runners, subprocess crash harnesses,
  remote deployments, new queues or general test infrastructure.

**Design and invariants**

- Preserve the #153/#154 precondition/no-op/captured-result regressions.
- Reuse existing SQL bridge, Node persistence tests, ETag-interference unit
  tests, and HTTP 050/060/070 workflows. Most acceptance behavior already passes.
- Check the existing operational append-failure test preserves assignment
  success, and unexpected exceptions still propagate. Add only missing proof
  that a subsequent publish relies on its pointer identity, not audit history.
- Use a disposable writable target. Restoration must use the test's captured
  token; never overwrite an intervening publisher during cleanup.
- SQL bridge tests do not prove Workers runtime behavior. Record that limit;
  do not replace the removed recovery work with a new platform-testing project.

**Expected touch points**

- Existing assignment facade/adapter and publishing transaction-script tests.
- `test/end-to-end/200-publishing-api/050-build-pointers.test.js`,
  `060-running-build.test.js`, and `070-admin-assignment.test.js` — existing HTTP
  coverage; edit only for a concrete gap or failure.
- This plan — final validation evidence and limitations.

**Acceptance criteria**

- [ ] API and admin A→B→A stale-token rejection remains covered and passing.
- [ ] JSON-based writes remain independent of GET ETag changes/removal.
- [ ] Valid no-op preserves identity/timestamp and appends no Activation.
- [ ] An operational Activation failure does not fail a committed assignment or
      prevent a later valid publish; unexpected failures are not swallowed.
- [ ] Full unit suite, affected-file lint, and local publishing HTTP suite pass
      without relevant disabled cases. No audit-recovery guarantee is claimed.

**Validation**

- Use CL1's full-unit/lint results if no subsequent source changes invalidate
  them. Run `node run-tests.js` and affected-file lint after any test/code edits.
- `node tools/local-target.js create assignment-identity` — unused disposable name.
- `node tools/local-target.js seed assignment-identity` — explicit-null bootstrap.
- `node tools/local-target.js serve assignment-identity` — separate server session.
- Set E2E_TESTS_BASE_URL, E2E_TESTS_ROOT_USERNAME, and E2E_TESTS_ROOT_PASSWORD from
  credentials.json without printing secrets.
- `node run-tests.js --e2e test/end-to-end/200-publishing-api` — existing HTTP suite.
- Stop the server, then `node tools/local-target.js destroy assignment-identity`.
- `git diff --check` — whitespace.

**Progress and handoff**

- Completed: Prior evidence available from ID1/ID2: 1,472 unit tests and 40 local
  HTTP tests passed at ID2, including stale overview/detail forms and restoration.
- Current state: Not started for the reduced final scope.
- Remaining: Review existing evidence, close any concrete best-effort behavior
  gap, and verify the state after CL1. Do not reproduce already proven cases.
- Decisions and discoveries: `assign-release.test.js` already checks operational
  append failure, unexpected failure propagation, and no-op suppression.
- Actual files changed: None yet.
- Validation run: No new runs for this revised task; prior counts above are
  historical, not validation of unimplemented CL1.
- Blockers: None after CL1.

### Task RL1: Document the breaking client transition and accepted audit limits

**Status:** Not started
**Depends on:** VR1
**Documentation:** This plan; `docs/publishing-api.md`; `docs/configuration.md`;
`README.md`.

**Objective**

Give the external CLI maintainer and operator the minimum precise information
needed to use protocol 2 and cut over to format 4, with honest audit semantics.

**Scope**

- In: API examples, concise external CLI handoff, scoped cutover/rollback notes,
  and final implementation evidence.
- Out: CLI implementation, deploying, executing resets, scheduling, repair
  commands, new runtime settings, and issue status changes.

**Design and invariants**

- Specify protocol discovery, format-4 publication, JSON UUID/null tokens for
  publish/carry-forward/rollback/restore, and read/reconcile after 412 or an
  uncertain response. No unconditional retries or hash/ETag fallback on v2.
- The CLI must identify unsupported server versions before writes. Supporting
  both generations in the external CLI is its choice, not a requirement for
  new compatibility code in this repository.
- Keep the cutover checklist short: pause old publishers, retain a valid token,
  snapshot the selected publishing state, reset only obsolete Release/Activation
  documents, deploy the new server, republish/assign via the upgraded client,
  verify serving, then resume. Rendering may be unavailable until assignment.
- If documenting reset SQL, scope it to the selected document database:
  `DELETE FROM documents WHERE type IN ('Release', 'Activation')`. Verify target
  and counts and preserve an export. Never delete accounts, sessions, tokens,
  files, whole databases, or DATA_DIRECTORY. Do not execute reset in this task.
- Retain old namespaces. Rollback after new assignments requires a coherent
  old server, pointer namespace, and history snapshot; do not mix writer versions.
- State that Activation history is best-effort and may have permanent gaps.
  Missing history neither blocks the next publish nor triggers repair.
- No Cron Trigger, scheduled handler, delivery config, backlog monitoring, or
  repair-runtime evidence is a rollout prerequisite.

**Expected touch points**

- `docs/publishing-api.md` — final protocol examples and best-effort history limits.
- `docs/build-assignment-rollout.md` — short client handoff and cutover checklist.
- `README.md` — link the cutover notes if useful to deployment operators.
- `docs/configuration.md` — only if existing format/client documentation needs
  correction; no new setting or scheduling section.
- This plan — actual files, validation, completion, external dependency.

**Acceptance criteria**

- [ ] API documentation consistently uses JSON identities and explicitly permits
      permanent gaps in Activation history; no eventual-delivery promise remains.
- [ ] External CLI upgrade is the explicit compatibility dependency, with space
      to record its revision and target validation when rollout is authorized.
- [ ] Format-4 cutover/reset scope, temporary availability impact, preservation
      of unrelated data, and rollback are documented without new tooling.
- [ ] No audit-recovery or scheduling gate remains. Local test evidence and
      unperformed platform/remote checks are distinguished accurately.

**Validation**

- `rg -n 'If-Match|If-None-Match|expectedRootHash|expectedReleaseId|expected_release_id|best-effort|assignmentId' docs README.md src` — inspect stale protocol claims; explicit rejection and unrelated HTTP caching may remain.
- Review examples against ID2/VR1 and the best-effort assignment script.
- `git diff --check` — formatting.
- Record external CLI revision and target smoke evidence only when provided or
  authorized. This documentation task can complete with that dependency pending;
  do not claim deployment readiness without a compatible client.

**Progress and handoff**

- Completed: ID2 already updated protocol examples in docs/publishing-api.md;
  retain those and add only the missing best-effort and transition details.
- Current state: Not started for the revised task.
- Remaining: Concise handoff/cutover notes and accepted audit-loss semantics.
- Decisions and discoveries: External CLI work remains outside this repository.
  No deployment or data reset is authorized by this planning revision.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None for documentation. Rollout requires the external CLI upgrade
  and an explicitly selected target/maintenance window, not audit recovery.
