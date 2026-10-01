# Administrative Data API

## Implementation Approach

Build a trusted administrative JSON:API surface at `/admin-data-api/v1/`.
Application-owned resource registrations explicitly expose Collections and
separately enable direct writes. Shared administrative Transaction Scripts own
authorization, input restrictions, validation, concurrency, and persistence.
Direct writes intentionally bypass application workflows, but never Record
validation or the resource registration's restrictions.

Use a dedicated bearer-token Collection. Administrators create and revoke tokens
through session-authenticated, CSRF-protected admin pages. Secrets appear only
in the creation response; store only a cryptographic verifier. Tokens carry
explicit per-Collection grants, independent of Publishing API roles.

The first resource is `File`. Its metadata lives in the Document Store, while
its bytes live behind the custom `FileContent` Collection. The user selected
record-only CRUD: this API neither uploads nor deletes bytes. Do not reuse
existing file update/delete retry behavior: reject stale client versions.

Keep protocol code portable, use existing gateways, and install no dependencies.
Implement ordinary modules and functions, with shared mechanics rather than a
new inheritance hierarchy. Implementation progress is recorded per task below.

### Confirmed requirements

- Trusted administrative access, using JSON:API resource documents.
- Exact route prefix: `/admin-data-api/v1/`.
- Bearer API access tokens; no username/password Basic authentication here.
- Admin-panel token creation/revocation; secret shown once at creation.
- Per-Collection grants.
- Explicit Collection exposure and explicit direct-write enablement.
- Direct edits may bypass application workflows.
- At least one complete CRUD resource, using File, with checked versions.
- File CRUD edits records and content references only; binary lifecycle is outside scope.

### Proposed defaults

- Public resource type `files` maps to Collection `File`.
- Grants name registered Collections and explicit actions: `list`, `get`,
  `create`, `update`, `delete`. No implicit wildcard grants to future Collections.
- Effective access is the intersection of token grants and current registration.
- Token grants are immutable; replace/revoke tokens to change access. Include
  description, creator, creation time, expiration, and revocation time.
- Use a distinct token prefix and Collection; reuse cryptographic primitives
  from the Publishing API implementation without accepting its credentials.
- Dedicated token-management permission for administrators. Follow the current
  Root/Developer token-management pattern; document eligible roles explicitly.
  This permission authorizes delegation only within registered data resources.
- `GET /admin-data-api/v1/` describes the caller's accessible resources, schemas,
  query capabilities, and operations. Discovery does not replace authorization.
- Resource reads include `data.meta.version`. PATCH submits the observed version
  in `data.meta.version`; DELETE uses `Kixx-Expected-Version` to avoid a DELETE
  body. Missing/invalid versions are `400`; stale versions are `409`.
- Client type/id mismatches are `409`; missing records are `404`; unsupported
  operations are `405`; invalid input is `422`; authentication failure is `401`
  with a Bearer challenge; insufficient grants are `403`.
- PATCH preserves omitted fields, validates explicit null, and replaces supplied
  attribute values rather than performing an undocumented recursive merge.
- Page size defaults to 25 and is capped at 100. Use `page[size]` and
  `page[after]`, signed store cursors, and complete `links.next` URLs.
- Only declared query plans are allowed. File initially supports newest-first
  primary scans; it has no declared secondary indexes today.
- Explicit output projection and writable fields. Storage identity, version,
  timestamps, and sort keys are server-owned unless the registration deliberately
  defines another contract. Record schemas alone are not enforcement.
- Sparse fieldsets are supported; relationship expansion/mutation, bulk writes,
  arbitrary query expressions, total counts, and API token minting are deferred.
- Structured mutation audit logs contain principal, resource/id, action,
  request id, and outcome. Never log bearer secrets or full request payloads.
  This is operational logging, not a transactional durable audit ledger.

### Decision F1: File records only (confirmed)

