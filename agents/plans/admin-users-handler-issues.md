Admin Users Request Handlers — Issue Tracker
============================================

Current-state review of
`src/app/presentation/request-handlers/admin-panel/admin-users.js` and its
rendering path.

This tracker was refreshed after the Hyperview refactor landed. The original
blocking findings no longer apply: the application has a working
`HyperviewPageHandler`, route manifests provide `baseTemplateId`, and HTML
error pages use the shared presentation facade. Remaining work is limited to
the admin-users handler and its missing unit coverage.

Implementation Approach
-----------------------

Resolve ADMIN-1 with the maintainer before changing login behavior. ADMIN-3
and ADMIN-4 are independent cleanups and may proceed without that decision.
Each implementation task adds focused tests in a new admin-users handler test
file; no such tests exist today.

HTTP status codes are part of the security surface. Invalid credentials and
throttled login attempts render at 200 deliberately so they do not expose a
credential-validity signal. Invalid form shape renders at 422, and openly
reported signup conflicts render at 409.

For JavaScript changes, run focused tests and linting first, then the full unit
suite as required by the project README. Do not use the development server or
end-to-end tests for verification.


Current-State Audit
-------------------

These original findings are resolved and are not implementation tasks:

- **Hyperview route adapter:**
  `src/app/presentation/request-handlers/hyperview/hyperview-page-handler.js`
  delegates to `respondWithHyperviewPage()`. It is documented and wired into
  `src/virtual-hosts.js` and `src/routes/admin-panel.js`.
- **Base template ownership:** full-page routes pass a literal
  `baseTemplateId`. No `src/pages/**/page.json` retains the obsolete
  `baseTemplate` metadata key.
- **HTML error rendering:** `renderHtmlErrorPage()` sets fixed rendering
  options and calls `respondWithHyperviewPage()`. It disables JSON responses
  and page caching, preserves the expected-render-failure cascade, and has
  focused unit coverage.
- **Signup gate ordering:** `postNewAdminUserForm()` documents why a valid
  session short-circuits before body parsing and why throttling runs before
  CSRF form parsing. No submission path parses the body before throttling.

The old plan's references to `HyperviewDynamicPageHandler`,
`HyperviewStaticPageHandler`, `respondWithHypertext()`, and
`hyperview-request-handlers.js` describe superseded APIs.


### Task ADMIN-1: Define login behavior for an existing session

**Status:** Not started
**Depends on:** None
**Documentation:** `src/app/presentation/README.md`,
`src/docs/server-error-handling.md`

**Objective**

Make both login handlers explicit about requests carrying a valid admin
session. Signup GET and POST short-circuit to an already-logged-in state;
login GET and POST currently proceed without a session check. Successful
login POST creates a replacement session and cookie.

This is a product decision, not a mechanical consistency fix. Re-login may be
intentional, but the policy should be recoverable from the code.

**Scope**

- In: decide and implement valid-session behavior for
  `getAdminUserLoginForm()` and `postAdminUserLoginForm()`.
- In: template support if login gains an already-logged-in state.
- In: focused unit coverage for the chosen GET and POST behavior.
- Out: session creation, authentication, and cookie lifecycle internals.
- Out: signup behavior, which already gates valid sessions.

**Design and invariants**

- Obtain a maintainer decision: deliberately permit re-login or short-circuit
  both login handlers coherently.
- If re-login remains allowed, explain why replacing the session is intended.
- If login is gated, preserve failure behavior for requests without a valid
  session.
- `hasValidAdminSession()` treats only `UnauthenticatedError` as an invalid
  session and propagates unexpected failures.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` — policy.
- `src/templates/pages/login/admin/new/page.html` — only if needed.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — coverage.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Login GET and POST follow a documented, coherent existing-session
      policy.
- [ ] Valid, absent, and invalid session cookies are covered where applicable.
- [ ] Invalid credentials and throttling remain 200; malformed form data
      remains 422.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — proves session policy and status invariants.
- `node run-linter.js src/app/presentation/request-handlers/admin-panel/admin-users.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — checks changed JavaScript.
- `node run-tests.js` — required full unit suite.

**Progress and handoff**

- Completed: Current behavior and the signup/login asymmetry were reverified.
- Current state: Awaiting a product decision.
- Remaining: Decide, implement, document, and test the policy.
- Decisions and discoveries: Login GET and POST perform no session check. A
  successful POST creates a new session and replaces the cookie.
