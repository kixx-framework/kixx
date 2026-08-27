# CSRF End-to-End Coverage

## Implementation Approach

Consolidate explicit CSRF testing under `test/end-to-end/010-csrf/` so the
security contract is discoverable and reviewable as one suite:

| File | Responsibility |
| --- | --- |
| `010-form-lifecycle.test.js` | Token envelope, cookie policy, SID stability, multi-tab behavior, token reuse, and fresh tokens after validation errors. |
| `020-authentication-boundary.test.js` | Login/signup rejection, session-cookie policy, and clearing the pre-authentication CSRF cookie. |
| `030-admin-mutations.test.js` | Invalid-token matrix plus invite and Publishing API token create/revoke protection. |
| `040-api-boundary.test.js` | Admin browser cookies cannot authenticate Admin or Publishing API mutations. |

Reusable infrastructure remains in `test/end-to-end/test-helpers/`. Centralizing
test intent does not mean removing every `csrf_token` reference elsewhere:
ordinary form workflow tests must still carry a valid cookie and token to reach
the behavior they actually test. Those files should not independently assert
CSRF policy, rejection variants, or lifecycle details after this suite owns
them.

Every file under `010-csrf/` must be independently runnable. It may use shared
authentication and HTTP helpers, but it must not read variables or depend on
records created by another test file. Use random identifiers for created state
and clean up invites or API tokens within the same file where practical.

The current protected HTML POST inventory is:

| Route | Handler | Invalid-CSRF response |
| --- | --- | --- |
| `POST /login/admin/new` | `postAdminUserLoginForm` | Generic 403 error page |
| `POST /users/admin/new` | `postNewAdminUserForm` | Generic 403 error page |
| `POST /admin/invites` | `postCreateAdminInvite` | 403 list re-render with a fresh token and `form_expired` notice |
| `POST /admin/invites/revoke` | `postRevokeAdminInvite` | 303 redirect to `/admin/invites?notice=form_expired` |
| `POST /admin/publishing-api-tokens` | `postCreatePublishingApiToken` | 403 list re-render with a fresh token and `form_expired` notice |
| `POST /admin/publishing-api-tokens/revoke` | `postRevokePublishingApiToken` | 303 redirect to `/admin/publishing-api-tokens?notice=form_expired` |

Use Publishing API token creation for the comprehensive invalid-input matrix.
It exercises the shared validator behind an authenticated mutation and renders a
recoverable 403. Give every other protected handler one missing-token regression
test because protection is adopted explicitly per handler; repeating the entire
matrix at all six routes would not cover another cryptographic path.

Lifecycle tests must avoid persistent side effects. Submit a deliberately invalid
`time_to_live_seconds` with a valid CSRF pair: 422 proves CSRF validation passed
while stopping before token creation. Reuse the original token for two such
submissions to prove it is not consumed. Render between mint and submission to
prove an earlier tab remains valid.

Rejected mutation tests must prove both the HTTP outcome and absence of domain
effects. Compare rendered record ids before and after rejected creates. For a
rejected revoke, confirm the target remains present, then revoke it successfully
to clean up and prove the rejection did not act.

The suite uses `fetch` and manually assembled `Cookie` headers. It can verify
`Set-Cookie` policy, but cannot prove real-browser enforcement of `SameSite=Lax`.
A 30-minute expiration wait, startup without `CSRF_TOKEN_SIGNING_SECRET`, and
deployment-wide signing-secret rotation are also outside the normal end-to-end
run. Keep malformed, forged, missing, and SID-mismatched coverage here; leave
cryptographic and deployment mechanics to unit or controlled integration tests.

Agent verification remains subject to the project rule forbidding the agent from
starting the development server or calling remote servers. The end-to-end
commands below are operator/CI checks against an already supplied target. The
implementing agent runs linting and records the end-to-end checks as not run when
no permitted target is available.

### Task C1: CSRF-aware end-to-end helpers

**Status:** Complete
**Depends on:** None
**Documentation:** `docs/cross-site-request-forgery.md`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `test/end-to-end/README.md`

**Objective**

Shared end-to-end support code can construct adversarial cookie combinations and
assert the complete public cookie and token-envelope contract without duplicating
protocol parsing in scenario files.

**Scope**

