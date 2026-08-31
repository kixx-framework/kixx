# Publishing API Build Resource

## Implementation Approach

Expose the running deployment's current build pointer as a JSON:API `Build`
resource at `GET /publishing-api/v1/build`, and allow publishing clients to
conditionally point that same build at an already-persisted closure with
`PUT /publishing-api/v1/build`.

The public representation is:

```json
{
    "data": {
        "type": "Build",
        "id": "<current-runtime-build-id>",
        "attributes": {
            "rootHash": "<assigned-closure-root-hash>"
        }
    }
}
```

`PUT /build` accepts the same resource identity with both the desired closure
and the pointer value the client observed:

```json
{
    "data": {
        "type": "Build",
        "id": "<current-runtime-build-id>",
        "attributes": {
            "rootHash": "<desired-existing-root-hash>",
            "expectedRootHash": "<currently-assigned-root-hash>"
        }
    }
}
```

The endpoint only operates on `context.runtime.build.id`; a client cannot use
it to inspect or move an arbitrary build. A missing runtime build id or a
runtime build with no assigned closure returns `404 NOT_FOUND_ERROR`. A request
whose `data.id` does not identify the runtime build returns `409
BuildIdMismatch`. A desired root hash which has no persisted closure returns
`404 NOT_FOUND_ERROR`. If the current pointer no longer equals
`expectedRootHash`, the assignment does not occur and returns `409
BuildPointerConflict`.

The pointer comparison and assignment must be one atomic storage operation.
Checking in a handler and assigning later would allow a deployment or another
test run to change the pointer between those operations. The portable content
store contract will therefore expose build identity and conditional assignment,
with equivalent behavior in the Node SQLite and Cloudflare Durable Object
adapters. Cloudflare cache invalidation still happens only after a successful
assignment; conflicts leave all caches and durable state untouched.

The content-tree closure endpoint will accept an optional
`expectedRootHash`. When present, its final build-pointer assignment uses the
same compare-and-swap operation and returns `409 BuildPointerConflict` on a
stale pointer. Omitting it preserves the existing unconditional publication
contract for current clients. The precondition is assignment metadata, not
part of the content tree, so it does not affect the deterministic closure hash.

Publishing-capable roles receive dedicated `urn:kixx:get` and
`urn:kixx:update` grants on `urn:kixx:publishing:build`. Existing wildcard
publishing grants remain intact for the other API resources. Root Admin's
global wildcard continues to cover both operations.

The end-to-end index and closure workflows will read the active `Build`,
publish their run-scoped closure to that build with the observed root hash as
the precondition, exercise `/index/*`, and restore the original root through
conditional `PUT /build`. Their `after` hooks run even when setup fails and
must never overwrite a pointer they no longer own. A restore conflict fails
the test run loudly but leaves the newer pointer unchanged. This protects
against a concurrent deploy or test mutation; it is not a distributed lock,
so operators should still avoid overlapping mutation-heavy E2E runs when
deterministic results are required.

### Task PB1: Make build pointers a portable conditional store capability

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md`, `src/kixx/content-addressable-store/content-store-interface.js`

**Objective**

Extend the content-store port and both writable adapters so callers can resolve
the exact root hash assigned to a build and atomically reassign that pointer
only when it still has an expected value. This task owns the cross-platform
storage invariant needed by both API endpoints and safe E2E restoration.

**Scope**

- In: portable build lookup returning the assigned root hash with its encoded
  index; conditional and unconditional build assignment; distinct
  assigned/conflict/missing-closure outcomes; Node SQLite implementation;
  Cloudflare Durable Object and adapter implementation; cache behavior; shared
  conformance and adapter tests.
- Out: HTTP routes, JSON:API documents, permissions, and E2E workflows (PB2-PB4).

**Design and invariants**

- Replace the index-only lookup contract with a build lookup shaped as
  `{ rootHash, entries }`, resolving `null` when a build is not registered.
  `rootHash` is the stored pointer value, not a hash recomputed by the caller.
- The developer content store may return its scanned entries with a `null`
  root hash because it has no persisted build pointer; deployed adapters must
  return a non-empty root hash for every found build.
- Change `assignBuild` to accept an assignment object containing `rootHash` and
  optional `expectedRootHash`. It returns an explicit assigned, conflict, or
  missing-closure outcome instead of using assertion failures for states that
  can now result from public input.
- When `expectedRootHash` is present, compare and update atomically. A mismatch
  must not alter the pointer or invalidate caches. An omitted expectation keeps
  the existing unconditional assignment behavior used by older publication
  callers.
- Node performs the conditional update in SQLite, using affected-row and
  follow-up existence checks only to classify a no-op. Immutable closures are
  never deleted, so checking whether the desired root exists cannot race with
  deletion.
- The Cloudflare Durable Object performs lookup and conditional update within
  its single serialized storage owner, and returns the same portable outcome.
  Its outward adapter invalidates pending and edge-cache entries only after an
  assigned outcome.
- Preserve the rule that a desired root must already name a saved closure.
  Conditional assignment must not create closures or build records from
  untrusted index data.

**Expected touch points**

- `src/kixx/content-addressable-store/content-store-interface.js` — document
  build lookup and conditional assignment results.
- `src/plugins/node-content-store/lib/content-store.js` — return root hashes
  from build lookup and implement SQLite compare-and-swap.
- `src/plugins/node-content-store/lib/developer-content-store.js` — adapt the
  developer-mode exception to the revised lookup contract.
- `src/plugins/cloudflare-content-store/lib/content-store.js` — carry root
  hashes through caches and translate Durable Object assignment outcomes.
- `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js`
  — resolve stored root hashes and atomically compare/reassign pointers.
- `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  — define shared found/missing/conditional behavior.
- `test/unit-tests/plugins/node-content-store/lib/content-store.test.js` —
  verify SQLite persistence and compare-and-swap outcomes.
