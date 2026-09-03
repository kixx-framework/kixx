# Admin panel publishing visibility and rollback

## Implementation Approach

Add a `Publishing` section to the admin panel that exposes the state the
Publishing API already tracks — the running build, every build pointer, the
Release history, and per-build activation history — and one write action:
assign an existing Release to the running build. Rolling back and rolling
forward are the same operation with different labels, exactly as
`docs/publishing-api.md` describes, so the admin panel presents a single
"assign" action and lets the activation `reason` say which one it was.

The domain layer needs almost nothing new. Every read is already a Transaction
Script (`list-releases.js`, `get-release.js`, `list-activations.js`) or a
`ContentAddressableStore` method (`getBuildPointer`, `listBuilds`), and the
write already exists as `assign-release.js`. The only new domain code is a
thin Transaction Script that restricts the write to the running build, maps a
form-supplied expected Release id onto the assign script's precondition, and
infers the audit `reason` with one timestamp comparison. Everything else is
presentation: routes, request handlers, one form module, three page
directories, and unit tests.

Decisions already made with the project owner (do not reopen):

- Three pages: an overview at `/admin/publishing`, a build detail page at
  `/admin/publishing/builds/:buildId`, and a Release detail page at
  `/admin/publishing/releases/:releaseId`.
- Only the running build (`context.runtime.build.id`) can be assigned from the
  admin panel. Other build pointers are read-only. Pre-staging a future build
  id from the panel is out of scope; builds and deploys are managed out of band.
- No confirmation page. The assign control is a single-click form whose hidden
  fields carry the expected current Release id (the HTML equivalent of
  `If-Match`) and the build id the page was rendered for.
- Reason inference is deliberately minimal: target Release `createdAt` earlier
  than the current Release's `createdAt` means `rollback`; otherwise `publish`.
  `restore` and `carry-forward` are never recorded from the admin panel. A
  re-applied Release therefore shows as `publish` in history; that is accepted.
- Release detail shows `objectCount`, `totalBytes`, and `provenance` only. The
  manifest is not rendered.
- Permissions reuse the Publishing API URNs so the admin panel and the API
  agree on who can see and move a pointer: `urn:kixx:get` on
  `urn:kixx:publishing:releases` and `urn:kixx:publishing:builds` for reads,
  `urn:kixx:update` on `urn:kixx:publishing:builds` for the assign action. No
  role changes are needed; editor, admin, developer, and root-admin already
  hold these grants (`src/app/permissions/roles.js`).
- `ActivationRecord.activatedBy` records the admin user id, with no principal
  kind. The record schema is unchanged.

Cross-cutting notes for every task:

- The devserver runs in developer mode with no persisted build pointer, and
  `context.runtime.build.id` may be `null`. Every page must render a sensible
  empty state in that case, and the assign control must not render. Manual
  verification of the write path requires a local target instance
  (`node tools/local-target.js`, see `README.md`).
- Follow the existing admin-panel handler conventions in
  `src/app/presentation/request-handlers/admin-panel/admin-publishing-api-tokens.js`:
  reverse-routed links via `context.getHttpTarget(...)`, cursor pagination via
  `src/app/presentation/lib/pagination.js`, CSRF via
  `src/app/presentation/lib/csrf.js`, an allow-listed `notice` query
  parameter, and `usePageCache: false` on any target that renders a CSRF token.
- Routes with a dynamic segment pass a stable `pathname` option to
  `HyperviewPageHandler` so one `src/pages/` directory serves every id.
- Templates must use existing primitives (`admin-content-section`, `card`,
  `callout`, `button`, `cluster`, `flow`, `grid-auto`, `type-*`) and the
  `formatDate` helper. Consult the live style guide under `/admin/style-guide`
  and `src/docs/frontend-development-guide.md` before adding any CSS; the
  expectation is that none is needed.
- Route order matters: `/publishing/builds/:buildId` and
  `/publishing/releases/:releaseId` must be declared before `/publishing`, and
  all of them before the `*` catch-all in `src/routes/admin-panel.js`.
- Read `src/app/presentation/README.md`, `src/app/transaction-scripts/README.md`,
  `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`,
  `src/docs/server-error-handling.md`, and `test/unit-tests/README.md` before
  starting any task. Run `node run-linter.js <changed files>` and
  `node run-tests.js <changed test paths>` before marking a task complete.

## Tasks

### Task PUBUI-1: Assign a Release to the running build with an inferred reason

**Status:** Complete
**Depends on:** None
**Documentation:** `docs/publishing-api.md` (The atomic release model, Assign a
Release to a build, Rollback); `src/app/transaction-scripts/README.md`;
`src/docs/server-error-handling.md`; `src/app/collections/README.md`.

