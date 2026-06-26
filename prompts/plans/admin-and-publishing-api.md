# Admin API and Publishing API - Implementation Plan

## Implementation Approach

Add two new JSON:API surfaces that complement the existing HTML flows: an **Admin API** (`/admin-api/v1/*`) for bootstrapping an admin user from an invite token and for minting Publishing API tokens, and a **Publishing API** (`/publishing-api/v1/*`) for pushing templates, page metadata, and include content into a build. All domain behavior reuses existing primitives — `resolveAdminInvite`/`consumeAdminInvite`, the `AdminUser` credential check, and the registered `Hyperview` service's `put*` write methods — so the bulk of the work is new presentation wiring (routes, request handlers, middleware, forms, JSON:API helpers) plus one new document-store collection for Publishing API tokens. Authentication uses a deliberate three-credential progression carried in the `Authorization` header: `Bearer <invite/bootstrap token>` to accept an invite, `Basic <admin email:password>` to mint a publishing token, and `Bearer <publishing token>` for every publishing call. Build namespacing travels in a `Kixx-Build-Id` request header — **required and required-to-differ-from-the-current-build for template writes** (templates are immutable per build), **optional and defaulting to the current build for page-metadata and include writes** (content is editable on the live build). Because the client supplies the build id, the `HyperviewService#assertWritableBuildId` precondition (which throws an unexpected `AssertionError`) must be pre-validated in the Transaction Script layer and surfaced as a client `4xx`, and all of these endpoints must serialize errors as `application/vnd.api+json` rather than the router fallback's `application/json`. Build activation (flipping the live `BUILD_ID`) and richer permission grammar are explicitly **out of scope** for this iteration: the only accepted permission is `{ effect: 'allow', action: ['*'], resource: '*' }`. Do not add automated tests unless explicitly requested; run `node run-linter.js` on changed JavaScript files after implementation.

### User Stories

- **AS-1** — As a CLI operator holding an invite or bootstrap token, I `POST /admin-api/v1/users/invite/` with a JSON:API `AdminUser` document and get back the created admin user resource (no session, no cookies).
- **AS-2** — As an admin, I `POST /admin-api/v1/publishing-api-tokens/` authenticated with Basic credentials and a JSON:API `PublishingApiToken` document, and receive the one-time secret token plus its stored attributes.
- **PS-1** — As a publishing client, every `/publishing-api/v1/*` request is authenticated by a `Bearer` publishing token and authorized by evaluating the token's permissions.
- **PS-2** — As a publishing client, I `PUT` base, page, and partial templates as raw text into a target build (`Kixx-Build-Id` required, must differ from the current build).
- **PS-3** — As a publishing client, I `PUT` page metadata as a JSON:API `PageMetadata` document into a build (`Kixx-Build-Id` optional, defaults to current).
- **PS-4** — As a publishing client, I `PUT` include content as raw text into a build (`Kixx-Build-Id` optional, defaults to current).
- **XS-1** — As any API client, expected errors are returned as fully JSON:API 1.1-compliant `errors` documents with the `application/vnd.api+json` content type.

## TODO

- [ ] **Add JSON:API presentation helpers**
  - **Story**: XS-1, AS-1, AS-2, PS-3
  - **What**: Create a small shared library of JSON:API request/response helpers used by every new handler. Export constants `JSON_API_CONTENT_TYPE = 'application/vnd.api+json'` and `BUILD_ID_HEADER = 'kixx-build-id'`. Add `assertJsonApiContentType(request)` — throw `UnsupportedMediaTypeError` (415) when the request `Content-Type` is not the JSON:API media type (ignore optional media-type parameters). Add `parseJsonApiResource(request, expectedType)` — `await request.json()`, assert the document has a `data` object whose `type` equals `expectedType` and an `attributes` object, throwing `BadRequestError` (or `ConflictError` 409 for a type mismatch, per JSON:API) on a malformed envelope; return `{ id, attributes }`. Add `jsonApiResource({ type, id, attributes, meta })` returning a `{ data: { type, id, attributes, ...(meta?) } }` document for response bodies. Add `parseBasicAuthCredentials(request)` — read the `Authorization` header, require the `Basic ` scheme, base64-decode, split on the first `:`, and return `{ username, password }` or throw `UnauthenticatedError` when absent/malformed. Use `atob`/`TextDecoder` (Web Platform APIs) for decoding so the code stays cross-platform.
  - **Where**: `src/app/presentation/lib/json-api.js`
  - **Documentation**: `src/app/presentation/README.md` (ServerRequest, ServerResponse), `src/kixx/http-router/server-request-interface.js`, `src/kixx/http-router/server-response.js`, `src/docs/error-handling.md`, `src/docs/code-style-guide.md`, `src/app/lib/crypto.js`
  - **Acceptance criteria**: Non-JSON:API content types are rejected with 415; a malformed or wrong-`type` JSON:API document is rejected with a client 4xx before any domain logic runs; `parseBasicAuthCredentials` returns the decoded username/password for a well-formed `Basic` header and throws `UnauthenticatedError` otherwise; helpers use only Web Platform APIs (no Node built-ins).
  - **Depends on**: none