- In: selective cookie-header construction; CSRF and admin-session cookie-policy
  assertions; raw cleared-cookie assertion; public CSRF envelope decoding;
  rendered record-id extraction only when shared by several scenarios.
- Out: application behavior, browser automation, and HTTP scenarios owned by
  C2-C5.

**Design and invariants**

- Preserve `CookieJar` ownership of stored cookie state. Extend its public API so
  callers can include a named subset of live cookies without exposing the private
  map or duplicating serialization.
- Keep existing no-argument `cookieHeader()` behavior backward compatible.
- Derive expected `Secure` values from `E2E_TESTS_BASE_URL`: true for HTTPS and
  false for HTTP.
- The CSRF cookie assertion covers non-empty value, `Path=/`, `Max-Age=1800`,
  `HttpOnly`, `SameSite=Lax`, absent `Domain`, and conditional `Secure`.
- The admin session assertion covers non-empty value, `Path=/`, `HttpOnly`,
  `SameSite=Lax`, absent `Domain`, conditional `Secure`, and the configured
  session lifetime.
- Inspect raw `Set-Cookie` headers for deletion before `CookieJar` discards an
  expired entry. Require an empty CSRF value, `Max-Age=0`, `Path=/`, `HttpOnly`,
  `SameSite=Lax`, absent `Domain`, and conditional `Secure`.
- Token decoding asserts exactly two base64url segments, a JSON object payload,
  non-empty `sid`, and integer `exp`. Do not verify the HMAC in end-to-end code.
- Exported APIs receive concise JSDoc describing arguments, returns, and mutation.
  Private parsing helpers use inline comments only for non-obvious protocol
  decisions.

**Expected touch points**

- `test/end-to-end/test-helpers/cookie-jar.js` — named-cookie header support.
- `test/end-to-end/test-helpers/lib.js` — cookie, clearing, envelope, and shared DOM assertions.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Existing calls to `cookieHeader()` still send every live cookie.
- [x] Tests can send only the admin session, only the CSRF cookie, or both without
      reading private jar state.
- [x] CSRF and admin-session assertions cover host-only and conditional-Secure
      policy in addition to existing attributes.
- [x] Authentication responses can be checked for the exact CSRF deletion cookie
      before it is applied to the jar.
- [x] Rendered token payloads can be compared with cookie SIDs and expected
      expiration windows without the signing key.

**Validation**

- `node run-linter.js test/end-to-end/test-helpers` — helper source follows project style.
- C2-C5 end-to-end validations — exercise every new public helper through real responses.

**Progress and handoff**

- Completed: Added selective live-cookie headers, public CSRF and admin-session policy assertions, raw CSRF-clearing assertions, public token-envelope decoding, and shared rendered-record-id extraction.
- Current state: Complete.
- Remaining: Nothing for C1.
- Decisions and discoveries: `CookieJar` remains the sole owner of live cookie state. `assertCsrfCookieCleared()` inspects raw response `Set-Cookie` headers because applying a `Max-Age=0` cookie correctly removes it from the jar.
- Actual files changed: `test/end-to-end/test-helpers/cookie-jar.js`; `test/end-to-end/test-helpers/lib.js`; `agents/plans/csrf-end-to-end-coverage.md`.
- Validation run: `node run-linter.js test/end-to-end/test-helpers` (passed); `git diff --check` (passed). End-to-end validations are deferred to C2-C5 and require an operator-supplied running target.
- Blockers: None.

### Task C2: Form lifecycle scenarios

**Status:** Complete
**Depends on:** C1
**Documentation:** `docs/cross-site-request-forgery.md#form-rendering`, `docs/cross-site-request-forgery.md#token-lifecycle`, `docs/cross-site-request-forgery.md#reusable-browser-wide-tokens`, `docs/cross-site-request-forgery.md#cookie-compatibility`

**Objective**

One independently runnable scenario file proves the rendering, cookie, multi-tab,
and reusable-token lifecycle without creating persistent application records.

**Scope**

- In: token wire format, expiration window, full CSRF cookie policy, SID reuse,
  fresh token per render, earlier-tab validity, token reuse, and fresh tokens on
  ordinary validation errors.
- Out: authentication-boundary clearing (C3), invalid-CSRF matrix (C4), APIs
  (C5), real-browser SameSite, actual 30-minute waits, secret rotation.

