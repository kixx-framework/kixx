# Admin Panel HTML Error Pages

## Implementation Approach

Add styled HTML 404/403/500 pages for two distinct visual scopes: the authenticated admin panel (`/admin/**`, `admin.html` base template) and the pre-authentication login/invite-acceptance forms (`/login/admin/new`, `/users/admin/new`, `admin-login.html` base template). Both scopes share one status-classification-and-render helper so the mapping from error to status/heading/message lives in exactly one place, but each scope keeps its own route-level `errorHandlers` entry, its own fixed Hyperview pathname, and its own page/template pair so the two visual layouts don't leak into each other. The helper renders through `HyperviewDynamicPageHandler` with a `pathname` override (not `HyperviewStaticPageHandler`, whose full-page cache would serve a stale error page for a different status/message) and `allowJSON: false` (the dynamic handler's JSON-debug branch hardcodes a `200` status, which would mask the real error status). Per the corrected error-handling documentation, it is safe and intended for these handlers to catch genuinely unexpected/programmer errors too — the platform's fatal-error shutdown is driven independently by the router's `error` event, not by whether this cascade produced a response — so both handlers render 500 for anything that isn't `NotFoundError` or `ForbiddenError`, while continuing to decline (`return false`) for JSON-negotiated requests and, in the admin-panel handler, the existing `UnauthenticatedError` redirect stays untouched.

## Tasks

- [x] **Shared error-classification-and-render helper**
  - **Story**: Admin panel HTML error pages
  - **What**: Add `src/app/presentation/lib/admin-error-page.js` exporting `renderAdminErrorPage(context, request, response, error, pathname)`. It: (1) returns `false` immediately when `request.isJSONRequest()` so JSON-negotiated requests keep falling through to the JSON:API/router/platform fallback; (2) classifies the error into `{ statusCode, heading, message }` via a private `classifyError(error)` helper — `error.name === 'NotFoundError'` → `404` with `error.message` (client-safe by contract), `error.name === 'ForbiddenError'` → `403` with `error.message`, anything else (expected non-HTTP errors and genuinely unexpected/programmer errors alike) → `500` with a fixed generic message, never `error.message`, since only `NotFoundError`/`ForbiddenError` messages are guaranteed client-safe per `src/docs/error-handling.md`; (3) sets `response.status = statusCode`; (4) calls `response.updateProps({ page: { title: \`${heading} : Admin\` }, error: { statusCode, heading, message } })`; (5) returns `HyperviewDynamicPageHandler({ pathname, allowJSON: false })(context, request, response)`.
  - **Where**: `src/app/presentation/lib/admin-error-page.js` (new file)
  - **Documentation**: `src/docs/error-handling.md` (error classification and message-safety rules, and the corrected "Router Error Propagation and the Platform Fatal-Error Policy" section), `src/kixx/hyperview/hyperview-request-handlers.js` (`HyperviewDynamicPageHandler` contract — no page cache, `response.status` passthrough, `allowJSON` status-200 quirk), `src/app/presentation/error-handlers/admin-error-handler.js` (existing handler shape/style to match)
  - **Acceptance criteria**: Helper is the single place that maps an error to a status/heading/message and renders it; both error handlers below call it with only a different `pathname`.
  - **Depends on**: none

- [x] **Admin panel error page content**
  - **What**: Add `src/pages/admin/errors/page.json` (`{ "baseTemplate": "admin.html", "page": { "title": "Error : Admin" } }`) and `src/templates/pages/admin/errors/page.html` rendering `error.statusCode`, `error.heading`, `error.message` inside the same `<main class="site-main"><article class="content-section flow">...</article></main>` structure used by `src/templates/pages/admin/invites/page.html`, plus a link back to `/admin`. One template serves all three statuses — no per-status branching — since the handler already supplies status-specific heading/message text.
  - **Story**: Admin panel HTML error pages
  - **Where**: `src/pages/admin/errors/page.json` (new), `src/templates/pages/admin/errors/page.html` (new)
  - **Documentation**: `src/templates/README.md` (interpolation, escaping), `src/app/presentation/README.md` (Hyperview file layout, page context data), `src/docs/frontend-development-guide.md` (no inline styles, BEM, reuse existing primitives/components)
  - **Acceptance criteria**: Requesting the fixed pathname renders a page styled consistently with the rest of the authenticated admin panel and displays the status-specific heading/message.
  - **Depends on**: Shared error-classification-and-render helper (defines the `error.*`/`page.title` data contract the template reads)

