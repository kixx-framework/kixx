# Admin Panel: Publishing API Tokens

## Implementation Approach

Add a session-authenticated `/admin/publishing-api-tokens` page that lists, creates,
and revokes Publishing API tokens, reusing the same Transaction Script and
Collection layer that `/admin-api/v1/publishing-api-tokens` already calls — not by
making the admin panel issue an HTTP request to the admin-api endpoint. The
admin-api endpoint is Basic-auth, JSON:API, and create-only, designed for external
programmatic callers; the admin panel already authenticates the browser session via
`authenticateAdminUser` + CSRF, so its request handlers can call
`createPublishingApiToken()` directly, exactly the way `admin-invites.js` calls
`createAdminInvite()`/`listAdminInvites()`/`revokeAdminInvite()` directly. This
keeps Transaction Scripts as the single reusable procedure layer and avoids
juggling admin Basic-auth credentials in-process just to satisfy an auth scheme
built for external tooling.

The admin-invites feature (`/admin/invites` + `/admin/invites/revoke`) is the
direct structural template: a list+create route, a sibling revoke-only route (a
route cannot host two POST targets at the same pattern), a reveal-once secret
callout for the plaintext value, and Collection methods (`listPage()`, `revoke()`)
that `PublishingApiTokenCollection` does not have yet.

Per the answered design questions: the create form has **no permissions field** —
every admin-panel-created token uses the existing wildcard allow-all grant (the
only grant shape `validatePermissions()` currently accepts) — and **does** expose
a selectable time-to-live, bounded by the existing
`MAX_PUBLISHING_API_TOKEN_TTL_SECONDS`. The admin-api Basic-auth endpoint is left
untouched.

One small cross-cutting cleanup: both the existing JSON:API form and the new HTML
form need "trim a submitted string, treat empty as null" normalization for
`description`. That logic is currently a private helper duplicated nowhere yet, but
would become duplicated by this feature, so it moves to the shared
`forms/utils.js` helpers used across all forms.

Testing is intentionally out of scope per project policy (tests are added only
when explicitly requested); the plan below only orders code changes.

---

- [x] **Export the allow-all permission grant as a named constant**
  - **Story**: Admin-panel token creation always grants full access
  - **What**: In `src/app/lib/publishing-permissions.js`, export a new constant `ALLOW_ALL_PUBLISHING_PERMISSIONS = [ { effect: ALLOW, action: [ WILDCARD ], resource: WILDCARD } ]` next to the existing `WILDCARD`/`ALLOW`/`DENY` constants, so callers that need to mint an allow-all grant (rather than validate one) reference the same canonical value instead of re-writing the literal shape. Leave `isWildcardAllowAllGrant()` as-is; it is the shape check, not the value being checked.
  - **Where**: `src/app/lib/publishing-permissions.js`
  - **Documentation**: `src/docs/code-quality.md` (owners of responsibility — the permissions module already owns this grant grammar)
  - **Acceptance criteria**: n/a (supports later admin-panel create-form task)
  - **Depends on**: none