- [ ] **Add the JSON:API error handler**
  - **Story**: XS-1
  - **What**: Add a route-level error handler that serializes expected HTTP errors as a JSON:API `errors` document with `Content-Type: application/vnd.api+json`. Mirror the router fallback's mapping (status string, `code`, `title` = error name, client-safe `detail`, `source`), aggregating `error.errors` children for `ValidationError`. Return `false` for unexpected (non-`httpError`, non-`expected`) errors so they propagate to the router fallback and crash/log as 500s. To avoid drift, factor the per-error mapping into a shared function reused by this handler (extract from / share with `HttpRouter.mapErrorToJsonError`); if extraction is undesirable, replicate the exact shape and note the coordinated change point.
  - **Where**: `src/app/presentation/error-handlers/json-api-error-handler.js` (and possibly a shared serializer under `src/kixx/http-router/`)
  - **Documentation**: `src/kixx/http-router/http-router.js` (`handleError`, `mapErrorToJsonError`), `src/kixx/http-router/error-handler-interface.js`, `src/app/presentation/error-handlers/admin-error-handler.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Expected HTTP errors raised under the API route subtrees are returned as `{ errors: [...] }` with the `application/vnd.api+json` content type and correct status; `ValidationError` field errors are serialized one entry per field with `source`; unexpected errors return `false` and surface as the router's 500.
  - **Depends on**: none

- [ ] **Extract a no-session admin account creation Transaction Script**
  - **Story**: AS-1
  - **What**: Split account creation from session creation in `create-admin-user.js`. Add `createAdminUserAccount(context, form)` performing: PBKDF2 hash → duplicate-email fast-fail (`ConflictError` code `NewUserConflictError`) → `consumeAdminInvite` → write the `AdminUser` (translating `DocumentUniqueIndexViolationError` race to the same conflict, unexpected to `AssertionError`), returning `{ user: record.toAuthenticatedUser() }`. Rewrite `createAdminUser(context, form)` to call `createAdminUserAccount`, then create the session and return `{ user, sessionId }`, preserving the existing `SignupSessionFailed` behavior. The HTML signup flow is unchanged because it still calls `createAdminUser`.
  - **Where**: `src/app/transaction-scripts/admin-users/create-admin-user-account.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`, `src/app/collections/README.md`
  - **Acceptance criteria**: `createAdminUserAccount` creates an admin user and consumes the invite with no session side effects; the duplicate-email path does not consume the invite; `createAdminUser` still returns `{ user, sessionId }` and the HTML signup flow behaves identically to before.
  - **Depends on**: none

- [ ] **Extract a no-session admin credential verification Transaction Script**
  - **Story**: AS-2
  - **What**: Split credential verification from session creation in `authenticate-admin-credentials.js`. Add `verifyAdminCredentials(context, { emailAddress, password })` performing the existing lookup + `verifyPassword` check, including the timing-equalization dummy hash on the unknown-email path, and returning the `AdminUserRecord` (or its `toAuthenticatedUser()` projection) on success; throw `UnauthorizedError` code `InvalidCredentials` on failure. Rewrite `authenticateAdminCredentials(context, form)` to call `verifyAdminCredentials` and then create the session, preserving current behavior for the HTML login flow.
  - **Where**: `src/app/transaction-scripts/admin-users/verify-admin-credentials.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/lib/crypto.js`, `src/app/lib/secret-encryption-config.js`
  - **Acceptance criteria**: `verifyAdminCredentials` returns the authenticated admin on correct credentials and throws `InvalidCredentials` on unknown email or wrong password without revealing which factor failed; the unknown-email timing-equalization hash is preserved; the HTML login flow behaves identically.
  - **Depends on**: none

- [ ] **Add a JSON:API constructor to NewAdminUserForm**
  - **Story**: AS-1
  - **What**: Add `static fromJsonApi(attributes, inviteToken)` (or `fromJsonApi(resource, inviteToken)`) to `NewAdminUserForm` that builds the form from JSON:API resource attributes (`emailAddress`, `password`) plus the invite token sourced from the `Authorization: Bearer` header rather than the body. Map the camelCase JSON:API attribute `emailAddress` to the form's normalized `email_address`/`password`/`invite_token` fields so the existing `validate()` and normalization are reused unchanged. The HTML `fromFormData` path is untouched.
  - **Where**: `src/app/presentation/forms/admin-users/new-admin-user-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms, `fromJsonApi`), `src/app/presentation/forms/base-form.js`, `src/app/presentation/forms/utils.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `NewAdminUserForm.fromJsonApi` produces a form whose `validate()` enforces the same email/password rules; the invite token is taken from the bearer header, not the JSON body; the HTML form path is unchanged.
  - **Depends on**: none

- [ ] **Add the accept-invite Admin API request handler**
  - **Story**: AS-1
  - **What**: Add `acceptAdminInvite(context, request, response, skip)`: assert JSON:API content type; read the invite/bootstrap token via `request.getAuthorizationBearer()` (throw `UnauthenticatedError` when absent); `parseJsonApiResource(request, 'AdminUser')`; build the form via `NewAdminUserForm.fromJsonApi(attributes, token)`; call `resolveAdminInvite` and reject a non-redeemable token with `ForbiddenError` code `InvalidInvite` (do not render HTML); `form.validate()`; call `createAdminUserAccount`; respond `201` with `jsonApiResource({ type: 'AdminUser', id: user.id, attributes: { emailAddress, userCreationDate } })`. Call `skip()` before responding so no Hyperview handler runs. Let `ValidationError`/`ConflictError`/`ForbiddenError` propagate to the JSON:API error handler.
  - **Where**: `src/app/presentation/request-handlers/admin-api/accept-invite.js`
  - **Documentation**: `src/app/presentation/README.md` (Request Handlers), `src/docs/error-handling.md`, `src/app/presentation/request-handlers/admin-users.js`, `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js`
  - **Acceptance criteria**: A valid invite/bootstrap token plus a valid `AdminUser` document creates the user and returns `201` with the user resource and no session cookie; a missing bearer token returns 401; a non-redeemable token returns 403 `InvalidInvite`; a duplicate email returns 409; field errors return 422; all error bodies are JSON:API documents.
  - **Depends on**: Add JSON:API presentation helpers, Add the JSON:API error handler, Extract a no-session admin account creation Transaction Script, Add a JSON:API constructor to NewAdminUserForm

- [ ] **Add the PublishingApiToken collection and record**
  - **Story**: AS-2, PS-1
  - **What**: Add a document-store `PublishingApiToken` collection and record. The record id is the SHA-256 hex digest of the raw token (set via `input.id`), mirroring `AdminInvite`, so bearer lookups are a single `get()` by hash and the plaintext token is never stored. Stored fields: `permissions` (array of `{ effect, action, resource }`), `description` (string or null), `createdBy` (granting admin user id), `tokenCreationDate`, `tokenExpirationDate` (ISO), `revokedAt` (null until revoked). Implement `validate()` requiring `createdBy`, the date fields, and a non-empty `permissions` array. Add record helpers `getStatus(referenceDate)` → `'revoked' | 'expired' | 'active'` and `isActive(referenceDate)`. Set `generateSortKey(doc)` to `tokenCreationDate` for newest-first listing. Add collection helpers: `createToken(context, { createdBy, permissions, description, ttlSeconds })` — generate a prefixed token with `generateSecretToken('kxpat_')`, compute `sha256Hex(token)`, `create()` the record with id = hash and a derived `tokenExpirationDate`, returning `{ token, record }`; `getByTokenHash(context, tokenHash)`; `revoke(context, record)`; and `listPage(context, { cursor, limit })`.
  - **Where**: `src/app/collections/publishing-api-token-collection.js`, `src/app/collections/publishing-api-token-record.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/collections/admin-invite-collection.js`, `src/app/collections/admin-invite-record.js`, `src/app/lib/crypto.js`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Tokens persist through a registered document-store Collection; only the SHA-256 hex digest is stored (used as the id), never the plaintext; the raw `kxpat_`-prefixed token is returned exactly once at creation; status/expiry derive from stored fields; listing returns tokens newest-first.
  - **Depends on**: none

- [ ] **Register the PublishingApiToken collection**
  - **Story**: AS-2, PS-1
  - **What**: Import and register `PublishingApiTokenCollection` against the existing `DocumentStore` service in `register(context)`. The collection declares no secondary indexes (lookup is by id/hash), so leave `DOCUMENT_STORE_INDEXES` unchanged.
  - **Where**: `src/app/app.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/app.js`
  - **Acceptance criteria**: `context.getCollection('PublishingApiToken')` resolves during HTTP requests; existing collection and index registrations are unchanged.
  - **Depends on**: Add the PublishingApiToken collection and record

- [ ] **Add the publishing permissions library**
  - **Story**: AS-2, PS-1
  - **What**: Add a permissions module with two concerns kept separate. `validatePermissions(permissions)` — assert `permissions` is a non-empty array where, for this iteration, the only accepted entry is exactly `{ effect: 'allow', action: ['*'], resource: '*' }`; collect violations into a `ValidationError` (source `permissions`) for anything else, so unsupported grammar is a clean 422. `evaluatePermissions(permissions, { action, resource })` — return a boolean authorization decision; implement allow/deny with `*` wildcard matching for `action` and `resource` so the evaluator is structurally ready for richer grammar later even though only wildcard is accepted now. Export a stable action/resource URN convention note in comments for future iterations.
  - **Where**: `src/app/lib/publishing-permissions.js`
  - **Documentation**: `src/docs/error-handling.md`, `src/docs/code-quality.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `validatePermissions` accepts the wildcard allow-all entry and rejects every other shape with a `ValidationError`; `evaluatePermissions` returns `true` for any action/resource under the wildcard allow-all grant and is written to extend to explicit grants without a rewrite.
  - **Depends on**: none

