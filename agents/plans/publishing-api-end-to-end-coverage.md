# Publishing API End-to-End Coverage

## Implementation Approach

Add a new end-to-end suite at `test/end-to-end/200-publishing-api/` covering
the Publishing API (`docs/publishing-api.md`, routed in
`src/routes/publishing-api-v1.js`): authentication/authorization, resource
uploads across all eight resource kinds, published-reference reads, generic
JSON:API protocol errors, and the content-tree closure workflow.

| File | Responsibility |
| --- | --- |
| `010-authentication.test.js` | 401 (missing/malformed/unknown bearer) and 403 `PublishingApiTokenInactive` (revoked token), against one representative endpoint. |
| `020-resource-uploads.test.js` | Happy-path upload -> `{hash, size}` for all 8 resource kinds; one 422 case per distinct JSON:API body shape; static-asset empty-body 400. |
| `030-index-reads.test.js` | `GET`/`HEAD` `/index/*` round trip against freshly uploaded resources; 404 for an unpublished pathname. |
| `040-protocol-errors.test.js` | 405 (wrong method), 415 (wrong content-type), 409 (`JsonApiResourceTypeMismatch`), 400 (malformed JSON:API body), each against one representative JSON:API write endpoint. |
| `050-closure.test.js` | Full-tree `ContentTree` referencing all 8 uploaded facets; 201 with deterministic hash; idempotent re-publish; downstream `/index/*` reads reflect the published closure. |

Two supporting modules carry shared, side-effect-free code (helper functions,
not shared mutable state), so every file above stays independently runnable
per `test/end-to-end/README.md`'s load-order guarantees:

- `test/end-to-end/test-helpers/publishing-workflows.js` — cross-suite
  reusable: `createPublishingApiToken`, `revokePublishingApiToken`, and one
  upload helper per resource kind (`uploadStaticAsset`, `uploadPagePartials`,
  etc.), analogous to the existing `admin-workflows.js`.
- `test/end-to-end/200-publishing-api/helpers.js` — suite-local: a random
  run-scoped prefix (`e2e-<uuid>`) used to namespace every `buildId` and
  content pathname created by this suite, so runs against shared remote
  targets (`--cloudflare`, `--nodejs`) never collide with real content or a
  concurrent test run. No cleanup step is needed: uploaded blobs are
  content-addressed and immutable, and random `buildId`s never collide with a
  real build name.

### Decisions carried into every task

- **Token minting:** Basic-auth `POST /admin-api/v1/publishing-api-tokens`
  using the root admin's env credentials (`E2E_TESTS_ROOT_USERNAME` /
  `E2E_TESTS_ROOT_PASSWORD`) directly via `loginRootAdmin()`'s credentials —
  no invite/signup round trip. `root-admin` and `developer` roles have
  identical publishing-token permissions per `docs/admin-api.md`, so there is
  no coverage benefit to a fresh super admin here.
- **Revocation:** there is no JSON:API revoke endpoint. Use the existing HTML
  admin-panel flow (`POST /admin/publishing-api-tokens/revoke`, session login
  via `loginRootAdmin()` + CSRF) to produce a `PublishingApiTokenInactive`
  token. This also covers token expiry, since revoked and expired tokens
  share the same code path and error code — no separate TTL-based test.
- **403 `FORBIDDEN_ERROR` (permission gap) is out of scope.** The Admin API
  only accepts `roles: ["editor"]` (or `root-admin`/`developer`/`admin`, which
  carry the same publishing permissions) when minting a token — any other
  role value fails validation at mint time. There is no way to mint an
  authenticated token that lacks the required permission through the public
  API surface, so this error code cannot be reached without bypassing the
  mint endpoint's own validation. Each test file notes this gap with a
  one-line comment rather than fabricating a scenario.
- **Full 8-kind resource matrix**, not a representative subset: static
  assets, global-template-partials, base-templates, page-metadata,
  page-partials, page-includes, page-templates, emails each get their own
  upload -> stat/index round trip.
