# Signed Document Store Cursors

## Implementation Approach

Make the `DocumentStore` facade the sole owner of public cursor integrity, wrapping each runtime engine's existing opaque continuation token in a versioned HMAC-SHA-256 envelope. The facade will obtain its signing secret from the runtime environment, use the Web Crypto API so the implementation remains portable to Node and Cloudflare Workers, and pass only a verified inner cursor to the configured engine. HTTP parsing remains in the presentation layer: it validates the query-string shape and translates a verified-storage failure into `BadRequestError`, while transaction scripts preserve the typed storage error instead of reclassifying it as unexpected. Invite-list history stays URL-backed and gains strict structural validation, including its explicit empty page-one sentinel; signed cursors prevent a syntactically valid but invented non-root history value from being used.

- [ ] **Define the invalid-cursor storage error**
  - **Story**: Invalid or tampered pagination cursors are expected input failures, not internal storage faults.
  - **What**: Add a typed `InvalidCursorError` with a stable name/code for an invalid, expired-if-applicable, or signature-mismatched public document-store cursor. Document it as an expected input error emitted by the `DocumentStore` facade, and update the facade/interface cursor contracts to distinguish its public signed token from each engine's private continuation cursor.
  - **Where**: `src/kixx/document-store/invalid-cursor-error.js` (new); `src/kixx/document-store/document-store.js`; `src/kixx/document-store/document-store-engine-interface.js`
  - **Documentation**: `src/docs/server-error-handling.md`; `src/docs/code-documentation-guide.md`; `src/kixx/document-store/document-store-engine-interface.js`
  - **Acceptance criteria**: Callers can identify invalid public cursors without inspecting an assertion message; engine implementations remain free to use their own private cursor formats.
  - **Depends on**: none

- [ ] **Configure a runtime cursor-signing secret**
  - **Story**: Every deployment runtime can verify the same opaque cursor it previously issued without storing secrets in source configuration.
  - **What**: Define and document one required environment-secret name for cursor signing (for example, `DOCUMENT_STORE_CURSOR_SIGNING_SECRET`). At application initialization, read and validate that secret from `context.env` and pass it to `DocumentStore.initialize()`. Add non-secret configuration/deployment documentation for local Node environment setup and the Cloudflare Worker binding; do not commit actual key material to `node-config.js` or `cloudflare-config.js`.
  - **Where**: `src/app/app.js`; `README.md`
  - **Documentation**: `README.md`; `src/kixx/context/application-context.js`; `src/kixx/context/request-context.js`; `src/docs/server-error-handling.md`
  - **Acceptance criteria**: Startup fails clearly before serving requests when the secret is missing or invalid, and Node and Cloudflare receive the secret through their existing `context.env` mechanism.
  - **Depends on**: Define the invalid-cursor storage error

- [ ] **Seal and unseal cursors in the DocumentStore facade**
  - **Story**: A client can paginate only with a cursor produced by the same application secret and cannot alter its inner engine cursor.
  - **What**: Extend `DocumentStore.initialize()` with the validated signing configuration and add private, versioned cursor-envelope helpers. On `scan()` and `query()`, verify and decode an incoming signed public cursor before calling the engine; after a successful engine result, wrap its inner cursor with an HMAC-SHA-256 signature before returning it. Use `crypto.subtle` and constant-time signature verification appropriate to the Web Crypto API; cache imported key material safely. Reject malformed base64/JSON, unsupported envelope versions, absent inner cursor, and signature mismatches as `InvalidCursorError`. Preserve `null` on the final page and preserve engine cursor scope validation by passing the original inner token through unchanged.
  - **Where**: `src/kixx/document-store/document-store.js`
  - **Documentation**: `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/kixx/document-store/document-store-engine-interface.js`; `src/plugins/node-document-store-engine/lib/document-store-engine.js`; `src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js`
  - **Acceptance criteria**: Cursors returned by `scan()` and `query()` round-trip in both runtimes; a modified token, an unsigned legacy engine cursor, and a correctly shaped token signed with another secret each fail as `InvalidCursorError`; no Node-only cryptography or bare dependency is introduced.
  - **Depends on**: Configure a runtime cursor-signing secret

