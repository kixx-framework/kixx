# Admin CSRF Protection - Implementation Plan

## Implementation Approach

Add reusable CSRF protection in the presentation layer using a synchronizer-token pattern backed by the existing Key/Value Store. The CSRF browser identity is a short-lived, `HttpOnly`, `SameSite=Lax` cookie that selects a server-side CSRF token record; the actual secret token is rendered only into the form body as a hidden field and is never placed in a URL. Because login and first-admin signup are unauthenticated forms, this acts as a pre-session that is separate from the eventual admin session and should be cleared after successful authentication so it cannot become part of the authenticated session lifecycle. Keep Transaction Scripts unchanged: request handlers validate CSRF before constructing and validating Forms, then call the existing domain scripts only after the request proves it came from a rendered form. Do not add automated tests unless explicitly requested; run the linter on changed JavaScript files after implementation.

## TODO

- [x] **Add CSRF token persistence**
  - **Story**: Forms can mint browser-bound CSRF pre-session tokens
  - **What**: Add a Key/Value Store `CsrfToken` collection and record. Store a random token hash, creation timestamp, and expiration timestamp under a random CSRF session id. Add collection helpers to create a token with a TTL, load a token by id, validate a submitted token against the stored hash, and delete a token record. Use `generateSecretToken()` for CSRF session ids and token values, and `sha256Hex()` so stored records do not contain the submitted token secret in plaintext.
  - **Where**: `src/app/collections/csrf-token-collection.js`, `src/app/collections/csrf-token-record.js`
  - **Documentation**: `src/app/collections/README.md`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/error-handling.md`, `src/app/lib/crypto.js`, `src/app/collections/user-session-collection.js`, `src/app/collections/base-key-value-store-collection.js`, `src/app/collections/base-key-value-store-record.js`
  - **Acceptance criteria**: CSRF token records are stored through a registered Collection, use Key/Value Store expiration, validate required fields before writes, never store the raw submitted token value, and expose named helpers so callers do not construct storage keys or hashes directly.
  - **Depends on**: none

- [x] **Register the CSRF token collection**
  - **Story**: Request handlers can access CSRF persistence through context
  - **What**: Import and register the new CSRF token collection from the application registration lifecycle using the existing `KeyValueStore` service. Keep document-store index registration unchanged because CSRF tokens use the Key/Value Store and need no secondary indexes.
  - **Where**: `src/app/app.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/app.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `context.getCollection('CsrfToken')` returns the new collection during HTTP requests; existing `AdminUser` and `UserSession` registrations still work; no document-store indexes are added for CSRF.
  - **Depends on**: Add CSRF token persistence

- [x] **Add reusable CSRF presentation helpers**
  - **Story**: HTML form handlers can render and validate CSRF tokens consistently
  - **What**: Add a presentation-layer CSRF module with constants for the cookie name, hidden field name, and TTL. Export an async render helper that accepts `(context, request, response, form, error)`, calls `form.getFormContext(context, error)`, creates or refreshes a CSRF token record, sets the CSRF cookie with `path: '/'`, `HttpOnly`, `SameSite=Lax`, and `secure` matching the request protocol, then returns the form context with `form.csrf.fieldName` and `form.csrf.token`. Export an async POST helper that calls `request.formData()` once, reads the CSRF cookie and hidden field, validates them through the `CsrfToken` collection, and returns the parsed `FormData` only after validation succeeds. Export a cleanup helper to delete the current CSRF token record and clear the CSRF cookie after successful signup/login.
  - **Where**: `src/app/presentation/csrf.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/app/presentation/forms/base-form.js`, `src/kixx/http-router/server-response.js`, `src/plugins/node-server-request/lib/server-request.js`, `src/plugins/cloudflare-server-request/lib/server-request.js`, `src/app/lib/user-sessions.js`
  - **Acceptance criteria**: GET handlers can obtain a normal form render context plus CSRF metadata from one helper; POST handlers receive already-parsed `FormData` without reading the body twice; missing, expired, or mismatched CSRF data throws a client-safe expected error before domain logic runs; successful authentication can clear the CSRF pre-session.
  - **Depends on**: Register the CSRF token collection