- **422 coverage is one case per distinct JSON:API body shape**, not one per
  resource kind: a `bundle` array entry missing `id`/`source` (covers
  `GlobalTemplatePartials`/`BaseTemplates`/`PagePartials`), a `PageIncludes`
  bundle with a non-string value, and an `EmailAssets` partial-object with a
  malformed nested object. Exhaustive per-field, per-kind validation is unit
  test territory (`test/unit-tests/`).
- **Protocol errors use one representative JSON:API write endpoint**
  (`PUT /resources/page-metadata`) for 415/400/409, and one recognized GET
  path (`GET /index/page-metadata`) for 405 — these checks live in shared
  request-parsing code ahead of any resource-specific logic.
- **Closure test is self-contained**: it uploads its own copy of all 8
  resources in its own `before()` rather than depending on
  `020-resource-uploads.test.js` having run, preserving independent
  runnability.

Agent verification is subject to the project rule against starting the
development server or calling remote servers. The end-to-end commands below
are operator/CI checks against an already-running target. The implementing
agent runs linting and records the end-to-end checks as not run when no
permitted target is available.

### Task P1: Shared publishing-workflow helpers

**Status:** Complete
**Depends on:** None
**Documentation:** `docs/admin-api.md`, `docs/publishing-api.md`, `test/end-to-end/README.md`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`

**Objective**

Provide reusable, side-effect-free functions for minting/revoking Publishing
API tokens and uploading each of the 8 resource kinds, so every test file in
`200-publishing-api/` can obtain a token and upload fixtures without
duplicating HTTP/JSON:API plumbing.

**Scope**

- In: `test/end-to-end/test-helpers/publishing-workflows.js` — token
  lifecycle and per-resource-kind upload functions, each returning the
  parsed JSON:API response (or throwing with a descriptive message on an
  unexpected status, matching the style of `admin-workflows.js`).
- Out: any suite-specific fixture data, random-prefix generation (that is
  suite-local, see P2), and the test files themselves (P3-P7).

**Design and invariants**

- `createPublishingApiToken(options)` — POSTs to
  `/admin-api/v1/publishing-api-tokens` with HTTP Basic auth. Defaults
  `username`/`password` to `process.env.E2E_TESTS_ROOT_USERNAME` /
  `process.env.E2E_TESTS_ROOT_PASSWORD` (reuse the same env-var assertions
  `loginRootAdmin()` uses). Accepts optional `roles`, `timeToLiveSeconds`,
  `description` attributes. Returns `{ token, id, roles, description,
  tokenCreationDate, tokenExpirationDate }` from the response `data`.
  Throws on a non-201 response.
- `revokePublishingApiToken(tokenId)` — logs in the root admin via
  `loginRootAdmin()` (imported from `admin-workflows.js`), loads
  `/admin/publishing-api-tokens` for a CSRF token, then POSTs to
  `/admin/publishing-api-tokens/revoke` with the token id and CSRF token.
  Throws on an unexpected status.
- One upload function per resource kind, each taking `(publishingToken,
  pathname, ...kindSpecificArgs)` and returning `{ hash, size }` parsed from
  the 201 response: `uploadStaticAsset`, `uploadGlobalTemplatePartials`,
  `uploadBaseTemplates`, `uploadPageMetadata`, `uploadPageIncludes`,
  `uploadPagePartials`, `uploadPageTemplate`, `uploadEmailAssets`. Each sets
  the `Authorization: Bearer <token>` header and the correct
  `Content-Type` (`application/vnd.api+json` for JSON:API bodies,
  `text/plain` for page templates, none required for static assets).
- Functions take the target base URL from the existing
  `test-helpers/target-url.js` `getBaseUrl()`, matching every other helper.

**Expected touch points**

- `test/end-to-end/test-helpers/publishing-workflows.js` — new file.

**Acceptance criteria**

- [x] Every function is documented per `src/docs/code-documentation-guide.md`.
- [x] Functions throw descriptive errors on unexpected HTTP status, matching
      the style of `admin-workflows.js`'s `createAdminInvite`.
- [x] No module-level mutable state beyond simple caching consistent with
      `admin-workflows.js` (none is required here since each call mints a
      fresh token or upload).

**Validation**

- `node run-linter.js test/end-to-end/test-helpers/publishing-workflows.js` — lint clean.
- Exercised indirectly by P3-P7's end-to-end runs; no unit tests (this is
  end-to-end test support code, not application source).

**Progress and handoff**

- Completed: Added token lifecycle and all eight resource-upload helpers.
- Current state: Complete.
- Remaining: P2-P8.
- Decisions and discoveries: Upload handlers return JSON:API resources with `{ hash, size }` in `data.attributes`; JSON:API upload endpoints require `application/vnd.api+json`, while page templates require `text/plain`. Static assets intentionally send no `Content-Type`.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/test-helpers/publishing-workflows.js`.
- Validation run: `node run-linter.js test/end-to-end/test-helpers/publishing-workflows.js` (passed); `git diff --check` (passed).
- Blockers: None.