The user selected record-only CRUD. There are no upload, download, replacement,
or binary cleanup endpoints in this API. POST requires an existing content
reference supplied by the caller; existing admin upload/file inspection can
provide it. The API does not copy bytes or transfer their ownership.

Proposed File contract:

- Read attributes: title, description, isPublished, originalUploadedAt, content.
- Create input: title, description, isPublished, and the complete content object.
  Generate a fresh ID and upload-order metadata using createFile(). Document
  originalUploadedAt as record creation time for this administrative create path.
- Update input: title, description, isPublished, and complete replacement content.
  Preserve omitted attributes; nested content is replaced as one attribute.
- Content must satisfy FileRecord validation. Do not claim that shape validation
  proves the referenced object exists. Return internal content references only
  to principals granted File access; this is intentionally administrative data.
- Delete uses deleteStrict() once and removes only the document, even when it is
  published. This deliberately bypasses the HTML workflow's publication guard.
- Updating content or deleting a File never invokes FileContent cleanup. The API
  does not add reference counting or shared-object ownership. Existing HTML file
  workflows may delete bytes they own, so duplicating references can leave other
  records dangling; detaching a reference can leave unused bytes. Document these
  limitations with the record-only contract and do not imply lifecycle safety.

### Repository findings

- `src/app/collections/file-record.js` requires a content reference, publication
  state, and original upload time; validation checks shape, not object existence.
- `FileCollection#createFile()` sets immutable upload-order metadata.
- `FileCollection#patch()` retries optimistic conflicts; unsuitable for client
  version-checked edits. Existing delete workflow also retries and prohibits
  deleting published files.
- `FileContentCollection` owns private object keys and immutable generations.
  Existing cleanup is best-effort and logs errors; document/object commits are
  not atomic.
- Publishing tokens already use SHA-256 verifier lookup, expiration/revocation,
  and one-time display. They currently derive permissions from publishing roles.
- The router defaults to no-store and sets private/no-store for authenticated
  principals. Error handling skips outbound middleware; API errors need their
  own complete protocol formatting.
- Existing JSON:API helpers ignore Content-Type parameters, require attributes,
  omit relationships/meta on input, and pass plain field names as error source.
  Tightening shared helpers must account for existing endpoint compatibility.
- `test/README.md` does not exist. Use root README, `test/unit-tests/README.md`,
  and `test/end-to-end/README.md`.

## Implementation Tasks

### Task D1: Define enforceable resource registrations and API contract

**Status:** Complete
**Depends on:** None
**Documentation:** This plan; Collections README; Presentation README; Transaction Scripts README

**Objective**

Make exposed resources, allowed operations, fields, and query capabilities
explicit and usable by both enforcement and discovery.

**Scope**

- In: Registration contract, validation, permission mapping, API documentation.
- Out: Token persistence/UI (D2/D3), HTTP execution (D4), file lifecycle (D5).

**Design and invariants**

- No automatic Collection enumeration or default write exposure.
- Shared administrative scripts operate only through validated registrations.
- Use exact Collection/action grants compatible with the existing permission
  evaluator; retired registrations/grants confer no access.
- Finalize field projection, version input, pagination, and error contracts.
- Apply the confirmed record-only boundary in F1 to the File registration.

**Expected touch points**

- `src/app/admin-data-api/` — application-owned resource definitions and lookup.
- `src/app/permissions/` — scoped permission identifiers and management policy.
- `docs/admin-data-api.md` — client and application-author contracts.

**Acceptance criteria**

- [x] Invalid or duplicate registrations fail as programmer errors.
- [x] Unregistered Collections and disabled actions cannot be selected.
- [x] Read/write field and query contracts are explicit and discoverable.
- [x] File record-only contract and reference limitations are documented.

**Validation**

- `node run-linter.js` — JavaScript style and correctness checks.
- `node run-tests.js` — full suite, including registration/grant boundary tests.

**Progress and handoff**

- Completed: Registry, permission mapping, File registration, boot-time
  registration checks, unit tests, and `docs/admin-data-api.md`.
