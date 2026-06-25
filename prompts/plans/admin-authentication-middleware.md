# Admin Authentication Middleware - Implementation Plan

## Implementation Approach

Protect the `/admin` route subtree with route-level inbound middleware that authenticates the admin session before any admin target handlers run. Keep the middleware focused on authentication only: read the admin session cookie, delegate session/user validation to a Transaction Script, and set `context.user` with the safe `AdminUserRecord#toAuthenticatedUser()` projection. Throw `UnauthenticatedError` for missing or invalid authentication and let an admin route error handler translate that expected error into either an HTML login redirect or the existing router-level JSON:API 401 response. Share the session cookie name and TTL through one small module so signup, future login, and middleware do not drift. Do not add automated tests unless explicitly requested; run the linter on changed JavaScript files after implementation.

## TODO

- [x] **Create the admin session contract module**
  - **Story**: Shared admin session identity
  - **What**: Move the admin session cookie name and max-age/TTL values into a reusable module. Export `ADMIN_SESSION_COOKIE_NAME` and `ADMIN_SESSION_TTL_SECONDS`, and update existing signup code to use those names instead of local constants.
  - **Where**: `src/app/lib/admin-session.js`, `src/app/presentation/request-handlers/admin-users.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/app/presentation/README.md`
  - **Acceptance criteria**: Signup still sets the same `kixx_admin_session` cookie; the cookie max age still mirrors the stored session expiration; no duplicate admin-session cookie name remains in request handlers.
  - **Depends on**: none

- [x] **Implement admin session authentication**
  - **Story**: Valid admin sessions authenticate admin requests
  - **What**: Add a Transaction Script that accepts a session id, loads the `UserSession` record, verifies the session exists and has not expired, loads the referenced `AdminUser`, and returns `user.toAuthenticatedUser()`. Throw `UnauthenticatedError` for missing sessions, expired sessions, or sessions whose referenced admin user no longer exists. Preserve unexpected storage failures as unexpected errors according to the error-handling guide.
  - **Where**: `src/app/transaction-scripts/admin-users/authenticate-admin-session.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/app/collections/README.md`, `src/docs/error-handling.md`, `src/app/collections/user-session-collection.js`, `src/app/collections/admin-user-record.js`
  - **Acceptance criteria**: A valid stored admin session returns a plain authenticated-user object without `passwordHash`; missing, expired, or orphaned sessions throw `UnauthenticatedError`; the script does not depend on HTTP request or response objects.
  - **Depends on**: Create the admin session contract module

- [x] **Add the admin authentication middleware**
  - **Story**: All `/admin` routes require an authenticated admin user
  - **What**: Add inbound middleware that reads `ADMIN_SESSION_COOKIE_NAME` from `request.getCookie()`, throws `UnauthenticatedError` when absent, calls `authenticateAdminSession(context, sessionId)`, and assigns the returned user with `context.setUser(user)`. The middleware should not redirect, render, or inspect response negotiation.
  - **Where**: `src/app/presentation/middleware/admin-authentication.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: Requests without the admin session cookie fail before admin page handlers run; requests with a valid session populate `context.user`; the middleware only performs authentication and does not commit a response.
  - **Depends on**: Implement admin session authentication

- [x] **Add the admin unauthenticated error handler**
  - **Story**: Browser admin requests are redirected to login
  - **What**: Add a route-level error handler for `/admin` that handles only `UnauthenticatedError` on non-JSON requests. Compile the login URL through `context.getHttpTarget('admin-login-form/render-form')`, clear the stale admin session cookie if present, and return a `303` redirect to the login page. For JSON requests and all non-authentication errors, return `false` so the existing router fallback produces the canonical JSON:API error response or lets unexpected errors propagate.
  - **Where**: `src/app/presentation/error-handlers/admin-authentication.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/kixx/http-router/error-handler-interface.js`, `src/kixx/http-router/http-router.js`
  - **Acceptance criteria**: HTML requests to protected admin URLs without valid auth redirect to `/login/admin/new`; JSON admin requests receive a 401 JSON:API response through the router fallback; unrelated errors are not swallowed.
  - **Depends on**: Create the admin session contract module

- [x] **Wire auth into the `/admin` route subtree**
  - **Story**: Route configuration protects every admin target
  - **What**: Import the admin authentication middleware and unauthenticated error handler, then attach them to the `/admin` route with `inboundMiddleware` and `errorHandlers`. Keep signup and login routes outside this middleware so unauthenticated users can create or recover an admin session.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/virtual-hosts.js`
  - **Acceptance criteria**: Every current and future nested target under `/admin` inherits the admin authentication middleware; `/users/admin/new` and `/login/admin/new` remain public; route matching order is unchanged.
  - **Depends on**: Add the admin authentication middleware, Add the admin unauthenticated error handler

- [x] **Run lint on changed files**
  - **Story**: Implementation is clean and observable
  - **What**: Run the linter on the changed JavaScript files. Do not manually verify admin request behavior in this implementation step; runtime behavior will be verified manually later.
  - **Where**: `src/app/lib/admin-session.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-session.js`, `src/app/presentation/middleware/admin-authentication.js`, `src/app/presentation/error-handlers/admin-authentication.js`, `src/app/presentation/request-handlers/admin-users.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/virtual-hosts.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/app/presentation/README.md`, `README.md`
  - **Acceptance criteria**: `node run-linter.js` passes for the changed JavaScript files; no manual admin HTML or JSON behavior verification is performed in this step; any test work remains deferred until explicitly requested.
  - **Depends on**: Wire auth into the `/admin` route subtree
