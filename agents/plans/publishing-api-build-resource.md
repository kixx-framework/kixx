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

**Status:** Complete
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

- [x] Both writable adapters return the exact persisted root hash and encoded
      entries for a registered build, and `null` for an unknown build.
- [x] Both writable adapters support unconditional assignment for compatibility.
- [x] Conditional assignment succeeds only when the stored pointer equals
      `expectedRootHash` and reports conflict without mutation otherwise.
- [x] Assignment reports a missing desired closure distinctly from pointer
      conflict.
- [x] Cloudflare invalidates build-index caches after success and not after a
      conflict or missing-closure result.
- [x] Shared conformance and adapter-specific unit tests cover these invariants.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — verifies the portable contract through both adapter suites, including the shared conformance module they import.
- `node run-linter.js src/kixx/content-addressable-store/content-store-interface.js src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store/content-store-conformance.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — checks every JavaScript touch point owned by this task.

**Progress and handoff**

- Completed: Port renamed `getIndex()` to `getBuild()`, resolving
  `{ rootHash, entries }` or `null` instead of throwing for an unregistered
  build. `assignBuild()` now takes an `{ rootHash, expectedRootHash }`
  assignment object and resolves `BUILD_ASSIGNMENT_OUTCOME.ASSIGNED` /
  `.CONFLICT` / `.MISSING_CLOSURE` instead of throwing `AssertionError` for
  conflict/missing-closure. Implemented in the Node SQLite adapter (single
  UPSERT for unconditional assignment; a single conditional `UPDATE ... WHERE
  root_hash = expected AND EXISTS(closure)` for compare-and-swap, with a
  closures-only follow-up read to classify a 0-row result as conflict vs.
  missing-closure — safe because closures are never deleted), the Cloudflare
  Durable Object (`content-addressable-index-store.js`, whose single-threaded
  per-instance execution makes the check-then-write sequence atomic without a
  SQL transaction), the Cloudflare outward adapter (`content-store.js`, which
  now invalidates index caches only on `ASSIGNED`), and the developer adapter
  (`getBuild()` always resolves `{ rootHash: null, entries }` from a fresh
  scan; `assignBuild()` still unconditionally throws — developer mode has no
  writable pointer regardless of arguments).
- Current state: Complete. `BUILD_ASSIGNMENT_OUTCOME` is exported from
  `content-store-interface.js` and imported by both writable adapters and the
  Durable Object.
- Remaining: None for this task. PB2 must update
  `ContentAddressableStore#openSnapshot()`/`#commitChanges()`, which still
  call the now-removed `getIndex()`/old two-arg `assignBuild()` shape on the
  real adapters (its own unit test suite is green only because it uses local
  mocks that were not touched).
- Decisions and discoveries: The old port returned only index entries and
  `assignBuild()` was unconditional; both had to change at the storage
  boundary since an application-layer read followed by a write cannot provide
  compare-and-swap. Did not add a dedicated Durable Object SQL test file —
  the outward adapter's Durable Object mock (in
  `content-store.test.js`/conformance) fully expresses the
  match/mismatch/missing-closure branching the DO implements, and DO
  single-threaded call serialization is a documented Cloudflare platform
  guarantee, not something a local mock can meaningfully race-test.
- Actual files changed:
  - `src/kixx/content-addressable-store/content-store-interface.js`
  - `src/plugins/node-content-store/lib/content-store.js`
  - `src/plugins/node-content-store/lib/developer-content-store.js`
  - `src/plugins/cloudflare-content-store/lib/content-store.js`
  - `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js`
  - `test/unit-tests/kixx/content-addressable-store/content-store-conformance.js`
  - `test/unit-tests/plugins/node-content-store/lib/content-store.test.js`
  - `test/unit-tests/plugins/node-content-store/developer-content-store.test.js`
  - `test/unit-tests/plugins/cloudflare-content-store/lib/content-store.test.js`