- [ ] **Add the CreatePublishingApiTokenForm**
  - **Story**: AS-2
  - **What**: Add a JSON:API-backed form normalizing and validating the token-creation attributes: `permissions` (required; validated via `validatePermissions`), `timeToLiveSeconds` (optional integer; apply a default and reject values above a max cap and non-positive values), and `description` (optional string). Provide `static schema`, `validate()` aggregating field errors into a `ValidationError`, `toJSON()`, and `static fromJsonApi(resource)`. This form backs an API endpoint only, so the HTML-form `target`/`getFormContext` machinery is unnecessary; document that omission. `createdBy`, creation/expiration dates, and the token id are **not** form fields — they are server-derived.
  - **Where**: `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms), `src/app/presentation/forms/base-form.js`, `src/app/lib/publishing-permissions.js`, `src/docs/error-handling.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: The form accepts a valid wildcard `permissions` array with optional `timeToLiveSeconds`/`description`; missing/invalid permissions, a non-positive or over-cap TTL, or a malformed body produce field-level `ValidationError`s; no audit/identity fields are read from the client body.
  - **Depends on**: Add the publishing permissions library

- [ ] **Add the create-publishing-api-token Transaction Script**
  - **Story**: AS-2
  - **What**: Add `createPublishingApiToken(context, form, grantingUserId)` that calls `collection.createToken` with `createdBy = grantingUserId` (the authenticated admin id, never the body), the validated `permissions`, optional `description`, and the resolved `ttlSeconds`. Return a plain object carrying the one-time `token` plus the stored attributes (`permissions`, `description`, `createdBy`, creation/expiration dates) and the record `id`. Translate unexpected storage failures to `AssertionError`.
  - **Where**: `src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/app/collections/README.md`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A valid form plus a granting user id mints a token whose `createdBy` is the authenticated admin; the script returns the one-time plaintext token and the stored attributes; unexpected storage errors surface as non-operational `AssertionError`.
  - **Depends on**: Add the PublishingApiToken collection and record, Add the publishing permissions library

