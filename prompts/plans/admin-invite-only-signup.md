# Admin Invite-Only Signup - Implementation Plan

## Implementation Approach

Replace the publicly reachable admin signup at `/users/admin/new` with an invite-gated flow so that creating an admin account always requires proof of authorization. Authorization is a single mechanism — a **bearer invite token** — carried in the signup URL (`?invite=<token>`) and re-posted as a hidden form field. Tokens are minted two ways that share one Transaction Script: by an authenticated admin through a new `/admin/invites` management UI, and — for the very first admin (bootstrap) — by matching an `ADMIN_BOOTSTRAP_TOKEN` environment value. Because serverless runtimes (Cloudflare Workers, AWS Lambda) cannot mutate env at runtime, the "one-time" property of the bootstrap token lives in the document store as a consumed-marker record, not in the env var itself. Invites are stored in the **document store** (not the eventually-consistent KV store) so single-use consumption can rely on optimistic concurrency. Tokens are never stored in plaintext: the record id is the SHA-256 hex digest of the raw token (mirroring the existing `CsrfToken` precedent of comparing `sha256Hex` digests), and the raw token appears only in the URL and is shown to an admin exactly once at creation time. The route stays unauthenticated (invitees and the bootstrap admin are not logged in); enforcement moves into the request handler, which resolves the token before rendering the form and consumes it during account creation. Do not add automated tests unless explicitly requested; run the linter on changed JavaScript files after implementation.

## TODO

- [x] **Add the AdminInvite collection and record**
  - **Story**: Invites can be persisted, looked up by token, consumed once, listed, and revoked
  - **What**: Add a document-store `AdminInvite` collection and record. The record id is the SHA-256 hex digest of the raw token (set via `input.id`), so no secondary index is needed for lookup. Stored fields: `inviteCreationDate`, `inviteExpirationDate`, `consumedAt` (null until consumed), `revokedAt` (null until revoked), `createdBy` (admin user id, or the literal `'bootstrap'` for the env-token marker), and `kind` (`'invite'` or `'bootstrap'`). Implement `validate()` to require the date fields and a valid `createdBy`/`kind`, mirroring `CsrfTokenRecord`. Add a record helper `getStatus(referenceDate)` deriving `'revoked' | 'consumed' | 'expired' | 'pending'` from the stored fields, plus `isRedeemable(referenceDate)` returning true only for `pending`. Set `generateSortKey(doc)` to `inviteCreationDate` so `scan()` lists invites in creation order. Add collection helpers: `createInvite(context, { createdBy })` — generate a raw token with `generateSecretToken()`, compute `sha256Hex(token)`, `create()` the record with id = that hash, and return `{ token, record }`; `getByTokenHash(context, tokenHash)`; `markConsumed(context, record)` — set `consumedAt` and persist with `update()` (optimistic concurrency); `createConsumedBootstrapMarker(context, tokenHash)` — `create()` an already-consumed `kind: 'bootstrap'` record (a `DocumentAlreadyExistsError` means the bootstrap token was already spent); `revoke(context, record)`; and `listPage(context, { cursor, limit })` wrapping `scan({ descending: true })`.
  - **Where**: `src/app/collections/admin-invite-collection.js`, `src/app/collections/admin-invite-record.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/collections/csrf-token-collection.js`, `src/app/collections/csrf-token-record.js`, `src/app/collections/admin-user-collection.js`, `src/app/collections/base-document-store-collection.js`, `src/app/collections/base-document-store-record.js`, `src/app/lib/crypto.js`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Invite records persist through a registered document-store Collection; the raw token is never stored (only its SHA-256 hex digest, used as the record id); `markConsumed` uses optimistic concurrency so a concurrent double-consume surfaces `VersionConflictError`; `createConsumedBootstrapMarker` surfaces `DocumentAlreadyExistsError` on reuse; status/expiry derive from stored fields; listing returns invites in reverse creation order.
  - **Depends on**: none