- `test/unit-tests/plugins/node-content-store/developer-content-store.test.js`
  — verify the source-backed lookup exception.
- `test/unit-tests/plugins/cloudflare-content-store/lib/content-store.test.js`
  — verify result translation and cache handling. Add focused Durable Object
  coverage if the adapter mock cannot prove the atomic SQL behavior.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both writable adapters return the exact persisted root hash and encoded
      entries for a registered build, and `null` for an unknown build.
- [ ] Both writable adapters support unconditional assignment for compatibility.
- [ ] Conditional assignment succeeds only when the stored pointer equals
      `expectedRootHash` and reports conflict without mutation otherwise.
- [ ] Assignment reports a missing desired closure distinctly from pointer
      conflict.
- [ ] Cloudflare invalidates build-index caches after success and not after a
      conflict or missing-closure result.
- [ ] Shared conformance and adapter-specific unit tests cover these invariants.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — verifies the portable contract through both adapter suites, including the shared conformance module they import.
- `node run-linter.js src/kixx/content-addressable-store/content-store-interface.js src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store/content-store-conformance.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — checks every JavaScript touch point owned by this task.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The current port returns only index entries and
  `assignBuild()` is unconditional. Both must change at the storage boundary;
  an application-layer read followed by write cannot provide compare-and-swap.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task PB2: Add current-build lifecycle behavior to ContentAddressableStore

**Status:** Not started
**Depends on:** PB1
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/server-error-handling.md`

**Objective**

Give application code one framework-owned API for resolving the current build,
opening its snapshot, publishing with an optional pointer precondition, and
conditionally restoring an existing closure. This keeps storage outcomes and
domain errors out of request handlers.

**Scope**

- In: current runtime build resolution; snapshot construction from the revised
  port result; conditional existing-closure assignment; optional conditional
  closure publication; translation of missing/conflict outcomes; unit tests.
- Out: route authorization and JSON:API parsing/rendering (PB3), remote test
  orchestration (PB4).

**Design and invariants**

- Add a public current-build lookup which returns `{ id, rootHash }` or `null`.
  It returns `null` when the runtime build id is absent, the adapter has no
  registered pointer, or the developer adapter has no persisted root hash.
- Refactor `openSnapshot()` to consume the build lookup result while preserving
  its existing invariant: normal rendering and resource uploads still treat a
  missing active closure as an unexpected server configuration error.
- Add an operation which conditionally assigns an existing closure to the
  current runtime build only. It must reject a missing runtime/current build as
  `NotFoundError`, a missing desired closure as `NotFoundError`, and a stale
  expectation as `ConflictError` with code `BuildPointerConflict`.
- Extend `commitChanges()` with an optional `expectedRootHash`. Continue saving
  the immutable closure before pointer assignment. On conflict, leave the saved
  closure unreferenced and return `ConflictError`; a retry reuses the same
  deterministic hash.
- Do not include `expectedRootHash` in `flattenContentTree()` input or closure
  hashing.
- Validate public request values before calling this layer; internal port result
  shapes remain assertions.

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-store.js` — own the
  current-build and conditional assignment lifecycle.
- `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
  — cover lookup, snapshot behavior, conditional publication, restoration,
  missing closures, and conflicts.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Application code can obtain the active build id and exact assigned root
      hash without accessing a platform adapter.
- [ ] Existing snapshot reads continue to use one closure pinned for the
      request.