- Actual files changed: None yet.
- Validation run: Read-only source review only.
- Blockers: Maintainer must decide whether re-login is intended.


### Task ADMIN-3: Replace unreachable status fallbacks

**Status:** Not started
**Depends on:** None
**Documentation:** `src/docs/server-error-handling.md`,
`src/kixx/errors/README.md`

**Objective**

Replace four `error.httpStatusCode || 500` assignments in `admin-users.js`
with the guaranteed outcome status: 422 for form validation and 409 for the
two signup conflicts.

The fallback suggests that normally rendered branches may become 500
responses. Validation branches catch `ValidationError`; the conflict codes
are created as `ConflictError` by `create-admin-user-account.js`.

**Scope**

- In: four status assignments in `admin-users.js`.
- In: assertions for all four statuses and deliberate 200 login branches.
- Out: the general fallback in `lib/csrf.js` and the JSON API error handler,
  where possible errors are broader.
- Out: error classes and Transaction Scripts.

**Design and invariants**

- Use literal 422 and 409 because the handler owns these HTTP semantics.
- Preserve 422 for signup and login validation, 409 for
  `InviteSpentInEmailRace` and `NewUserConflictError`, and 200 for invalid
  credentials and throttling.
- Do not broaden caught-error matching or absorb unexpected errors.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` — status
  assignments.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — coverage.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No `error.httpStatusCode || 500` remains in `admin-users.js`.
- [ ] Affected branches respond with 422, 409, 409, and 422.
- [ ] Invalid-credentials and throttled login branches remain 200.
- [ ] Unexpected errors still propagate.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — proves status and propagation behavior.
- `node run-linter.js src/app/presentation/request-handlers/admin-panel/admin-users.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — checks changed JavaScript.
- `node run-tests.js` — required full unit suite.

**Progress and handoff**

- Completed: Reverified all four occurrences and originating error contracts.
- Current state: Ready for implementation.
- Remaining: Replace assignments and add focused tests.
- Decisions and discoveries: No admin-users handler unit test exists; the old
  tracker's claim that existing assertions prove these statuses is false.
- Actual files changed: None yet.
- Validation run: Read-only source review only.
- Blockers: None.


### Task ADMIN-4: Remove the dead already-logged-in prop

**Status:** Not started
**Depends on:** ADMIN-1 only if ADMIN-1 adds this state to the login page;
otherwise none
**Documentation:** `src/templates/README.md`

**Objective**

Make `renderAlreadyLoggedIn()` set only state its template consumes. It
currently returns `{ alreadyLoggedIn: true, inviteValid: false }`, but the
signup template's `alreadyLoggedIn` branch bypasses `inviteValid`.

**Scope**

- In: remove `inviteValid` from `renderAlreadyLoggedIn()`.
- In: focused coverage of returned props.
- Out: other no-form helpers; their `inviteValid: false` values select live
  template branches.

**Design and invariants**

- Already-authenticated signup output must remain unchanged.
- Recheck ownership after ADMIN-1 if the helper is shared with login.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` — props.
- `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — coverage.

Treat this list as orientation, not permission to ignore other necessary
files. Record actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The helper sets no unused template-selection prop.
- [ ] The already-logged-in signup page renders unchanged.
- [ ] Other no-form helpers retain `inviteValid: false`.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — proves state through exported handlers.
- `node run-linter.js src/app/presentation/request-handlers/admin-panel/admin-users.js test/unit-tests/app/presentation/request-handlers/admin-panel/admin-users.test.js`
  — checks changed JavaScript.
- `node run-tests.js` — required full unit suite.

**Progress and handoff**

- Completed: Reverified the helper against the current signup template.
- Current state: Ready for implementation, subject to ADMIN-1's shape.
- Remaining: Remove the prop and add focused coverage.
- Decisions and discoveries: The `alreadyLoggedIn` branch remains
  self-contained; `inviteValid` is not evaluated on that path.
- Actual files changed: None yet.
- Validation run: Read-only source and template review only.
- Blockers: None unless ADMIN-1 changes helper ownership.


Reviewed and Rejected
---------------------

**The already-logged-in signup render needs `links.loginForm`.** It does not.
The branch is self-contained; all `links.loginForm` reads are in the alternate
branch.

**The invite-guess counter should advance for every non-redeemable token.** It
should not. Expired, revoked, or spent real invites still resolve to stored
records. Only a non-empty token matching no record is a guess.