**Design and invariants**

- Authenticate through shared setup, then GET
  `/admin/publishing-api-tokens`. Capture token A and SID A; issue a second GET
  with the same jar and capture token B and SID B.
- Assert SID A equals SID B, token A differs from token B, each payload SID equals
  its cookie SID, and each expiration is approximately 1,800 seconds after its
  response. Allow a small clock/request-duration tolerance.
- Submit token A after the second render with a non-integer
  `time_to_live_seconds`. A 422 rather than 403 proves the earlier tab's token
  remains valid. Assert no plaintext `new-token` value exists.
- Submit the same token A and invalid business payload again. Another 422 proves
  validation does not consume the token.
- Assert both 422 responses mint distinct fresh tokens, retain the SID, and
  refresh the cookie's 1,800-second lifetime.
- Do not create an invite, user, or Publishing API token in this file.

**Expected touch points**

- `test/end-to-end/010-csrf/010-form-lifecycle.test.js` — new lifecycle scenarios.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Token payload SID and expiration agree with the documented cookie and
      30-minute lifetime.
- [x] Two renders retain the SID and mint distinct tokens.
- [x] A token minted before the second render still passes CSRF validation.
- [x] The same valid token passes CSRF validation twice.
- [x] Each 422 re-render supplies a fresh token bound to the same SID.
- [x] No scenario creates persistent domain state.
- [x] The file is self-contained and does not read state from another end-to-end scenario file.

**Validation**

- `node run-linter.js test/end-to-end/010-csrf/010-form-lifecycle.test.js` — file is lint-clean.
- `node run-tests.js --e2e --development test/end-to-end/010-csrf/010-form-lifecycle.test.js` — operator/CI independent-file check against an already running target.

**Progress and handoff**

- Completed: Added a self-contained lifecycle scenario covering token envelope lifetime, stable SIDs, multi-tab tokens, reusable tokens, 422 fresh tokens, and absence of the one-time plaintext token field.
- Current state: Complete with the operator/CI end-to-end exception below.
- Remaining: Nothing for C2.
- Decisions and discoveries: Invalid `time_to_live_seconds` produces the required 422 business-validation response without creating a Publishing API token. The test preserves token A across a second render and both invalid submissions.
- Actual files changed: `test/end-to-end/010-csrf/010-form-lifecycle.test.js`; `agents/plans/csrf-end-to-end-coverage.md`.
- Validation run: `node run-linter.js test/end-to-end/010-csrf/010-form-lifecycle.test.js` (passed); `git diff --check` (passed). `node run-tests.js --e2e --development test/end-to-end/010-csrf/010-form-lifecycle.test.js` not run: project instructions reserve end-to-end checks for an operator/CI supplied, already running target and forbid this agent from starting a server or calling remote servers.
- Blockers: None. Operator/CI should run the listed independent-file command against its target.

### Task C3: Authentication boundary scenarios

**Status:** Complete
**Depends on:** C1
**Documentation:** `docs/cross-site-request-forgery.md#form-submission`, `docs/cross-site-request-forgery.md#token-lifecycle`, `src/app/presentation/README.md#csrf-protected-html-forms`

**Objective**

One independently runnable file proves login and signup reject missing CSRF data
before authentication state changes, then clear pre-authentication CSRF state when
the same workflows succeed.

**Scope**

- In: login and signup missing-token rejection; absence of session/account/invite
  side effects; successful retry; admin session cookie policy; CSRF deletion.
- Out: authenticated admin mutations (C4), API boundaries (C5), login throttling
  and invite semantics beyond what proves CSRF ordering.

**Design and invariants**

- Login: render the form, submit valid credentials without `csrf_token`, assert a
  generic 403 and no admin session, then submit the original valid cookie/token
  pair and assert successful login.
- Signup: create a unique invite within this file, render its form, submit valid
  unique account fields without `csrf_token`, assert 403 and no admin session,
  then redeem the same invite successfully. The successful retry proves the
  rejection did not consume the invite or create the account.
- Inspect each success response before applying it to the jar. Assert the complete
  admin session cookie policy and exact CSRF deletion cookie; after applying it,
  assert the jar contains the admin session and no CSRF cookie.
- Use unique credentials. Do not depend on the account or invite created by
  `001-sanity-checks` or another `010-csrf` file.