- Validation run:
  - `node run-linter.js src/kixx/content-addressable-store/content-store-interface.js src/plugins/node-content-store src/plugins/cloudflare-content-store test/unit-tests/kixx/content-addressable-store/content-store-conformance.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — clean, no output.
  - `node run-tests.js test/unit-tests/plugins/node-content-store test/unit-tests/plugins/cloudflare-content-store` — 134 tests, passed.
  - `node run-tests.js` (full suite) — 1251 tests, passed; confirms this task did not regress anything outside its own scope.
- Blockers: None.

### Task PB2: Add current-build lifecycle behavior to ContentAddressableStore

**Status:** Complete
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

- [x] Application code can obtain the active build id and exact assigned root
      hash without accessing a platform adapter.
- [x] Existing snapshot reads continue to use one closure pinned for the
      request.
- [x] Existing callers can publish unconditionally when no expectation is
      supplied.
- [x] Conditional publication and restoration use atomic adapter assignment
      and report stale pointers as `409 BuildPointerConflict`-compatible domain
      errors.
- [x] Missing runtime builds and missing desired closures are distinguishable
      expected errors for the new public operations.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — verifies framework build lifecycle behavior.
- `node run-linter.js src/kixx/content-addressable-store/content-addressable-store.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — checks changed JavaScript.

**Progress and handoff**

- Completed: `content-addressable-store.js` now imports `BUILD_ASSIGNMENT_OUTCOME`
  from the port, and `ConflictError`/`NotFoundError` from `kixx/errors/mod.js`.
  - `openSnapshot()` now calls `#store.getBuild()` instead of the removed
    `getIndex()`, and throws the assertion-library `AssertionError` (via
    `assert()`) when it resolves `null` — same observable behavior as before,
    now enforced one layer up since the port itself no longer throws for
    build absence.
  - Added `getCurrentBuild(context)`: resolves `{ id, rootHash }` or `null`,
    guarding on a missing `context.runtime.build.id` before ever calling the
    adapter (unlike `openSnapshot()`, so a public caller gets `null` instead
    of a crash), and treating a developer-mode `rootHash: null` result as
    "no active build" too.
  - Added `assignCurrentBuild(context, { rootHash, expectedRootHash })`: both
    fields are required (unlike `commitChanges()`'s optional precondition,
    since this operation only ever restores an already-observed pointer).
    Throws `NotFoundError` for a missing runtime build id or a
    `MISSING_CLOSURE` outcome, `ConflictError` with `code: 'BuildPointerConflict'`
    for a `CONFLICT` outcome, and never names a build other than the runtime's
    own — there is no build-id parameter.
  - `commitChanges()` gained an optional 4th `options.expectedRootHash`
    parameter, kept out of `flattenContentTree()`/hashing input, passed to
    `#store.assignBuild()`, and translated to the same `ConflictError`. A
    `MISSING_CLOSURE` outcome here is asserted unreachable (the closure was
    just saved in the same call) rather than surfaced as a caller-facing error.
- Current state: Complete.
- Remaining: None for this task. PB3 wires `getCurrentBuild()`/
  `assignCurrentBuild()` into the `GET`/`PUT /publishing-api/v1/build` route
  and handler, and passes `expectedRootHash` through the existing closure
  endpoint's `commitChanges()` call
  (`src/app/presentation/request-handlers/publishing-api/mod.js`); neither
  existing caller needed changes for this task since both new parameters are
  optional/additive.
- Decisions and discoveries: `openSnapshot()` still calls the adapter with a
  possibly-null `buildId` (unlike the two new public methods) so the
  developer-mode adapter — which ignores `buildId` entirely — keeps working
  exactly as before; only the two new methods short-circuit on a missing
  runtime build id.