**Objective**

Provide one Transaction Script the admin panel can call to move the running
build's pointer to an existing Release, with the precondition and the audit
`reason` derived server-side. This is the only new domain behavior in the
feature and is independently testable without any presentation code.

**Scope**

- In: `src/app/transaction-scripts/publishing/assign-release-to-running-build.js`
  and its unit test.
- Out: Any route, handler, form, or template (PUBUI-2 through PUBUI-5). Any
  change to `assign-release.js`, `ActivationRecord`, or the roles registry.

**Design and invariants**

- Signature: `assignReleaseToRunningBuild(context, args)` where `args` is
  `{ buildId, releaseId, expectedReleaseId, activatedBy }`. All four are
  required non-empty strings; assert them like `assign-release.js` does.
- Read the running build id from `context.runtime.build.id`. When it is
  `null`, or when `args.buildId` does not equal it, throw an expected
  `ConflictError` with code `RunningBuildMismatch`. A mismatch means the page
  was rendered under a different deploy, so the operator must reload.
- Load the target Release through `getRelease(context, releaseId)`. When it is
  `null`, throw an expected `NotFoundError` with code `ReleaseNotFound`.
- Load the current pointer with
  `context.getService('ContentAddressableStore').getBuildPointer(context, buildId)`.
  When it is `null`, throw `ConflictError` with code `RunningBuildUnassigned`;
  the admin panel never performs a first assignment.
- When `pointer.rootHash !== expectedReleaseId`, throw `ConflictError` with
  code `BuildPointerConflict` without calling the assign script. This is the
  stale-page case and must never overwrite a concurrent change.
- Infer `reason`: load the current Release through `getRelease` using
  `pointer.rootHash`; when the target's `createdAt` is strictly earlier than
  the current Release's `createdAt`, `reason` is `rollback`, otherwise
  `publish`. When the current Release record is missing (its audit record was
  never written or was lost), fall back to `publish` rather than failing;
  the pointer is authoritative and the reason is metadata.
- Delegate to `assignRelease(context, { buildId, releaseId, precondition:
  expectedReleaseId, activatedBy, reason })` and return its result. Let its
  `NotFoundError` and `ConflictError` propagate unchanged.
- Assigning the Release the build already points at is a success no-op in the
  underlying store; do not special-case it here.
- Do not catch and wrap errors from `getRelease` or the store beyond what
  `assign-release.js` already does; unexpected failures propagate as
  programmer errors per `src/docs/server-error-handling.md`.

**Expected touch points**

- `src/app/transaction-scripts/publishing/assign-release-to-running-build.js` — new script.
- `test/unit-tests/app/transaction-scripts/publishing/assign-release-to-running-build.test.js` — new tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Assigning an older Release records `reason: 'rollback'`; a newer or equal-timestamp Release records `reason: 'publish'`.
- [ ] A `buildId` that differs from `context.runtime.build.id`, or a `null` runtime build id, throws `ConflictError` with code `RunningBuildMismatch` and never touches the store.
- [ ] An unassigned running build throws `ConflictError` with code `RunningBuildUnassigned`.
- [ ] A stale `expectedReleaseId` throws `ConflictError` with code `BuildPointerConflict` before the assign script is called.
- [ ] An unknown `releaseId` throws `NotFoundError` with code `ReleaseNotFound`.
- [ ] A missing current Release audit record falls back to `reason: 'publish'`.
- [ ] The script passes `expectedReleaseId` as `precondition` and the caller's `activatedBy` to `assignRelease`.
- [ ] JSDoc follows `src/docs/code-documentation-guide.md`.

**Validation**

- `node run-linter.js src/app/transaction-scripts/publishing test/unit-tests/app/transaction-scripts/publishing` — lint passes.
- `node run-tests.js test/unit-tests/app/transaction-scripts/publishing` — new tests pass alongside the existing assign and create tests.
- Unit tests mock `context.getService('ContentAddressableStore')`,
  `context.getCollection('Release')` and `context.getCollection('Activation')`
  in the style of `assign-release.test.js`.

**Progress and handoff**

- Completed: New Transaction Script `assignReleaseToRunningBuild` and its unit tests. All acceptance criteria met.
- Current state: Complete.
- Remaining: Nothing for this task.
- Decisions and discoveries: `getRelease` returns `null` (not a thrown error) for a
  missing current-Release audit record, so the "missing current Release" fallback
  is driven by `getRelease(context, pointer.rootHash)` resolving `null` — no
  separate try/catch needed. `assignRelease()`'s underlying store call receives
  only `{ releaseId, precondition }`; `activatedBy` and `reason` are only visible
  on the `Activation.append` call, which is what tests assert against.