- Move explicit login/signup CSRF policy and clearing assertions out of existing
  sanity tests. Leave token extraction and submission there as workflow mechanics.

**Expected touch points**

- `test/end-to-end/010-csrf/020-authentication-boundary.test.js` — new login/signup boundary scenarios.
- `test/end-to-end/001-sanity-checks/010-admin-user-auth.test.js` — remove superseded CSRF-specific assertions while retaining valid form setup.
- `test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js` — remove superseded signup CSRF-specific assertions while retaining valid form setup.
- `test/end-to-end/test-helpers/authenticate.js` — only if independently creating an invite needs a reusable workflow primitive with a clear contract.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Login without a token returns 403, creates no session, and does not prevent
      a later valid login.
- [x] Signup without a token returns 403, creates no session, and leaves its
      invite redeemable by the later valid submission.
- [x] Successful login and signup set policy-compliant admin session cookies and
      clear their CSRF cookies with `Max-Age=0`.
- [x] Explicit authentication CSRF assertions live in this file, not the sanity
      workflow tests.
- [x] The file is self-contained and creates its own invite and credentials.

**Validation**

- `node run-linter.js test/end-to-end/010-csrf/020-authentication-boundary.test.js test/end-to-end/001-sanity-checks/010-admin-user-auth.test.js test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js` — changed files are lint-clean.
- `node run-tests.js --e2e --development test/end-to-end/010-csrf/020-authentication-boundary.test.js` — operator/CI independent-file check against an already running target.

**Progress and handoff**

- Completed: Added self-contained login and signup missing-token scenarios, raw CSRF-clearing and session-cookie checks, and a reusable invite creation helper. Removed superseded CSRF policy assertions from sanity workflow tests while retaining token extraction and submission.
- Current state: Complete with the operator/CI end-to-end exception below.
- Remaining: Nothing for C3.
- Decisions and discoveries: A successful signup consumes the file-local invite, so no cleanup is required. Both successful authentication responses are asserted before their jars apply the `Max-Age=0` CSRF deletion cookie; the original valid token then proves each prior 403 caused no authentication side effect.
- Actual files changed: `test/end-to-end/010-csrf/020-authentication-boundary.test.js`; `test/end-to-end/test-helpers/authenticate.js`; `test/end-to-end/001-sanity-checks/010-admin-user-auth.test.js`; `test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js`; `agents/plans/csrf-end-to-end-coverage.md`.
- Validation run: `node run-linter.js test/end-to-end/010-csrf/020-authentication-boundary.test.js test/end-to-end/001-sanity-checks/010-admin-user-auth.test.js test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js test/end-to-end/test-helpers/authenticate.js` (passed); `git diff --check` (passed). `node run-tests.js --e2e --development test/end-to-end/010-csrf/020-authentication-boundary.test.js` not run: project instructions reserve end-to-end checks for an operator/CI supplied, already running target and forbid this agent from starting a server or calling remote servers.
- Blockers: None. Operator/CI should run the listed independent-file command against its target.

### Task C4: Admin mutation scenarios

**Status:** Complete
**Depends on:** C1
**Documentation:** `docs/cross-site-request-forgery.md#form-submission`, `docs/cross-site-request-forgery.md#request-handlers`, `src/app/presentation/README.md#csrf-protected-html-forms`

**Objective**

One independently runnable file proves the shared validator fails closed for all
documented attacker-controlled token variants and every current authenticated
HTML mutation handler explicitly adopts CSRF validation.

**Scope**

- In: comprehensive invalid matrix on Publishing API token creation; missing-token
  coverage for invite create/revoke and token create/revoke; recovery responses;
  non-mutation assertions; cleanup of valid test records.
- Out: login/signup (C3), APIs (C5), signer internals, production changes.

**Design and invariants**

- Obtain an authenticated admin through shared setup, but create every invite and
  API token used by these scenarios within this file.
- Against Publishing API token creation, submit otherwise valid fields with:
  - a missing `csrf_token` while both cookies are present;
  - a valid token with only the admin session cookie;
  - a malformed token;
  - a valid token with one signature character changed;
  - token A paired with CSRF SID B while retaining the valid admin session.
- Every matrix case returns the same recoverable 403 classification, does not
  reveal the failed cryptographic check, carries `form_expired`, and contains a
  fresh usable CSRF pair.
