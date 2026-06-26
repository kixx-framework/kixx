# Admin User Login - Implementation Plan

## Implementation Approach

Complete the `POST /login/admin/new` half of the admin login feature; the GET render half (`getAdminUserLoginForm`, the route, the form class) already exists. A new Transaction Script authenticates submitted credentials against the stored `AdminUser`, using the existing `verifyPassword()` PHC verifier and `UserSessionCollection#createForUser()` to mint a session. The request handler parses and validates the form (server-side only), calls the script, and on success sets the admin session cookie and redirects into the admin panel — mirroring the established signup flow — or re-renders the form with a generic, non-enumerating error on bad credentials. To avoid leaking whether an email is registered, the script returns one generic error for both "no such user" and "wrong password" and performs equivalent key-derivation work in the no-user branch so response timing does not distinguish the two. A prerequisite task repairs two broken `lib/admin-session.js` imports left behind by an earlier rename to `lib/user-sessions.js`, since the admin auth path cannot load until they are fixed. Do not add automated tests unless explicitly requested; run the linter on changed JavaScript files after implementation.

## TODO

- [x] **Repair broken admin session library imports**
  - **Story**: Auth path modules load
  - **What**: Repoint the two stale imports from the removed `../../lib/admin-session.js` to `../../lib/user-sessions.js`. `create-admin-user.js` imports `ADMIN_SESSION_TTL_SECONDS`; `admin-authentication.js` (middleware) imports `ADMIN_SESSION_COOKIE_NAME`. Both symbols are exported from `lib/user-sessions.js`. Change only the import specifier path; do not alter behavior.
  - **Where**: `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/app/presentation/middleware/admin-authentication.js`
  - **Documentation**: `src/app/lib/user-sessions.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: No source file imports `lib/admin-session.js`; `grep -rn "lib/admin-session" src/` returns nothing; signup and admin authentication modules import the session cookie name and TTL from `lib/user-sessions.js`.
  - **Depends on**: none

- [x] **Add the admin credential authentication Transaction Script**
  - **Story**: Valid admin credentials produce a session
  - **What**: Add `authenticateAdminCredentials(context, form)`. Read `email_address` and `password` from the validated form. Look up the admin via `adminUsers.getByEmailAddress(context, email_address)`. When a user exists, verify with `verifyPassword(password, user.get('passwordHash'))`. When no user exists, still perform equivalent KDF work (e.g. `await pbkdf2HashPassword(password, iterations)` with `PBKDF2_ITERATIONS` read via `context.getEnvInteger('PBKDF2_ITERATIONS', { required: true })`) and discard the result, so the timing of the no-user branch matches the verify branch. On any credential failure (no user, or `verifyPassword` returns false), throw a single generic `UnauthorizedError` with a client-safe message ("Invalid email or password.") and `code: 'InvalidCredentials'` — never reveal which factor failed. On success, create a session with `sessions.createForUser(context, user.id, ADMIN_SESSION_TTL_SECONDS)` and return `{ user: user.toAuthenticatedUser(), sessionId: session.id }`. Wrap unexpected storage failures as unexpected `AssertionError` with `cause`; let assertion/programmer errors propagate.
  - **Where**: `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/lib/crypto.js`, `src/app/lib/user-sessions.js`, `src/app/collections/admin-user-collection.js`, `src/app/collections/user-session-collection.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`
  - **Acceptance criteria**: Correct email + password returns `{ user, sessionId }` with no `passwordHash` in `user`; both an unknown email and a wrong password throw `UnauthorizedError` with `code: 'InvalidCredentials'` and an identical generic message; the unknown-email branch still performs a password hash derivation; the script takes no HTTP request/response objects; unexpected storage errors surface as unexpected `AssertionError`.
  - **Depends on**: Repair broken admin session library imports

- [x] **Add login form render metadata (keep server-side validation)**
  - **Story**: Login form validates server-side and renders its fields
  - **What**: Update `AdminUserLoginForm`. Keep `validate()` as-is: email validated via `validateEmailAddressField`, and password validated for presence **and** the existing 16/256 `minLength`/`maxLength` bounds — server-side only. Keep `minLength`/`maxLength` on the schema's `password` and keep `writeOnly: true` so the password is never echoed back. Add render metadata to both schema fields matching the signup form's shape (`label`, `inputType`, `autocomplete`, `hint`), using `autocomplete: 'current-password'` for the password field (not `new-password`) and `inputType: 'email'`, `autocomplete: 'email'` for the email field. Do not add any client-side validation affordance — validation stays server-side, enforced only in `validate()` (the template renders `novalidate` with no `required`, handled in the template task).
  - **Where**: `src/app/presentation/forms/admin-users/admin-user-login-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms), `src/app/presentation/forms/base-form.js`, `src/app/presentation/forms/admin-users/new-admin-user-form.js`, `src/app/presentation/forms/utils.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A missing email or missing password fails server-side validation with field-level messages; a present-but-too-short or too-long password fails server-side validation with the length message; the schema password field retains `minLength`/`maxLength` and `writeOnly: true`; `getFormContext()` exposes `label`, `inputType`, `autocomplete`, and `hint` for both fields and never exposes a `password` value.
  - **Depends on**: none

- [x] **Add the login POST request handler**
  - **Story**: Submitting valid credentials logs the admin in
  - **What**: Add `postAdminUserLoginForm(context, request, response, skip)` to the admin-users request handlers. Build the form with `AdminUserLoginForm.fromFormData(await request.formData())` and call `validate()`. On `ValidationError`, re-render via `response.updateProps({ form: form.getFormContext(context, error), links })` (do not call `skip()`), where `links` includes the new-user form link. Otherwise call `authenticateAdminCredentials(context, form)`; catch `error.code === 'InvalidCredentials'` and re-render with `form.getFormContext(context)` plus a generic form-level `formError` ("Invalid email or password.") and the links — rethrow anything else. On success call `setAdminSessionCookie(request, response, result.sessionId)`, then `skip()` and `respondWithRedirect(303, ...)` to the admin panel via `context.getHttpTarget('admin-panel/style-guide/render-style-guide-page').compilePathname().pathname` (same destination as signup). Also fix the two inverted link-helper names in this module (`getNewAdminUserFormLink` / `getAdminUserLoginFormLink`) so each helper's name matches the target it compiles; update their call sites accordingly. Reuse a single helper for the new-user-form link used by the login handlers.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md` (Request Handlers, Forms, Reverse Routing), `src/docs/error-handling.md`, `src/app/lib/user-sessions.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`
  - **Acceptance criteria**: Valid credentials set the `kixx_admin_session` cookie and `303`-redirect to the admin panel; invalid credentials re-render the login page with a single generic form-level message and no field disclosure of which factor failed; validation failures re-render with field-level errors; non-credential errors are rethrown; link helper names match their compiled targets.
  - **Depends on**: Add the admin credential authentication Transaction Script, Relax login form validation and add render metadata