- Current state: Complete.
- Remaining: None for D1.
- Decisions and discoveries:
  - `ResourceRegistry` (`src/app/admin-data-api/resource-registry.js`) is the
    single authority. Use `getResource(type)`, `getResourceByCollection()`,
    `isOperationEnabled()`, `isAuthorized(permissions, type, action)`,
    `listAuthorizedActions()`, and `describeAccessibleResources(permissions)`.
    The app instance is `adminDataResources` in `src/app/admin-data-api/mod.js`.
  - Registration shape: `{ type, collection, description, attributes: { name:
    { description, schema } }, operations: { list: { sorts: [{ name,
    description, descending, index? }] }, get: {}, create: { attributes,
    required, persist? }, update: { attributes }, delete: {} } }`. Presence of
    an operation enables it; unknown keys anywhere are assertion errors.
    Registrations are deep-frozen; schemas are cloned first.
  - Sorts double as JSON:API `sort` values (first is default) and are the only
    declared query plans. Page constants: `DEFAULT_PAGE_SIZE` 25,
    `MAX_PAGE_SIZE` 100, exported from the registry module.
  - `create.persist(context, collection, attributes)` is the optional hook for
    server-generated values; File uses it to call `createFile()` with
    `crypto.randomUUID()`. D4's generic create must call it when present and
    `collection.create()` otherwise.
  - File create requires all four writable attributes (title/description may
    be null). `originalUploadedAt` is read-only.
  - Permissions (`src/app/permissions/admin-data-api.js`): stored token grants
    are `[{ collection, actions }]`; `toAdminDataPermissions()` converts them
    to exact evaluator grants (`urn:kixx:<action>` on
    `urn:kixx:admin-data:collections:<Collection>`) and silently drops
    malformed/wildcard-capable entries. D2 must build the principal's
    permissions ONLY from token grants: Root Admin's `*` role grant would
    otherwise satisfy any data resource (registry tests show the registration
    still bounds it, but grants must not include role permissions).
  - Token management resource: `ADMIN_DATA_TOKEN_MANAGEMENT_RESOURCE` =
    `urn:kixx:admin:api-tokens:admin-data`; Root Admin and Developer hold it
    through existing grants, so `roles.js` needed no change.
  - `app.initialize()` calls `adminDataResources.assertCollections(context)`,
    which checks Collection presence, required methods per operation,
    attributes against `Record.schema.properties`, and sort indexes against
    the Collection's static `INDEXES`.
  - Protocol choices recorded in `docs/admin-data-api.md` beyond the plan
    defaults: token prefix `kxadt_`; discovery returns resources under
    top-level `meta.resources`; resource `meta` carries version, createdAt,
    updatedAt; client-supplied id on create is `403`; undeclared/read-only
    attributes are `422`; unknown query parameters (including `filter[...]`)
    are `400`; `406` for unacceptable Accept; delete success is `204`. The doc
    has an "Implementation status" note to remove in D5.
  - The plan references `docs/admin-files.md`, which does not exist; File
    record-only guarantees live in `docs/admin-data-api.md` ("Files").
- Actual files changed:
  - `src/app/admin-data-api/resource-registry.js` (new)
  - `src/app/admin-data-api/resources/files.js` (new)
  - `src/app/admin-data-api/mod.js` (new)
  - `src/app/permissions/admin-data-api.js` (new)
  - `src/app/app.js` — boot-time registration check
  - `docs/admin-data-api.md` (new)
  - `test/unit-tests/app/admin-data-api/resource-registry.test.js` (new)
  - `test/unit-tests/app/permissions/admin-data-api.test.js` (new)
- Validation run: `node run-linter.js` on changed files — clean.
  `node run-tests.js` — 1695 tests passed, 0 failures.
- Blockers: None.

### Task D2: Authenticate scoped administrative data tokens

**Status:** Complete
**Depends on:** D1
**Documentation:** This plan; Collections README; server-error-handling.md; code-style-guide.md; code-documentation-guide.md; unit testing guide

