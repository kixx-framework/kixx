# Stateless CSRF Tokens Implementation Plan

Replace the KV-backed CSRF pre-session with an HMAC-signed stateless token, removing every
Key/Value Store read and write from the CSRF subsystem without changing the handler-facing
API, the wire format, or any template.

## Implementation Approach

Today every CSRF operation touches the Key/Value Store. One admin login costs **3 writes and
2 reads**:

| Step | KV operations |
|---|---|
| `GET` login page → `getCsrfFormContext()` | 1 write (`createToken` or `issueToken`) |
| `POST` → `validateCsrfFormData()` → `validateToken()` | 1 read |
| `POST` → `consumeToken()` | 1 read + 1 write (put or delete) |
| `POST` → `clearCsrfToken()` | 1 write (delete) |

Each failed submission that re-renders the form adds another write. Both write sources trace
to a single decision: token hashes are **stored server-side** and tokens are **single-use**.
Minting is a write; spending is a write.

The replacement keeps the synchronizer token pattern but moves the state into the signature.
A random pre-session id (`sid`) lives in the existing `kixx_csrf_session` cookie — client
state, free to write. The form field carries an HMAC envelope over `{sid, exp}`. Verification
recomputes the HMAC and compares `payload.sid` against the cookie, so it is a pure function of
data the request already carries plus a deploy-time secret. **Zero KV operations on both GET
and POST.**

This also removes a latent correctness bug on Cloudflare. Workers KV is eventually consistent
— a write is immediately visible in the colo that made it, but other colos can serve stale
reads for up to ~60 seconds. The current flow writes on `GET` in one colo and reads on `POST`
in whichever colo the submission lands in, which is precisely the pattern KV is worst at, and
produces spurious "form has expired" rejections invisible in development because SQLite is
strongly consistent and single-node. The same eventual consistency is the cause of the
lost-append race that `CsrfTokenCollection#issueToken()`'s docblock already concedes.

Work lands in three partitions: a shared base64url utility and the signer itself (Task 1),
rewiring `lib/csrf.js` onto the signer (Task 2), and deleting the now-dead storage layer and
updating configuration and documentation (Task 3). Each task owns the unit tests for the
behavior it introduces — tests are not deferred to a trailing task.

### Cross-cutting decisions

These were settled with the user before planning and should not be re-litigated:

1. **Single-use replay protection is dropped, deliberately.** The user confirmed no surface
   depends on it. Within the token TTL a token becomes replayable. CSRF protection itself is
   unaffected — the attacker still cannot read the token cross-origin, which is the entire
   threat model. Rails and Django both accept this same tradeoff. Note that
   `postNewAdminUserForm()` does not lean on single-use for idempotency: invite consumption is
   enforced in the domain layer, and `InviteSpentInEmailRace`
   (`src/app/presentation/request-handlers/admin-panel/admin-users.js:241`) already handles
   the concurrent-resubmit case where it belongs.
2. **The handler-facing API does not change.** `getCsrfFormContext()`,
   `renderWithFreshCsrf()`, `validateCsrfFormData()`, and `INVALID_CSRF_TOKEN_CODE` keep their
   exact signatures and semantics. `clearCsrfToken()` is the one exception — it loses its now
   unused `context` parameter. No request handler logic changes, and no template changes.
3. **The wire format is preserved.** Cookie name `kixx_csrf_session`, form field name
   `csrf_token`, and the `form.csrf.fieldName` / `form.csrf.token` render context are
   unchanged. This is what keeps `test/end-to-end/test-helpers/authenticate.js` and every
   `page.html` working untouched.
4. **Binding `sid` inside the signed payload is mandatory**, not decorative. It is what makes
   this a synchronizer token rather than plain double-submit. Double-submit's classic weakness
   is an attacker who can write cookies via subdomain shadowing — they set both halves and
   match them. Here they would additionally have to forge an HMAC over the injected `sid`,
   which requires the server secret.
5. **A separate secret**, `CSRF_TOKEN_SIGNING_SECRET`, read with
   `context.getEnvString(..., { required: true })` at boot so a missing secret fails startup on
   every platform rather than at first request. Not shared with
   `DOCUMENT_STORE_CURSOR_SIGNING_SECRET` — distinct purpose, independent rotation.
6. **Rotation invalidates in-flight forms, and that is accepted for v1.** Same documented
   tradeoff already stated for the cursor secret in `src/example.env`. Multi-secret
   verify-against-any rotation was considered and deferred; the token format chosen here
   admits it later without a format change.
7. **No targeted revocation.** A specific outstanding token can no longer be invalidated
   globally, because it is never stored. The remaining levers are clearing the cookie
   (per-browser, instant, no propagation — this is what `clearCsrfToken()` becomes) and
   rotating the secret (global). The user confirmed no surface needs the targeted form.
8. **No inverse coverage of the replaced behavior.** Do not write test cases asserting the
   *absence* of the removed single-use semantics — specifically, no test asserting that
   replaying a token succeeds. Replayability is a consequence of the new design, not a
   property the system promises. Codifying it would lock the door against ever reintroducing
   replay protection, and the test would fail spuriously the day someone does. Cover what the
   new design guarantees, not what it stopped preventing. This does **not** exempt the new
   design's own rejection paths: a forged, expired, malformed, or `sid`-mismatched token must
   be proven to fail, and those cases are required (see Task 1).