- [x] **Register the AdminInvite collection**
  - **What**: Import and register `AdminInviteCollection` against the existing `DocumentStore` service in the app registration lifecycle. The collection declares no secondary indexes, so leave `DOCUMENT_STORE_INDEXES` unchanged (still only `AdminUserCollection.INDEXES`).
  - **Where**: `src/app/app.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/app.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `context.getCollection('AdminInvite')` returns the collection during HTTP requests; existing `AdminUser`, `CsrfToken`, and `UserSession` registrations and document-store index registration are unchanged.
  - **Depends on**: Add the AdminInvite collection and record

- [x] **Add the bootstrap token environment configuration**
  - **What**: Add an `ADMIN_BOOTSTRAP_TOKEN` entry to the local Node config so first-admin bootstrap works in development, and document that it is operator-supplied in deployed environments. The value is a high-entropy random string the operator sets at deploy time; the app only ever compares its `sha256Hex` digest. When the env var is absent, the bootstrap path is simply unavailable (no token can match), which is the correct posture once admins exist.
  - **Where**: `src/node-config.json`
  - **Documentation**: `src/app/presentation/README.md` (RequestContext env helpers: `getEnvString`), `src/app/lib/crypto.js`
  - **Acceptance criteria**: `context.getEnvString('ADMIN_BOOTSTRAP_TOKEN')` returns the configured value during local development; an unset value disables bootstrap rather than throwing.
  - **Depends on**: none

- [x] **Add invite resolve and consume Transaction Scripts**
  - **Story**: A presented token can be checked for redeemability and consumed exactly once, covering both stored invites and the env bootstrap token
  - **What**: Add `resolveAdminInvite(context, token)` (read-only): compute `sha256Hex(token)`, look up the invite by that hash; if found, return `{ redeemable, status, isBootstrap: false }` from the record's derived status; if not found, compare `sha256Hex(token)` to `sha256Hex(ADMIN_BOOTSTRAP_TOKEN)` (following the `CsrfToken` digest-comparison precedent) and, if it matches and no consumed bootstrap marker exists for that hash, return `{ redeemable: true, isBootstrap: true }`; otherwise return `{ redeemable: false }`. Add `consumeAdminInvite(context, token)`: re-resolve, and for a stored pending invite call `markConsumed` (translating `VersionConflictError`/already-consumed into an expected error), or for the bootstrap token call `createConsumedBootstrapMarker` (translating `DocumentAlreadyExistsError` into the same expected error). Throw a client-safe expected error with a stable `code` (e.g. `ForbiddenError` with `code: 'InvalidInvite'`) when not redeemable; rethrow unexpected storage failures as `AssertionError`. The env comparison and branching live here (business policy), not in the collection or a gateway. Bootstrap is intentionally **not** gated on admin count, so the env token doubles as a lockout-recovery path.
  - **Where**: `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js`, `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/lib/crypto.js`, `src/app/presentation/README.md`, `src/app/transaction-scripts/admin-users/authenticate-admin-session.js`
  - **Acceptance criteria**: `resolveAdminInvite` never mutates state and correctly classifies stored-pending, expired, consumed, revoked, bootstrap-available, and invalid tokens; `consumeAdminInvite` succeeds at most once per token (stored or bootstrap) and throws an expected `InvalidInvite` error on reuse/expiry; unexpected storage errors surface as non-operational `AssertionError`.
  - **Depends on**: Register the AdminInvite collection, Add the bootstrap token environment configuration

- [x] **Consume the invite inside admin user creation**
  - **Story**: Creating an admin account spends exactly one invite and never creates two admins from one token
  - **What**: Update `createAdminUser(context, form)` to accept the invite token (read from `form.invite_token`) and consume it as part of account creation. Order the steps so the invite is not wasted on a recoverable mistake: (1) fast-fail duplicate-email check (unchanged); (2) `consumeAdminInvite(context, token)`; (3) create the admin user; (4) create the session. A failed consume (invalid/expired/already-used) throws the expected `InvalidInvite` error before any user is written; a duplicate-email conflict is detected before consumption so the invitee can retry with the same link. Preserve the existing `NewUserConflictError`/`SignupSessionFailed` behavior.
  - **Where**: `src/app/transaction-scripts/admin-users/create-admin-user.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/app/collections/README.md`
  - **Acceptance criteria**: A valid invite is consumed once and the admin user + session are created; a duplicate-email submission fails without consuming the invite; an invalid/expired/already-used token fails with the expected `InvalidInvite` error and writes no user; two concurrent submissions with the same token create at most one admin.
  - **Depends on**: Add invite resolve and consume Transaction Scripts

- [x] **Carry the invite token through the signup form**
  - **What**: Add an `invite_token` property to `NewAdminUserForm`. Add it to the schema as a hidden field (e.g. `fieldType: 'hidden'`, not `writeOnly`, not in `required`) so its value is available in the rendered form context for a hidden input. Set `this.invite_token` from submitted attributes in the constructor using `normalizeStringAttribute`. Do not validate the token in `validate()` — redeemability is enforced by the Transaction Script — but keep email/password validation unchanged.
  - **Where**: `src/app/presentation/forms/admin-users/new-admin-user-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms), `src/app/presentation/forms/base-form.js`, `src/app/presentation/forms/utils.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `NewAdminUserForm.fromFormData` preserves a submitted `invite_token`; the value is exposed in the form render context for the hidden input; email/password validation behavior is unchanged.
  - **Depends on**: none

- [x] **Gate the signup request handlers on a valid invite**
  - **Story**: The signup form only renders and only accepts submissions when backed by a redeemable invite
  - **What**: In `getNewAdminUserForm`, read `request.queryParams.invite`, call `resolveAdminInvite`, and: if not redeemable, render the page in an "invalid or expired invite" state (no form); if redeemable, construct `new NewAdminUserForm({ invite_token })` and render through `getCsrfFormContext` so the hidden invite and CSRF fields are present. In `postNewAdminUserForm`, validate CSRF first (`validateCsrfFormData`), construct the form (which carries `invite_token`), validate it, then call `createAdminUser`. Handle the expected `InvalidInvite` code by re-rendering the invalid-invite state (the token was spent or expired between GET and POST); keep existing `NewUserConflictError` and `SignupSessionFailed` handling, and on success set the admin session cookie, clear the CSRF pre-session, and redirect into the admin panel.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/app/presentation/csrf.js`, `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`
  - **Acceptance criteria**: `GET /users/admin/new` without a redeemable invite shows the invalid-invite state and no form; with a redeemable invite it renders the form including hidden CSRF and `invite_token` inputs; `POST /users/admin/new` rejects missing/invalid CSRF, then invalid/expired/used invites, before creating an account; successful signup still establishes the session and redirects to the admin panel.
  - **Depends on**: Consume the invite inside admin user creation, Carry the invite token through the signup form