- [ ] Existing callers can publish unconditionally when no expectation is
      supplied.
- [ ] Conditional publication and restoration use atomic adapter assignment
      and report stale pointers as `409 BuildPointerConflict`-compatible domain
      errors.
- [ ] Missing runtime builds and missing desired closures are distinguishable
      expected errors for the new public operations.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — verifies framework build lifecycle behavior.
- `node run-linter.js src/kixx/content-addressable-store/content-addressable-store.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — checks changed JavaScript.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Upload and index handlers currently call
  `openSnapshot()`, which resolves only `context.runtime.build.id`; publishing a
  random build cannot affect their subsequent reads.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task PB3: Expose and authorize the Publishing API Build resource

**Status:** Not started
**Depends on:** PB2
**Documentation:** `docs/publishing-api.md`, `src/app/presentation/README.md`, `src/docs/server-error-handling.md`

**Objective**

Add the authenticated JSON:API endpoint that reports the running build and
conditionally restores it to an existing closure, and make conditional
publication available through the existing closure endpoint.

**Scope**

- In: `GET` and `PUT /publishing-api/v1/build`; Build JSON:API request and
  response contracts; current-build restriction; dedicated authorization;
  `expectedRootHash` on closure requests; public error behavior; route/handler,
  permission, and protocol documentation; unit tests.
- Out: changing the build id of the running process, reading arbitrary build
  pointers, deleting closures, garbage collection, or an endpoint that accepts
  raw index entries.

**Design and invariants**

- `GET /build` requires `urn:kixx:get` on
  `urn:kixx:publishing:build` and returns `Build` with `data.id` equal to the
  runtime build id and `attributes.rootHash` equal to its assigned closure.
- `PUT /build` requires `urn:kixx:update` on the same resource. It requires a
  JSON:API `Build` resource with `data.id`, `rootHash`, and
  `expectedRootHash`; success returns `200` with the resulting Build resource.
- The PUT handler compares `data.id` with `context.runtime.build.id` before
  mutation. A different id returns `409 BuildIdMismatch`; it never assigns the
  requested arbitrary build.
- Missing runtime id or missing active pointer returns `404 NOT_FOUND_ERROR` on
  both methods. A desired root with no saved closure also returns 404. A stale
  `expectedRootHash` returns `409 BuildPointerConflict` and does not mutate.
- Extend `ContentTree` parsing to accept optional `expectedRootHash`, pass it as
  commit metadata, and keep it outside the tree supplied to hashing. A stale
  conditional closure publish returns the same `409 BuildPointerConflict`.
- Add explicit Build get/update grants to Developer, Admin, and Editor. Root
  Admin remains authorized by `*`/`*`. Extend the editor-role action invariant
  to recognize the narrowly scoped update grant without broadening Editor to
  unrelated update resources.
- Keep route ordering explicit so `/build` cannot be shadowed by broader
  publishing paths. Support the API's existing optional trailing-slash policy.

**Expected touch points**

- `src/routes/publishing-api-v1.js` — register the Build endpoint and grants.
- `src/app/presentation/request-handlers/publishing-api/mod.js` — parse and
  render Build operations and conditional closure requests.
- `src/app/permissions/roles.js` — grant publishing-capable roles Build read and
  update access while preserving role-domain assertions.
- `docs/publishing-api.md` — document endpoint shapes, permissions, errors,
  conditional publication, and restoration workflow.
- `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js`
  — cover Build success, validation, missing state, identity mismatch,
  missing closure, and stale-pointer behavior.
- `test/unit-tests/app/permissions/roles.test.js` — add focused coverage for the
  new publishing grants if no existing role test owns this contract.
- Relevant route tests — verify GET/PUT methods and authorization decisions.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Authenticated GET returns the runtime Build id and assigned root hash.
- [ ] GET and PUT return 404 when the runtime id is absent or unassigned.
- [ ] PUT can point only the current runtime build at a persisted closure.
- [ ] PUT returns 409 without mutation when its expected pointer is stale.
- [ ] PUT returns 404 when its desired closure does not exist and 409 when its
      resource id differs from the runtime build.
- [ ] Conditional closure publication returns 409 on a stale pointer; existing
      closure clients without `expectedRootHash` remain compatible.
- [ ] Editor, Admin, Developer, and Root Admin are authorized for both Build
      operations; unrelated roles or empty grants remain forbidden.
- [ ] Publishing API documentation describes the mutation risk and conditional
      restore sequence.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — verifies handlers and role grants.
- `node run-tests.js test/unit-tests/kixx/http-router` — verifies routing and method behavior if the route tree changes require router-level coverage.
- `node run-linter.js src/routes/publishing-api-v1.js src/app/presentation/request-handlers/publishing-api src/app/permissions/roles.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — checks changed JavaScript.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Existing publishing roles grant only get/create;
  the update grant must be specific to the Build resource so pointer mutation
  does not imply general update authority.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task PB4: Make publishing E2E workflows restore the active build