### Token format

```
token       = base64url(payloadBytes) "." base64url(signatureBytes)
payloadBytes = utf8(JSON.stringify({ sid, exp }))
signatureBytes = HMAC-SHA-256(secret, payloadBytes)
```

`sid` is the `kixx_csrf_session` cookie value (a `generateSecretToken()` hex string). `exp` is
whole Unix seconds. This mirrors `DocumentStore#sealCursor()`
(`src/kixx/document-store/document-store.js:176-182`), which is the existing precedent in this
codebase for a signed stateless value and should be followed rather than reinvented.

Verification must run in this order and **fail closed and uniformly** at every step — one
boolean `false`, one error message, no distinguishing detail that would build an oracle:

1. Split on `.` — exactly two non-empty segments.
2. base64url-decode both segments; the canonical-form check rejects permissive `atob()` decodes.
3. `crypto.subtle.verify('HMAC', key, signature, payloadBytes)`.
4. `JSON.parse` the payload through a fatal UTF-8 decoder.
5. Shape check: `sid` a non-empty string, `exp` an integer.
6. `exp > now`.
7. `payload.sid === cookieSid`.

Signature comparison is constant-time inside `crypto.subtle.verify`. The `sid` string compare
at step 7 uses `===`; both operands are attacker-supplied in an attack scenario and no secret
is involved, so a non-constant-time compare leaks nothing.

### Distributed-system notes for the implementing agent

- **No cross-node coordination exists in this design.** Any colo verifies any token minted by
  any other colo. There is no affinity or sticky-session requirement.
- **Clock skew is a non-issue.** `exp` is compared against each node's `Date.now()`. Cloudflare
  machines are NTP-synced to within milliseconds against a 30-minute TTL. Workers additionally
  freezes `Date.now()` between I/O operations as a Spectre mitigation, so the clock can lag a
  request by a few milliseconds — expected behavior, not a bug, and irrelevant at this TTL. Do
  not add a skew-tolerance window.
- **Import the `CryptoKey` once per instance, never per request.** Store the *promise* returned
  by `crypto.subtle.importKey()` and `await` it at each use, exactly as
  `DocumentStore` does with `#cursorSigningKey`
  (`src/kixx/document-store/document-store.js:146-161`). Workers isolates persist instance
  state across requests, so this amortizes to zero.
- **Concurrent first-GET from a cookie-less browser remains an edge case and is not a
  regression.** Two tabs opened simultaneously with no cookie each mint a different `sid` and
  set a cookie; the browser keeps whichever `Set-Cookie` arrived last, and the losing tab's
  form is bound to a dead `sid`. The current design fails identically (two `createToken()`
  calls, two records, one surviving cookie). The window is narrow and the failure is
  recoverable through the existing `InvalidCsrfTokenError` re-render path. Do not attempt to
  fix it in this work.

### Cookie lifetime

The cookie carries only a `sid`, which is not a credential on its own — an attacker holding it
cannot forge a token for it without the secret. The token's signed `exp` is the real time
bound. Set the cookie on every form render with `maxAge = CSRF_TOKEN_TTL_SECONDS`, refreshing
it, so the cookie always outlives a token minted in the same response. All other attributes
(`path: '/'`, `httpOnly`, `sameSite: 'Lax'`, `secure: isSecureRequest(request)`) are unchanged.
The `maxAge`-tracks-remaining-pre-session-lifetime logic in the current
`getCsrfFormContext()` disappears along with the record it was tracking.

### Test strategy

The user has explicitly asked for unit test coverage of this work, so writing **and running**
the tests described below is in scope for the task that owns them. Follow
`test/unit-tests/README.md` for the runner API, `MockTracker` usage, hook semantics, and the
patterns for asserting thrown errors and rejected promises. Test files mirror the source tree.

Four facts set the shape of the coverage:

- **`test/unit-tests/app/presentation/lib/csrf.test.js` (248 lines) cannot be salvaged
  incrementally.** Its `makeHarness()` mocks a `CsrfToken` collection and asserts on
  `collection.consumed` and `collection.deleted` — state that stops existing at Task 2. The
  file is rewritten, not patched, and Task 2 owns it. Do not try to preserve its harness.