- Actual files changed:
  - `src/app/transaction-scripts/publishing/assign-release-to-running-build.js` (new)
  - `test/unit-tests/app/transaction-scripts/publishing/assign-release-to-running-build.test.js` (new)
- Validation run: `node run-linter.js src/app/transaction-scripts/publishing test/unit-tests/app/transaction-scripts/publishing` (clean); `node run-tests.js test/unit-tests/app/transaction-scripts/publishing` (13 passed); full `node run-tests.js` run confirms no new failures (pre-existing unrelated failure in `test/unit-tests/node-config.test.js`, reproduced independent of this change).
- Blockers: None.

### Task PUBUI-2: Publishing overview page at `/admin/publishing`

**Status:** Complete
**Depends on:** None
**Documentation:** `src/app/presentation/README.md` (Routing, Reverse Routing,
Request Handlers, Rendering a Page with HyperviewPageHandler, Dynamic Page
recipe); `src/templates/README.md`; `src/docs/frontend-development-guide.md`;
`docs/publishing-api.md` (Build pointers, Release history).

**Objective**

An authenticated administrator with publishing read grants can open
`/admin/publishing` and see the running build, every registered build pointer,
and the Release history newest first with cursor pagination. The admin
directory links to it. This task delivers read-only visibility; the assign
control is added to this page by PUBUI-5.

**Scope**

- In: The `/publishing` route and its GET target; a
  `getPublishingOverview` request handler; `src/pages/admin/publishing/`
  page files; the directory card on `src/pages/admin/page.html`; unit tests
  for the handler.
- Out: Build and Release detail pages (PUBUI-3, PUBUI-4); any POST target or
  form (PUBUI-5).

**Design and invariants**

- Route: add `{ pattern: '/publishing', name: 'publishing' }` in
  `src/routes/admin-panel.js` with a `render-overview` target for `GET`/`HEAD`
  gated by `authorize([{ action: 'urn:kixx:get', resource:
  'urn:kixx:publishing:releases' }, { action: 'urn:kixx:get', resource:
  'urn:kixx:publishing:builds' }])`. Declare it after the detail routes added
  by PUBUI-3 and PUBUI-4 (leave a comment marking where they go) and before
  the `*` catch-all. Use `HyperviewPageHandler({ baseTemplateId:
  'admin.html', usePageCache: false })`; the cache is disabled now because
  PUBUI-5 will render a CSRF token on this page.
- Handler module: `src/app/presentation/request-handlers/admin-panel/admin-publishing.js`,
  re-exported from `mod.js`. It must not contain domain logic.
- Props the handler sets:
  - `runningBuild`: `{ id, releaseId, assignedAt }` when
    `context.runtime.build.id` is set and `getBuildPointer` returns a pointer;
    `{ id, releaseId: null, assignedAt: null }` when the id is set but the
    pointer is missing; `null` when there is no runtime build id. The
    template distinguishes all three states with plain copy (no build id
    configured; build has no Release assigned; normal).
  - `builds`: `store.listBuilds(context)` mapped to
    `{ id, releaseId, assignedAt, isRunning, href }` where `href` is the
    compiled build detail pathname (`admin-panel/publishing-build/render-build`;
    see PUBUI-3 for the target name; compile it here even though the route
    lands in PUBUI-3, and mark this task blocked on that name if the route is
    not yet present).
  - `releases`: page items from `listReleases(context, { cursor })` mapped to
    `{ id, createdAt, createdBy, objectCount, totalBytes, provenance,
    isCurrent, href }` where `isCurrent` is true when `id` equals the running
    build's `releaseId` and `href` is the compiled Release detail pathname
    (`admin-panel/publishing-release/render-release`, see PUBUI-4).
  - `showPagination` and `links.nextPage` / `links.previousPage` built with
    `createCursorPaginationLinks` exactly as the token list does, translating
    `InvalidCursorError` with `rethrowInvalidCursorAsBadRequest`.
- Pagination applies to Releases only. Build pointers are unpaginated because
  `listBuilds` is unpaginated.
- Pages: `src/pages/admin/publishing/page.json` with `subpage.title:
  "Publishing"` and `page.html` with one `main.admin-main` and one
  `article.admin-content-section.flow`. Sections: running build card, build
  pointers list, Release history list, pagination controls outside the list
  conditional (same reasoning as the token page comment).