- Compare rendered token ids before and after the matrix. Absence of the one-time
  plaintext token field alone is not proof that mutation did not occur.
- Invite create: submit a valid role without a CSRF token, assert 403 and unchanged
  invite ids, then create one valid invite for the revoke scenario.
- Invite revoke: submit that id without a CSRF token, assert the exact 303
  `/admin/invites?notice=form_expired` redirect and that the invite remains listed;
  then revoke it validly to clean up.
- Token create is covered by the matrix. Create one valid token after the matrix
  for the revoke scenario.
- Token revoke: submit that id without a CSRF token, assert the exact 303
  `/admin/publishing-api-tokens?notice=form_expired` redirect and that the token
  remains listed; then revoke it validly to clean up.
- Move explicit invite/token CSRF assertions out of existing workflow tests.
  Continue extracting and submitting valid tokens there because those workflows
  require them.

**Expected touch points**

- `test/end-to-end/010-csrf/030-admin-mutations.test.js` — new matrix and authenticated handler scenarios.
- `test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js` — remove superseded invite CSRF assertions.
- `test/end-to-end/050-admin-panel/create-publishing-api-token.test.js` — remove superseded token CSRF assertions.
- `test/end-to-end/test-helpers/lib.js` — shared rendered-id extraction only if it belongs in reusable support.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Missing field, missing CSRF cookie, malformed token, altered signature, and
      SID mismatch all fail closed for an authenticated mutation.
- [ ] Invalid variants receive the same external classification and no detailed
      cryptographic failure signal.
- [ ] Rejected creates return 403 with a fresh token and create no record.
- [ ] Rejected revokes redirect with the exact notice and leave targets intact.
- [ ] Invite and token records created by this file are successfully cleaned up.
- [ ] Explicit admin-mutation CSRF assertions live in this file, not general
      workflow tests.
- [ ] The file passes when selected without any other end-to-end scenario file.

**Validation**

- `node run-linter.js test/end-to-end/010-csrf/030-admin-mutations.test.js test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js test/end-to-end/050-admin-panel/create-publishing-api-token.test.js` — changed files are lint-clean.
- `node run-tests.js --e2e --development test/end-to-end/010-csrf/030-admin-mutations.test.js` — operator/CI independent-file check against an already running target.

**Progress and handoff**

- Completed: Added a self-contained authenticated mutation suite covering missing fields and cookies, malformed tokens, altered signatures, SID mismatches, create/revoke rejection recovery, non-mutation checks, and cleanup. Removed the superseded CSRF-cookie policy assertion from the token workflow test while preserving form setup.
- Current state: Complete with the operator/CI end-to-end exception below.
- Remaining: Nothing for C4.
- Decisions and discoveries: Create rejections re-render a 403 with the "That form had expired" notice and fresh CSRF pair; revoke rejections retain post-redirect-get behavior with the `form_expired` query notice. The existing invite workflow test already limited CSRF usage to valid-form mechanics, so it needed no C4 edit.
- Actual files changed: `test/end-to-end/010-csrf/030-admin-mutations.test.js`; `test/end-to-end/050-admin-panel/create-publishing-api-token.test.js`; `agents/plans/csrf-end-to-end-coverage.md`.
- Validation run: `node run-linter.js test/end-to-end/010-csrf/030-admin-mutations.test.js test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js test/end-to-end/050-admin-panel/create-publishing-api-token.test.js` (passed); `git diff --check` (passed). `node run-tests.js --e2e --development test/end-to-end/010-csrf/030-admin-mutations.test.js` not run: user direction forbids end-to-end tests, and project instructions reserve them for an operator/CI supplied target.
- Blockers: None. Operator/CI should run the listed independent-file command against its target.
- Blockers: None.

### Task C5: Explicit-credential API boundary and suite documentation

**Status:** Complete
**Depends on:** C1, C4
**Documentation:** `docs/cross-site-request-forgery.md#request-handlers`, `test/end-to-end/README.md`

**Objective**

One independently runnable file proves browser session cookies do not authenticate
state-changing APIs, while suite documentation records the centralized coverage
model and its deliberate limits.

**Scope**

- In: cookie-only Admin and Publishing API rejection, non-mutation assertions,
  suite ownership audit, README coverage and limitations, full-suite handoff.
