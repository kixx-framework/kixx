# Implementation Approach

Fix [#153](https://github.com/kixx-framework/kixx/issues/153) and
[#154](https://github.com/kixx-framework/kixx/issues/154) as one assignment-path
change: the storage operation checks the precondition, decides whether anything
changes, and returns the metadata for that exact operation. Node SQLite and the
Cloudflare Durable Object must provide the same contract.

The user agreed on 2026-09-18 that assigning the already-current Release is a
successful no-op **only after the precondition passes**. Preserve the pointer
and its timestamp, and append no Activation. A stale precondition fails even
when the requested Release happens to be current.

This document is the implementation specification and handoff for these two
issues. Implementation has not started. Do not use the older publishing plans
as the current API specification; the current endpoint is
`PUT /publishing-api/v1/builds/:buildId`.

## Boundaries and follow-up work

- Keep the existing public Build JSON shape, HTTP precondition syntax, status
  codes, and content-hash comparison for this work. No schema migration is
  required.
- [#152](https://github.com/kixx-framework/kixx/issues/152) owns assignment
  identity, JSON-carried concurrency tokens, client migration, and A→B→A
  detection. These fixes alone cannot detect A→B→A and do not solve CDN ETag
  rewriting. When identity is added, valid no-ops must preserve it too.
- [#155](https://github.com/kixx-framework/kixx/issues/155) owns durable audit
  delivery, deterministic audit IDs, and repair/retry infrastructure. This
  plan fixes its inaccurate predecessor/timestamp inputs as a small consequence
  of returning atomic write metadata, but does not close #155.
- No new dependencies, deployment, GitHub edits, or external CLI changes are
  part of this plan. Application logic stays platform-neutral.

## Assignment contract

Keep `assignBuild(context, buildId, { rootHash, expectedRootHash })` inputs.
Replace the bare outcome string with a discriminated result object:

| Outcome | Result fields | Meaning |
| --- | --- | --- |
| `assigned` | `outcome`, `pointer: { rootHash, assignedAt }`, `previousRootHash` | A new pointer was committed; predecessor is a hash or `null` for first assignment. |
| `unchanged` | `outcome`, `pointer: { rootHash, assignedAt }`, `previousRootHash` | Precondition passed and target was already current; predecessor equals `pointer.rootHash`. |
| `conflict` | `outcome` | Explicit precondition failed; no mutation. |
| `missingClosure` | `outcome` | Target closure is absent; no mutation. |

Add `UNCHANGED` to `BUILD_ASSIGNMENT_OUTCOME` and document a
`ContentBuildAssignmentResult` typedef separately from the outcome enum.
Cloudflare's internal RPC envelope adds `success: true` to these fields; its
ContentStore adapter returns only the portable result fields.

The synchronous storage operation has this order:

1. Validate internal arguments before touching storage.
2. Verify the target closure exists. Preserve the current `missingClosure`
   precedence if the target is missing and the precondition also fails.
3. Read the current pointer inside the atomic operation and compare the
   explicit precondition: a string must match `rootHash`, `null` requires
   absence, and `undefined` skips the comparison for internal callers.
4. Return `conflict` on mismatch, including a same-target request.
5. If the target equals the current root, return `unchanged` with the stored
   timestamp, without updating the row.
6. Otherwise generate the assignment timestamp, insert/update the pointer,
   and return `assigned` with that timestamp and the actual predecessor.

The returned pointer describes this operation, even if another writer changes
the build before the caller receives the result. It is not a promise that the
pointer remains current. Do not obtain result metadata through a separate
post-commit `getBuildPointer()` call. Construct the result from values captured
inside the atomic operation; only return a successful write after commit.

`ContentAddressableStore#assignRelease()` translates the result to:

`{ buildId, releaseId, assignedAt, isChanged, previousReleaseId }`

`isChanged` is true only for `assigned`; `previousReleaseId` is the captured
predecessor. Neither field becomes a public Build attribute. Continue mapping
`conflict` to `ConflictError` / `BuildPointerConflict`, and `missingClosure` to
`NotFoundError` / `ReleaseNotFound`. Assert unexpected result shapes instead of
silently treating an unknown outcome as success.

## Required behavior matrix

All target closures exist in this table. A and B are different Release hashes.

| Current | Target | Expected | Result | Timestamp / Activation |
| --- | --- | --- | --- | --- |
| absent | A | `null` | assigned | New timestamp; one append attempt |
| A | B | A | assigned | New timestamp; one append attempt |
| A | A | A | unchanged | Preserved timestamp; no append |
| A | A | B | conflict | Preserved timestamp; no append |
| A | A | `null` | conflict | Preserved timestamp; no append |
| absent | A | A | conflict | No pointer; no append |
| A | A | omitted | unchanged | Preserved timestamp; no append |
| A or absent | B | omitted | assigned | New timestamp; one append attempt |

Omitted preconditions are supported only by internal services. HTTP still
requires a precondition and returns 428 when it is missing. Conflicts remain
HTTP 412. A valid no-op returns HTTP 200 with the original `assignedAt`.
Timestamps are not unique identities; tests must not assume every real write
occurs in a different millisecond.

## Findings and verification constraints

- `ContentAddressableStore#assignRelease()` currently performs both the early
  equality read and the post-write read. Remove both.
- The transaction script currently performs a third pointer read and attempts
  an Activation append even after the facade's no-op. Issue #153's claim that
  the branch writes no Activation is not true of the full application path.
- The existing facade unit test explicitly accepts a same-target request with
  a stale precondition. Replace that expectation.
- Node currently uses single-statement conditional writes. Adding a no-op
  decision and predecessor capture requires a protected read/compare/write
  sequence; a JavaScript read followed by an unprotected UPDATE is insufficient.
- Cloudflare conformance tests currently use a hand-written Durable Object
  fake. They do not execute `ContentAddressableIndexStore`'s SQL. Add coverage
  of the production SQL assignment operation, not just another fake.
- `test/README.md` referenced by AGENTS.md is absent. Use `README.md`,
  `test/unit-tests/README.md`, and `test/end-to-end/README.md`.

### Task BA1: Make assignment decisions and results atomic on both runtimes

**Status:** Not started
**Depends on:** None
**Documentation:** This plan's Assignment contract and Required behavior matrix;
`src/plugins/README.md`; `src/kixx/content-addressable-store/content-store-interface.js`;
`src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`;
`src/docs/server-error-handling.md`; `test/unit-tests/README.md`.

**Objective**

Every framework assignment enforces its precondition at the storage boundary
and returns metadata from the same atomic operation, including valid no-ops.
This task closes the storage/facade defects in #153 and #154 together.

**Scope**

- In: portable result contract; Node and Cloudflare storage implementations;
  facade consumption; cache behavior; storage and facade regression tests;
  necessary test-double updates for the new internal return shape.
- Out: Activation orchestration (BA2); HTTP regression coverage and public
  documentation (BA3); assignment tokens and durable audit delivery.

**Design and invariants**

- Node: acquire the database first, then use `BEGIN IMMEDIATE` around the
  synchronous closure check, pointer read, comparison, no-op decision, and
  optional upsert. Complete COMMIT before returning. Roll back on failure;
  preserve the original cause and existing operational-error conventions.
  Do not hold the transaction across an `await`, file I/O, or logging I/O.
- Cloudflare: keep the SQLite check/read/compare/optional-write sequence
  synchronous with no `await` between those steps. Return the captured result
  through the existing RPC envelope. Do not add an application-layer read.
- For SQL regression coverage without a new runtime dependency, extract only
  the Cloudflare assignment operation into an adapter-local module such as
  `lib/assign-build.js`, accepting the SQL handle. The DO calls this exact
  function synchronously. Test it against an in-memory `node:sqlite` database
  through a small test-only `exec(...).toArray()` bridge. The bridge executes
  production SQL; it must not reimplement the assignment decision. This proves
  SQL behavior, not Cloudflare runtime scheduling or durability.
- Cloudflare evicts its build cache only for `assigned`. No-op, conflict, and
  missing-closure outcomes leave caches untouched.
- Remove both facade pointer reads. Map `pointer.rootHash`, not the request's
  desired hash, into the successful facade result.
- The developer store continues to reject writes. Migrate every consumer and
  test double of the bare outcome result; do not add dual-format compatibility.
- Update the relevant JSDoc and inline comments with the contract changes.

**Expected touch points**

- `src/kixx/content-addressable-store/content-store-interface.js` — result
  typedef, `UNCHANGED`, and atomic no-op contract.
- `src/kixx/content-addressable-store/content-addressable-store.js` — consume
  authoritative results and remove pointer reads.
- `src/plugins/node-content-store/lib/content-store.js` — transaction-owned
  decision and result.
- `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js`
  and new `lib/assign-build.js` — production SQL operation and RPC result.
- `src/plugins/cloudflare-content-store/lib/content-store.js` — portable result
  forwarding and cache invalidation.
- `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  and `content-addressable-store.test.js` — shared matrix and facade races.
- `test/unit-tests/plugins/node-content-store/lib/content-store.test.js` — real
  SQLite results, multiple connections, and transaction failure behavior.
- `test/unit-tests/plugins/cloudflare-content-store/lib/content-store.test.js`
  and new `assign-build.test.js` — RPC/cache behavior and production SQL tests.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both adapters satisfy the complete behavior matrix and return the new
      result shape, with failure outcomes leaving state unchanged.
- [ ] Same-target no-ops preserve the exact stored timestamp. Seed an explicit
      historical timestamp or control the clock so a mistaken UPDATE cannot
      pass merely because both calls ran in the same millisecond.
- [ ] Node transactions release locks on success, no-op, conflict, and missing
      closure. Injected write/commit failures do not return success and leave
      the connection usable after rollback where SQLite permits it.
- [ ] Two Node connections observe committed state; a stale same-target write
      conflicts. The no-op decision and predecessor read stay inside the write
      transaction.
- [ ] Cloudflare production assignment SQL is exercised independently of the
      hand-written conformance fake; cache tests cover `unchanged` explicitly.
- [ ] A deterministic facade test simulates a later assignment before the
      first caller resumes. The first result retains its own hash/timestamp;
      `getBuildPointer()` is never called by `assignRelease()`.
- [ ] Missing Releases, conflicts, and malformed internal results retain
      distinct error behavior. JSDoc matches the implemented contract.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — contract, SQL, cache, and facade regressions.
- `node run-linter.js src/kixx/content-addressable-store src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — affected runtime code and tests.
- `node run-tests.js` — full unit suite after the result-shape migration.
- Review the transaction boundaries explicitly; sequential tests alone do not
  prove concurrent-writer exclusion.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Contract and SQL test boundary specified above.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task BA2: Record activations only for actual assignments

**Status:** Not started
**Depends on:** BA1
**Documentation:** This plan's Assignment contract; `src/app/transaction-scripts/README.md`;
`src/app/collections/README.md`; `src/docs/server-error-handling.md`;
`src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`;
`test/unit-tests/README.md`.

**Objective**

The publishing workflow honors no-op semantics and derives Activation metadata
from the assignment result, eliminating the remaining speculative pointer read.

**Scope**

- In: publishing transaction script and its consumers/test doubles; no-op
  audit suppression; committed predecessor and timestamp in audit attributes.
- Out: deterministic Activation IDs, transactional outbox, repair jobs, and
  other #155 durability work; public protocol changes.

**Design and invariants**

- Call `store.assignRelease()` without a preceding `getBuildPointer()`.
- Return immediately when `isChanged` is false, without calling
  `Activation.append()`.
- For changed assignments, append with `fromReleaseId: previousReleaseId`,
  `toReleaseId: releaseId`, and `activatedAt: assignedAt` from the result.
  Retain the authenticated actor and validated reason from the request.
- Use the same authoritative values in failure logs. Expected audit-storage
  failure remains best-effort and does not undo or misreport the assignment.
  Apply the error guide to the touched catch: unexpected/programmer failures
  must propagate; use an actual operational error in the failure test.
- The existing collection accepts explicit `activatedAt`, so no collection
  schema or ID changes are needed.
- Admin-specific reads used for running-build validation or reason selection
  remain outside this cleanup. They do not substitute for the adapter's atomic
  precondition check.

**Expected touch points**

- `src/app/transaction-scripts/publishing/assign-release.js` — consume
  `isChanged` and committed audit metadata; remove the pointer read.
- `test/unit-tests/app/transaction-scripts/publishing/assign-release.test.js`
  — no-op, failure, predecessor, and timestamp coverage.
- `test/unit-tests/app/transaction-scripts/publishing/assign-release-to-running-build.test.js`,
  `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`,
  and `test/unit-tests/app/presentation/request-handlers/publishing-api/builds.test.js`
  — migrate any affected service doubles and verify consumers.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Valid no-op returns the preserved pointer and creates no Activation.
- [ ] Conflict or missing closure creates no Activation.
- [ ] First assignment records `fromReleaseId: null`; replacement records the
      predecessor and timestamp supplied by the atomic operation.
- [ ] Tests make any transaction-script pointer read fail, proving the audit
      inputs do not depend on another observation.
- [ ] An operational audit failure logs authoritative metadata and returns the
      successful pointer; an unexpected failure propagates.
- [ ] Admin and API consumers handle the extended internal result correctly.

**Validation**

- `node run-tests.js test/unit-tests/app/transaction-scripts/publishing test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — workflow and consumer regressions.
- `node run-linter.js src/app/transaction-scripts/publishing test/unit-tests/app/transaction-scripts/publishing test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — changed script and tests.
- `node run-tests.js` — full unit suite.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Committed audit metadata addresses part of #155;
  crash recovery and idempotent delivery remain unresolved.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task BA3: Verify and document conditional no-ops through the Publishing API

**Status:** Not started
**Depends on:** BA1, BA2
**Documentation:** This plan's Required behavior matrix; `docs/publishing-api.md`
(Build pointers, Assign a Release to a build, Build activation history);
`src/app/presentation/README.md`; `test/unit-tests/README.md`;
`test/end-to-end/README.md`; `README.md` (Local Target Instances, Linting, Testing).

**Objective**

Prove the complete HTTP path rejects stale same-target requests, preserves
valid no-ops, and returns the operation's authoritative result. Document the
retry behavior clients must now observe.

**Scope**

- In: handler regression tests; build-pointer E2E tests; Publishing API docs;
  final validation and handoff.
- Out: API token redesign, external deployment CLI implementation, remote
  deployments, or closing #152/#155.

**Design and invariants**

- Keep HTTP 200, 412, 428, malformed-header behavior, `no-transform`, and the
  current ETag format. Serialize only the existing public Build attributes;
  `isChanged` and `previousReleaseId` stay internal.
- Add same-target `If-None-Match: *` and stale `If-Match` cases to the E2E
  workflow. Assert no timestamp or Activation-count change on failure.
- For a valid no-op, compare the response timestamp to the prior assignment
  and verify the Activation count is unchanged. Changed writes still record
  one activation each when the local document store is healthy.
- Test the response race deterministically in unit tests with controlled
  promises/results, not with timing sleeps or probabilistic HTTP concurrency.
- Correct the documentation claiming same-target requests automatically make
  retries safe. A lost response after a state change may produce 412 on retry;
  clients must read and reconcile the current state. No automatic unconditional
  retry or request-idempotency mechanism is introduced.
- Explain that hash preconditions still cannot detect A→B→A until #152.
- Run HTTP write tests against a disposable local target, never the read-only
  devserver. Do not treat skipped `--development` cases as validation.

**Expected touch points**

- `test/unit-tests/app/presentation/request-handlers/publishing-api/builds.test.js`
  — authoritative response fields, status mapping, internal-field exclusion.
- `test/end-to-end/200-publishing-api/050-build-pointers.test.js` — conditional
  no-op and Activation-history regressions on synthetic build IDs.
- `docs/publishing-api.md` — corrected no-op, retry, and audit semantics.
- `src/app/presentation/request-handlers/publishing-api/builds.js` — only if
  response mapping or JSDoc needs adjustment; existing explicit mapping should
  already keep internal fields private.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] HTTP rejects stale same-target assignments with 412 for both supported
      precondition forms; missing preconditions still return 428.
- [ ] Valid same-target assignment returns 200, preserves `assignedAt`, and
      adds no Activation. Internal metadata does not leak into Build JSON.
- [ ] Response body and ETag describe the same operation even when a later
      assignment occurs before the response is assembled.
- [ ] Documentation describes strict preconditions, retry reconciliation, and
      the remaining #152/#155 limitations without claiming full resolution.
- [ ] All changed JavaScript passes lint; full unit tests and the local
      build-pointer E2E file pass. Record test counts and any runtime gaps.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api/builds.test.js` — HTTP mapping and response regressions.
- `node run-linter.js src/app/presentation/request-handlers/publishing-api/builds.js test/unit-tests/app/presentation/request-handlers/publishing-api/builds.test.js test/end-to-end/200-publishing-api/050-build-pointers.test.js` — handler and HTTP test style.
- `node run-tests.js` — final full unit suite; do not repeat if this exact final
  source/test state already passed it in BA2.
- `node tools/local-target.js create assignment-fixes` — create an isolated
  target; choose another name if it already exists.
- `node tools/local-target.js seed assignment-fixes` — publish working-tree
  content and create test credentials.
- `node tools/local-target.js serve assignment-fixes` — serve that target in a
  separate terminal/session.
- Set `E2E_TESTS_BASE_URL`, `E2E_TESTS_ROOT_USERNAME`, and
  `E2E_TESTS_ROOT_PASSWORD` from that target's `credentials.json` as described
  in the E2E guide; keep secret values out of plan and tool output.
- `node run-tests.js --e2e test/end-to-end/200-publishing-api/050-build-pointers.test.js` — complete local HTTP write-path verification using those variables.
- Stop the target process, then `node tools/local-target.js destroy assignment-fixes`
  — remove only the disposable target created for this validation.
- `git diff --check` — final whitespace check.
- Cloudflare runtime verification remains distinct from Node-backed SQL tests.
  When a test deployment containing the change is available, run the same E2E
  file with `--cloudflare` and configured credentials; record whether it ran.
  This plan does not authorize deploying or writing to a remote target.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Local E2E covers the real Node HTTP path;
  production Cloudflare SQL tests do not prove runtime scheduling/durability.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