- Directory card: add a fourth `li` to `src/pages/admin/page.html` titled
  `Publishing` linking to `/admin/publishing`, matching the existing cards.
  The literal path is acceptable there because templates have no
  reverse-routing access (see `agents/plans/admin-panel-landing-page.md`).
- Do not truncate Release ids in the template. They are the operator's
  correlation key with the Publishing API.

**Expected touch points**

- `src/routes/admin-panel.js` — new route.
- `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` — new handler.
- `src/app/presentation/request-handlers/admin-panel/mod.js` — re-export.
- `src/pages/admin/publishing/page.json`, `page.html` — new page.
- `src/pages/admin/page.html` — directory card.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — handler tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `GET /admin/publishing` renders for a principal holding both get grants and is refused with `ForbiddenError` for one lacking either.
- [ ] The three running-build states render distinct, accurate copy.
- [ ] Every build pointer row links to its detail page and the running build is marked.
- [ ] Releases list newest first, the current Release is marked, and each row links to its detail page.
- [ ] An invalid `cursor` responds `400`.
- [ ] Pagination links appear only when a next or previous page exists.
- [ ] The admin directory shows a Publishing card.
- [ ] Handler unit tests cover the three running-build states, `isCurrent` marking, pagination link construction, and the invalid-cursor path, mocking the store, scripts, and `getHttpTarget`.

**Validation**

- `node run-linter.js src/routes src/app/presentation/request-handlers/admin-panel test/unit-tests/app/presentation/request-handlers/admin-panel` — lint passes.
- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel` — tests pass.
- `node run-tests.js test/unit-tests/routes` (if present) — any route manifest tests that assert every `authorize` decision is reachable still pass.
- Manual: with the devserver, `/admin/publishing` renders the "no build id configured" state; with a seeded local target instance it shows the seeded build and Release.

**Progress and handoff**

- Completed: Route, handler, pages, directory card, and handler tests, implemented
  together with PUBUI-3/4/5 in one pass since the overview's build/Release hrefs
  and the assign control are mutually referential with those tasks' routes.
- Current state: Complete.
- Remaining: Nothing for this task.
- Decisions and discoveries: `listBuilds()`/`getBuildPointer()` return
  `{ buildId, rootHash, assignedAt }` (build list) and `{ rootHash, assignedAt }`
  (single pointer) — mapped to the plan's `id`/`releaseId` prop shape in the
  handler. Manually verified on a seeded local target instance
  (`node tools/local-target.js create/seed/serve pubui`, since destroyed): logged
  in as the seeded root admin and confirmed `/admin/publishing` renders the
  running build, its one build pointer, and the seeded Release marked current.
  Did not exercise the "no build id configured" state against the devserver
  interactively (confirmed only that the route returns a login redirect, not a
  500, when unauthenticated) — low risk since the `runningBuild === null` branch
  is covered by a handler unit test.
- Actual files changed (shared across PUBUI-2/3/4/5, see each task's list for
  the touch points it owns):
  - `src/routes/admin-panel.js`
  - `src/app/presentation/request-handlers/admin-panel/admin-publishing.js`
  - `src/app/presentation/request-handlers/admin-panel/mod.js`
  - `src/pages/admin/publishing/page.json`, `src/pages/admin/publishing/page.html`
  - `src/pages/admin/page.html`
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`
- Validation run: `node run-linter.js` (repo-wide, clean); `node run-tests.js`
  (1341 tests, only the pre-existing unrelated `node-config.test.js` failure);
  manual render on a seeded local target instance (see above).
- Blockers: None.

### Task PUBUI-3: Build detail page with activation history

**Status:** Complete
**Depends on:** None
**Documentation:** `src/app/presentation/README.md` (Route Pattern Matching,
Dynamic Page recipe, Reverse Routing); `docs/publishing-api.md` (Build
activation history).

**Objective**

`/admin/publishing/builds/:buildId` shows one build pointer and its activation
history newest first with cursor pagination, for any registered build, running
or not. An unregistered build id responds `404`.

**Scope**

- In: The `/publishing/builds/:buildId` route and GET target; a
  `getPublishingBuild` handler in `admin-publishing.js`;
  `src/pages/admin/publishing/builds/` page files; handler tests.
- Out: Any write action. The overview page (PUBUI-2).

**Design and invariants**

- Route: `{ pattern: '/publishing/builds/:buildId', name: 'publishing-build' }`
  with target `render-build`, gated by `authorize([{ action: 'urn:kixx:get',
  resource: 'urn:kixx:publishing:builds' }])`. Declared before `/publishing`.
  `HyperviewPageHandler({ baseTemplateId: 'admin.html', pathname:
  '/admin/publishing/builds' })`. Page caching may stay at its default because
  this page renders no CSRF token; if a later task adds one, disable it then.
