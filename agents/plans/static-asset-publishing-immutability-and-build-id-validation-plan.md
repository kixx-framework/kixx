# Static Asset Publishing Immutability and Build ID Validation Implementation Plan

Close the two publishing-contract gaps introduced by Build-ID-addressed immutable asset
URLs: make a static asset address write-once under ordinary sequential Publishing API use,
and establish one shared definition of a real Build ID that cannot collide with the `dev`
no-build URL placeholder.

## Implementation Approach

The public asset identity is the pair `(Build ID, filepath)`. The first successful
`PUT /publishing-api/v1/assets/<filepath>` fixes the bytes and normalized content type at
that identity. A later sequential PUT to the same identity follows one of two paths:

- When the incoming bytes, byte length, and normalized content type match the stored asset,
  it is an idempotent retry. The API returns the existing asset description with HTTP 200
  and does not call `StaticFileStore.write()` again.
- When any of those values differ, or the existing asset has no strong validator with which
  the server can prove equality, the API returns `409 Conflict` and leaves the stored asset
  untouched. Changed output must be published under a new Build ID.

The transaction script will compute the incoming strong ETag, read the target address with
`computeEtag: true`, cancel the returned body stream, and compare the stored parts before
deciding whether to return, conflict, or write. The strong-ETag construction currently
duplicated in the two static-file-store adapters will move to one framework helper used by
the adapters and transaction script, keeping the comparison byte-identical across Node.js
and Cloudflare.

This is deliberately a **sequential** write guarantee. Per the user's decision, the work
does not add a lock, reservation record, compare-and-set store operation, or build lifecycle.
Two concurrent first PUTs to the same address can both observe a miss and the backing store
may apply them last-writer-wins. Publishing clients must serialize writes to the same
`(Build ID, filepath)`. Concurrent writes to different asset addresses remain supported.

Build IDs get a shared contract in `src/kixx/utils/build-id.js`. A real Build ID is a
non-empty, case-preserving, URL-safe **single path segment** using the existing conservative
pathname character rules; it contains no slash, has no leading dot or `..`, and is not the
reserved `NO_BUILD_ID_SEGMENT` value `dev`. The placeholder remains valid only at the asset
read boundary, where it maps to the flat store root. All Publishing API workflows that
accept `Kixx-Build-Id` validate real IDs before persistence, and `AppRuntime` rejects an
invalid configured `BUILD_ID` at startup while continuing to allow a missing build ID.

No deployed-data migration or compatibility mode is needed. The user confirmed that
existing deployments do not use `dev` or other non-URL-safe Build IDs.

The existing wire addresses remain unchanged:

```text
PUT /publishing-api/v1/assets/stylesheets/stylesheet.css
Kixx-Build-Id: <build-id>

GET /assets/<build-id>/stylesheets/stylesheet.css
```

The first write and an identical retry both remain HTTP 200 responses with the existing
JSON:API resource shape. Only a conflicting retry adds new observable behavior: HTTP 409
with error code `StaticAssetImmutableConflict`.

---

### Task 1: Enforce one real Build ID contract at runtime, publishing, and asset-read boundaries