- [ ] **Add the create-publishing-api-token Admin API request handler**
  - **Story**: AS-2
  - **What**: Add `createPublishingApiTokenHandler(context, request, response, skip)`: assert JSON:API content type; `parseBasicAuthCredentials(request)`; `verifyAdminCredentials(context, { emailAddress, password })` to authenticate the granting admin (401 on failure); `parseJsonApiResource(request, 'PublishingApiToken')`; build and `validate()` the `CreatePublishingApiTokenForm`; call `createPublishingApiToken(context, form, admin.id)`; `skip()` and respond `201` with `jsonApiResource({ type: 'PublishingApiToken', id, attributes: { token, permissions, description, createdBy, tokenCreationDate, tokenExpirationDate } })`. The one-time secret appears as `data.attributes.token`.
  - **Where**: `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/docs/error-handling.md`, `src/app/presentation/lib/json-api.js`, `src/app/transaction-scripts/admin-users/verify-admin-credentials.js`
  - **Acceptance criteria**: Valid Basic credentials plus a valid token document return `201` with the secret token in `data.attributes.token` and the stored attributes; bad credentials return 401; an unsupported permission or bad TTL returns 422; a wrong content type returns 415; all error bodies are JSON:API documents.
  - **Depends on**: Add JSON:API presentation helpers, Add the JSON:API error handler, Extract a no-session admin credential verification Transaction Script, Add the CreatePublishingApiTokenForm, Add the create-publishing-api-token Transaction Script

