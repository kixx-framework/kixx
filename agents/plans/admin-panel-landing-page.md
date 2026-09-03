# Admin panel landing page

## Implementation Approach

Add an explicit root target below the existing authenticated `/admin` route and
render the already-established `pages/admin/` page through the admin shell. The
page will be a static directory of the three current admin domains: Style Guide,
User Invites, and Publishing API Tokens. It will compose existing semantic HTML,
the admin content-section shell, cards, and the responsive grid primitive, so no
new handler, data access, authorization rule, browser JavaScript, or CSS is
needed.

The route must be a child whose pattern is `{/}`, rather than relying on the
subtree's `*` fallback: the latter only serves descendants such as
`/admin/style-guide`, while `/admin` currently has no matching target. The new
endpoint inherits the parent route's admin-session authentication and error
handling. The directory links can be literal, stable admin paths because
templates do not have request-context reverse-routing access; their target
names and paths will be recorded in the test that owns this route contract.

## Tasks

### Task ADMLP-1: Serve an authenticated admin directory at `/admin`

**Status:** Complete
**Depends on:** None
**Documentation:** `README.md`; `src/app/presentation/README.md` (Routing,
Route Matching Order, and Reverse Routing); `src/templates/README.md`
(Hyperview Context); `src/docs/frontend-development-guide.md` (Public Pages Are
the Default, Follow the Style Guide, Layout Primitives, and Components and
Forms).

**Objective**

Make `GET` and `HEAD` requests to `/admin` render an admin-shell landing page
for an authenticated administrator, instead of falling through to a 404. The
page gives each existing admin domain a clear, usable entry point.

**Scope**

- In: A root child route in the admin-panel route tree; the root admin page
  metadata and markup; links to Style Guide, User Invites, and Publishing API
  Tokens.
- Out: Changes to authentication, permissions, invitations, token operations,
  the style-guide sub-navigation, and any new dashboard data or counters.

**Design and invariants**

- Add a named `{/}` child route before the catch-all `*` route in
  `src/routes/admin-panel.js`, with one `GET`/`HEAD` render target using
  `HyperviewPageHandler({ baseTemplateId: 'admin.html' })`.
- Do not attach a second authentication or authorization middleware. The target
  must inherit `authenticateAdminUser` and `adminErrorHandler` from the
  `/admin` parent in `src/virtual-hosts.js`; any valid admin role can see this
  directory even if its grants do not allow every destination operation.
- Give the root `pages/admin/page.json` a concrete page title (for example,
  `Admin Panel`) without changing the inherited title template used by child
  admin pages.
- Add `src/pages/admin/page.html` with a single `main.admin-main`, one
  `article.admin-content-section.flow`, an `h1`, concise introductory copy, and
  a semantic list of three `article.card.flow` entries inside `grid-auto`.
  Each card has an `h2`, a short purpose statement, and a normal text link to
  its existing route:
  `/admin/style-guide`, `/admin/invites`, and `/admin/publishing-api-tokens`.
- Reuse only existing styles (`admin-main`, `admin-content-section`, `flow`,
  `grid-auto`, `card`, and existing type roles). Do not add inline styles,
  page-local CSS, scripts, imagery, icons, or a new component. The semantic
  card list uses the shared `list-unstyled` utility with the responsive-grid
  contract, so browser list markers and indentation do not leak into the grid.
- Preserve the existing route order and behavior for the three domain routes,
  their POST actions, and arbitrary static `/admin/*` pages.

**Expected touch points**

- `src/routes/admin-panel.js` — declare the `/admin` root render target before
  the static catch-all.
- `src/pages/admin/page.json` — supply root-page title data while retaining
  inheritance for descendant titles.
- `src/pages/admin/page.html` — render the three-domain admin directory.
- `src/static-assets/stylesheets/lib/layout.css` — provide the reusable
  unstyled-list utility used by layout lists.

**Acceptance criteria**

- [x] An authenticated `GET /admin` resolves to a 200 HTML page using
  `admin.html`, not a 404.
- [x] `HEAD /admin` is handled by the same endpoint.
- [x] The rendered page has a meaningful document title and one `h1`.
- [x] Style Guide, User Invites, and Publishing API Tokens each appear with
  concise explanatory copy and a working link to their current endpoint.
- [x] The three entries remain readable and usable at narrow widths through the
  existing responsive grid and the shared `list-unstyled` utility; no
  client-side behavior is introduced.