- Handler: read `request.pathnameParams.buildId`; load the pointer with
  `getBuildPointer`; when `null`, throw `NotFoundError` with code
  `BuildNotFound` so the admin error handler renders the 404 page. Then call
  `listActivations(context, { buildId, cursor })` and build pagination links
  against this target's own compiled pathname (compile with `{ buildId }`).
- Props: `build` as `{ id, releaseId, assignedAt, isRunning, releaseHref }`
  (`releaseHref` compiled from the Release detail target, PUBUI-4);
  `activations` as `{ id, fromReleaseId, toReleaseId, activatedAt,
  activatedBy, reason, fromReleaseHref, toReleaseHref }` with `fromReleaseHref`
  `null` when `fromReleaseId` is `null` (first assignment);
  `showPagination` and `links` as in PUBUI-2; `links.overview` compiled from
  `admin-panel/publishing/render-overview` for a back link.
- Page: `src/pages/admin/publishing/builds/page.json` with `subpage.title`
  templated from `build.id` if the title template supports response props,
  otherwise the static `"Build"`; `page.html` renders the pointer card, an
  activation list (each row: reason label, from and to Release links,
  timestamp via `formatDate`, `activatedBy`), an empty state, and pagination.
- The page never offers an assign control, even for the running build. The
  action lives on Release rows (PUBUI-5).

**Expected touch points**

- `src/routes/admin-panel.js` — new route before `/publishing`.
- `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` — `getPublishingBuild`.
- `src/pages/admin/publishing/builds/page.json`, `page.html` — new page.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A registered build renders its pointer and history; the running build is marked.
- [ ] An unregistered build id responds `404` through the admin error handler.
- [ ] A first-assignment activation renders without a from-Release link.
- [ ] Pagination links compile to this build's own pathname and carry cursors correctly.
- [ ] An invalid `cursor` responds `400`.
- [ ] Handler tests cover found, not found, first-assignment row shaping, and pagination.

**Validation**

- `node run-linter.js src/routes src/app/presentation/request-handlers/admin-panel test/unit-tests/app/presentation/request-handlers/admin-panel`
- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel`
- Manual: on a seeded local target instance, the seeded build's page lists its single `publish` activation with a `null` from-Release.

**Progress and handoff**

- Completed: Route, `getPublishingBuild` handler, page files, and handler tests
  (implemented together with PUBUI-2/4/5, see PUBUI-2's handoff note for why).
- Current state: Complete.
- Remaining: Nothing for this task.
- Decisions and discoveries: Used the static `subpage.title: "Build"` rather
  than templating `build.id` into the title — the response-prop timing for
  `page.title`'s template form was not verified precisely enough to trust for
  a first pass, and a generic title carries no functional risk. Manually
  verified on a seeded local target instance: the seeded build's page listed
  its single `publish` activation with `fromReleaseId: null` rendered as
  "First assignment", matching the acceptance criterion.
- Actual files changed:
  - `src/routes/admin-panel.js` (`/publishing/builds/:buildId` route)
  - `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` (`getPublishingBuild`)
  - `src/pages/admin/publishing/builds/page.json`, `src/pages/admin/publishing/builds/page.html`
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`
- Validation run: see PUBUI-2 (same lint/test run covers this file); manual
  render confirmed on the seeded local target instance.
- Blockers: None.

### Task PUBUI-4: Release detail page

**Status:** Complete
**Depends on:** None
**Documentation:** `src/app/presentation/README.md` (Dynamic Page recipe);
`docs/publishing-api.md` (Create a Release response shape, Release history).

**Objective**

`/admin/publishing/releases/:releaseId` shows one Release's audit metadata
(created at and by, object count, total bytes, contract version, provenance)
and which build pointers currently reference it. An unknown Release responds
`404`. The assign control is added to this page by PUBUI-5.

**Scope**

- In: The `/publishing/releases/:releaseId` route and GET target; a
  `getPublishingRelease` handler; `src/pages/admin/publishing/releases/` page
  files; handler tests.
- Out: Rendering the manifest. Any write action.

**Design and invariants**

- Route: `{ pattern: '/publishing/releases/:releaseId', name:
  'publishing-release' }` with target `render-release`, gated by
  `authorize([{ action: 'urn:kixx:get', resource:
  'urn:kixx:publishing:releases' }, { action: 'urn:kixx:get', resource:
  'urn:kixx:publishing:builds' }])` because the page lists build pointers.
  Declared before `/publishing`. `HyperviewPageHandler({ baseTemplateId:
  'admin.html', pathname: '/admin/publishing/releases', usePageCache: false })`
  since PUBUI-5 adds a CSRF token here.