- [ ] **Add the authenticate-publishing-token Transaction Script**
  - **Story**: PS-1
  - **What**: Add `authenticatePublishingToken(context, token)`: compute `sha256Hex(token)`, `getByTokenHash`, and return the active token record; throw `UnauthenticatedError` when the token is absent/unknown, and a suitable expected error (e.g. `UnauthenticatedError` or `ForbiddenError`) when the record is expired or revoked. Translate unexpected storage failures to `AssertionError`. Return enough of the record for the middleware to set a publishing principal and evaluate permissions.
  - **Where**: `src/app/transaction-scripts/publishing-api-tokens/authenticate-publishing-token.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/docs/error-handling.md`, `src/app/collections/publishing-api-token-collection.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-session.js`
  - **Acceptance criteria**: A valid active token resolves to its record; unknown, expired, or revoked tokens raise an expected 401/403; unexpected storage errors surface as non-operational `AssertionError`.
  - **Depends on**: Add the PublishingApiToken collection and record

- [ ] **Add the publishing-token authentication middleware**
  - **Story**: PS-1
  - **What**: Add `authenticatePublishingToken(context, request, response)` inbound middleware: read the bearer token via `request.getAuthorizationBearer()` (throw `UnauthenticatedError` when absent); call the authenticate Transaction Script; store the resolved token principal on the context (e.g. `context.setUser(...)` or a dedicated setter) including its `permissions` and `createdBy` for downstream auditing/authorization. Leave per-action permission checks to the individual handlers (or a thin shared helper) using `evaluatePermissions`; for this iteration any active token authorizes all publishing actions, but route the decision through the evaluator so future scoping is a data change.
  - **Where**: `src/app/presentation/middleware/publishing-authentication.js`
  - **Documentation**: `src/app/presentation/README.md` (Middleware), `src/app/presentation/middleware/admin-authentication.js`, `src/app/lib/publishing-permissions.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Requests without a valid active publishing bearer token are rejected with 401/403 before any handler runs; authenticated requests expose the token principal (permissions + grantor) on the context; authorization decisions flow through `evaluatePermissions`.
  - **Depends on**: Add the authenticate-publishing-token Transaction Script, Add the publishing permissions library

- [ ] **Add the put-template Transaction Script**
  - **Story**: PS-2
  - **What**: Add `putTemplate(context, { kind, filepath, source, buildId })` where `kind` is `'base' | 'page' | 'partial'`. Validate that `buildId` is a non-empty string (`ValidationError`/`BadRequestError` 400/422 when missing) and that it differs from `context.runtime.build?.id` (`ConflictError` 409 when equal) **before** calling the service, so the service's internal `AssertionError` precondition can never reach the client as a 500. Dispatch to `service.putBaseTemplate` / `putPageTemplate` / `putPartial` on the registered `'Hyperview'` service. Return the written logical filepath. Translate unexpected service failures to `AssertionError`.
  - **Where**: `src/app/transaction-scripts/publishing/put-template.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/kixx/hyperview/hyperview-service.js` (`putBaseTemplate`/`putPageTemplate`/`putPartial`, `#assertWritableBuildId`), `src/kixx/hyperview/template-file-store-interface.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A missing build id returns a client 400/422 and an equal-to-current build id returns 409, both before the service is called; a valid differing build id writes the template source verbatim and returns the logical filepath; unexpected failures surface as `AssertionError`.
  - **Depends on**: none