- Actual files changed:
  - `src/kixx/content-addressable-store/content-addressable-store.js`
  - `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
- Validation run:
  - `node run-linter.js src/kixx/content-addressable-store/content-addressable-store.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — clean, no output.
  - `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — 27 tests, passed.
- Blockers: None.

### Task PB3: Expose and authorize the Publishing API Build resource

**Status:** Complete
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

- [x] Authenticated GET returns the runtime Build id and assigned root hash.
- [x] GET and PUT return 404 when the runtime id is absent or unassigned.
- [x] PUT can point only the current runtime build at a persisted closure.
- [x] PUT returns 409 without mutation when its expected pointer is stale.
- [x] PUT returns 404 when its desired closure does not exist and 409 when its
      resource id differs from the runtime build.
- [x] Conditional closure publication returns 409 on a stale pointer; existing
      closure clients without `expectedRootHash` remain compatible.
- [x] Editor, Admin, Developer, and Root Admin are authorized for both Build
      operations; unrelated roles or empty grants remain forbidden.
- [x] Publishing API documentation describes the mutation risk and conditional
      restore sequence.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — verifies handlers and role grants.
- `node run-tests.js test/unit-tests/kixx/http-router` — verifies routing and method behavior if the route tree changes require router-level coverage.
- `node run-linter.js src/routes/publishing-api-v1.js src/app/presentation/request-handlers/publishing-api src/app/permissions/roles.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — checks changed JavaScript.

**Progress and handoff**

- Completed:
  - `src/routes/publishing-api-v1.js`: added a top-level `/build` route with
    `GET` (`urn:kixx:get` on `urn:kixx:publishing:build`) and `PUT`
    (`urn:kixx:update` on the same resource) targets, wired to new
    `getBuild`/`putBuild` handlers.
  - `src/app/presentation/request-handlers/publishing-api/mod.js`: added
    `getBuild()` (calls `store.getCurrentBuild()`, 404s via `NotFoundError`
    when it resolves `null`) and `putBuild()` (validates `rootHash`/
    `expectedRootHash` are non-empty strings as a `ValidationError` — public
    input is validated here, not left to the store's internal assertions;
    404s when the runtime has no build id, checked *before* the id-mismatch
    check so that case reports 404 rather than `BuildIdMismatch`; 409s with
    code `BuildIdMismatch` when `data.id` differs from the runtime build id;
    then delegates to `store.assignCurrentBuild()`, which supplies the
    404/409 `BuildPointerConflict` outcomes for a missing closure or stale
    pointer). `commitChanges()` now reads `attributes.expectedRootHash`,
    validates its type as a `ValidationError` when present, and passes it
    through as `store.commitChanges()`'s options 4th argument — an absent
    value stays `undefined`, preserving unconditional publication for
    existing clients.
  - `src/app/permissions/roles.js`: added a `{ action: ['urn:kixx:get',
    'urn:kixx:update'], resource: 'urn:kixx:publishing:build' }` grant to
    `developer`, `admin`, and `editor` (Root Admin already covered by its
    `*`/`*` wildcard). Extended `assertPublishingGrants()` so the Editor-role
    invariant check allows `update` only on the exact
    `urn:kixx:publishing:build` resource (via a new `EDITOR_BUILD_ACTIONS`
    set keyed off `PUBLISHING_BUILD_RESOURCE`), leaving every other
    publishing grant restricted to get/create as before.
  - `docs/publishing-api.md`: added the `GET`/`PUT /build` rows to the
    endpoint table, the `BuildIdMismatch`/`BuildPointerConflict` error rows,
    an `expectedRootHash` note under "Publish a content tree", a permissions
    note that the Build update grant does not extend elsewhere, and a new
    "Get and restore the active build" section documenting the request/
    response shapes and the observe-then-conditionally-restore pattern.
  - Added `test/unit-tests/app/permissions/roles.test.js` (new directory;
    none existed before) covering: get/update on Build for developer, admin,
    editor; Root Admin via wildcard; an unknown role id; that Editor's Build
    update grant does not leak into update on other publishing resources or
    into unrelated actions on Build; and that Editor's ordinary get/create
    publishing access is unaffected.
  - Extended `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js`
    with `getBuild`/`putBuild` describe blocks and three new `commitChanges`
    cases (expectedRootHash omitted/present/invalid, and store-raised
    `ConflictError` propagation). `makeContext()` now takes an optional
    runtime build id and always sets `context.runtime`; `makeStore()` gained
    `getCurrentBuild`/`assignCurrentBuild` trackers.