- Out: adding CSRF to APIs, changing API credentials or media types, browser
  automation, secret rotation, accelerated production expiration.

**Design and invariants**

- Send a simple form-style POST to the authenticated Admin API Publishing-token
  creation endpoint with a valid admin session cookie but no explicit API
  credential. Assert the API's unauthenticated response and unchanged HTML token
  list.
- Send a mutation-shaped request to one representative Publishing API route with
  the admin session cookie but no Publishing bearer token. Use the route's
  expected method and body so rejection proves missing credentials, not merely a
  method or media-type mismatch. Assert publication state is unchanged.
- Do not submit `csrf_token` to either API. The invariant is that browser cookies
  confer no API identity, not that APIs adopt HTML CSRF validation.
- Keep setup and state assertions local or in generic helpers; do not depend on a
  record or principal created by another `010-csrf` file.
- Audit end-to-end tests after consolidation. Literal token extraction and
  submission may remain in workflow files, but explicit CSRF descriptions,
  policy assertions, rejection matrices, and lifecycle assertions belong under
  `010-csrf/`.
- Update the end-to-end README with the four-file layout, six-route inventory,
  comprehensive-validator/per-handler split, independent-file invariant,
  operator/CI commands, and limitations.
- State that fetch-based tests do not prove browser SameSite enforcement and that
  normal runs do not wait 30 minutes, rotate secrets, or restart without a secret.

**Expected touch points**

- `test/end-to-end/010-csrf/040-api-boundary.test.js` — cookie-only API rejection.
- `test/end-to-end/README.md` — centralized coverage model, commands, and limitations.
- `test/end-to-end/test-helpers/publishing-api.js` — only if a read-only state assertion belongs in its existing client responsibility.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Admin browser cookies cannot authenticate an Admin API mutation without the
      API's explicit credential.
- [ ] Admin browser cookies cannot authenticate a Publishing API mutation without
      a Publishing bearer token.
- [ ] Both rejected requests leave state unchanged and do not use `csrf_token`.
- [ ] All four `010-csrf` files pass when selected independently.
- [ ] Outside `010-csrf`, CSRF references are limited to helpers and the mechanics
      required to complete non-CSRF form workflows.
- [ ] The README explains suite ownership, route coverage, limitations, and the
      permitted validation workflow.

**Validation**

- `node run-linter.js test/end-to-end` — all end-to-end JavaScript is lint-clean.
- `node run-tests.js --e2e --development test/end-to-end/010-csrf/040-api-boundary.test.js` — operator/CI independent-file check against an already running target.
- `node run-tests.js --e2e --development test/end-to-end/010-csrf` — operator/CI focused suite check.
- `node run-tests.js --e2e --development` — operator/CI full-suite regression check.
- `rg -n "CSRF|csrf" test/end-to-end --glob '*.test.js'` — review confirms explicit CSRF test intent is centralized; remaining outside matches are setup mechanics only.

**Progress and handoff**

- Completed: Added self-contained cookie-only Admin and Publishing API mutation rejection scenarios, audited CSRF references outside `010-csrf/`, and documented the centralized suite, commands, and limits.
- Current state: Complete with the operator/CI end-to-end exception below.
- Remaining: Nothing for C5.
- Decisions and discoveries: Admin API authentication fails before JSON:API parsing without HTTP Basic credentials; Publishing API authentication fails before its `PUT` handler without a bearer token. The cookie-only requests intentionally omit `csrf_token`, because the asserted boundary is explicit API credentials rather than HTML-form CSRF validation.
- Actual files changed: `test/end-to-end/010-csrf/040-api-boundary.test.js`; `test/end-to-end/README.md`; `agents/plans/csrf-end-to-end-coverage.md`.
- Validation run: `node run-linter.js test/end-to-end` (passed); `git diff --check` (passed); `rg -n "CSRF|csrf" test/end-to-end --glob '*.test.js'` (reviewed; matches outside `010-csrf/` are form workflow setup or its explanatory mechanics). The independent-file, focused-suite, and full end-to-end commands were not run: user direction forbids end-to-end tests, and project instructions reserve them for an operator/CI supplied target.
- Blockers: None. Operator/CI should run the C2-C5 independent-file commands, then the focused and full suite commands listed above.