**Status:** Not started
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/server-error-handling.md`, `src/app/transaction-scripts/README.md`, `src/app/presentation/README.md`, `src/kixx/static-file-server/README.md`, `test/unit-tests/README.md`

**Objective**

Every real Build ID accepted by the application round-trips through the
`/assets/:build_id/*pathname` URL as exactly one safe segment, while the reserved `dev`
placeholder can represent only the flat no-build asset root. Invalid external Build IDs
produce a client-visible 400 before persistence; invalid runtime configuration fails fast
as an assertion during startup.

**Scope**

- In: shared Build ID predicate/validation behavior, runtime Build ID validation, asset URL
  parameter validation, every Publishing API transaction script that accepts or derives a
  Build ID, unit coverage, and Build ID contract documentation.
- Out: changing the `dev` placeholder value, lower-casing Build IDs, adding a maximum Build
  ID length, changing asset or publishing routes, migrating stored namespaces, and adding a
  build registry or lifecycle API.

**Design and invariants**

- Extend `src/kixx/utils/build-id.js`; do not create competing Build ID validators in the
  presentation, Hyperview, or static-file-server modules.
- Keep `NO_BUILD_ID_SEGMENT = 'dev'` as the no-build URL placeholder.
- Export a pure `isValidBuildId(value)` predicate for internal/runtime assertions. It returns
  true only for a non-empty string which:
  - passes the existing `isValidPathname()` safety rules;
  - contains no `/`, including a slash obtained by decoding a route parameter;
  - is not exactly `NO_BUILD_ID_SEGMENT`.
- Export `validateBuildId(value)` as the operational validator for external Build IDs.
  Preserve the supplied case and
  return the validated value unchanged. Use:
  - `BadRequestError` with code `ReservedBuildId` when the value is exactly `dev`;
  - `BadRequestError` with code `InvalidBuildId` for every other non-empty invalid value.
  Required endpoints retain their existing `BuildIdRequired` error for a missing or empty
  header; requiredness remains the owning transaction script's concern.
- `AppRuntime` continues to accept an omitted `build`, `{ id: undefined }`, or `{ id: null }`
  as a no-build runtime. When `build.id` is present, assert `isValidBuildId(build.id)` before
  freezing the descriptor. Empty, malformed, multi-segment, and reserved IDs are programmer/
  configuration errors and must throw `AssertionError`, not an operational HTTP error.
- `StaticAssetRequestHandler` accepts `NO_BUILD_ID_SEGMENT` as its one special URL segment
  and maps it to `namespace: null`. Every other segment must satisfy the real Build ID
  validator before reaching `StaticFileStore.read()`. In particular, a decoded `a/b` value
  must be rejected even though `validatePathname()` permits safe multi-segment pathnames.
- Apply the real Build ID validator in all four Publishing API Transaction Scripts:
  - `putStaticAsset()` and `putTemplate()` retain their required-header behavior, then
    validate the supplied ID before comparing it with the current build or accessing a
    service.
  - `putPageMetadata()` and `putInclude()` keep their optional-header/current-build fallback,
    then validate the effective Build ID before accessing Hyperview. This covers direct
    non-HTTP callers as well as request handlers.
- Preserve existing validation precedence unless the Build ID is the value under test. For
  example, an empty static-asset body still reports `StaticAssetSourceRequired` before Build
  ID validation, and a missing effective page/include build still reports
  `CurrentBuildIdRequired`.
- Do not treat `DEV` or other case variants as the placeholder. Build IDs and store
  namespaces are case-sensitive and case-preserving; only the exact lowercase `dev` value
  is reserved.

**Test coverage**

- Add `test/unit-tests/kixx/utils/build-id.test.js` covering safe IDs (including mixed case,
  hyphen, underscore, and a non-leading dot), empty/non-string values, slash-containing
  values, whitespace and other disallowed characters, leading-dot values, `..`, and the
  exact reserved placeholder. Assert both predicate results and operational error codes.
- Extend `test/unit-tests/kixx/context/app-runtime.test.js` to prove absent/null Build IDs
  remain allowed, a valid ID remains exposed and frozen, and malformed or reserved IDs throw
  `AssertionError` before the runtime is constructed.
- Extend the `StaticAssetRequestHandler` unit group to prove `dev` still maps to `null`, a
  valid real Build ID is preserved, and a decoded multi-segment value such as `build/child`
  is rejected before store access.
- Extend each publishing Transaction Script test file to prove malformed and reserved
  explicit Build IDs are rejected before service access. For page metadata and includes,
  retain coverage for the no-header fallback to a valid current Build ID.
- Do not duplicate the full Build ID input matrix in every consumer test. The utility test
  owns the matrix; consumer tests prove each boundary actually calls the shared contract.

**Expected touch points**

- `src/kixx/utils/build-id.js` — shared real-ID predicate, external validator, and reserved
  placeholder contract.
- `src/kixx/context/app-runtime.js` — fail-fast validation for configured real Build IDs.
- `src/kixx/static-file-server/static-file-server-request-handlers.js` — distinguish the
  allowed no-build placeholder from validated real Build ID URL segments.
- `src/app/transaction-scripts/publishing/put-static-asset.js` — validate the required asset
  target Build ID.
- `src/app/transaction-scripts/publishing/put-template.js` — validate the required template
  target Build ID.
- `src/app/transaction-scripts/publishing/put-page-metadata.js` — validate the effective page
  target Build ID.
- `src/app/transaction-scripts/publishing/put-include.js` — validate the effective include
  target Build ID.
- `test/unit-tests/kixx/utils/build-id.test.js` — exhaustive Build ID contract coverage.
- `test/unit-tests/kixx/context/app-runtime.test.js` — runtime configuration coverage.
- `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js` —
  asset route-segment boundary coverage.
- `test/unit-tests/app/transaction-scripts/publishing/*.test.js` — Publishing API domain
  boundary coverage.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A real Build ID is accepted only when it is one safe, case-preserving URL segment and
  is not `dev`.
- [ ] Missing runtime Build IDs remain supported; configured invalid or reserved Build IDs
  fail fast with `AssertionError`.
- [ ] `/assets/dev/<key>` still reads the flat asset root, while no publishing workflow can
  persist content under a real `dev` build namespace.
- [ ] Every Publishing API workflow rejects an explicit reserved Build ID with HTTP 400 code
  `ReservedBuildId` and another malformed ID with HTTP 400 code `InvalidBuildId`.
- [ ] Existing missing-Build-ID and current-Build-ID behavior and error codes are unchanged.
- [ ] All cases listed under **Test coverage** exist and pass.

**Validation**

- `node run-linter.js src/kixx/utils/build-id.js src/kixx/context/app-runtime.js src/kixx/static-file-server/static-file-server-request-handlers.js src/app/transaction-scripts/publishing test/unit-tests/kixx/utils test/unit-tests/kixx/context/app-runtime.test.js test/unit-tests/kixx/static-file-server test/unit-tests/app/transaction-scripts/publishing` — no lint errors in the Build ID implementation or its tests.
- `node run-tests.js test/unit-tests/kixx/utils/build-id.test.js test/unit-tests/kixx/context/app-runtime.test.js test/unit-tests/kixx/static-file-server test/unit-tests/app/transaction-scripts/publishing` — focused Build ID behavior passes.
- `node run-tests.js` — the full unit suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The exact lowercase `dev` value is reserved; Build IDs remain
  case-preserving. No compatibility migration is required.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 2: Make sequential static-asset PUTs write-once and idempotent

**Status:** Not started
**Depends on:** Task 1
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/server-error-handling.md`, `src/app/transaction-scripts/README.md`, `src/kixx/static-file-server/README.md`, `src/plugins/README.md`, `test/unit-tests/README.md`

**Objective**

After the first successful sequential PUT to a `(Build ID, filepath)`, the Publishing API
never changes that address. A byte-and-content-type-identical retry succeeds without a
write; a conflicting retry returns 409 and preserves the first asset. Both runtime adapters
and the transaction script use one strong-ETag function when identifying bytes.

**Scope**

- In: shared strong static-file ETag construction, both adapter call sites, sequential
  read-before-write enforcement in `putStaticAsset()`, body-stream cleanup, error
  translation, and focused unit coverage.
- Out: atomic compare-and-set behavior, locks or reservation records, build staging/sealing,
  changing `StaticFileStore.write()` into a create-only primitive, blocking out-of-band
  deployment tooling, and changing the successful JSON:API response shape.

**Design and invariants**

- Add one framework-owned helper under `src/kixx/static-file-server/` which computes the
  quoted strong ETag used by static files: SHA-256 lowercase hex wrapped in double quotes.
  It delegates hashing to `sha256Hex()` and works with the same byte inputs accepted today.
- Replace the inline quoted-SHA construction in both Node and Cloudflare static-file-store
  adapters with the shared helper. This is a mechanical ownership change; their stored ETag
  values and read/write behavior must remain byte-for-byte compatible.
- Keep `StaticFileStore.write()` as an overwrite-capable low-level port. The Publishing API
  Transaction Script owns the write-once business rule; out-of-band deploy tooling and
  other future callers are not silently given new semantics.
- In `putStaticAsset()`, retain the existing body, required Build ID, Build ID validity, and
  current-build checks before store access. A request targeting the current build still
  returns `CurrentBuildWriteConflict`, even if its bytes happen to match.
- Compute the incoming strong ETag once, then call:

  ```js
  store.read(context, {
      key: filepath,
      namespace: buildId,
      computeEtag: true,
  })
  ```

- When the read returns `null`, call `store.write()` exactly as today. The store remains the
  source of truth for the returned write parts; do not synthesize a successful first-write
  response from the precomputed ETag.
- When the read returns an asset, cancel its body before returning or throwing so a Node file
  stream or binding stream is never leaked. Treat a null body as already cleaned up.
- An existing asset is an identical retry only when all three comparisons match:
  - stored `etag` equals the incoming strong ETag;
  - stored `contentLength` equals the incoming byte length;
  - stored `contentType` equals the request handler's normalized media type.
- For an identical retry, do not call `write()`. Return the requested `filepath` together
  with the existing `contentType`, `contentLength`, and `etag` in the same shape used by a
  first write, so the request handler continues returning HTTP 200 with an unchanged
  JSON:API schema. `StaticFileResult` does not carry a key, so do not expect one from
  `read()`.
- If any comparison differs, or the existing result has no strong ETag, throw
  `ConflictError` with code `StaticAssetImmutableConflict` and a client-safe message stating
  that the address already exists with different content or content type. Do not disclose
  storage paths or validators in the error.
- Translate unexpected `read()`, body-cancellation, and `write()` failures into
  `AssertionError` with the original `cause` and a phase-specific message. Do not catch and
  wrap the intentional `ConflictError`.
- Document the agreed concurrency boundary in code and the public guide: publishing clients
  must serialize PUTs to the same `(Build ID, filepath)`. The transaction script provides
  no guarantee when two first writes race after both observe a miss. Do not imply that
  Cloudflare KV provides compare-and-set semantics.

**Test coverage**

- Add a focused unit test for the shared ETag helper proving it returns the exact quoted
  lowercase SHA-256 value expected by the existing adapters.
- Update the `putStaticAsset` Transaction Script harness with tracked `read()` results and a
  cancellable body double.
- Prove a missing target is read with the exact key, namespace, and `computeEtag: true`, then
  written once with the original bytes and normalized content type.
- Prove an identical existing asset is cancelled, returned with its existing parts, and
  never written.
- Prove changed bytes with the same content type returns
  `409 StaticAssetImmutableConflict`, cancels the existing body, and never writes.
- Prove identical bytes with a changed content type returns the same conflict.
- Prove a length mismatch or absent stored ETag is conservatively treated as a conflict.
- Prove current-build rejection happens before both `read()` and `write()`.
- Prove read, body-cancellation, and write failures become phase-appropriate
  `AssertionError`s preserving `cause`.
- Update the publishing request-handler test store double to implement `read()` as a miss by
  default, and add one integration-style handler case showing an immutable `ConflictError`
  propagates for the route's JSON:API error handler without a second write. Keep detailed
  JSON:API serialization assertions in Task 3's end-to-end coverage.

**Expected touch points**

- `src/kixx/static-file-server/static-file-etag.js` — shared quoted strong-ETag computation.
- `src/plugins/node-static-file-server/lib/static-file-server-store.js` — use the shared
  helper without changing stored values.
- `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js` — use the same
  helper without changing stored values.
- `src/app/transaction-scripts/publishing/put-static-asset.js` — sequential read-before-write,
  equality decision, stream cleanup, and immutable conflict.
- `test/unit-tests/kixx/static-file-server/static-file-etag.test.js` — shared ETag behavior.
- `test/unit-tests/app/transaction-scripts/publishing/put-static-asset.test.js` — write-once
  domain behavior and error translation.
- `test/unit-tests/app/presentation/request-handlers/publishing-api/put-static-asset.test.js`
  — handler/store-double compatibility and conflict propagation.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The Node adapter, Cloudflare adapter, and Publishing API comparison use one strong
  static-file ETag helper and retain the existing quoted SHA-256 format.
- [ ] The first sequential PUT to an unused address writes once and returns the existing
  HTTP 200 resource contract.
- [ ] An identical sequential retry returns HTTP 200 with the existing parts and performs
  no write.
- [ ] A sequential retry with different bytes, length, or normalized content type returns
  `409 StaticAssetImmutableConflict`, performs no write, and leaves the first asset intact.
- [ ] An existing asset without a strong ETag is never overwritten through the Publishing
  API.
- [ ] Every existing result body is cancelled on both idempotent and conflict paths.
- [ ] Current-build protection and all pre-existing input errors remain unchanged.
- [ ] The implementation and documentation explicitly state that concurrent first writes
  to the same address are unsupported and not made atomic by this task.
- [ ] All cases listed under **Test coverage** exist and pass.

**Validation**

- `node run-linter.js src/kixx/static-file-server src/plugins/node-static-file-server/lib/static-file-server-store.js src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js src/app/transaction-scripts/publishing/put-static-asset.js test/unit-tests/kixx/static-file-server test/unit-tests/app/transaction-scripts/publishing/put-static-asset.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-static-asset.test.js` — no lint errors.
- `node run-tests.js test/unit-tests/kixx/static-file-server test/unit-tests/app/transaction-scripts/publishing/put-static-asset.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-static-asset.test.js` — focused immutable-write behavior passes.
- `node run-tests.js` — the full unit suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Sequential equality is defined by ETag, byte length, and
  normalized content type. No concurrent-write guarantee is in scope.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 3: Publish the corrected API contract in end-to-end coverage and documentation

**Status:** Not started
**Depends on:** Task 1, Task 2
**Documentation:** `src/app/presentation/README.md`, `src/kixx/static-file-server/README.md`, `src/plugins/README.md`, `test/end-to-end/README.md`

**Objective**

The repository's executable Publishing API examples and written static-file contract agree
with the new behavior: build-addressed assets are publicly reachable and immutable after
their first sequential write; identical retries are safe; conflicting retries are 409; and
`dev` is not a publishable Build ID.

**Scope**

- In: Publishing API end-to-end success/error cases, stale comments that describe the old
  current-build-only reader, static-file-store interface documentation, and the static file
  server guide.
- Out: adding a standalone Publishing API specification site, testing concurrent races,
  adding deletion/pruning behavior, changing authentication/authorization, and changing
  deploy tooling outside this repository.

**Design and invariants**

- Replace the end-to-end scenario which currently expects two different payloads at the
  same address to succeed. Keep its single-segment filepath coverage, but split the contract
  into two observable cases, each using its own filepath so test order cannot make one case
  depend on the other:
  - two identical PUTs return 200 and the same resource parts;
  - a second PUT with changed bytes returns a JSON:API 409 error with code
    `StaticAssetImmutableConflict`.
- After a conflicting retry, GET the public
  `/assets/<build-id>/<filepath>` URL and prove it still returns the first bytes, content
  type, and ETag with the immutable cache policy. This is now possible because the new asset
  handler intentionally reads any stored Build ID, including the test run's staged ID.
- Update the old end-to-end comments which say staged writes cannot be read back. The route
  is public and namespace-addressed; immutability, not invisibility until promotion, is now
  what makes that safe.
- Add end-to-end error coverage showing `Kixx-Build-Id: dev` returns HTTP 400 with code
  `ReservedBuildId`, and a representative malformed single-segment violation returns HTTP
  400 with code `InvalidBuildId`. Unit tests own the exhaustive matrix and coverage of the
  other Publishing API workflows.
- Update the static-file-server guide to state:
  - `/assets/<build-id>/<key>` can serve staged, current, or historical stored namespaces;
  - the first sequential asset PUT fixes that address;
  - identical retries return the existing resource without rewriting;
  - conflicting bytes or content type return 409 and require a new Build ID;
  - clients must serialize writes to the same address because no atomic concurrency
    guarantee is provided;
  - real Build IDs are safe URL segments and cannot equal `dev`.
- Correct `static-file-server-store-interface.js` without changing its executable contract:
  distinguish the current-build `StaticFileRequestHandler` lookup from the URL-namespaced
  `StaticAssetRequestHandler` lookup, state that raw `write()` remains overwrite-capable,
  and state that the Publishing API caller enforces sequential write-once behavior by
  reading first.
- Update `route-params.js` comments which still name `StaticFileRequestHandler` as the asset
  reader; the case-preserving claim now belongs to `StaticAssetRequestHandler`.
- Do not edit the completed historical plan
  `agents/plans/static-asset-request-handler-implementation-plan.md`. This plan records the
  follow-up correction rather than rewriting the earlier handoff.

**Expected touch points**

- `test/end-to-end/020-publishing-api/put-static-asset.test.js` — identical retry,
  conflicting retry, and read-after-conflict behavior.
- `test/end-to-end/020-publishing-api/put-static-asset-errors.test.js` — reserved and malformed
  Build ID JSON:API errors.
- `src/kixx/static-file-server/README.md` — corrected public read/write and Build ID contract.
- `src/kixx/static-file-server/static-file-server-store-interface.js` — accurate low-level
  store and caller-responsibility documentation.
- `src/app/presentation/request-handlers/publishing-api/route-params.js` — current asset
  reader name in the case-preservation rationale.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] End-to-end coverage proves identical retries succeed without changing the resource.
- [ ] End-to-end coverage proves conflicting retries return the expected JSON:API 409 and
  the public asset URL still serves the first representation.
- [ ] End-to-end coverage proves reserved and malformed Build IDs return their documented
  HTTP 400 codes.
- [ ] No current documentation claims that a stored staged namespace is unreachable until
  promotion or that “not current” alone makes asset writes immutable.
- [ ] Documentation clearly separates the overwrite-capable store port from the sequential
  write-once Publishing API policy and records the lack of a concurrent-write guarantee.
- [ ] The publishing route, asset route, successful JSON:API schema, and asset upload key
  remain unchanged.

**Validation**

- `node run-linter.js src/kixx/static-file-server/static-file-server-store-interface.js src/app/presentation/request-handlers/publishing-api/route-params.js test/end-to-end/020-publishing-api/put-static-asset.test.js test/end-to-end/020-publishing-api/put-static-asset-errors.test.js` — no lint errors in documentation-bearing JavaScript and end-to-end coverage.
- `node run-tests.js` — the full unit suite still passes after documentation and end-to-end fixture changes.
- `node run-tests.js --e2e --development test/end-to-end/020-publishing-api/put-static-asset.test.js test/end-to-end/020-publishing-api/put-static-asset-errors.test.js` — focused local end-to-end behavior passes when the user explicitly authorizes starting the development server and running end-to-end tests.
- `node run-tests.js --e2e --nodejs test/end-to-end/020-publishing-api/put-static-asset.test.js test/end-to-end/020-publishing-api/put-static-asset-errors.test.js` — focused deployed-Node behavior passes when credentials, target configuration, and explicit authorization are available.
- `node run-tests.js --e2e --cloudflare test/end-to-end/020-publishing-api/put-static-asset.test.js test/end-to-end/020-publishing-api/put-static-asset-errors.test.js` — focused Cloudflare behavior passes when credentials, target configuration, and explicit authorization are available.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The API route and success schema remain stable. End-to-end tests
  may now read staged test assets through the public Build-ID route.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