- Current state: Complete.
- Remaining: None for this task. PB4 will use `GET`/`PUT /build` from the E2E
  suite for active-build discovery and conditional restoration.
- Decisions and discoveries: Existing publishing roles grant only get/create;
  the update grant had to be specific to the Build resource so pointer
  mutation does not imply general update authority — confirmed by extending
  `assertPublishingGrants()` rather than widening `EDITOR_ACTIONS` itself. No
  dedicated route-manifest audit test exists in this codebase (checked); route
  behavior is proven through the handler unit tests plus the existing generic
  `http-router` test suite, per the existing pattern for every other
  publishing-api-v1 route.
- Actual files changed:
  - `src/routes/publishing-api-v1.js`
  - `src/app/presentation/request-handlers/publishing-api/mod.js`
  - `src/app/permissions/roles.js`
  - `docs/publishing-api.md`
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js`
  - `test/unit-tests/app/permissions/roles.test.js` (new)
- Validation run:
  - `node run-linter.js src/routes/publishing-api-v1.js src/app/presentation/request-handlers/publishing-api src/app/permissions/roles.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — clean, no output.
  - `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api test/unit-tests/app/permissions` — 35 tests, passed.
  - `node run-tests.js test/unit-tests/kixx/http-router` — 144 tests, passed.
  - `node run-tests.js` (full suite) — 1279 tests, passed.
- Blockers: None.

### Task PB4: Make publishing E2E workflows restore the active build

**Status:** Complete
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

- [x] Both affected test files remain independently runnable.
- [x] They publish to the runtime build using the root observed immediately
      before publication as an atomic precondition.
- [x] Their `/index/*` assertions read the test closure rather than the
      deployment's prior closure.
- [x] Successful runs conditionally restore the exact original root hash.
- [x] A changed pointer causes 409 and a failed restore hook without overwriting
      the newer pointer.
- [x] Setup failures do not trigger an unconditional or guessed restoration.
- [x] Documentation states what persistent test data remains and why routine
      content reset is unnecessary.

**Validation**

- `node run-linter.js test/end-to-end/test-helpers/publishing-workflows.js test/end-to-end/200-publishing-api` — checks changed E2E JavaScript.
- `node run-tests.js --e2e --cloudflare test/end-to-end/200-publishing-api/030-index-reads.test.js` — operator/CI verification of active-build publication, reads, and restoration on Cloudflare.
- `node run-tests.js --e2e --cloudflare test/end-to-end/200-publishing-api/050-closure.test.js` — operator/CI verification of closure idempotence and restoration on Cloudflare.
- `node run-tests.js --e2e --nodejs test/end-to-end/200-publishing-api` — operator/CI verification of the complete Publishing API suite on Node.
- Re-fetch `GET /publishing-api/v1/build` after each permitted remote run and confirm its root hash equals the value observed before the run. This is an operator/CI check, not an implementation-agent remote smoke test.

**Progress and handoff**