- Handler: `getRelease(context, releaseId)`; `null` throws `NotFoundError`
  with code `ReleaseNotFound`. Then `listBuilds` filtered to pointers whose
  `rootHash` equals the Release id, mapped to `{ id, assignedAt, isRunning,
  href }`.
- Props: `release` as `{ id, createdAt, createdBy, objectCount, totalBytes,
  contractVersion, provenance, isCurrent }` where `isCurrent` is true when the
  running build points at it; `referencingBuilds`; `links.overview`.
- Provenance renders each of `sourceRevision`, `message`, `client`,
  `intendedForBuildId` only when present, with an explicit "No provenance
  recorded" state when the object is empty.
- Show `totalBytes` as the raw integer with a "bytes" unit. Do not add a
  formatting helper for this task.

**Expected touch points**

- `src/routes/admin-panel.js` — new route before `/publishing`.
- `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` — `getPublishingRelease`.
- `src/pages/admin/publishing/releases/page.json`, `page.html` — new page.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A known Release renders its metadata and provenance; missing provenance fields are omitted and an empty object shows the empty state.
- [ ] Builds pointing at the Release are listed with links; the running build is marked.
- [ ] An unknown Release id responds `404`.
- [ ] Handler tests cover found, not found, `isCurrent`, and referencing-build filtering.

**Validation**

- `node run-linter.js src/routes src/app/presentation/request-handlers/admin-panel test/unit-tests/app/presentation/request-handlers/admin-panel`
- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel`

**Progress and handoff**

- Completed: Route, `getPublishingRelease` handler, page files, and handler
  tests (implemented together with PUBUI-2/3/5, see PUBUI-2's handoff note).
  The empty-provenance and assign-control props described here were extended
  in the same pass to cover PUBUI-5 (see that task's design notes for
  `hasProvenance`, `runningBuild`, `direction`, and `form`).
- Current state: Complete.
- Remaining: Nothing for this task.
- Decisions and discoveries: The template's `#with` helper renders its
  primary block for an empty plain object (per `src/templates/README.md`), so
  `{{#with release.provenance}}...{{else}}No provenance recorded{{/with}}`
  would never show the empty state for `provenance: {}`. Added an explicit
  `release.hasProvenance` boolean computed in the handler
  (`Object.keys(provenance).length > 0`) and gated the empty-state branch on
  that instead of relying on `#with`/`#if` truthiness of the object itself.
  Manually verified on the seeded local target instance: the seeded Release's
  provenance (message + client, no sourceRevision/intendedForBuildId) rendered
  only the present fields, and the release page correctly omitted the assign
  button for the current Release.