- [x] An unauthenticated `/admin` request retains the established redirect to
  the admin login form, and existing protected-domain permissions remain
  unchanged.

**Validation**

- `node run-linter.js src/routes/admin-panel.js` — confirms the changed
  JavaScript route module follows project lint rules.
- `node run-tests.js test/unit-tests/routes/admin-panel.test.js` — exercises
  the root route's method, render-shell, target-name, and ordering contract.
- `node run-tests.js` — confirms the complete unit suite remains green.
- Review the rendered template context for `/admin.json` only if needed to
  confirm inherited title and page content; do not start a development server
  as part of task verification.

**Progress and handoff**

- Completed: Added the root route, title data, static directory page, and its
  `page.html` metadata declaration, plus the reusable semantic-list utility.
- Current state: Complete.
- Remaining: Nothing in this task.
- Decisions and discoveries: `/admin` inherits authentication and error handling
  from its parent route. Its `subpage.title` supplies the root title while the
  inherited `page.title` template remains available to descendants. The root
  route precedes the descendant catch-all and uses the existing admin shell.
- Actual files changed: `src/routes/admin-panel.js`,
  `src/pages/admin/page.json`, `src/pages/admin/page.html`, and
  `src/static-assets/stylesheets/lib/layout.css`.
- Validation run: `node run-linter.js src/routes/admin-panel.js
  test/unit-tests/routes/admin-panel.test.js`, `git diff --check`,
  `node run-tests.js test/unit-tests/routes/admin-panel.test.js`, and
  `node run-tests.js` passed (1,267 tests). Authenticated live requests
  initially reproduced the 404 and identified the missing `page.html`
  declaration. The existing devserver stopped while refreshing, so the corrected
  live response was not rechecked without starting a new server. The shared
  `list-unstyled` utility was added after visual review exposed default list
  markers and indentation in the card grid; `git diff --check` and the focused
  route test passed afterward. The local server was not listening for a final
  live rendering check.
- Blockers: None.

### Task ADMLP-2: Lock the admin-root route contract with a unit test

**Status:** Complete
**Depends on:** ADMLP-1
**Documentation:** `test/unit-tests/README.md`; `src/app/presentation/README.md`
(Routing and Route Matching Order).

**Objective**

Prevent a future route-tree edit from removing or shadowing the admin landing
page while preserving the intended static-page fallback behavior.

**Scope**

- In: Focused route-specification tests for the `/admin` root target.
- Out: Browser/end-to-end testing, testing Hyperview itself, and duplicate
  coverage of authentication or individual admin domain handlers.

**Design and invariants**

- Add `test/unit-tests/routes/admin-panel.test.js` to import the admin route
  tree and inspect the root child route directly.
- Assert that the root child uses `{/}`, appears before the `*` fallback, and
  exposes a named render target for both `GET` and `HEAD`.
- Assert that the root target uses the admin base template through its
  Hyperview handler configuration where that configuration is observable; keep
  the test focused on the route contract, not Hyperview internals.
- Do not add an end-to-end test: project instructions exclude those unless
  explicitly requested.

**Expected touch points**

- `test/unit-tests/routes/admin-panel.test.js` — route contract coverage for
  the new landing endpoint.

**Acceptance criteria**

- [x] The test fails if `/admin` no longer has an explicit `GET`/`HEAD` root
  target.
- [x] The test fails if the static catch-all precedes and can shadow the root
  target.
- [x] The test passes without a running server or persistence setup.

**Validation**

- `node run-tests.js test/unit-tests/routes/admin-panel.test.js` — validates
  the focused route contract.
- `node run-tests.js` — validates the full unit suite.

**Progress and handoff**

- Completed: Added and passed focused route-contract coverage.
- Current state: Complete.
- Remaining: Nothing in this task.
- Decisions and discoveries: A route-module test is the smallest suitable
  regression boundary because the new behavior is declarative routing plus a
  static Hyperview page; existing handler tests already cover the Invite and
  Publishing API Token workflows. The Hyperview handler's options are
  observable by invoking it with a local service double.
- Actual files changed: `test/unit-tests/routes/admin-panel.test.js`.
- Validation run: `node run-linter.js src/routes/admin-panel.js
  test/unit-tests/routes/admin-panel.test.js` passed;
  `node run-tests.js test/unit-tests/routes/admin-panel.test.js` passed
  (2 tests); `node run-tests.js` passed (1,267 tests).
- Blockers: None.