**Objective**

Mint, verify, expire, and revoke tokens carrying explicit Collection grants.

**Scope**

- In: Token Collection/Record, lifecycle Forms/scripts, bearer middleware.
- Out: Admin interface (D3), resource HTTP handlers (D4).

**Design and invariants**

- Reuse established random-secret/hash primitives; never persist plaintext.
- Distinct token purpose and prefix; reject Publishing API tokens and Basic auth.
- Set an authenticated principal on context.user with normalized scoped grants.
- Check current token state on each request; no stale positive auth cache.
- Revocation prevents subsequent authentications; do not promise cancellation
  of requests already authenticated before revocation.
- Reject unknown/action-invalid grants at minting and ignore retired grants at
  authorization. API tokens cannot mint tokens or grant themselves authority.

**Expected touch points**

- `src/app/collections/admin-data-api-token-*.js` — persistent verifier/lifecycle.
- `src/app/transaction-scripts/admin-data-api-tokens/` — lifecycle operations.
- `src/app/presentation/forms/admin-data-api-tokens/` — normalized inputs.
- `src/app/presentation/middleware/` — bearer authentication.
- `src/app/app.js` — Collection registration.

**Acceptance criteria**

- [x] Mint returns the secret once; stored/listed data cannot recover it.
- [x] Missing, wrong-purpose, expired, and revoked credentials are rejected.
- [x] Tokens cannot access other Collections or ungranted actions.
- [x] Concurrent revocation preserves the original revocation event.

**Validation**

- `node run-linter.js` — lint all changed runtime JavaScript.
- `node run-tests.js` — lifecycle, permission isolation, expiry, and conflict tests.

**Progress and handoff**

- Completed: Token Record/Collection, lifecycle scripts, admin Forms, bearer
  middleware, Collection registration, tests, and doc updates.
- Current state: Complete.
- Remaining: None for D2. D3 must add the routes the Forms target and mount
  the pages; D4 must attach the middleware to the API subtree.
- Decisions and discoveries:
  - Publishing token code is a pattern, not a shared credential domain.
  - Collection `AdminDataApiToken` (registered in `app.js`), prefix `kxadt_`
    (`ADMIN_DATA_API_TOKEN_PREFIX`), record id = SHA-256 hex of the token,
    sort key = creation time. Stored grants are canonical
    `[{ collection, actions }]`, sorted by Collection with actions in
    `ADMIN_DATA_ACTIONS` order. `createToken()` asserts every grant against
    `adminDataResources` (unregistered Collection, disabled action, empty or
    repeated Collection are AssertionErrors); Record validation checks shape
    only, so retiring a registration never invalidates stored tokens.
  - `authenticateAdminDataApiToken()` rejects anything not matching
    `^kxadt_[0-9a-f]{64}$` before lookup (so Publishing tokens and Basic auth
    never reach storage). Unlike the Publishing API, expired/revoked tokens are
    `401` (`UnauthenticatedError`, code `AdminDataApiTokenInactive`), matching
    the plan's "authentication failure is 401". No caching.
  - Middleware `presentation/middleware/authenticate-admin-data-api-token.js`
    sets `context.user = { id, type, grants, permissions, createdBy,
    tokenCreationDate, tokenExpirationDate }`, with `permissions` from
    `toAdminDataPermissions(grants)` only (no roles). D4 authorizes with
    `adminDataResources.isAuthorized(context.user.permissions, type, action)`.
    The `WWW-Authenticate: Bearer` challenge is NOT set yet; D4's API error
    handler must add it to 401 responses.
  - Revocation is version-checked and never retried: a concurrent revoke gets
    `VersionConflictError` → `ConflictError` `AdminDataApiTokenConflict`; a
    re-revoke gets `AdminDataApiTokenNotRevocable`. Original `revokedAt` is
    preserved (tested).
  - Forms (`presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js`):
    `AdminDataApiTokenCreateForm` (fields `description` ≤ 200 chars,
    `grants` multi-value checkboxes with values `"<Collection>:<action>"`,
    `time_to_live_seconds` select, default 30 days, max 365) with
    `fromFormData()` using `getAll('grants')`; `getDynamicFieldMetadata()`
    returns `{ grants: { resources: [{ type, collection, description,
    actions: [{ value, action, isChecked }] }] } }` for D3 rendering.
    `AdminDataApiTokenRevokeForm` (`token_id`). Targets D3 must define:
    `admin-panel/admin-data-api-tokens/create-token` and
    `admin-panel/admin-data-api-tokens-revoke/revoke`.
  - Extracted the Publishing admin form's private TTL parser into
    `normalizeIntegerStringAttribute(value, defaultValue)` in
    `presentation/forms/utils.js`; both admin token forms use it (behavior
    unchanged; existing form tests pass).