- [ ] **Add the template PUT request handlers and helper**
  - **Story**: PS-2
  - **What**: Add request handlers for `PUT` base, page, and partial templates. Each: enforce a `text/plain` or `text/html` content type (415 otherwise); read the build id from the `Kixx-Build-Id` header (required here); join the `*filepath` wildcard segments into a logical filepath; read the raw body via `request.text()`; call `putTemplate` with the appropriate `kind`; `skip()` and respond `200`/`201` with `jsonApiResource({ type: 'Template', id: filepath, attributes: { kind, filepath, buildId } })`. Factor the shared content-type guard, filepath join, and response shaping so the three handlers stay thin.
  - **Where**: `src/app/presentation/request-handlers/publishing-api/put-template.js`
  - **Documentation**: `src/app/presentation/README.md` (Request Handlers, route wildcard params), `src/app/presentation/lib/json-api.js`, `src/app/transaction-scripts/publishing/put-template.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: `PUT` of `text/plain`/`text/html` to each template endpoint with a valid differing `Kixx-Build-Id` stores the source and returns a JSON:API `Template` resource; a missing build header returns 4xx; an equal-to-current build id returns 409; a non-text content type returns 415.
  - **Depends on**: Add JSON:API presentation helpers, Add the JSON:API error handler, Add the publishing-token authentication middleware, Add the put-template Transaction Script

- [ ] **Add the PutPageMetadataForm**
  - **Story**: PS-3
  - **What**: Add a JSON:API-backed form for page metadata. The attributes are an arbitrary JSON bag that becomes `page.json`, so validation is intentionally minimal: assert the attributes are a plain object and require a non-empty `version` string (the minimal guard for the live-build cache contract — the form cannot verify the value actually changed, only that one is present). Provide `static schema` (documenting the `version` requirement), `validate()`, `toJSON()` returning the full bag, and `static fromJsonApi(resource)`.
  - **Where**: `src/app/presentation/forms/pages/put-page-metadata-form.js`
  - **Documentation**: `src/app/presentation/README.md` (Forms, Page Context Data), `src/kixx/hyperview/hyperview-service.js` (`putPageMetadata` caching caveat, `getPageMetadata` version composition), `src/docs/error-handling.md`
  - **Acceptance criteria**: A page-metadata document with a non-empty `version` validates and round-trips the full attribute bag; a non-object body or a missing/empty `version` produces a `ValidationError`.
  - **Depends on**: none

- [ ] **Add the put-page-metadata Transaction Script**
  - **Story**: PS-3
  - **What**: Add `putPageMetadata(context, { pathname, metadata, buildId })`. Resolve the effective build id: use the provided `buildId` when present, otherwise default to `context.runtime.build?.id` (assert a current build id exists). Call `service.putPageMetadata(context, effectiveBuildId, pathname, metadata)` on the `'Hyperview'` service and return the written filepath plus the effective build id. Translate unexpected service failures to `AssertionError`.
  - **Where**: `src/app/transaction-scripts/publishing/put-page-metadata.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/kixx/hyperview/hyperview-service.js` (`putPageMetadata`), `src/kixx/hyperview/page-data-store-interface.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: With no build header the write targets the current build; with a build header it targets that build; the page metadata is stored as `page.json` at the pathname; unexpected failures surface as `AssertionError`.
  - **Depends on**: none