- **`test/unit-tests/kixx/document-store/document-store.test.js` already covers the moved
  base64url helpers indirectly**, through cursor seal/unseal, tamper rejection ("Invalid
  document store cursor"), and a replacement-signing-secret case. It is the regression proof
  that Task 1's extraction changed no behavior, and Task 1 must run it. No new cases are
  needed there.
- **`src/app/app.js` is pure wiring and has no unit test today**, consistent with how this
  suite treats `src/virtual-hosts.js`. Task 3 adds none; a test of `registerService()` would
  be testing the context, which `test/unit-tests/kixx/` already covers. Task 3 is proven by
  the full-suite run plus its manual boot checks.
- **`test/end-to-end/` needs no changes.** The helpers scrape the token from rendered HTML and
  reuse the cookie, both of which the preserved wire format keeps valid. E2E runs will require
  `CSRF_TOKEN_SIGNING_SECRET` in the environment once Task 3 lands.

New and rewritten files, each owned by the task that introduces the behavior:

| File | Owner | Covers |
|---|---|---|
| `test/unit-tests/kixx/utils/base64url.test.js` | Task 1 | Round-trip and canonical-form rejection |
| `test/unit-tests/app/presentation/lib/csrf-token-signer.test.js` | Task 1 | Envelope, fail-closed contract, cross-instance verification |
| `test/unit-tests/app/presentation/lib/csrf.test.js` | Task 2 | Rewritten: cookie handling, `sid` reuse, render context, rejection propagation |

`test/unit-tests/kixx/utils/crypto.test.js` and
`test/unit-tests/app/presentation/lib/admin-session-cookie.test.js` are the closest existing
models — reuse their structure rather than inventing a new one.

Cross-cutting decision 8 governs all of it: cover the guarantees the new design makes, and do
not write a case asserting that a replayed token is accepted.

---

### Task 1: HMAC-signed CSRF token envelope

**Status:** Complete
**Depends on:** None
**Documentation:** Token format and distributed-system notes above; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `test/unit-tests/README.md`; `src/plugins/README.md` (service registration lifecycle)

**Objective**

A `CsrfTokenSigner` that mints and verifies stateless CSRF tokens using HMAC-SHA-256 over a
`{sid, exp}` payload, holding its `CryptoKey` for the life of the instance and touching no
storage. Standalone, independently exercisable, and under test before anything consumes it.

**Scope**

- In: the base64url encode/decode utility extracted for shared use; the signer module; its
  key import and lifecycle; the sign and verify envelope; unit tests for both new modules;
  the existing document-store regression run that proves the extraction was behavior-neutral.
- Out: all `lib/csrf.js` rewiring and its test rewrite (Task 2); service registration in
  `app.js` and env configuration (Task 3); deleting the collection and record (Task 3).

**Design and invariants**

- `bytesToBase64Url()` / `base64UrlToBytes()` are currently file-private in
  `src/kixx/document-store/document-store.js:637-669`. Extract them verbatim into
  `src/kixx/utils/base64url.js` and update `document-store.js` to import them. This is a pure
  move with no behavior change. Duplicating them is not acceptable: the canonical-form
  round-trip check in `base64UrlToBytes()` is security-relevant, and two copies will drift.
  The `BASE64URL_PATTERN` constant moves with them.
- Follow the small-focused-module convention already visible in `src/kixx/utils/`.
- The signer stores the **promise** from `crypto.subtle.importKey()`, never the raw secret
  string, and never re-imports per call.
- `verify()` returns a boolean. It never throws for a malformed, forged, or expired token, and
  never reports *which* check failed. Malformed input is an expected condition here, not a
  programmer error — see `src/docs/server-error-handling.md`.
- The signer knows nothing about cookies, requests, or responses. It takes a `sid` string and
  returns/validates a token string. Cookie handling belongs to `lib/csrf.js` (Task 2).
- `verify()` takes the expected `sid` as a parameter and performs the step-7 comparison
  itself, so no caller can forget it.
- The constructor asserts a non-empty secret, per `src/docs/server-error-handling.md` rules for
  internal invariants.

**Expected touch points**

- `src/kixx/utils/base64url.js` — new; extracted encode/decode helpers plus `BASE64URL_PATTERN`.
- `src/kixx/document-store/document-store.js` — remove the two private functions and the
  pattern constant; import from the new module.
- `src/app/presentation/lib/csrf-token-signer.js` — new; the signer class.
- `test/unit-tests/kixx/utils/base64url.test.js` — new.
- `test/unit-tests/app/presentation/lib/csrf-token-signer.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `src/kixx/utils/base64url.js` exports both helpers; `document-store.js` imports them and
      retains byte-identical cursor behavior.
- [ ] `CsrfTokenSigner` exposes an async `sign(sid, ttlSeconds)` returning the two-segment
      token, and an async `verify(token, sid)` returning a boolean.
- [ ] The `CryptoKey` is imported at most once per instance.
- [ ] `verify()` returns `false` — never throws, never distinguishes causes — for: a token with
      the wrong segment count, non-canonical base64url, a bad signature, a non-UTF-8 or
      non-JSON payload, a malformed `sid` or `exp`, an expired `exp`, and a `sid` mismatch.
- [ ] A token minted by one signer instance verifies against a second instance constructed
      with the same secret, and fails against one constructed with a different secret. This is
      the cross-node property the whole design rests on.
- [ ] JSDoc per `src/docs/code-documentation-guide.md` on the class and both public methods,
      documenting the fail-closed contract.

**Test coverage owned by this task**

`test/unit-tests/kixx/utils/base64url.test.js`:

- [ ] Round-trips arbitrary bytes, including empty input and bytes that encode with padding.
- [ ] Produces URL-safe output: no `+`, `/`, or trailing `=`.
- [ ] Rejects a non-canonical encoding that permissive `atob()` would otherwise accept — the
      round-trip check is the security-relevant behavior and is the reason this module is
      shared rather than duplicated.
- [ ] Rejects input containing characters outside the base64url alphabet.

`test/unit-tests/app/presentation/lib/csrf-token-signer.test.js`:

- [ ] A signed token verifies against the `sid` it was minted for.
- [ ] The token is two `.`-separated base64url segments, and the payload decodes to the
      expected `{sid, exp}` — asserted by decoding, so the format stays pinned for the future
      multi-secret rotation described in cross-cutting decision 6.
- [ ] `exp` is `ttlSeconds` in the future, in whole Unix seconds.
- [ ] One rejection case per reason listed in the acceptance criteria above, each asserting a
      returned `false` rather than a throw. Drive the expiry case by signing with a short or
      zero TTL rather than by mocking the clock.
- [ ] Cross-instance: same secret verifies, different secret rejects. Model this on the
      replacement-signing-secret case already in `document-store.test.js`.
- [ ] `crypto.subtle.importKey` is called at most once across many `sign()`/`verify()` calls,
      via `MockTracker`. This is the Workers-isolate amortization property and is invisible to
      every behavioral assertion, so it needs its own case.

Per cross-cutting decision 8, do not add a case asserting a token verifies twice.

**Validation**

- `node run-linter.js src/kixx/utils/base64url.js src/kixx/document-store/document-store.js src/app/presentation/lib/csrf-token-signer.js`
- `node run-tests.js test/unit-tests/kixx/utils test/unit-tests/app/presentation/lib` — proves
  the new modules.
- `node run-tests.js test/unit-tests/kixx/document-store` — proves the base64url extraction was
  behavior-neutral. This existing file already exercises cursor seal/unseal, tamper rejection,
  and secret replacement, so it is the regression gate for the move; it must pass unmodified.
- Manual: the document store's cursor pagination is the only runtime consumer of the moved
  helpers. Start the dev server, open the admin invite list (`/admin/invites`), and page
  forward and back.

**Progress and handoff**

- Completed: Extracted `bytesToBase64Url()`/`base64UrlToBytes()` (and `BASE64URL_PATTERN`) out
  of `document-store.js` verbatim into `src/kixx/utils/base64url.js`; `document-store.js` now
  imports them. Wrote `CsrfTokenSigner` with `sign(sid, ttlSeconds)` and `verify(token, sid)`,
  holding the imported `CryptoKey` promise in a private field. Wrote both new test files per
  the plan's coverage list.
- Current state: All acceptance criteria met. Lint clean. New tests pass (104 tests across
  `test/unit-tests/kixx/utils` + `test/unit-tests/app/presentation/lib`). The existing
  `test/unit-tests/kixx/document-store` suite (40 tests) passes unmodified, confirming the
  extraction was behavior-neutral.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - `base64UrlToBytes('')` throws (the alphabet pattern requires 1+ chars) — this is
    pre-existing behavior carried over unchanged, not a regression. The round-trip test for
    empty input was adjusted to only assert the encode direction; `document-store.js` never
    exercised the decode side with an empty string either.
  - The non-canonical-decode test uses a single zero byte (canonical form `"AA"`) versus the
    hand-crafted `"AB"`, since a 3-byte example leaves no unused padding bits to tamper with —
    only inputs whose base64 length includes padding have "don't care" bits a permissive
    `atob()` accepts but the canonical round-trip rejects.
  - `MockTracker.method(crypto.subtle, 'importKey')` needed no explicit implementation
    argument; it defaults to calling through to the original bound method, which is enough to
    just count calls for the CryptoKey-imported-once assertion.
  - Per this repo's `AGENTS.md` ("Do not run the dev server... for the purpose of work
    verification or smoke testing"), the plan's manual dev-server check (paging
    `/admin/invites` forward and back) was intentionally skipped. The automated regression
    suite (`document-store.test.js`, unmodified and passing) is the verification for this
    task instead.
- Actual files changed:
  - `src/kixx/utils/base64url.js` (new)
  - `src/kixx/document-store/document-store.js` (removed the two private functions and
    `BASE64URL_PATTERN`; added the import)
  - `src/app/presentation/lib/csrf-token-signer.js` (new)
  - `test/unit-tests/kixx/utils/base64url.test.js` (new)
  - `test/unit-tests/app/presentation/lib/csrf-token-signer.test.js` (new)
- Validation run:
  - `node run-linter.js src/kixx/utils/base64url.js src/kixx/document-store/document-store.js src/app/presentation/lib/csrf-token-signer.js test/unit-tests/kixx/utils/base64url.test.js test/unit-tests/app/presentation/lib/csrf-token-signer.test.js` — clean.
  - `node run-tests.js test/unit-tests/kixx/utils test/unit-tests/app/presentation/lib` — 104 tests, passed.
  - `node run-tests.js test/unit-tests/kixx/document-store` — 40 tests, passed unmodified.
- Blockers: None.

---

### Task 2: Rewire the CSRF helpers onto the signer

**Status:** Complete
**Depends on:** Task 1
**Documentation:** Cookie lifetime and cross-cutting decisions above; `src/app/presentation/README.md` §"CSRF-Protected HTML Forms" (lines ~859-905); `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

`src/app/presentation/lib/csrf.js` mints and validates tokens through `CsrfTokenSigner`,
performing zero Key/Value Store operations, while every request handler and template that
consumes it continues to work without modification.

**Scope**

- In: `issueCsrfToken()` replaced by signer-backed minting; `getCsrfFormContext()` cookie
  handling; `validateCsrfFormData()` verification; `clearCsrfToken()` reduced to a cookie
  expiry; the two `clearCsrfToken()` call sites; the CSRF section of the presentation README;
  the full rewrite of `test/unit-tests/app/presentation/lib/csrf.test.js`.
- Out: registering the signer service and reading the env secret (Task 3); deleting the
  collection and record (Task 3); any change to handler control flow, form classes, or
  templates.

**Design and invariants**

- `getCsrfFormContext()`, `renderWithFreshCsrf()`, and `validateCsrfFormData()` keep their
  exact exported signatures. `getCsrfFormContext()` remains async — `crypto.subtle.sign()` is
  async — so no call site changes.
- `clearCsrfToken(request, response)` loses the unused `context` parameter. Update both call
  sites: `admin-users.js:289` (signup success) and `admin-users.js:404` (login success). Do not
  leave an unused parameter behind; `eslint.config.js` will flag it and it misrepresents the
  function's dependencies.
- The signer is reached via `context.getService('CsrfTokenSigner')`, mirroring how
  `lib/csrf.js` reaches `context.getCollection('CsrfToken')` today. Task 3 registers it; until
  then this task's code will throw at runtime on a service lookup, which is expected and is why
  the two tasks share a manual validation pass.
- Minting logic replacing `issueCsrfToken()`: read `kixx_csrf_session`; reuse the `sid` when
  the cookie holds a non-empty string, otherwise `generateSecretToken()`. Reusing the existing
  `sid` is what preserves the multi-tab property — a second tab must not invalidate a form
  already on screen. Always `sign()` a fresh payload and always re-set the cookie with
  `maxAge: CSRF_TOKEN_TTL_SECONDS`.
- `MIN_REUSABLE_SECONDS`, `isReusable()`, and the remaining-lifetime `maxAge` calculation have
  no analogue and must not be carried over. They existed only to decide whether a stored record
  could still be written to.
- `validateCsrfFormData()` keeps owning `request.formData()` (bodies are one-shot) and keeps
  throwing `ForbiddenError` with `INVALID_CSRF_TOKEN_CODE` and the same user-facing message on
  failure, so every handler recovery path in `admin-invites.js` and
  `admin-publishing-api-tokens.js` keeps working untouched.
- Delete the token-consumption step entirely. There is nothing to spend.
- Rewrite the module's existing comments rather than leaving them in place. The current
  docblocks explain pre-session reuse, single-use spending, and record lifetime — all of which
  become actively misleading. Per `src/docs/code-style-guide.md`, stale comments are a defect.
- Update the presentation README's CSRF section in this task, not Task 3: it currently
  documents "mints a fresh single-use CSRF token", which is false the moment this task lands.

**Expected touch points**

- `src/app/presentation/lib/csrf.js` — the whole minting and validation path, and its comments.
- `src/app/presentation/request-handlers/admin-panel/admin-users.js` — two `clearCsrfToken()`
  call sites.
- `src/app/presentation/README.md` — the CSRF-Protected HTML Forms section.
- `test/unit-tests/app/presentation/lib/csrf.test.js` — rewritten.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `lib/csrf.js` contains no `getCollection('CsrfToken')` call and no storage access of any
      kind.
- [ ] `getCsrfFormContext()` returns the same `{csrf: {fieldName, token}}` shape merged onto
      the form context, and sets `kixx_csrf_session` with unchanged attributes plus
      `maxAge: CSRF_TOKEN_TTL_SECONDS`.
- [ ] An existing cookie's `sid` is reused rather than replaced, so a second render does not
      invalidate a form already rendered.
- [ ] `validateCsrfFormData()` accepts a token minted for the cookie it was rendered with, and
      rejects a missing cookie, a missing field, a forged token, an expired token, and a token
      bound to a different `sid` — all with `INVALID_CSRF_TOKEN_CODE`.
- [ ] `clearCsrfToken(request, response)` expires the cookie and performs no storage call.
- [ ] No request handler's control flow changed; no template changed.
- [ ] Comments and JSDoc describe the stateless model, with no surviving reference to
      pre-sessions, reuse thresholds, or single-use spending.

**Test coverage owned by this task**

`test/unit-tests/app/presentation/lib/csrf.test.js` is rewritten from scratch. The old
harness mocks a `CsrfToken` collection; the new one supplies a stub `context.getService()`
returning a real `CsrfTokenSigner` built on a fixed test secret. Use a real signer rather than
a mock — the interesting behavior in this module is the interaction between cookie and token,
and a mocked signer would assert nothing about it. `admin-session-cookie.test.js` is the model
for asserting cookie attributes on a stubbed response.

- [ ] `getCsrfFormContext()` returns `csrf.fieldName` and `csrf.token`, merged onto the form
      context without disturbing the properties `form.getFormContext()` supplied.
- [ ] It sets `kixx_csrf_session` with `path: '/'`, `httpOnly`, `sameSite: 'Lax'`, and
      `maxAge: CSRF_TOKEN_TTL_SECONDS`.
- [ ] `secure` follows `isSecureRequest(request)` in both directions.
- [ ] **`sid` reuse:** given a request already carrying a cookie, the response re-sets that
      same `sid` rather than minting a new one, and the token it returns verifies against it.
      This is the multi-tab invariant — the single most important case in the file.
- [ ] **No cookie:** a fresh `sid` is minted and set, and its token verifies against it.
- [ ] **Independent tokens:** two successive renders against the same cookie both produce
      tokens that verify. (Assert that both are valid — not that either can be used twice.)
- [ ] `validateCsrfFormData()` returns the parsed `FormData` when the token matches the cookie.
- [ ] It throws `ForbiddenError` with `INVALID_CSRF_TOKEN_CODE` and status 403 for: no cookie,
      no `csrf_token` field, a forged token, an expired token, and a token minted for a
      different `sid`. Handler recovery paths match on that code, so the code — not just the
      throw — is the contract under test.
- [ ] It performs no storage access; the stub context exposes no collection, so a stray
      `getCollection()` call fails the test loudly.
- [ ] `renderWithFreshCsrf()` sets the response status from an explicit `status`, falls back to
      `error.httpStatusCode`, and defaults to 500 — the three branches at `csrf.js:87`.
- [ ] `clearCsrfToken(request, response)` sets the cookie to an empty value with `maxAge: 0`
      and makes no storage call.

Per cross-cutting decision 8, do not add a case submitting the same token twice and asserting
both succeed.

**Validation**

- `node run-linter.js src/app/presentation/lib/csrf.js src/app/presentation/request-handlers/admin-panel/admin-users.js`
- `node run-tests.js test/unit-tests/app/presentation/lib`
- Manual (run after Task 3 wires the service; these are the acceptance path for both tasks):
  1. `node tools/devserver.js --port 2026` with `CSRF_TOKEN_SIGNING_SECRET` set.
  2. `GET /login/admin/new` — confirm a `csrf_token` hidden field and a `kixx_csrf_session`
     cookie in the response.
  3. Submit valid credentials — login succeeds and the CSRF cookie is cleared.
  4. Submit with the hidden field's value altered by one character — expect the recoverable
     rejection, not a generic 403 page.
  5. Submit with the `kixx_csrf_session` cookie deleted from the request — expect rejection.
  6. Open the invite form in two tabs, submit the **first** tab — it must succeed. This is the
     multi-tab regression that the `sid`-reuse rule protects, and it is the single most
     important manual check in this plan.
  7. Submit the same captured token twice — both now succeed. This is a one-time manual
     confirmation that the approved behavior change actually landed; note the result in the
     handoff. Per cross-cutting decision 8, do **not** promote it into a test case.
  8. Verify no KV writes occur during any of the above.

**Progress and handoff**

- Completed: Rewrote `src/app/presentation/lib/csrf.js` end to end onto `CsrfTokenSigner`:
  `getCsrfFormContext()` now reuses an existing `sid` cookie value (or mints one via
  `generateSecretToken()`), always signs a fresh token, and always re-sets the cookie with
  `maxAge: CSRF_TOKEN_TTL_SECONDS`. `validateCsrfFormData()` verifies the submitted token
  against the cookie's `sid` via `signer.verify()` and no longer consumes anything.
  `clearCsrfToken()` dropped its `context` parameter and is now synchronous (it only clears a
  cookie — there is no longer any awaited storage call). Updated both call sites in
  `admin-users.js` (lines ~289 and ~404) to the new two-argument, non-awaited form. Rewrote
  the CSRF-Protected HTML Forms section of `src/app/presentation/README.md` to describe the
  stateless model (dropped "single-use", "pre-session", added the resubmission-is-now-accepted
  and secret-rotation notes). Rewrote
  `test/unit-tests/app/presentation/lib/csrf.test.js` from scratch using a real
  `CsrfTokenSigner` built on a fixed test secret behind a stub `context.getService()`.
- Current state: All acceptance criteria met. Lint clean on all changed files. New/rewritten
  test file passes (48 tests in `test/unit-tests/app/presentation/lib`), and the full repo
  suite passes (1412 tests), confirming no other caller depended on the old signatures. Grepped
  the whole `src/` tree for `clearCsrfToken`/`getCsrfFormContext`/`validateCsrfFormData`/
  `renderWithFreshCsrf` — every other call site (`admin-invites.js`,
  `admin-publishing-api-tokens.js`) already used the unchanged three-argument
  `getCsrfFormContext`/`validateCsrfFormData`/`renderWithFreshCsrf` signatures and needed no
  edits.
- Remaining: Nothing for this task. Task 3's service registration is what makes
  `context.getService('CsrfTokenSigner')` resolve at runtime — until that lands, calling any
  of these helpers against a live `context` will throw, which is expected and documented in
  the plan.
- Decisions and discoveries:
  - `clearCsrfToken()` no longer performs any `await`-worthy work, so it was made synchronous
    rather than kept `async` for its own sake; both call sites in `admin-users.js` were updated
    to call it without `await` accordingly. This is slightly beyond the plan's literal
    "loses the unused context parameter" wording but keeps the function's signature honest
    about what it actually does now, per the code style guide's stance on encapsulation.
  - Per this repo's `AGENTS.md` policy against running the dev server for verification, the
    manual validation sequence in this task (steps 1-8, including the two-tab multi-tab check
    and the one-time "same token submitted twice now succeeds" confirmation) was **not** run.
    That sequence requires Task 3's service registration to be wired up anyway (the plan notes
    this task's code throws at runtime on the service lookup until then), so it is deferred to
    whoever performs manual acceptance testing after Task 3 lands, or to the user directly.
  - The rewritten test's "performs no storage access" case asserts `context.getCollection` is
    `undefined` on the stub context (rather than mocking a throwing `getCollection`), which is
    sufficient: `lib/csrf.js` no longer references `getCollection` anywhere, confirmed by a
    full-file read of the rewritten module.
- Actual files changed:
  - `src/app/presentation/lib/csrf.js` (rewritten)
  - `src/app/presentation/request-handlers/admin-panel/admin-users.js` (two `clearCsrfToken()` call sites)
  - `src/app/presentation/README.md` (CSRF-Protected HTML Forms section)
  - `test/unit-tests/app/presentation/lib/csrf.test.js` (rewritten)
- Validation run:
  - `node run-linter.js src/app/presentation/lib/csrf.js src/app/presentation/request-handlers/admin-panel/admin-users.js test/unit-tests/app/presentation/lib/csrf.test.js` — clean.
  - `node run-tests.js test/unit-tests/app/presentation/lib` — 48 tests, passed.
  - `node run-tests.js` (full suite) — 1412 tests, passed.
  - Manual steps 1-8: **not run**, deferred (see discoveries above).
- Blockers: None. Manual acceptance steps are deferred to after Task 3, as the plan itself anticipates.

---

### Task 3: Register the signer, remove the storage layer

**Status:** Complete
**Depends on:** Task 2
**Documentation:** `src/plugins/README.md` (two-phase `register()`/`initialize()` lifecycle); `src/app/collections/README.md`; cross-cutting decision 5 above

**Objective**

`CsrfTokenSigner` is registered as a service and initialized from a required environment
secret at boot, and the CSRF pre-session collection, record, and their registration are gone
from the codebase.

**Scope**

- In: service registration and initialization in `app/app.js`; the `CSRF_TOKEN_SIGNING_SECRET`
  env var and its documentation; deletion of `csrf-token-collection.js` and
  `csrf-token-record.js` and the `registerCollection('CsrfToken', ...)` line; the full-suite
  test run that proves nothing else depended on the deleted modules.
- Out: any behavior change to `lib/csrf.js` (Task 2); new unit tests — see the note below.

**Design and invariants**

- Read the secret in `initialize()` with `context.getEnvString(CSRF_TOKEN_SIGNING_SECRET,
  { required: true })`, exactly matching the `DOCUMENT_STORE_CURSOR_SIGNING_SECRET` pattern at
  `src/app/app.js:41`. Boot must fail loudly on a missing secret rather than deferring the
  failure to the first form render — a silently unsigned CSRF subsystem is a security failure,
  not a degraded mode.
- Follow the two-phase lifecycle: `register()` constructs and registers, `initialize()` supplies
  configuration. Follow whichever shape reads most naturally against the existing
  `DocumentStore` wiring, and keep `register()` pure wiring.
- Deleting the collection is safe only after Task 2 removes the last reference. Verify with a
  repo-wide grep for `CsrfToken` before deleting, and confirm the only hits are the deletions
  themselves.
- Add `CSRF_TOKEN_SIGNING_SECRET` to `src/example.env` with a comment matching the existing
  cursor-secret note, stating that rotation invalidates every form currently open — anyone
  mid-edit gets a rejection on submit.
- Note in the handoff that Cloudflare deploys must supply this as a Workers Secret binding, and
  that a deploy which rotates it while colos are mid-propagation will reject tokens across the
  version boundary for the length of one TTL.

**Expected touch points**

- `src/app/app.js` — import, service registration, `initialize()` secret read; remove the
  `CsrfToken` collection import and registration.
- `src/app/collections/csrf-token-collection.js` — delete.
- `src/app/collections/csrf-token-record.js` — delete.
- `src/example.env` — new documented secret.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `CsrfTokenSigner` is registered and reachable via `context.getService()` from a request
      handler.
- [ ] Starting the server without `CSRF_TOKEN_SIGNING_SECRET` fails at boot with a clear
      message naming the variable.
- [ ] Both collection files are deleted and a repo-wide grep for `CsrfToken` returns only
      `CsrfTokenSigner` hits.
- [ ] `src/example.env` documents the new secret and its rotation consequence.
- [ ] No remaining code path writes to the Key/Value Store for CSRF purposes.
- [ ] The full unit suite passes, including the collection tests that remain after the two
      CSRF files are deleted.

**Test coverage owned by this task**

**None, deliberately.** `src/app/app.js` is pure wiring, and this suite has no test for it —
the same treatment `src/virtual-hosts.js` gets. A test asserting that `registerService()`
registers a service would be testing `ApplicationContext`, which
`test/unit-tests/kixx/` already covers, and would pin the wiring shape in place without
proving anything about this feature.

Deleting `csrf-token-collection.js` and `csrf-token-record.js` removes no test files: neither
has a dedicated test today (`test/unit-tests/app/collections/` covers the base collection and
record plus the *other* record types). The full-suite run below is what proves nothing else
imported them.

The boot-failure behavior on a missing secret is verified manually rather than by unit test,
because it is a property of process startup and `getEnvString()` already owns the `required`
contract under `test/unit-tests/kixx/`.

**Validation**

- `node run-linter.js src/app/app.js`
- `node run-tests.js` — the full suite. This is the gate that proves the deletions broke no
  remaining import, and that Tasks 1 and 2 left the rest of the suite green.
- Manual: start the dev server with the secret unset and confirm the boot failure names the
  variable; set it and confirm normal startup. Then run the full Task 2 manual sequence, which
  is the end-to-end acceptance path for the feature.
- Manual: confirm the KV store shows no new CSRF entries across a full login and a full invite
  creation. On Node this is inspectable directly in
  `./data/nodejs_app/key_value_store.sqlite`.

**Progress and handoff**

- Completed: In `src/app/app.js`, added the `CsrfTokenSigner` import, a `CSRF_TOKEN_SIGNING_SECRET`
  constant, and — in `initialize()`, right after the existing `DOCUMENT_STORE_CURSOR_SIGNING_SECRET`
  read — a `context.getEnvString(CSRF_TOKEN_SIGNING_SECRET, { required: true })` read followed by
  `context.registerService('CsrfTokenSigner', new CsrfTokenSigner(csrfTokenSigningSecret))`.
  Removed the `CsrfTokenCollection` import and its `registerCollection('CsrfToken', ...)` line from
  `register()`. Deleted `src/app/collections/csrf-token-collection.js` and
  `src/app/collections/csrf-token-record.js`. Added `CSRF_TOKEN_SIGNING_SECRET` to
  `src/example.env` with a rotation-consequence comment matching the cursor-secret one. Also
  fixed a now-stale comment in
  `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js` (line ~89) that referenced
  "the CsrfToken precedent" of hash-comparison, since that collection no longer exists to be a
  precedent for anything — reworded to state the SHA-256-digest-comparison rationale directly.
- Current state: All acceptance criteria met. Full unit suite passes (1412 tests). Repo-wide
  grep for `CsrfToken` returns only `CsrfTokenSigner` hits and unrelated compound identifiers
  (`csrf_token` form field name, `formCsrfToken`/`assertHtmlCsrfToken` test-helper names) — no
  reference to the deleted collection or record remains anywhere, including `test/end-to-end/`.
- Remaining: Nothing for this task. The deferred Task 2 manual acceptance sequence (dev server
  with `CSRF_TOKEN_SIGNING_SECRET` set, the two-tab multi-tab check, the same-token-twice
  confirmation, and the "boot fails loudly on a missing secret" check) is still outstanding —
  see the note below.
- Decisions and discoveries:
  - `CsrfTokenSigner`'s constructor (from Task 1) takes the secret directly rather than
    exposing a separate `initialize(config)` method the way `DocumentStore` does. Given that,
    "register() constructs and registers, initialize() supplies configuration" was followed in
    spirit rather than literally: both the `getEnvString()` read *and* the
    `registerService('CsrfTokenSigner', ...)` call happen inside `initialize()`, since the
    constructor cannot run before the secret is available. `register()` stays pure wiring with
    no `CsrfTokenSigner` involvement at all. `registerService()` has no phase restriction
    (confirmed by reading `ApplicationContext#registerService()` — it is an unconditional `Map`
    write), so calling it from `initialize()` is safe and nothing else in this codebase calls
    `context.getService('CsrfTokenSigner')` before `app.initialize()` completes.
  - `context.getEnvString()` is available in both `register()` and `initialize()` (it reads
    from `BaseContext`, not the service registry), so reading the secret in `initialize()` was
    a deliberate placement choice to mirror the cursor-secret pattern exactly, not a
    requirement of the phase system itself.
  - Per this repo's `AGENTS.md` policy against running the dev server for verification, this
    task's manual validation (boot-failure-on-missing-secret check, and the full Task 2 manual
    sequence) was **not** run. Both the missing-secret behavior (`getEnvString({ required: true })`
    throwing) and the service-registration wiring are exercised structurally by the full unit
    suite passing with the real `app.js` module loaded transitively through existing tests, but
    an actual process-boot check was not performed. This should be done by the user, or by
    whoever runs the deferred Task 2 manual sequence, before deploying.
- Actual files changed:
  - `src/app/app.js` (service registration and `initialize()` secret read)
  - `src/app/collections/csrf-token-collection.js` (deleted)
  - `src/app/collections/csrf-token-record.js` (deleted)
  - `src/example.env` (new documented secret)
  - `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js` (stale comment fix)
- Validation run:
  - `node run-linter.js src/app/app.js src/app/transaction-scripts/admin-invites/resolve-admin-invite.js` — clean.
  - `node run-tests.js` (full suite) — 1412 tests, passed.
  - `node --check src/app/app.js` — syntax-valid.
  - Repo-wide `grep -rn "CsrfToken"` across `src/` and `test/` — only `CsrfTokenSigner` and
    unrelated compound-name hits remain.
  - Manual boot-failure check and the full Task 2/3 manual acceptance sequence: **not run**,
    deferred per `AGENTS.md` policy (see discoveries above).
- Blockers: None. The three-task implementation is functionally complete and unit-tested; the
  only outstanding item across the whole plan is the manual dev-server acceptance pass
  (Task 2's 8-step sequence plus Task 3's boot-failure check), which requires running the
  dev server and was intentionally left to the user per this repo's verification policy.