- Actual files changed:
  - `src/app/collections/admin-data-api-token-record.js` (new)
  - `src/app/collections/admin-data-api-token-collection.js` (new)
  - `src/app/transaction-scripts/admin-data-api-tokens/{create,authenticate,list,revoke}-admin-data-api-token(s).js` (new)
  - `src/app/presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js` (new)
  - `src/app/presentation/middleware/authenticate-admin-data-api-token.js` (new)
  - `src/app/presentation/forms/utils.js`, `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js` — shared TTL parser
  - `src/app/app.js` — Collection registration
  - `docs/admin-data-api.md` — status and token behavior
  - `test/unit-tests/app/transaction-scripts/admin-data-api-tokens/admin-data-api-token-lifecycle.test.js` (new; real in-memory SQLite store)
  - `test/unit-tests/app/presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.test.js` (new)
- Validation run: `node run-linter.js` — clean. `node run-tests.js` — 1719
  tests passed, 0 failures.
- Blockers: None.

### Task D3: Manage data tokens in the admin panel

**Status:** Complete
**Depends on:** D1, D2
**Documentation:** Presentation README; templates README; frontend-development-guide.md; this plan

**Objective**

Let authorized administrators select per-Collection actions, create a token,
copy its one-time secret, inspect token status, and revoke it.

**Scope**

- In: Token pages, handlers, forms, navigation, management authorization.
- Out: Redesigning the admin theme or migrating existing Publishing API tokens.

**Design and invariants**

- Reuse session authentication, CSRF, reverse routing, and existing visual rules.
- Generate grant options from current registrations; validate server-side.
- Render the secret only on successful creation, with caching disabled. Do not
  put it in redirects, logs, storage, subsequent GETs, or template-context JSON.
- List metadata, grants, expiration, and revocation without revealing secrets.

**Expected touch points**

- `src/routes/admin-panel.js` — management routes and permission checks.
- `src/app/presentation/request-handlers/admin-panel/` — token UI workflows.
- `src/pages/admin/` — token-management page and specimens as needed.
- `src/templates/partials/admin-nav.html` — navigation.

**Acceptance criteria**

- [x] Authorized administrators can create/list/revoke scoped tokens.
- [x] Unauthorized and CSRF-invalid requests do not mutate token state.
- [x] Secret appears on creation only; validation failures preserve safe fields.
- [x] Controls work with keyboard, narrow screens, enlarged text, and supported themes.

**Validation**

- `node run-linter.js` — runtime and browser JavaScript checks as applicable.
- `node run-tests.js` — Form/handler and authorization coverage.
- Local-target browser check — create, copy, revisit, revoke, validation states,
  keyboard, themes, and responsive layout. Read relevant guides before editing.

**Progress and handoff**

- Completed: Routes, handlers, page, nav/landing links, field-group
  component with style-guide specimen, unit tests, and a local-target browser
  check.