- [x] **Wire 404/403/500 into the admin-panel error handler**
  - **What**: Update `src/app/presentation/error-handlers/admin-error-handler.js` so the existing `UnauthenticatedError` branch is preserved as-is (redirect to login, still skipped for JSON requests), and every other error falls through to `renderAdminErrorPage(context, request, response, error, '/admin/errors')` from the new helper.
  - **Story**: Admin panel HTML error pages
  - **Where**: `src/app/presentation/error-handlers/admin-error-handler.js`
  - **Documentation**: `src/docs/error-handling.md`, `src/app/presentation/README.md` ("Middleware vs. Request Handlers vs. Error Handlers")
  - **Acceptance criteria**: A `NotFoundError` or `ForbiddenError` thrown anywhere under `/admin/**` renders the matching styled page at the right status code; any other error (including an unexpected/programmer error) renders the styled 500 page; `UnauthenticatedError` behavior and JSON-request behavior are unchanged from today.
  - **Depends on**: Shared error-classification-and-render helper, Admin panel error page content

- [x] **Login/invite error page content**
  - **What**: Add `src/pages/login/admin/errors/page.json` (`{ "baseTemplate": "admin-login.html", "page": { "title": "Error : Admin" } }`) and `src/templates/pages/login/admin/errors/page.html` rendering the same `error.statusCode`/`error.heading`/`error.message` fields inside a `.center.center--form.flow` wrapper matching `src/templates/pages/login/admin/new/page.html`'s structure, with a link back to `/login/admin/new`.
  - **Story**: Admin login/invite HTML error pages
  - **Where**: `src/pages/login/admin/errors/page.json` (new), `src/templates/pages/login/admin/errors/page.html` (new)
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md`, `src/docs/frontend-development-guide.md`
  - **Acceptance criteria**: Requesting the fixed pathname renders a page styled consistently with the login/invite-acceptance forms (no admin nav/sidebar) and displays the status-specific heading/message.
  - **Depends on**: Shared error-classification-and-render helper (same data contract)

- [x] **New shared error handler for the login/new-admin-user routes**
  - **What**: Add `src/app/presentation/error-handlers/admin-auth-error-handler.js` exporting `adminAuthErrorHandler(context, request, response, error)`, which simply calls `renderAdminErrorPage(context, request, response, error, '/login/admin/errors')`. This is a separate handler from `adminErrorHandler` — it is shared only between the two pre-auth routes below, not with the authenticated admin-panel route, since those routes have no `UnauthenticatedError`/redirect concern and use the different `admin-login.html` visual scope.
  - **Story**: Admin login/invite HTML error pages
  - **Where**: `src/app/presentation/error-handlers/admin-auth-error-handler.js` (new file)
  - **Documentation**: `src/app/presentation/error-handlers/admin-error-handler.js` (sibling handler shape/style), `src/docs/error-handling.md`
  - **Acceptance criteria**: Handler renders the login/invite error page for any error other than a JSON-negotiated request.
  - **Depends on**: Shared error-classification-and-render helper, Login/invite error page content

- [x] **Attach the new handler to the login and new-admin-user routes**
  - **What**: In `virtual-hosts.js`, import `adminAuthErrorHandler` and add `errorHandlers: [ adminAuthErrorHandler ]` to both the `new-admin-user-form` route (pattern `/users/admin/new{.:suffix}`) and the `admin-login-form` route (pattern `/login/admin/new{.:suffix}`). Neither route currently declares `errorHandlers`.
  - **Story**: Admin login/invite HTML error pages
  - **Where**: `virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (Dynamic Routes, route/target error handler wiring)
  - **Acceptance criteria**: A `NotFoundError`, `ForbiddenError`, or unexpected error thrown while handling either route renders the login-scope styled error page at the right status code.
  - **Depends on**: New shared error handler for the login/new-admin-user routes

- [x] **Manual verification pass**
  - **What**: Run the dev server (`node tools/devserver.js --config src/node-config.json --port 2026`) and manually check: an unknown path under `/admin/` while logged in as an admin renders the styled 404; a route that throws `ForbiddenError` (or a temporary manual throw) renders the styled 403; a forced unexpected error renders the styled 500 without crashing the manual check (the dev server child process restart from the graceful shutdown is expected); the same three cases for `/login/admin/new` and `/users/admin/new`; confirm `UnauthenticatedError` redirect-to-login behavior for `/admin/**` is unchanged; confirm a `.json`-suffixed or `Accept: application/json` request to a failing admin route still gets a JSON:API error body, not the HTML page.
  - **Story**: Admin panel HTML error pages / Admin login/invite HTML error pages
  - **Where**: n/a (manual browser/curl verification, no new files)
  - **Documentation**: `AGENTS.md` (Development Server section)
  - **Acceptance criteria**: All bullets above pass visually and via response status/content-type.
  - **Depends on**: Attach the new handler to the login and new-admin-user routes