- [x] **Protect the admin signup form render and submit flow**
  - **Story**: Creating an admin account requires a valid CSRF token
  - **What**: Update the signup GET handler to render its form through the CSRF render helper. Update the signup POST handler to call the CSRF POST helper before constructing `NewAdminUserForm`, then continue the existing form validation, duplicate-email handling, session-cookie creation, and redirect behavior. On successful signup, clear the CSRF pre-session after setting the admin session cookie. Preserve the existing validation and domain-error re-render behavior, but make all re-rendered signup form contexts include a fresh CSRF token.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/app/transaction-scripts/README.md`, `src/app/presentation/forms/base-form.js`, `src/app/presentation/forms/admin-users/new-admin-user-form.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/app/lib/user-sessions.js`
  - **Acceptance criteria**: `GET /users/admin/new` renders a CSRF hidden field; `POST /users/admin/new` rejects missing/invalid/expired CSRF before calling `createAdminUser`; validation and duplicate-email re-renders include a new CSRF token; successful signup still sets the admin session cookie and redirects to the admin panel; the CSRF pre-session is not carried into the authenticated admin session.
  - **Depends on**: Add reusable CSRF presentation helpers

- [x] **Protect the admin login form render and submit flow**
  - **Story**: Logging in to the admin panel requires a valid CSRF token
  - **What**: Update the login GET handler to render its form through the CSRF render helper while preserving the existing `notice` handling. Update the login POST handler to call the CSRF POST helper before constructing `AdminUserLoginForm`, then continue the existing validation, invalid-credentials re-render, session-cookie creation, and redirect behavior. On successful login, clear the CSRF pre-session after setting the admin session cookie. Preserve the generic invalid-credentials message and make validation or invalid-credential re-renders include a fresh CSRF token.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/app/transaction-scripts/README.md`, `src/app/presentation/forms/base-form.js`, `src/app/presentation/forms/admin-users/admin-user-login-form.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`, `src/app/lib/user-sessions.js`
  - **Acceptance criteria**: `GET /login/admin/new` renders a CSRF hidden field; `POST /login/admin/new` rejects missing/invalid/expired CSRF before calling `authenticateAdminCredentials`; validation and invalid-credential re-renders include a new CSRF token and keep credential rejection non-enumerating; successful login still sets the admin session cookie and redirects to the admin panel; the CSRF pre-session is not carried into the authenticated admin session.
  - **Depends on**: Add reusable CSRF presentation helpers

- [x] **Render CSRF fields in admin templates**
  - **Story**: Admin signup and login forms submit their server-rendered CSRF tokens
  - **What**: Render one hidden CSRF input directly inside both admin form templates immediately after the opening `<form>` tag, guarded by `{{#if form.csrf}}`. The input name must come from `form.csrf.fieldName` and the value from `form.csrf.token`. Keep the existing field markup, callouts, `novalidate` behavior, and links unchanged. Do not use inline `style` attributes.
  - **Where**: `src/templates/pages/users/admin/new/page.html`, `src/templates/pages/login/admin/new/page.html`
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md`, `AGENTS.md` (Use General Styles)
  - **Acceptance criteria**: Both rendered forms include exactly one CSRF hidden input when `form.csrf` exists; no visible UI changes are introduced; existing email/password fields and form-level callouts continue to render as before.
  - **Depends on**: Protect the admin signup form render and submit flow, Protect the admin login form render and submit flow

- [x] **Document the reusable CSRF form pattern**
  - **Story**: Future form implementations can opt into CSRF protection consistently
  - **What**: Add a short section to the presentation guide describing when to use the CSRF helpers, how GET handlers render protected form contexts, how POST handlers validate `FormData` before constructing a Form, and how templates render the hidden CSRF input. Call out that CSRF validation belongs in request handlers before Transaction Scripts and that the POST helper owns `request.formData()` because request bodies are one-shot.
  - **Where**: `src/app/presentation/README.md`
  - **Documentation**: `src/app/presentation/README.md`, `src/templates/README.md`, `src/app/presentation/csrf.js`, `src/app/presentation/request-handlers/admin-users.js`
  - **Acceptance criteria**: The guide gives future agents enough information to protect another HTML form without duplicating token logic; it explains the one-shot body parsing constraint; it keeps CSRF responsibilities in the presentation layer.
  - **Depends on**: Render CSRF fields in admin templates

- [x] **Run lint on changed JavaScript files**
  - **Story**: Implementation is clean and observable
  - **What**: Run the linter on the changed JavaScript files and fix any reported issues. Do not write or run tests unless explicitly requested.
  - **Where**: `src/app/collections/csrf-token-collection.js`, `src/app/collections/csrf-token-record.js`, `src/app/app.js`, `src/app/presentation/csrf.js`, `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `README.md`
  - **Acceptance criteria**: `node run-linter.js` passes for the changed JavaScript files; no automated tests are written or run in this step unless the user separately asks for them.
  - **Depends on**: Document the reusable CSRF form pattern