- Current state: Complete.
- Remaining: None for D3.
- Decisions and discoveries:
  - Existing Publishing token creation renders directly to show the secret
    once; the data-token page follows the same pattern
    (`request-handlers/admin-panel/admin-data-api-tokens.js`).
  - Routes (`src/routes/admin-panel.js`): `/admin/admin-data-api-tokens`
    (`render-token-list` GET/HEAD gated `urn:kixx:list`, `create-token` POST
    gated `urn:kixx:create`) and `/admin/admin-data-api-tokens/revoke`
    (`revoke` POST gated `urn:kixx:revoke`), all on
    `ADMIN_DATA_TOKEN_MANAGEMENT_RESOURCE`, `usePageCache: false`. Root Admin
    and Developer pass; Admin and Editor get 403 (tested).
  - The list shows each grant by public type (`files: list, get`); grants for
    a Collection that is no longer registered render as "(no longer exposed)".
  - Added a reusable `.field-group` fieldset component to
    `static-assets/stylesheets/lib/forms.css` and a "Field Groups" specimen in
    the style guide forms page. It resets only inline margin (block margin
    belongs to the parent `.flow`; an initial `margin: 0` erased it, which the
    browser check caught) and sets its children's `--flow-space`.
  - ValidationError re-renders with status 422 (not 400).