---

### Task P2: Suite-local run-id helper

**Status:** Complete
**Depends on:** None
**Documentation:** `test/end-to-end/README.md`, `src/docs/code-style-guide.md`

**Objective**

Give every file in `200-publishing-api/` a shared, random, run-scoped prefix
for `buildId`s and content pathnames, so test data never collides with real
content or a concurrent run on shared remote targets — without introducing a
data dependency between files (it is pure ID generation, computed
independently by each importer, not state produced by one file's HTTP calls).

**Scope**

- In: `test/end-to-end/200-publishing-api/helpers.js` — exports a function
  (or constant) producing e.g. `e2e-<uuid>` and helpers to build namespaced
  pathnames/buildIds from it.
- Out: token/upload helpers (P1), any test assertions.

**Design and invariants**

- The prefix must be safe as both a `buildId` value and as a path segment in
  canonical content pathnames (lowercase, no whitespace, no leading dots).
  Use `crypto.randomUUID()` lowercased, consistent with
  `admin-workflows.js`'s `SUPER_ADMIN_USERNAME` pattern.
- Each importing file calls the generator itself (e.g. at module load), so
  no file depends on another file having run — this keeps files
  independently runnable per the README's explicit convention.

**Expected touch points**

- `test/end-to-end/200-publishing-api/helpers.js` — new file.

**Acceptance criteria**

- [x] Generated prefixes are lowercase and pathname-safe.
- [x] No shared mutable state is read across files; each file that imports
      this generates its own prefix value.

**Validation**

- `node run-linter.js test/end-to-end/200-publishing-api/helpers.js` — lint clean.

**Progress and handoff**

- Completed: Added pure run-prefix, build-ID, and content-pathname helpers.
- Current state: Complete.
- Remaining: P3-P8.
- Decisions and discoveries: Every importing test file will create its own prefix at module load, preserving independent file execution. The UUID prefix is lowercased and begins with `e2e-`, which is safe as both a build ID and pathname segment.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/helpers.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/helpers.js` (passed); `git diff --check` (passed).
- Blockers: None.

---

### Task P3: Authentication and authorization coverage

**Status:** Complete
**Depends on:** P1, P2
**Documentation:** `docs/publishing-api.md` (Authentication and authorization), `docs/admin-api.md` (Create a publishing API token), `test/end-to-end/010-csrf/030-admin-mutations.test.js` (revoke pattern reference)

**Objective**

Prove the Publishing API's auth boundary: missing/malformed/unknown bearer
tokens are rejected before any endpoint logic runs, and a revoked token is
rejected with the documented `PublishingApiTokenInactive` code.

**Scope**

- In: `test/end-to-end/200-publishing-api/010-authentication.test.js`.
  401 cases (no `Authorization` header, malformed header, well-formed but
  unknown token) and the 403 `PublishingApiTokenInactive` case (mint, revoke
  via `revokePublishingApiToken`, then use), all against one representative
  endpoint (`GET /publishing-api/v1/index/base-templates`).
- Out: 403 `FORBIDDEN_ERROR` (documented as out of scope — add a one-line
  comment explaining why, per the Implementation Approach). Per-endpoint
  repetition of these checks (covered once, since `authorize()` wiring is
  identical across routes).

**Design and invariants**

- File must be independently runnable: mint and revoke its own token, use
  `getBaseUrl()` for the target.
- Assert exact documented codes/status: `401 UNAUTHENTICATED_ERROR`,
  `403 PublishingApiTokenInactive`.

**Expected touch points**

- `test/end-to-end/200-publishing-api/010-authentication.test.js` — new file.

**Acceptance criteria**

- [x] Missing, malformed, and unknown bearer credentials each return 401
      with code `UNAUTHENTICATED_ERROR`.
- [x] A revoked token returns 403 with code `PublishingApiTokenInactive`.
- [x] A one-line comment documents why `FORBIDDEN_ERROR` is not covered.

**Validation**

- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api/010-authentication.test.js`

**Progress and handoff**

- Completed: Added missing, malformed, unknown, and revoked bearer-token coverage against the base-template index endpoint.
- Current state: Complete.
- Remaining: P4-P8.
- Decisions and discoveries: `FORBIDDEN_ERROR` cannot be produced through the public token-mint endpoint because it rejects every role without Publishing API permissions. The revoked-token scenario uses the HTML admin flow, exercising the same inactive-token path as expiry.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/010-authentication.test.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/010-authentication.test.js test/end-to-end/200-publishing-api/helpers.js test/end-to-end/test-helpers/publishing-workflows.js` (passed); `git diff --check` (passed). The listed end-to-end command was not run: project instructions prohibit starting a development server or calling remote servers for verification, and no already-running permitted target is available.
- Blockers: None.

---

### Task P4: Resource upload coverage

**Status:** Complete
**Depends on:** P1, P2
**Documentation:** `docs/publishing-api.md` (Upload resources), `src/app/presentation/request-handlers/publishing-api/mod.js`

**Objective**

Prove every one of the 8 resource-upload endpoints accepts a valid body and
returns the documented `{data.id, attributes.hash, attributes.size}` 201
shape, and that each distinct JSON:API body shape used by these endpoints
rejects an invalid body with 422.

**Scope**

- In: `test/end-to-end/200-publishing-api/020-resource-uploads.test.js`.
  Happy-path upload for all 8 kinds (static asset, global-template-partials,
  base-templates, page-metadata, page-partials, page-includes,
  page-template, email assets). One 422 case per distinct body shape:
  `bundle` array entry missing `id`/`source`; `PageIncludes` bundle with a
  non-string value; `EmailAssets` with a malformed nested object. Static
  asset empty-body 400.
- Out: index/stat reads (P5), closure (P6), protocol-level errors not tied
  to a specific resource shape (P7).

**Design and invariants**

- Use `helpers.js`'s run prefix for every uploaded pathname.
- Assert the documented 201 shape exactly: `data.type`, `data.id` equals
  `attributes.hash`, `attributes.size` matches byte length, `pathname`
  present where the resource has one.

**Expected touch points**

- `test/end-to-end/200-publishing-api/020-resource-uploads.test.js` — new file.

**Acceptance criteria**

- [x] All 8 resource kinds: happy-path PUT returns 201 with correct
      `hash`/`size`/`pathname`.
- [x] Three 422 cases (one per distinct body shape) return `VALIDATION_ERROR`.
- [x] Static-asset empty body returns 400 `BAD_REQUEST_ERROR`.

**Validation**

- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api/020-resource-uploads.test.js`

**Progress and handoff**

- Completed: Added happy-path coverage for all eight upload kinds, three JSON:API shape-specific validation failures, and the empty-static-asset rejection.
- Current state: Complete.
- Remaining: P5-P8.
- Decisions and discoveries: Upload responses consistently expose `data.type`, `data.id`, and `data.attributes`; only path-addressed resources include `pathname`. JSON:API envelopes are parsed before storage, so expected sizes use the canonical payload rather than the request document.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/020-resource-uploads.test.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/020-resource-uploads.test.js` (passed); `git diff --check` (passed). The listed end-to-end command was not run: project instructions prohibit starting a development server or calling remote servers for verification, and no already-running permitted target is available.
- Blockers: None.

---

### Task P5: Published-reference read coverage

**Status:** Complete
**Depends on:** P1, P2
**Documentation:** `docs/publishing-api.md` (Read published resource references)

**Objective**

Prove `/index/*` endpoints return the correct reference for content that has
actually been published (not merely uploaded), and 404 for content that has
never been published.

**Scope**

- In: `test/end-to-end/200-publishing-api/030-index-reads.test.js`. Because
  `/index/*` reads the published snapshot, not raw uploads, this file
  publishes a minimal closure of its own (uploads + one `PUT /index/closure`)
  in its `before()`, then reads each `/index/*` endpoint (`GET` and `HEAD`)
  against it. 404 for an unpublished, never-uploaded pathname.
- Out: the full 8-facet closure workflow assertions (that belongs to P6);
  this file's closure is just fixture setup.

**Design and invariants**

- File is independently runnable: uploads and publishes its own closure
  under its own run-prefixed `buildId`.
- `HEAD` assertions check status/headers only, no body, per the documented
  contract.

**Expected touch points**

- `test/end-to-end/200-publishing-api/030-index-reads.test.js` — new file.

**Acceptance criteria**

- [x] Each of the 8 `/index/*` reference kinds (static-asset,
      global-template-partials, base-templates, page-metadata,
      page-partials, page-includes, page-template, email) returns 200 with
      the correct hash/size/pathname after publishing, both `GET` and `HEAD`.
- [x] An unpublished pathname returns 404 `NOT_FOUND_ERROR`.

**Validation**

- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api/030-index-reads.test.js`

**Progress and handoff**

- Completed: Added a self-contained full-facet published fixture and coverage for GET, HEAD, and absent published references.
- Current state: Complete.
- Remaining: P6-P8.
- Decisions and discoveries: The API documentation has eight index endpoint kinds despite this task's prior acceptance-criteria wording saying seven; the test covers all eight. The closure fixture is intentionally comprehensive so every GET and HEAD endpoint reads an independently uploaded, published reference.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/030-index-reads.test.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/030-index-reads.test.js` (passed); `git diff --check` (passed). The listed end-to-end command was not run: project instructions prohibit starting a development server or calling remote servers for verification, and no already-running permitted target is available.
- Blockers: None.

---

### Task P6: Protocol-level error coverage

**Status:** Complete
**Depends on:** P1, P2
**Documentation:** `docs/publishing-api.md` (Protocol conventions, Error documents)

**Objective**

Prove the generic JSON:API protocol checks (method, media type, resource
type, malformed body) that apply uniformly across write endpoints, using one
representative endpoint rather than repeating per resource kind.

**Scope**

- In: `test/end-to-end/200-publishing-api/040-protocol-errors.test.js`.
  405 via `POST /publishing-api/v1/index/page-metadata` (GET/HEAD-only
  path). 415 via `PUT /publishing-api/v1/resources/page-metadata` with a
  wrong `Content-Type`. 400 via the same endpoint with a malformed JSON:API
  body. 409 via the same endpoint with a `data.type` other than
  `PageMetadata`.
- Out: resource-shape-specific 422 cases (owned by P4).

**Design and invariants**

- File is independently runnable: mints its own token.
- Assert the `Allow` header on the 405 response per the documented contract.

**Expected touch points**

- `test/end-to-end/200-publishing-api/040-protocol-errors.test.js` — new file.

**Acceptance criteria**

- [x] 405 `METHOD_NOT_ALLOWED_ERROR` with an `Allow` header.
- [x] 415 `UNSUPPORTED_MEDIA_TYPE_ERROR` for a wrong content type.
- [x] 400 `BAD_REQUEST_ERROR` for a malformed JSON:API document.
- [x] 409 `JsonApiResourceTypeMismatch` for a wrong `data.type`.

**Validation**

- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api/040-protocol-errors.test.js`

**Progress and handoff**

- Completed: Added representative method, media-type, malformed-document, and resource-type rejection coverage.
- Current state: Complete.
- Remaining: P7-P8.
- Decisions and discoveries: The recognized page-metadata index route advertises `GET, HEAD` in its Allow header. JSON:API parser failures are covered with an authenticated token so authorization cannot mask protocol behavior.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/040-protocol-errors.test.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/040-protocol-errors.test.js` (passed); `git diff --check` (passed). The listed end-to-end command was not run: project instructions prohibit starting a development server or calling remote servers for verification, and no already-running permitted target is available.
- Blockers: None.

---

### Task P7: Content-tree closure workflow coverage

**Status:** Complete
**Depends on:** P1, P2
**Documentation:** `docs/publishing-api.md` (Publish a content tree, Typical publishing workflow)

**Objective**

Prove the full documented publishing workflow end-to-end: upload every
facet, assemble a complete `ContentTree`, publish it, confirm the
deterministic closure hash and idempotent re-publish, and confirm `/index/*`
reads now reflect the published closure.

**Scope**

- In: `test/end-to-end/200-publishing-api/050-closure.test.js`. Uploads its
  own copy of all 8 resource kinds under its own run-prefixed pathnames and
  `buildId` (self-contained, does not depend on P4's uploads). Assembles one
  `ContentTree` referencing every facet (`staticAssets`,
  `globalTemplatePartials`, `baseTemplates`, one page's
  `metadata`/`partials`/`includes`/`template`, `emails`). `PUT
  /index/closure`, assert 201 with `data.id`, `attributes.hash`,
  `attributes.nodeCount`, `attributes.buildId`. Re-PUT the identical tree,
  assert the same hash (content-idempotent). `GET` a couple of `/index/*`
  endpoints for facets in the tree, confirm they reflect the published hash.
- Out: partial/omitted-facet closure semantics beyond what's needed to prove
  the happy path (unit-test territory).

**Design and invariants**

- File is independently runnable.
- Every reference in the `ContentTree` must use the exact `{hash, size}`
  pair returned by that facet's upload — mismatches would surface as a 422,
  not the outcome under test.

**Expected touch points**

- `test/end-to-end/200-publishing-api/050-closure.test.js` — new file.

**Acceptance criteria**

- [x] Full-tree publish returns 201 with `buildId`, deterministic `hash`,
      and `nodeCount`.
- [x] Re-publishing the identical tree returns the same `hash`.
- [x] Post-publish `/index/*` reads for facets in the tree return matching
      hashes.

**Validation**

- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api/050-closure.test.js`
- `node run-tests.js --e2e --development test/end-to-end/200-publishing-api` — full suite together.

**Progress and handoff**

- Completed: Added self-contained upload, full-tree publish, idempotent re-publish, and published-index read coverage.
- Current state: Complete.
- Remaining: P8.
- Decisions and discoveries: The closure fixture uses every upload helper and passes its exact `{ hash, size }` result into the ContentTree. The index checks compare read references directly with the corresponding upload result.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/200-publishing-api/050-closure.test.js`.
- Validation run: `node run-linter.js test/end-to-end/200-publishing-api/050-closure.test.js` (passed); `git diff --check` (passed). The listed end-to-end commands were not run: project instructions prohibit starting a development server or calling remote servers for verification, and no already-running permitted target is available.
- Blockers: None.

---

### Task P8: Document the new suite

**Status:** Complete
**Depends on:** P3, P4, P5, P6, P7
**Documentation:** `test/end-to-end/README.md`

**Objective**

Make the new suite discoverable the same way the CSRF suite is documented,
so operators/CI know what it covers and how to run it standalone.

**Scope**

- In: a new section in `test/end-to-end/README.md` describing
  `200-publishing-api/`'s file breakdown (mirroring the CSRF coverage
  table) and its standalone run commands.
- Out: any change to the CSRF section or other existing suite docs.

**Design and invariants**

- Match the existing table style and standalone-run command style used for
  `010-csrf/`.

**Expected touch points**

- `test/end-to-end/README.md` — new section.

**Acceptance criteria**

- [x] A table lists each file under `200-publishing-api/` and its coverage.
- [x] Standalone run commands are given for each file and for the suite as
      a whole.

**Validation**

- Manual review against the CSRF section for consistency.

**Progress and handoff**

- Completed: Added the Publishing API coverage table and focused test commands.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: The section mirrors the existing CSRF section and lists only test files; shared helper modules remain implementation detail.
- Actual files changed: `agents/plans/publishing-api-end-to-end-coverage.md`, `test/end-to-end/README.md`.
- Validation run: Manual review against the CSRF section (passed); `node run-linter.js test/end-to-end/200-publishing-api` (passed); `git diff --check` (passed).
- Blockers: None.