- [ ] **Add the page-metadata PUT request handler**
  - **Story**: PS-3
  - **What**: Add a handler for `PUT /publishing-api/v1/pages/*pathname`: assert JSON:API content type; read the optional `Kixx-Build-Id` header; join `*pathname` segments into a normalized pathname; `parseJsonApiResource(request, 'PageMetadata')`; build and `validate()` the `PutPageMetadataForm`; call `putPageMetadata`; `skip()` and respond `200`/`201` with `jsonApiResource({ type: 'PageMetadata', id: pathname, attributes: metadata, meta: { buildId } })`.
  - **Where**: `src/app/presentation/request-handlers/publishing-api/put-page-metadata.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/json-api.js`, `src/app/transaction-scripts/publishing/put-page-metadata.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A valid `PageMetadata` document writes `page.json` to the resolved build and returns a JSON:API resource echoing the metadata and `meta.buildId`; a missing `version` returns 422; a wrong content type returns 415.
  - **Depends on**: Add JSON:API presentation helpers, Add the JSON:API error handler, Add the publishing-token authentication middleware, Add the PutPageMetadataForm, Add the put-page-metadata Transaction Script

- [ ] **Add the put-include Transaction Script**
  - **Story**: PS-4
  - **What**: Add `putInclude(context, { pathname, filename, source, buildId })`. Resolve the effective build id the same way as page metadata (provided value, else current build). Call `service.putIncludeContent(context, effectiveBuildId, pathname, filename, source)` and return the written filepath plus effective build id. Translate unexpected service failures to `AssertionError`. Document the workflow caveat in a comment: editing an include on the live build is only visible after its owning page is re-PUT with a bumped `version`, because the includes cache keys on page version.
  - **Where**: `src/app/transaction-scripts/publishing/put-include.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`, `src/kixx/hyperview/hyperview-service.js` (`putIncludeContent`, `getIncludes` cache keying), `src/docs/error-handling.md`
  - **Acceptance criteria**: With no build header the include targets the current build; with a build header it targets that build; the include source is stored at the page-relative filename; unexpected failures surface as `AssertionError`.
  - **Depends on**: none

- [ ] **Add the include PUT request handler**
  - **Story**: PS-4
  - **What**: Add a handler for `PUT /publishing-api/v1/includes/*filepath`: enforce a text-based content type (any `text/*`; 415 otherwise); read the optional `Kixx-Build-Id` header; split the `*filepath` wildcard into the page pathname and the include filename (the last segment is the filename, the preceding segments form the pathname); read the raw body via `request.text()`; call `putInclude`; `skip()` and respond `200`/`201` with `jsonApiResource({ type: 'Include', id: filepath, attributes: { pathname, filename, buildId } })`.
  - **Where**: `src/app/presentation/request-handlers/publishing-api/put-include.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/json-api.js`, `src/app/transaction-scripts/publishing/put-include.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: A `text/*` `PUT` stores the include for the resolved build and returns a JSON:API `Include` resource; a non-text content type returns 415; the pathname/filename split is correct for nested include paths.
  - **Depends on**: Add JSON:API presentation helpers, Add the JSON:API error handler, Add the publishing-token authentication middleware, Add the put-include Transaction Script

- [ ] **Wire the Admin API and Publishing API routes into virtual-hosts**
  - **Story**: AS-1, AS-2, PS-1, PS-2, PS-3, PS-4, XS-1
  - **What**: Add the new route subtrees to the `localhost` virtual host, placed before the `*` catch-all. (1) An `/admin-api/v1` branch with the JSON:API error handler and two leaf routes: `POST /admin-api/v1/users/invite{/}` → `acceptAdminInvite`, and `POST /admin-api/v1/publishing-api-tokens{/}` → `createPublishingApiTokenHandler` (no shared auth middleware — the invite endpoint authenticates by bearer-in-handler, the token endpoint by Basic-in-handler). (2) A `/publishing-api/v1` branch with `inboundMiddleware: [ authenticatePublishingToken ]` and the JSON:API error handler, containing the five `PUT` leaf routes: `/templates/base/*filepath`, `/templates/pages/*filepath`, `/templates/partials/*filepath`, `/pages/*pathname`, `/includes/*filepath`. Give every route and target a stable `name`. None of these targets include a Hyperview handler. Use optional-trailing-slash patterns (`{/}`) on the admin-api collection endpoints. Add the necessary imports.
  - **Where**: `src/virtual-hosts.js`
  - **Documentation**: `src/app/presentation/README.md` (Dynamic Routes, Route Matching Order, Route Pattern Matching, Middleware vs Request Handlers vs Error Handlers), `src/virtual-hosts.js`
  - **Acceptance criteria**: All seven endpoints resolve with their documented methods and patterns; publishing routes reject unauthenticated requests via the inbound middleware; errors under both subtrees are serialized by the JSON:API error handler; the `*` static catch-all still matches everything else; admin-api endpoints accept an optional trailing slash.
  - **Depends on**: Add the accept-invite Admin API request handler, Add the create-publishing-api-token Admin API request handler, Add the template PUT request handlers and helper, Add the page-metadata PUT request handler, Add the include PUT request handler