- Actual files changed:
  - `src/app/presentation/request-handlers/admin-panel/admin-data-api-tokens.js` (new), `.../admin-panel/mod.js`
  - `src/routes/admin-panel.js`
  - `src/pages/admin/admin-data-api-tokens/page.{html,json}` (new)
  - `src/pages/admin/page.html`, `src/templates/partials/admin-nav.html`
  - `src/static-assets/stylesheets/lib/forms.css`, `src/pages/admin/style-guide/forms/body.html`
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-data-api-tokens.test.js` (new)
- Validation run: `node run-linter.js` — clean. `node run-tests.js` — 1729
  passed. Local target `d3-tokens` (Node runtime) browser check in Chrome:
  login, page render, empty-grant validation (error shown, description kept),
  keyboard-only checkbox selection with visible focus and submit, one-time
  secret display, revisit/`.json` context/HTML contain no secret,
  `Cache-Control: private, no-store`, revoke → status "revoked" and no
  revoke control, dark and light themes, 200% root font size, and 360px
  width without horizontal overflow. The local target served the CSS from
  seed time, so the final `.field-group` CSS was verified by injecting the
  same rules into the page; the style-guide specimen itself was not
  rendered in the browser. Target destroyed afterwards.
- Blockers: None.

### Task D4: Serve the JSON:API resource protocol and checked writes

**Status:** Not started
**Depends on:** D1, D2
**Documentation:** JSON:API 1.1 (https://jsonapi.org/format/1.1/); Presentation README; Transaction Scripts README; server-error-handling.md; unit testing guide

**Objective**

Provide authenticated discovery and reusable collection CRUD mechanics with
explicit projection, stable errors, cursor pagination, and conflict detection.

**Scope**

- In: Route subtree, negotiation, parsing, serialization, resource dispatch,
  shared administrative scripts, protocol tests, mutation logging.
- Out: File registration (D5), binary lifecycle, relationship expansion, bulk operations.

**Design and invariants**

- Mount `/admin-data-api/v1` before the public catch-all, accepting trailing slash.
- Correct JSON:API Content-Type/Accept handling and structured error source
  pointers/parameters; preserve unexpected-error propagation to router policy.
- Preserve meta.version on input; sparse fields never add unauthorized fields.
- Validate protocol input before calling Collection assertions. No blind merges
  of payloads into Records and no unrestricted query/index selection.
- Check the client version against the loaded Record, then use update/deleteStrict
  on that same version. Translate both initial mismatch and persistence race to
  conflict; never retry user updates or deletes against a newer version.
- Server-generated IDs avoid accidental reuse; verify store version semantics
  before supporting client IDs and delete/recreate of the same identifier.
- Retain existing API behavior when extracting or extending shared JSON helpers;
  test affected endpoints rather than silently changing their contracts.
- Error responses are complete even though outbound middleware does not run.

**Expected touch points**

- `src/routes/admin-data-api-v1.js`, `src/virtual-hosts.js` — mounted subtree.
- `src/app/presentation/request-handlers/admin-data-api/` — HTTP adapters.
- `src/app/presentation/lib/` — JSON:API mechanics and pagination.
- `src/app/presentation/error-handlers/` — API error projection.
- `src/app/transaction-scripts/admin-data-api/` — shared direct-edit workflows.
- `test/unit-tests/` — protocol and two-writer race coverage.

**Acceptance criteria**

- [ ] Discovery returns only currently accessible capabilities.
- [ ] GET/list output is explicit and cursor links preserve query semantics.
- [ ] Two clients reading the same version cannot both update/delete successfully.
- [ ] Rejected writes do not alter stored state; unknown fields are not persisted.
- [ ] Malformed payloads, unsupported media, missing grants, invalid cursors, and
  stale versions receive documented responses with no internal details leaked.

**Validation**

- `node run-linter.js` — changed JavaScript is clean.
- `node run-tests.js` — full suite including compatibility and concurrency tests.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Existing helpers are incomplete for the proposed protocol.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None; dependencies must complete first.

### Task D5: Deliver and verify File CRUD end to end

**Status:** Not started
**Depends on:** D1, D2, D3, D4
**Documentation:** This plan including F1; docs/admin-files.md; Collections README; test/end-to-end/README.md

**Objective**

Make File the first explicitly enabled, version-checked administrative CRUD
resource, proven with tokens created and revoked through the admin panel.

**Scope**

- In: File resource registration, record-only create/update/delete, integration
  tests, client examples, author documentation.
- Out: Binary lifecycle, additional operational Collections, changing HTML file workflows.

**Design and invariants**

- Follow F1: intentionally bypass application publication restrictions and
  content cleanup while preserving Record validation and version checks.
- Preserve upload-order sort keys on update; server generates them on create.
- Never call FileContent create/delete from this API. Content references are
  caller-supplied and shape-validated, without object-existence guarantees.
- Tests must prove that deleting or repointing a File leaves bytes untouched.
- Integration fixtures use isolated IDs and clean up only their own resources.

**Expected touch points**

- `src/app/admin-data-api/` — File registration and discovery schema.
- `src/app/transaction-scripts/admin-data-api/` — record-only File behavior.
- `src/app/presentation/forms/`, `src/routes/admin-data-api-v1.js` — File transport.
- `test/end-to-end/300-admin-data-api/` — dedicated integration suite.
- `docs/admin-data-api.md`, `docs/admin-files.md` — curl examples and guarantees.

**Acceptance criteria**

- [ ] Admin-created scoped token can create/list/get/update/delete Files as documented.
- [ ] Read-only and wrong-Collection grants fail writes; revoked tokens fail auth.
- [ ] Stale PATCH/DELETE and a race after load cannot overwrite/delete newer state.
- [ ] Create/update/delete never mutate bytes; reference limitations are documented.
- [ ] Discovery, schemas, examples, permissions, and runtime behavior agree.

**Validation**

- `node run-linter.js` — full linter.
- `node run-tests.js` — full unit suite.
- `node tools/local-target.js create admin-data-api` — disposable writable target.
- `node tools/local-target.js seed admin-data-api` — seed app and administrator.
- `node tools/local-target.js serve admin-data-api` — run writable target.
- `node run-tests.js --e2e test/end-to-end/300-admin-data-api` — with target URL and
  root credentials supplied through the documented E2E environment variables.
- Browser-check D3 against this target. Stop the server, then run
  `node tools/local-target.js destroy admin-data-api` after verification.
- Record which runtime was exercised; do not claim deployed Cloudflare validation
  from Node tests. No deployment is part of this plan.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: File records reference another gateway, but API mutations touch only the document store.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None; dependencies must complete first.