**Status:** Not started
**Depends on:** PB3
**Documentation:** `test/end-to-end/README.md`, `docs/publishing-api.md`, `test/unit-tests/README.md`

**Objective**

Update the published-reference and closure end-to-end tests to exercise the
closure they publish through the server's actual runtime build, then restore
the original pointer without overwriting concurrent changes.

**Scope**

- In: shared Build workflow helpers; active-build discovery; conditional
  publication; index assertions; conditional restoration in `after` hooks;
  Build endpoint E2E coverage; suite documentation.
- Out: deletion of uploaded immutable blobs, closure garbage collection,
  deletion of publishing-token records, and distributed locking of the remote
  test environment.

**Design and invariants**

- Add shared helpers to GET the current Build and conditionally PUT a desired
  existing root. Helpers return the exact JSON:API build identity/root or throw
  on unexpected status.
- `030-index-reads.test.js` and `050-closure.test.js` fetch and retain the
  original Build before publishing. Their closure payload uses the runtime
  build id and original root hash as `expectedRootHash`.
- Capture the test closure hash returned by successful publication. Subsequent
  `/index/*` reads now resolve that closure because its build id matches the
  runtime build.
- Register `after` before mutation-capable setup completes. Restore only when
  the original Build and successfully published test root are both known. Send
  the test root as `expectedRootHash`; a conflict fails the hook and never
  overwrites a deployment or another run's pointer.
- An `after` hook still runs when `before` fails. Avoid restoration when the
  publication result is unknown, because guessing ownership would be more
  destructive than leaving a clearly failed run for operator inspection.
- Remove random build-id generation if it has no remaining callers. Keep UUID
  pathname prefixes: they prevent fixture paths and missing-resource checks
  from colliding with real content or concurrent runs.
- Add observable E2E coverage that GET reports the active Build and PUT can
  restore a known prior closure. Unit tests own missing-runtime and synthetic
  conflict cases which cannot safely be created on a shared deployment.
- Document that immutable blobs and closures remain after a run, tokens retain
  their existing expiry behavior, and pointer cleanup is conditional rather
  than destructive content cleanup.

**Expected touch points**

- `test/end-to-end/test-helpers/publishing-workflows.js` — Build GET/PUT helpers
  and conditional closure support shared by independently runnable files.
- `test/end-to-end/200-publishing-api/helpers.js` — remove obsolete run-scoped
  build-id generation if unused.
- `test/end-to-end/200-publishing-api/030-index-reads.test.js` — publish through
  and restore the active build.
- `test/end-to-end/200-publishing-api/050-closure.test.js` — publish through and
  restore the active build while retaining idempotent hash assertions.
- `test/end-to-end/README.md` — describe active-pointer mutation, restoration,
  conflict safety, and non-concurrent-run recommendation.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both affected test files remain independently runnable.
- [ ] They publish to the runtime build using the root observed immediately
      before publication as an atomic precondition.
- [ ] Their `/index/*` assertions read the test closure rather than the
      deployment's prior closure.
- [ ] Successful runs conditionally restore the exact original root hash.
- [ ] A changed pointer causes 409 and a failed restore hook without overwriting
      the newer pointer.
- [ ] Setup failures do not trigger an unconditional or guessed restoration.
- [ ] Documentation states what persistent test data remains and why routine
      content reset is unnecessary.

**Validation**

- `node run-linter.js test/end-to-end/test-helpers/publishing-workflows.js test/end-to-end/200-publishing-api` — checks changed E2E JavaScript.
- `node run-tests.js --e2e --cloudflare test/end-to-end/200-publishing-api/030-index-reads.test.js` — operator/CI verification of active-build publication, reads, and restoration on Cloudflare.
- `node run-tests.js --e2e --cloudflare test/end-to-end/200-publishing-api/050-closure.test.js` — operator/CI verification of closure idempotence and restoration on Cloudflare.
- `node run-tests.js --e2e --nodejs test/end-to-end/200-publishing-api` — operator/CI verification of the complete Publishing API suite on Node.
- Re-fetch `GET /publishing-api/v1/build` after each permitted remote run and confirm its root hash equals the value observed before the run. This is an operator/CI check, not an implementation-agent remote smoke test.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Random build IDs isolate stored pointers but cannot
  make `/index/*` read them; index reads always use the runtime build. Safe
  restoration therefore requires mutating that pointer with compare-and-swap.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