- [x] **Wire the login handler into the post-form target**
  - **Story**: The login route handles POST submissions
  - **What**: In the `admin-login-form` route's `post-form` target, prepend `postAdminUserLoginForm` to `requestHandlers` before the existing `HyperviewDynamicPageHandler()`, and import it from the admin-users request handlers. Leave the GET `render-form` target unchanged.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (Dynamic Routes, Common Task Recipes), `src/virtual-hosts.js`
  - **Acceptance criteria**: `POST /login/admin/new` runs `postAdminUserLoginForm` then renders via Hyperview when not redirected; on a successful login the Hyperview handler is skipped in favor of the redirect; route matching order and the public (unauthenticated) status of the login route are unchanged.
  - **Depends on**: Add the login POST request handler

- [x] **Build the login page template**
  - **Story**: The login page renders an admin login form
  - **What**: Replace the stub `templates/pages/login/admin/new/page.html` with a full login form modeled on the signup template, but with no client-side validation: the `<form>` carries `novalidate` and the inputs omit `required` and any HTML5 constraint attributes. Render the generic `formError` callout (same `.callout--error` pattern as signup), the email and password fields from `form.fields`, field-level error hints, and a link to the new-user form (`links.newUserForm`). Surface the existing `notice` state passed by `getAdminUserLoginForm` (e.g. `session_create_failed`) as an informational message. Use only existing components/utilities from the stylesheets; no inline `style` attributes. Confirm the `admin-login.html` base template referenced by `pages/login/admin/new/page.json` renders the page body and any `formError`/notice region as expected.
  - **Where**: `src/templates/pages/login/admin/new/page.html` (and `src/pages/login/admin/new/page.json` only if a page-local adjustment is needed)
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md` (Form-Backed HTML Workflow), `src/templates/pages/users/admin/new/page.html`, `src/pages/admin/style-guide/`, `AGENTS.md` (Use General Styles)
  - **Acceptance criteria**: `/login/admin/new` renders email and password inputs, a submit control, and a link to create an account; the form posts to the compiled `form.url` with `form.method`; no client-side validation attributes are present (`novalidate` set, no `required`); invalid-credential and validation states display the generic and field-level messages respectively; no inline `style` attributes are used.
  - **Depends on**: Relax login form validation and add render metadata

- [x] **Run lint on changed files**
  - **Story**: Implementation is clean and observable
  - **What**: Run the linter on the changed JavaScript files and fix any reported issues. Do not manually verify login behavior in this step; runtime behavior will be verified manually later. Do not write or run tests unless explicitly requested.
  - **Where**: `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/app/presentation/middleware/admin-authentication.js`, `src/app/presentation/forms/admin-users/admin-user-login-form.js`, `src/app/presentation/request-handlers/admin-users.js`, `src/virtual-hosts.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `README.md`
  - **Acceptance criteria**: `node run-linter.js` passes for the changed JavaScript files; no manual login verification is performed in this step; any test work remains deferred until explicitly requested.
  - **Depends on**: Wire the login handler into the post-form target, Build the login page template