- Completed:
  - `test/end-to-end/test-helpers/publishing-workflows.js`: added
    `getActiveBuild(publishingToken)` (GET `/build`, throws on non-200,
    returns `{id, rootHash}`) and `putActiveBuild(publishingToken, {buildId,
    rootHash, expectedRootHash})` (PUT `/build`, throws on non-200 — including
    a 409 conflict, deliberately, so a restoration call in an `after` hook
    fails loudly rather than being retried over a pointer something else has
    since moved). Both follow this file's existing throw-on-unexpected-status
    convention.
  - `test/end-to-end/200-publishing-api/helpers.js`: removed
    `createRunScopedBuildId()` — no remaining caller after both test files
    switched to publishing through the observed runtime build id.
    `createRunPrefix()`/`createRunScopedPathname()` are unchanged and still
    used for fixture pathname namespacing.
  - `test/end-to-end/200-publishing-api/030-index-reads.test.js` and
    `050-closure.test.js`: both now call `getActiveBuild()` as the first thing
    `before()` does (before any mutating request), publish with
    `buildId: originalBuild.id` and `expectedRootHash: originalBuild.rootHash`
    on `/index/closure`, and register an `after()` hook — ahead of any request
    `before()` makes — that conditionally restores via `putActiveBuild()` only
    when both `originalBuild` and a confirmed `publishedRootHash` are set.
    `050-closure.test.js`'s repeated-publish call (proving idempotent
    re-publish) stays unconditional, matching its existing intent; only the
    first publish carries the precondition. Added two explicit Build-endpoint
    checks to `030-index-reads.test.js`: one asserting `GET /build` reports a
    non-empty id/rootHash, and one self-contained no-op round trip (`PUT
    /build` reassigning the current pointer to itself) proving restoration
    works without depending on or disturbing either file's own fixture.
  - `test/end-to-end/README.md`: added an "Active-build mutation and
    restoration" subsection under Publishing API coverage describing the
    observe → conditional-publish → register-`after`-early → conditional-
    restore sequence, the conflict-is-not-a-lock caveat and the
    non-concurrent-run recommendation, and a "What a run leaves behind"
    subsection stating that blobs/closures/tokens are not cleaned up and why
    that is safe (content-addressed, no delete operation in the port; UUID
    run prefixes prevent collisions).
- Current state: Complete.
- Remaining: None for this task. Actually exercising `--e2e --cloudflare` /
  `--e2e --nodejs` against a live deployment is explicitly operator/CI
  verification per this task's own Validation section — not run by this
  implementation pass. `node --check` confirmed all four touched E2E files
  parse, and the unit suite (which never loads `test/end-to-end/`) stayed
  green throughout.
- Decisions and discoveries: Confirmed the discovery already recorded above —
  before this task, `/index/*` reads always resolve `context.runtime.build.id`
  regardless of what `buildId` a `ContentTree` publish names, so the prior
  random-build-id fixtures could only have passed by coincidence or not been
  exercised; publishing through the observed active build is what makes the
  reads see the fixture at all, independent of the restoration concern.
  Confirmed via `test/unit-tests/README.md` that `kixx-test` runs a
  describe's `after` hook even when its `before` hook fails, which is what
  makes "register `after` early, guard on captured state" sufficient without
  a try/finally inside `before()`.
- Actual files changed:
  - `test/end-to-end/test-helpers/publishing-workflows.js`
  - `test/end-to-end/200-publishing-api/helpers.js`
  - `test/end-to-end/200-publishing-api/030-index-reads.test.js`
  - `test/end-to-end/200-publishing-api/050-closure.test.js`
  - `test/end-to-end/README.md`
- Validation run:
  - `node run-linter.js test/end-to-end/test-helpers/publishing-workflows.js test/end-to-end/200-publishing-api` — clean, no output.
  - `node --check` on all four touched E2E `.js` files — parsed successfully.
  - `node run-tests.js` (full unit suite) — 1279 tests, passed; the E2E suite is not part of this run by design (requires `--e2e` and a live `E2E_TESTS_BASE_URL`).
  - Not run (operator/CI only, per this task's Validation section): `node run-tests.js --e2e --cloudflare test/end-to-end/200-publishing-api/030-index-reads.test.js`, the `050-closure.test.js` Cloudflare run, `node run-tests.js --e2e --nodejs test/end-to-end/200-publishing-api`, and the post-run `GET /publishing-api/v1/build` pointer check.
- Blockers: None. The four remote validation commands above are the
  documented next step for an operator with a live target.