- [x] **Render the invite-gated signup template**
  - **What**: Update the signup page template to (a) render a hidden `<input name="invite_token">` from the form context immediately alongside the existing hidden CSRF input, and (b) branch on an `inviteValid` prop so that when the invite is missing/invalid the page shows an error callout (and a link back to login) instead of the form. Keep the existing field markup, callouts, and login link for the valid case. Do not use inline `style` attributes; reuse existing `callout`, `field`, and layout utilities.
  - **Where**: `src/templates/pages/users/admin/new/page.html`, `src/pages/users/admin/new/page.json` (only if a title/metadata tweak is needed)
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md`, `AGENTS.md` (Use General Styles), `src/pages/admin/style-guide/`
  - **Acceptance criteria**: The valid-invite render includes exactly one CSRF hidden input and one `invite_token` hidden input; the invalid-invite render shows an error message and no form fields; no inline styles are introduced.
  - **Depends on**: Gate the signup request handlers on a valid invite

- [x] **Add invite mint, list, and revoke Transaction Scripts**
  - **Story**: An authenticated admin can create, enumerate, and revoke invites
  - **What**: Add `createAdminInvite(context, { createdBy })` calling `invites.createInvite` and returning the raw token plus the record's `toObject()` (the raw token is returned only here, for one-time display). Add `listAdminInvites(context, { cursor })` returning `{ items, cursor }` where each item includes its derived status and metadata (created/expires/consumed/revoked, createdBy) but never a token. Add `revokeAdminInvite(context, inviteId)` loading the record, throwing `NotFoundError` when absent, and calling `invites.revoke`; translate a `VersionConflictError` into an expected `ConflictError` and unexpected storage failures into `AssertionError`.
  - **Where**: `src/app/transaction-scripts/admin-invites/create-admin-invite.js`, `src/app/transaction-scripts/admin-invites/list-admin-invites.js`, `src/app/transaction-scripts/admin-invites/revoke-admin-invite.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/collections/README.md`
  - **Acceptance criteria**: Minting returns a one-time raw token and persists a pending invite owned by the creating admin; listing returns status-annotated invites without exposing tokens; revoking marks an existing invite revoked and surfaces `NotFoundError`/`ConflictError` as expected errors.
  - **Depends on**: Register the AdminInvite collection

- [x] **Add an admin invites form for minting and revoking**
  - **What**: Add a small form class (or pair) backing the admin invite actions so the management UI uses the established Form + CSRF pattern. The mint action needs no user-entered fields (an empty CSRF-protected POST), and the revoke action carries the target `inviteId` (hidden field), with `static target`/`method` pointing at the new admin invite targets for reverse-routed action URLs.
  - **Where**: `src/app/presentation/forms/admin-invites/admin-invite-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms, CSRF-Protected HTML Forms), `src/app/presentation/forms/base-form.js`, `src/app/presentation/csrf.js`
  - **Acceptance criteria**: The form(s) compile their action URLs via `getHttpTarget(...).compilePathname()`; revoke carries a hidden `inviteId`; both integrate with `getCsrfFormContext`/`validateCsrfFormData`.
  - **Depends on**: none