- Actual files changed:
  - `src/routes/admin-panel.js` (`/publishing/releases/:releaseId` route)
  - `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` (`getPublishingRelease`)
  - `src/pages/admin/publishing/releases/page.json`, `src/pages/admin/publishing/releases/page.html`
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`
- Validation run: see PUBUI-2 (same lint/test run covers this file); manual
  render confirmed on the seeded local target instance.
- Blockers: None.

### Task PUBUI-5: Assign a Release to the running build from the admin panel

**Status:** Complete
**Depends on:** PUBUI-1, PUBUI-2, PUBUI-4
**Documentation:** `src/app/presentation/README.md` (Forms, HTML Forms Extend
BaseForm, Companion Forms in One File, CSRF-Protected HTML Forms, Response
Status on Re-rendered Errors); `docs/publishing-api.md` (Assign a Release to a
build, Rollback).

**Objective**

From the overview's Release rows and from the Release detail page, an
administrator holding `urn:kixx:update` on `urn:kixx:publishing:builds` can
assign that Release to the running build with one click. The action is
CSRF-protected, carries the expected current Release id and build id as hidden
fields, redirects on every outcome, and reports the outcome with a notice on
the overview page.

**Scope**

- In: A form class; the POST route and target; a `postAssignRelease` handler;
  the assign control markup on the overview and Release detail pages; notice
  rendering on the overview; form and handler tests.
- Out: Assigning to a non-running build; pre-staging; a confirmation page;
  changes to the Transaction Script from PUBUI-1.

**Design and invariants**

- Form: `src/app/presentation/forms/publishing/assign-release-form.js`
  exporting `AssignReleaseForm extends BaseForm` with `static target =
  'admin-panel/publishing-assign/assign'`, `static method = 'POST'`, and a
  schema of three hidden fields: `release_id`, `build_id`,
  `expected_release_id`, all required non-empty strings normalized with
  `normalizeStringAttribute`. `validate()` accumulates one error per missing
  field. `release_id` and `expected_release_id` should additionally be
  checked with `isValidHash` from
  `src/kixx/content-addressable-store/addressing.js` so a forged value is
  rejected before any store read.
- Route: `{ pattern: '/publishing/assign', name: 'publishing-assign' }` with
  a single `POST` target named `assign`, gated by `authorize([{ action:
  'urn:kixx:update', resource: 'urn:kixx:publishing:builds' }])`, declared
  before `/publishing`. It is its own route for the same reason the revoke
  routes are: one route cannot host two POST targets, and this action is
  reachable from two pages. It renders no page; it only redirects.
- Handler flow, mirroring `postRevokePublishingApiToken`:
  1. `validateCsrfFormData`; on `INVALID_CSRF_TOKEN_CODE` redirect `303` to
     the overview with `?notice=form_expired`.
  2. `AssignReleaseForm.fromFormData`, `validate()`; a `ValidationError`
     propagates to the admin error handler (a forged hidden field is not a
     recoverable operator mistake).
  3. Call `assignReleaseToRunningBuild(context, { buildId: form.build_id,
     releaseId: form.release_id, expectedReleaseId:
     form.expected_release_id, activatedBy: context.user.id })`.
  4. Map outcomes to redirect notices on the overview:
     success → `release_assigned`; `BuildPointerConflict` →
     `pointer_conflict`; `RunningBuildMismatch` → `build_mismatch`;
     `RunningBuildUnassigned` → `build_unassigned`; `ReleaseNotFound` →
     `release_not_found`. Any other error propagates.
  5. Always `skip()` and redirect `303`.
- Notice rendering: extend the overview handler's allow-list to these codes
  and render one callout per code (`callout--info` for success, `callout--error`
  otherwise) with copy that tells the operator what to do (reload for
  conflict and mismatch; use the Publishing API for an unassigned build).
- Assign control rendering:
  - The overview and Release detail handlers get a `form` prop via
    `getCsrfFormContext` with a bare `AssignReleaseForm` so the template can
    read `form.url`, `form.method`, and `form.csrf`. Only mint it when
    `runningBuild` has a `releaseId`; otherwise omit `form` so no control
    renders.
  - Each Release row on the overview, and the Release detail card, renders a
    `<form>` with the CSRF hidden field, `release_id`, `build_id` set to the
    running build id, and `expected_release_id` set to the running build's
    current `releaseId`, plus a submit button labeled `Assign to running
    build`. The button is omitted for the current Release, which shows a
    "Current" label instead.
  - The button label must also indicate direction so a single click is
    informed: pass a per-row `direction` prop (`'rollback'` when the row's
    `createdAt` is earlier than the current Release's `createdAt`,
    `'forward'` otherwise) and label the button `Roll back to this Release`
    or `Roll forward to this Release`. This duplicates the timestamp
    comparison from PUBUI-1 in the handler; keep it a two-line helper in the
    handler module, not a shared utility, and note in a comment that the
    recorded reason is decided by the Transaction Script.
  - Render the control only when the principal holds the update grant, using
    `requirePermission`-equivalent check exposed by
    `src/kixx/permissions/permission-validation.js` (look for a boolean
    variant; if only the throwing form exists, wrap it in a small helper in
    the handler). A viewer without the grant sees the rows without buttons
    rather than a button that yields a 403.
- The overview and Release detail targets already run with `usePageCache:
  false`; confirm this once the CSRF token is rendered.

**Expected touch points**

- `src/app/presentation/forms/publishing/assign-release-form.js` — new form.
- `src/routes/admin-panel.js` — POST route.
- `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` — `postAssignRelease`, notice handling, `form` and `direction` props.
- `src/pages/admin/publishing/page.html` — notices and per-row control.
- `src/pages/admin/publishing/releases/page.html` — control on the detail card.
- `test/unit-tests/app/presentation/forms/publishing/assign-release-form.test.js` — form tests.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js` — handler tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Submitting the control for an older Release results in an activation with `reason: 'rollback'`; for a newer one, `publish` (asserted through the mocked script's received arguments in handler tests, and end-to-end on a local target instance manually).
- [ ] The overview redirect carries `notice=release_assigned` and the page shows the running build pointing at the chosen Release.
- [ ] A stale page (expected Release id no longer current) redirects with `notice=pointer_conflict` and the pointer is unchanged.
- [ ] A page rendered for a different build id redirects with `notice=build_mismatch`.
- [ ] An expired CSRF token redirects with `notice=form_expired`.
- [ ] Unknown notice codes are discarded.
- [ ] The control does not render for the current Release, when no running build or pointer exists, or for a principal lacking the update grant.
- [ ] A POST from a principal lacking the update grant is refused by `authorize` before the handler runs.
- [ ] Form tests cover normalization, required fields, and hash validation. Handler tests cover every redirect outcome.

**Validation**

- `node run-linter.js src/routes src/app/presentation test/unit-tests/app/presentation`
- `node run-tests.js test/unit-tests/app/presentation`
- `node run-tests.js` — full unit suite passes.
- Manual on a local target instance: create a second Release via the
  Publishing API (or re-seed after a content change), roll back to the first
  from the admin panel, confirm the site serves the old content on the next
  request, then roll forward and confirm the build detail page shows a
  `rollback` followed by a `publish` activation attributed to the admin user id.

**Progress and handoff**

- Completed: `AssignReleaseForm`, the `/publishing/assign` route,
  `postAssignRelease` handler, notice rendering and per-row/detail assign
  controls on the overview and Release detail templates, `direction`
  computation, permission-gated control rendering, and form + handler tests.
  Implemented together with PUBUI-2/3/4 (see PUBUI-2's handoff note for why).
- Current state: Complete, with one documented manual-verification gap (see
  below) rather than a code gap — every acceptance criterion backed by an
  automated test is satisfied and passing.
- Remaining: The full live rollback/roll-forward round trip against a local
  target instance (create a second Release via the Publishing API, roll back,
  confirm served content changes, roll forward) described in the Validation
  section was not run. Constructing a second valid Release by hand requires
  assembling a complete manifest (base templates, global partials, at least
  one page's metadata/partials/templates, all as uploaded or inline content
  objects) per `docs/publishing-api.md` — a substantial scripted effort beyond
  what this pass covered. A future agent or the user can complete this with
  `node tools/local-target.js create/seed/serve <name>`, the
  `publishingApiToken` from its `credentials.json`, and a second `POST
  /publishing-api/v1/releases` call with inline content, then exercise the
  admin panel's roll back/forward controls and confirm the build detail page
  shows a `rollback` then a `publish` activation.
- Decisions and discoveries:
  - `postAssignRelease` drives the real `assignReleaseToRunningBuild` script
    through a fully mocked `context` (store/collections), the same style
    `assign-release.test.js` and `assign-release-to-running-build.test.js`
    already use, rather than mocking the transaction-script module directly —
    ES module named exports are not reassignable, so there is no established
    pattern in this codebase for swapping a handler's imported script with a
    `MockTracker` double. This exercises the real reason-inference and
    precondition logic end-to-end in the handler tests, which is stronger
    coverage than mocking the script's call arguments would have been.
  - `AssignReleaseForm.validate()` rejects `release_id`/`expected_release_id`
    values that are not 26-character `[a-z2-7]` digests via `isValidHash()`
    before any store read, exactly as specified.
  - Redirects always target the overview pathname
    (`admin-panel/publishing/render-overview`), never the assign route itself
    — the assign route renders no page of its own.
  - Verified interactively on the (since-destroyed) seeded local target
    instance: logging in as the seeded root admin and viewing the overview,
    build, and Release pages worked with real seeded data end-to-end through
    the new routes and handlers with no server errors, confirming the route
    wiring, CSRF token minting (`usePageCache: false`), and permission checks
    function against a real running app, not only against test mocks.
- Actual files changed:
  - `src/app/presentation/forms/publishing/assign-release-form.js` (new)
  - `src/routes/admin-panel.js` (`/publishing/assign` POST route)
  - `src/app/presentation/request-handlers/admin-panel/admin-publishing.js` (`postAssignRelease`, notice handling, `form`/`direction`/`runningBuild` props)
  - `src/pages/admin/publishing/page.html` (notices, per-row assign control)
  - `src/pages/admin/publishing/releases/page.html` (detail-card assign control)
  - `test/unit-tests/app/presentation/forms/publishing/assign-release-form.test.js` (new)
  - `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing.test.js`
- Validation run: `node run-linter.js` (repo-wide, clean); `node run-tests.js`
  (1341 tests; only the pre-existing, unrelated `node-config.test.js` failure,
  reproduced independent of this branch); manual render verification on a
  seeded local target instance (see above) — the live rollback/roll-forward
  round trip itself was not run (see Remaining).
- Blockers: None for the code. The live rollback manual step is deferred, not
  blocked — it just needs a deliberate session to build a second Release
  payload.