- [ ] **Preserve cursor failures through list transaction scripts**
  - **Story**: Presentation handlers can distinguish an invalid signed cursor from an unexpected persistence outage.
  - **What**: Update the invite and Publishing API token list transaction scripts to rethrow `InvalidCursorError` unchanged before their existing catch-all wrapping into `AssertionError`. Keep all other storage failures classified as unexpected and preserve the returned `{ items, cursor }` shapes.
  - **Where**: `src/app/transaction-scripts/admin-invites/list-admin-invites.js`; `src/app/transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js`
  - **Documentation**: `src/app/transaction-scripts/README.md`; `src/docs/server-error-handling.md`; `src/kixx/document-store/invalid-cursor-error.js`
  - **Acceptance criteria**: A signature failure reaches the request handler as `InvalidCursorError`; an unrelated engine failure is still wrapped as the existing unexpected `AssertionError`.
  - **Depends on**: Define the invalid-cursor storage error; Seal and unseal cursors in the DocumentStore facade

- [ ] **Validate URL cursor and invite-history input at the presentation boundary**
  - **Story**: Malformed `cursor` and `history` query parameters return a clear 400 without sending arbitrary values into storage or generating poisoned previous-page links.
  - **What**: Keep `getCursorQueryParam()` focused on the single `cursor` query parameter and add a dedicated invite-history parser in the presentation pagination module. Permit repeated history values only when each value is a string; allow the empty string only as the first/page-one sentinel and require all subsequent entries to be non-empty. Add a presentation-facing translation helper or equivalent route-local handling that converts `InvalidCursorError` from list loading into `BadRequestError` without exposing signature details. Update both list GET handlers to use the shared cursor parser/translator, and update the invite handler to use the validated history stack when building next/previous links.
  - **Where**: `src/app/presentation/lib/pagination.js`; `src/app/presentation/request-handlers/admin-invites.js`; `src/app/presentation/request-handlers/admin-publishing-api-tokens.js`
  - **Documentation**: `src/app/presentation/README.md`; `src/docs/server-error-handling.md`; `src/kixx/http-router/server-request-interface.js`; `src/templates/README.md`
  - **Acceptance criteria**: `?cursor=`, repeated `cursor`, malformed `history`, a non-leading empty history entry, and a tampered signed cursor result in the normal HTML 400 response; server-generated page links continue to support forward and backward invite navigation.
  - **Depends on**: Preserve cursor failures through list transaction scripts

- [ ] **Document the signed public cursor contract**
  - **Story**: Maintainers can extend document-store pagination without bypassing cursor integrity or putting HTTP concerns in storage code.
  - **What**: Update the DocumentStore and engine-interface JSDoc (and any existing document-store guide if present) to state that callers receive a signed public cursor from the facade, engines receive only an opaque inner cursor, cursors require a runtime secret, and invalid public cursors use `InvalidCursorError`. Add a short presentation note that query-string cardinality/history validation is intentionally separate from storage signing.
  - **Where**: `src/kixx/document-store/document-store.js`; `src/kixx/document-store/document-store-engine-interface.js`; `src/app/presentation/lib/pagination.js`
  - **Documentation**: `src/docs/code-documentation-guide.md`; `src/docs/code-style-guide.md`; `src/app/presentation/README.md`
  - **Acceptance criteria**: The layer boundary, secret requirement, cross-runtime behavior, and expected-error mapping are discoverable without reading implementation helpers.
  - **Depends on**: Seal and unseal cursors in the DocumentStore facade; Validate URL cursor and invite-history input at the presentation boundary

- [ ] **Lint the changed source files**
  - **Story**: The cursor-integrity implementation follows the project JavaScript style rules.
  - **What**: Run the linter on every changed JavaScript source file and fix reported errors. Do not add, modify, or run unit tests unless separately requested.
  - **Where**: `src/kixx/document-store/`; `src/app/app.js`; `src/app/transaction-scripts/admin-invites/list-admin-invites.js`; `src/app/transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js`; `src/app/presentation/lib/pagination.js`; `src/app/presentation/request-handlers/admin-invites.js`; `src/app/presentation/request-handlers/admin-publishing-api-tokens.js`
  - **Documentation**: `README.md`; `src/docs/code-style-guide.md`; `AGENTS.md`
  - **Acceptance criteria**: `node run-linter.js` exits successfully for all changed source files, and no unit-test files are changed or run.
  - **Depends on**: Document the signed public cursor contract