- [x] **Add admin invite management request handlers**
  - **Story**: `/admin/invites` lists invites and lets an admin create and revoke them
  - **What**: Add `getAdminInvites` (GET): call `listAdminInvites`, compile the public signup base URL via `getHttpTarget('new-admin-user-form/render-form').compilePathname()`, and render the list plus a CSRF-protected "create invite" control. Add `postCreateAdminInvite` (POST): validate CSRF, call `createAdminInvite` with `context.user.id` as `createdBy`, then render the list page directly (no redirect) with the newly generated full invite link (`<origin><signup pathname>?invite=<token>`) shown once in a copy-able callout — a deliberate exception to post-redirect-get because the raw token is only available at creation time. Add `postRevokeAdminInvite` (POST): validate CSRF, read `inviteId`, call `revokeAdminInvite`, then redirect back to the list (303).
  - **Where**: `src/app/presentation/request-handlers/admin-invites.js`
  - **Documentation**: `src/app/presentation/README.md` (Request Handlers, Reverse Routing, CSRF), `src/app/presentation/csrf.js`, `src/app/transaction-scripts/admin-invites/`, `src/docs/error-handling.md`
  - **Acceptance criteria**: `GET /admin/invites` lists current invites with status; `POST` create mints an invite and displays its full link exactly once; `POST` revoke marks an invite revoked and redirects back; all mutating actions require a valid CSRF token and an authenticated admin.
  - **Depends on**: Add invite mint, list, and revoke Transaction Scripts, Add an admin invites form for minting and revoking

- [x] **Register the admin invite routes**
  - **What**: Under the existing `admin-panel` route (which already applies `authenticateAdminUser` and `adminErrorHandler`), add an `invites` route with targets: `render-invite-list` (GET/HEAD → `getAdminInvites`, then `HyperviewDynamicPageHandler()`), `create-invite` (POST → `postCreateAdminInvite`, then `HyperviewDynamicPageHandler()`), and `revoke-invite` (POST → `postRevokeAdminInvite`). Give targets stable names so forms can reverse-route to them. Leave the `/users/admin/new` route unauthenticated (enforcement is in the handler) and keep route ordering with the catch-all last.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (Dynamic Routes, Reverse Routing), `src/virtual-hosts.js`
  - **Acceptance criteria**: `/admin/invites` requires an admin session; GET renders the list and POST targets handle create/revoke; reverse routing to the new target names succeeds; the public signup route and catch-all behavior are unchanged.
  - **Depends on**: Add admin invite management request handlers

- [x] **Add admin invite management page and template**
  - **What**: Add the `pages/` metadata and `templates/pages/` markup for `/admin/invites` using the authenticated admin base template (`admin.html`). The template lists invites with their status and creation/expiry, renders the CSRF-protected create control, shows the one-time new-invite link callout when present, and renders a revoke control per pending invite. Follow the admin style guide; no inline styles.
  - **Where**: `src/pages/admin/invites/page.json`, `src/templates/pages/admin/invites/page.html`
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md`, `src/pages/admin/style-guide/`, `AGENTS.md` (Use General Styles)
  - **Acceptance criteria**: `/admin/invites` renders within the admin layout; invites display with status; the create control and (for pending invites) revoke controls render with CSRF fields; the freshly minted link is shown once after creation; no inline styles.
  - **Depends on**: Register the admin invite routes

- [x] **Document the invite-only signup and bootstrap mechanism**
  - **What**: Add a short section to the presentation guide (and a note where admin auth is described) explaining that admin creation is invite-only: tokens are minted by admins via `/admin/invites` or, for the first admin, by the `ADMIN_BOOTSTRAP_TOKEN` env var; the one-time property of the bootstrap token is enforced by a document-store consumed-marker because serverless env vars are immutable at runtime; tokens are stored only as SHA-256 digests and shown once; and rotating `ADMIN_BOOTSTRAP_TOKEN` re-enables a single bootstrap/recovery signup.
  - **Where**: `src/app/presentation/README.md`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: The guide explains the invite-only flow, the bootstrap env-var mechanism and its one-time/recovery semantics, and where the relevant collection, Transaction Scripts, and routes live.
  - **Depends on**: Add admin invite management page and template