- [x] **Add a shared "optional trimmed string" form-field normalizer**
  - **What**: Add `normalizeOptionalStringAttribute(value)` to `src/app/presentation/forms/utils.js` — trims a non-empty string and returns it, converts an empty/whitespace-only string, `null`, or `undefined` to `null`, and passes any other value through unchanged (mirrors the existing private `normalizeOptionalDescription()` in `create-publishing-api-token-form.js`). Update `create-publishing-api-token-form.js` to import and use it instead of its private copy, deleting the private function.
  - **Where**: `src/app/presentation/forms/utils.js`; `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`
  - **Documentation**: `src/docs/code-style-guide.md` (type detection helpers); existing `normalizeStringAttribute`/`normalizeLowerCaseStringAttribute` in `forms/utils.js` for the pattern to match
  - **Acceptance criteria**: n/a (behavior-preserving extraction; supports the new HTML create form's `description` field below)
  - **Depends on**: none

- [x] **Add `listPage()` and `revoke()` to `PublishingApiTokenCollection`**
  - **Story**: List and revoke tokens in the admin panel
  - **What**: Mirror `AdminInviteCollection`'s two methods exactly. `listPage(context, { cursor, limit })` returns `this.scan(context, { descending: true, cursor, limit })` (newest first, using the existing `tokenCreationDate` sort key). `revoke(context, record)` sets `record.set('revokedAt', new Date().toISOString())` and calls `this.update(context, record)`, documenting the same `VersionConflictError`/`DocumentNotFoundError` throw contract as `AdminInviteCollection#revoke()`.
  - **Where**: `src/app/collections/publishing-api-token-collection.js`
  - **Documentation**: `src/app/collections/README.md` (Document Store write methods, optimistic concurrency); `src/app/collections/admin-invite-collection.js` (`listPage()`/`revoke()` as the exact template)
  - **Acceptance criteria**: n/a (supports the transaction scripts below)
  - **Depends on**: none

- [x] **Add `listPublishingApiTokens` Transaction Script**
  - **Story**: Publishing API token list page
  - **What**: New script `listPublishingApiTokens(context, { cursor })`, modeled on `list-admin-invites.js`: calls `context.getCollection('PublishingApiToken').listPage(context, { cursor })` inside a try/catch that rethrows unexpected storage errors as `AssertionError`, then maps each record to a plain presenter object via a private `presentToken(record)` — `{ id, status: record.getStatus(), description: record.get('description'), createdBy: record.get('createdBy'), createdAt: record.get('tokenCreationDate'), expiresAt: record.get('tokenExpirationDate'), revokedAt: record.get('revokedAt') }`. Never include `permissions` or the token itself; `id` (the token hash) is the safe value the revoke action references, mirroring the invite list's comment about never exposing the unrecoverable raw token.
  - **Where**: `src/app/transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js` (new)
  - **Documentation**: `src/app/transaction-scripts/README.md`; `src/app/transaction-scripts/admin-invites/list-admin-invites.js` (direct template); `src/app/collections/publishing-api-token-record.js` (`getStatus()` contract: `'revoked'|'expired'|'active'`)
  - **Acceptance criteria**: Returns `{ items, cursor }` with no `permissions`/token fields exposed
  - **Depends on**: Add `listPage()` and `revoke()` to `PublishingApiTokenCollection`

- [x] **Add `revokePublishingApiToken` Transaction Script**
  - **Story**: Revoke a publishing API token from the admin panel
  - **What**: New script `revokePublishingApiToken(context, tokenId)`, modeled on `revoke-admin-invite.js`: assert `tokenId` is a non-empty string, load via `context.getCollection('PublishingApiToken').getByTokenHash(context, tokenId)`, throw `NotFoundError` (`code: 'PublishingApiTokenNotFound'`) when absent, call `.revoke(context, record)`, and translate `VersionConflictError` → `ConflictError` (`code: 'PublishingApiTokenConflict'`) and `DocumentNotFoundError` → `NotFoundError` (`code: 'PublishingApiTokenNotFound'`); rethrow anything else as `AssertionError`.
  - **Where**: `src/app/transaction-scripts/publishing-api-tokens/revoke-publishing-api-token.js` (new)
  - **Documentation**: `src/docs/error-handling.md` (expected vs. unexpected, storage-error translation); `src/app/transaction-scripts/admin-invites/revoke-admin-invite.js` (direct template)
  - **Acceptance criteria**: Throws `NotFoundError`/`ConflictError` with the codes above on the respective conditions; otherwise revokes and resolves
  - **Depends on**: Add `listPage()` and `revoke()` to `PublishingApiTokenCollection`

- [x] **Add HTML-facing `PublishingApiTokenCreateForm` and `PublishingApiTokenRevokeForm`**
  - **Story**: Create and revoke controls in the admin panel UI
  - **What**: New file exporting two `BaseForm` subclasses, mirroring `admin-invite-form.js`.
    - `PublishingApiTokenCreateForm` — `static target = 'admin-panel/publishing-api-tokens/create-token'`, `static method = 'POST'`. Schema fields: `description` (`type: ['string','null']`, `fieldType: 'text'`, optional, label "Description", hint "Optional note to identify this token later.") and `time_to_live_seconds` (`type: 'integer'`, `fieldType: 'select'`, `default: DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS` imported from `create-publishing-api-token-form.js`, plus a new `options` array of `{ value, label }` pairs for common durations — e.g. 7/30/90/365 days — each `value` bounded by the imported `MAX_PUBLISHING_API_TOKEN_TTL_SECONDS`). Constructor normalizes `description` with the new `normalizeOptionalStringAttribute()` and parses `time_to_live_seconds` to an integer (`Number.parseInt(value, 10)`, defaulting to `DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS` when missing/blank, since `FormData` values arrive as strings). `validate()` checks `time_to_live_seconds` is an integer within `(0, MAX_PUBLISHING_API_TOKEN_TTL_SECONDS]` and `description` is a string or null, collecting into a `ValidationError`. `toJSON()` returns `{ permissions: ALLOW_ALL_PUBLISHING_PERMISSIONS, description, timeToLiveSeconds: this.time_to_live_seconds }` — this exact shape is what `createPublishingApiToken()` (the existing Transaction Script) reads via `form.toJSON()`, so no changes are needed to that script.
    - `PublishingApiTokenRevokeForm` — `static target = 'admin-panel/publishing-api-tokens-revoke/revoke'`, `static method = 'POST'`, single hidden field `token_id` (required), constructed/validated exactly like `AdminInviteRevokeForm`.
  - **Where**: `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js` (new)
  - **Documentation**: `src/app/presentation/README.md` (Forms, CSRF-Protected HTML Forms); `src/app/presentation/forms/admin-invites/admin-invite-form.js` (direct template for both forms); `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js` (existing TTL constants and `toJSON()` shape to match); `src/app/presentation/forms/utils.js`
  - **Acceptance criteria**: `toJSON()` output matches what `createPublishingApiToken()` destructures; `validate()` rejects an out-of-range or non-integer TTL and a non-string/non-null description
  - **Depends on**: Export the allow-all permission grant as a named constant; Add a shared "optional trimmed string" form-field normalizer

- [x] **Add admin request handlers for listing, creating, and revoking tokens**
  - **Story**: Wire the page together end-to-end
  - **What**: New file exporting three handlers, mirroring `admin-invites.js`:
    - `getPublishingApiTokens(context, request, response)` — calls `listPublishingApiTokens(context, { cursor: request.queryParams.cursor })`, builds an empty `PublishingApiTokenCreateForm()`, and returns `response.updateProps({ tokens: items, nextCursor: cursor, form: await getCsrfFormContext(context, request, response, form), links: { revokeToken: <compiled revoke pathname> } })`.
    - `postCreatePublishingApiToken(context, request, response)` — `const formData = await validateCsrfFormData(context, request)`, build `PublishingApiTokenCreateForm.fromFormData(formData)`, and on `form.validate()` throwing a `ValidationError`, re-render the list with `form: await getCsrfFormContext(context, request, response, form, error)` (rethrow any other error). On success, call `createPublishingApiToken(context, form, context.user.id)`, re-fetch the list via `listPublishingApiTokens`, and render directly (not a redirect — same reasoning as invites: the plaintext token exists only on this response) with `newToken: created.token` plus a fresh empty `PublishingApiTokenCreateForm()` for the re-rendered create control.
    - `postRevokePublishingApiToken(context, request, response, skip)` — `validateCsrfFormData`, build `PublishingApiTokenRevokeForm.fromFormData(formData)`, `form.validate()`, call `revokePublishingApiToken(context, form.token_id)`, then `skip()` + `response.respondWithRedirect(303, <list pathname>)` (safe post-redirect-get; revocation carries no secret).
    Two small private helpers (`getRevokeTokenLink`, `getTokenListLink`) compile pathnames via `context.getHttpTarget(...).compilePathname()`, matching `admin-invites.js`.
  - **Where**: `src/app/presentation/request-handlers/admin-publishing-api-tokens.js` (new)
  - **Documentation**: `src/app/presentation/README.md` (Request Handlers, Reverse Routing, CSRF-Protected HTML Forms); `src/app/presentation/request-handlers/admin-invites.js` (direct template); `src/docs/error-handling.md` (catching only `ValidationError` by name)
  - **Acceptance criteria**: GET renders the list; POST create validates, mints, and shows the token once; POST revoke redirects back to the list
  - **Depends on**: Add HTML-facing `PublishingApiTokenCreateForm` and `PublishingApiTokenRevokeForm`; Add `listPublishingApiTokens` Transaction Script; Add `revokePublishingApiToken` Transaction Script

- [x] **Register the two new routes under `/admin`**
  - **What**: In `src/virtual-hosts.js`, add `import * as AdminPublishingApiTokens from './app/presentation/request-handlers/admin-publishing-api-tokens.js';` near the existing `AdminInvites` import. Inside the `admin-panel` route's `routes` array, insert two entries directly after the existing `invites`/`invites-revoke` routes and before the trailing `*` catch-all (`static-pages`) route — matching the invites revoke-before-main ordering and comment style:
    - `{ pattern: '/publishing-api-tokens/revoke', name: 'publishing-api-tokens-revoke', targets: [ { name: 'revoke', methods: ['POST'], requestHandlers: [ AdminPublishingApiTokens.postRevokePublishingApiToken ] } ] }`
    - `{ pattern: '/publishing-api-tokens', name: 'publishing-api-tokens', targets: [ { name: 'render-token-list', methods: ['GET','HEAD'], requestHandlers: [ AdminPublishingApiTokens.getPublishingApiTokens, HyperviewDynamicPageHandler() ] }, { name: 'create-token', methods: ['POST'], requestHandlers: [ AdminPublishingApiTokens.postCreatePublishingApiToken, HyperviewDynamicPageHandler() ] } ] }`
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (Dynamic Routes, Route Matching Order — catch-all must stay last)
  - **Acceptance criteria**: `context.getHttpTarget('admin-panel/publishing-api-tokens/render-token-list')`, `.../create-token`, and `admin-panel/publishing-api-tokens-revoke/revoke` all resolve; the fully-qualified names used in the request-handler and form `target` values above match these route/target names exactly
  - **Depends on**: Add admin request handlers for listing, creating, and revoking tokens

- [x] **Add page data and template**
  - **What**: `src/pages/admin/publishing-api-tokens/page.json` — `{ "baseTemplate": "admin.html", "page": { "title": "Publishing API Tokens" } }`. `src/templates/pages/admin/publishing-api-tokens/page.html` — mirror `templates/pages/admin/invites/page.html` structure: a `{{#if newToken}}` reveal-once `callout callout--info` with a `.code-block` showing `{{ newToken }}` and copy noting it is shown only once; a CSRF-protected `<form>` posting to `form.url`/`form.method` with a text input for `description` (`form.fields.description`) and a hand-written `<select name="time_to_live_seconds">` iterating `{{#each form.fields.time_to_live_seconds.options as |option| }}` with `{{#ifEqual option.value form.fields.time_to_live_seconds.value}}selected{{/ifEqual}}`; a `{{#each tokens as |token| }}` list of `<li class="card flow">` rows showing `token.description` (or a placeholder when null), `token.status`, created/expires dates via the `formatDate` helper, and a conditional per-row revoke `<form>` (hidden `token_id` + shared CSRF field) shown only `{{#ifEqual token.status "active"}}`.
  - **Where**: `src/pages/admin/publishing-api-tokens/page.json` (new); `src/templates/pages/admin/publishing-api-tokens/page.html` (new)
  - **Documentation**: `src/templates/README.md` (sections, `#each`, `#ifEqual`, `formatDate`, whitespace/standalone-tag rules); `src/docs/frontend-development-guide.md` (no inline styles; reuse `.card`, `.flow`, `.cluster`, `.callout`, `.code-block`, `.button` primitives — no new CSS should be needed); `src/templates/pages/admin/invites/page.html` (direct template); `src/pages/admin/invites/page.json`
  - **Acceptance criteria**: `GET /admin/publishing-api-tokens` renders the list and create form; `GET /admin/publishing-api-tokens.json` returns the assembled context object for inspection; creating a token shows the plaintext value once; revoking an active token removes its revoke control on next render
  - **Depends on**: Register the two new routes under `/admin`
