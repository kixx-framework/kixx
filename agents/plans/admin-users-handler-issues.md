Admin Panel Presentation Layer — Issue Tracker
=============================================

Findings from a review of
`src/app/presentation/request-handlers/admin-panel/admin-users.js` and the
Hyperview rendering path those handlers depend on.

One issue is blocking: the module's request handlers are still wired to a
page-handler API that no longer exists, so the app cannot boot. The rest
are consistency and dead-code defects in `admin-users.js` — places where
two sibling handlers disagree about the order of their gates, or where a
fallback can never be taken. Those are tracked because the next person to
edit the module will otherwise have to re-derive the same reasoning to
decide whether the asymmetry was deliberate.

Implementation Approach
-----------------------

**Do HV-1 through HV-3 first.** They are not optional cleanup: nothing
runs until they land. HV-2 rewrites the bodies of the same handlers that
ADMIN-1 and ADMIN-2 modify, so taking the ADMIN tasks first guarantees
rework. ADMIN-3 and ADMIN-4 are independent and can be done at any point.

The four ADMIN issues are independent of each other. Each is small — none
should exceed a handful of lines — so the cost is concentrated in
deciding the intended behavior, not in writing it. Two of them (ADMIN-1,
ADMIN-2) are genuine behavior questions that need a decision from the
maintainer before code is written; the other two (ADMIN-3, ADMIN-4) are
unambiguous cleanups.

The cross-cutting invariant for the admin-users module: **HTTP status
codes are part of the security surface.** Invalid credentials and
throttled login both render at 200 deliberately, so neither leaks account
existence, while a malformed submission reports 422. Any change here must
preserve that asymmetry rather than "normalizing" it.

Verification for every task: `node run-linter.js` and `node run-tests.js`
(see README.md).


### Task HV-1: Decide how callers supply `baseTemplateId`

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/hyperview/hyperview-service.js` (class doc,
lines 66-119 and the `respondWithHypertext` JSDoc), `src/app/presentation/README.md`

**Objective**

There is one decided, written-down answer to where `baseTemplateId` comes
from for a full-page render, before any call site is migrated. Every
later task applies that answer.

`HyperviewService#respondWithHypertext` asserts `options.baseTemplateId`
is a valid pathname (lines 599-604) *before* the page is loaded, so it
cannot read the id out of page metadata. The removed
`HyperviewStaticPageHandler` did exactly that: it took
`options.baseTemplate` as a default and let a page override it via
`metadata.baseTemplate` (recoverable at `git show e5903d8`). Seven page
data files still carry that key:

- `"baseTemplate": "admin.html"` — `src/pages/admin/page.json`,
  `src/pages/admin/errors/page.json`, `src/pages/admin/style-guide/page.json`
- `"baseTemplate": "admin-login.html"` — `src/pages/users/admin/page.json`,
  `src/pages/login/admin/page.json`, `src/pages/login/admin/errors/page.json`
- `"baseTemplate": "default.html"` — `src/pages/page.json`

They currently do nothing. Ancestor `page.json` files inherit down to
descendants, which is why three files cover far more than three pages —
whatever replaces this has to preserve that reach or explicitly drop it.

**Scope**

- In: the decision, and whatever small shared helper or convention it
  implies.
- In: updating or removing the now-inert `baseTemplate` keys in
  `src/pages/**/page.json` to match the decision.
- Out: migrating the call sites (HV-2, HV-3).
- Out: any change to `respondWithHypertext` itself unless the decision is
  specifically that the service should resolve the id — in which case
  that change belongs to this task and the assert at lines 599-604 has to
  move after `#getPage`.

**Design and invariants**

Three viable shapes, in rough order of preference:

1. **Each route passes its own literal.** Simplest and most explicit; the
   base template becomes a property of the route rather than the content.
   Costs repetition across ~15 call sites and silently drops per-page
   override.
2. **A small per-area helper** (e.g. one for the admin panel, one for the
   public site) that wraps `respondWithHypertext` with the area's
   `baseTemplateId` and cache policy. Keeps the repetition in one place
   and gives the ADMIN tasks a natural seam.
3. **The service resolves it from page metadata**, restoring the old
   behavior. Preserves the inheritance the seven `page.json` files
   already encode, but requires moving the assert past the page load and
   defining what happens when metadata names a template that the bundle
   does not contain.

Whichever is chosen, record *why* in this task's handoff notes — the next
reader will find the inert `baseTemplate` keys and ask.

- Do not leave the seven `page.json` keys in place as decoration. Either
  they are live again, or they are removed.

**Expected touch points**

- `src/pages/**/page.json` — the seven files above.
- A new shared helper module under `src/app/presentation/lib/`, if shape 2
  is chosen.
- `src/kixx/hyperview/hyperview-service.js` — only under shape 3.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The chosen mechanism is implemented and documented in
      `src/app/presentation/README.md`.
- [ ] No `page.json` carries a `baseTemplate` key that nothing reads.
- [ ] A full-page render reaching `respondWithHypertext` without a valid
      `baseTemplateId` fails loudly, not silently.

**Validation**

- `node run-linter.js`
- `node run-tests.js`
- Read-through: a reader of `src/app/presentation/README.md` can answer
  "which base template does this page use?" without reading the service.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The legacy `metadata.baseTemplate` override
  is recoverable at `git show e5903d8:src/kixx/hyperview/hyperview-request-handlers.js`.
  The intervening commits stubbed the module to no-op exports named
  `HyperviewStaticRequestHandler`/`HyperviewDynamicRequestHandler` — note
  the different names — so there is no working intermediate version to
  diff against.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: Needs a maintainer decision between the three shapes above.


### Task HV-2: Migrate route request handlers to `respondWithHypertext()`

**Status:** Not started
**Depends on:** HV-1
**Documentation:** `src/kixx/hyperview/hyperview-service.js`, `src/app/presentation/README.md`

**Objective**

Every route renders its page by calling
`context.getService('Hyperview').respondWithHypertext()` from the request
handler itself. The `HyperviewDynamicPageHandler()` /
`HyperviewStaticPageHandler()` entries disappear from the route tables,
and the app boots.

`src/kixx/hyperview/hyperview-request-handlers.js` was deleted, but
`src/virtual-hosts.js:1` and `src/routes/admin-panel.js:1` still import
from it. That import alone is fatal at startup.

**Scope**

- In: `src/virtual-hosts.js` — the import and the five handler entries at
  lines 45, 53, 70, 78, 131.
- In: `src/routes/admin-panel.js` — the import and the six handler entries
  at lines 16, 47, 56, 87, 96, 109.
- In: the four exported handlers in
  `request-handlers/admin-panel/admin-users.js`, which must now render
  rather than fall through.
- In: any other request handler that relied on a trailing page handler to
  produce its response.
- Out: `src/app/presentation/lib/html-error-page.js` (HV-3).

**Design and invariants**

- **The `skip()` contract inverts.** Today a handler returns
  `updateProps()` and lets the trailing page handler render, calling
  `skip()` only to suppress it before a redirect. Once handlers render
  themselves there is no trailing handler to suppress, so every
  `skip()`-before-redirect in `admin-users.js` (lines 276, 292, 407)
  needs re-examination rather than mechanical deletion — confirm what the
  router does with a handler that returns a completed response.
- **Status codes must survive.** `respondWithHypertext` renders with
  whatever status is already on the response (see its JSDoc), so the
  inline `response.status = ...` assignments still work — but the
  deliberate 200 on the invalid-credentials and throttled login branches
  is now this task's responsibility to preserve. Coordinate with ADMIN-3.
- **The JSON affordance changed shape.** The old handler keyed off
  `request.isJSONRequest()` (Accept header) *and* stripped a configurable
  format extension. The new service keys only off a literal `.json`
  pathname suffix gated by `allowJsonResponse` (lines 559-585). The
  `{.:suffix}` patterns in the route definitions were built for the old
  behavior and need checking against the new one.
- **Caching is now an option, not a separate function.** The routes that
  used `HyperviewStaticPageHandler` were the cacheable ones; that
  distinction is now `options.usePageCache`, defaulting to the
  constructor value. Losing track of which routes were static drops
  caching rather than breaking correctness.
- **Do not hand-roll the cache key for authenticated pages.** The service
  is already safe by default here: when caching is on,
  `includePropsInCacheKey` defaults to true (lines 546-557) specifically
  so a page rendered for one user is not served to the next, and
  `hashSet` canonicalizes and hashes the entire props tree, so two users
  with different props cannot collide. The migration only has to avoid
  *defeating* that — passing `includePropsInCacheKey: false`, or a
  `propsHashFunction` that omits the identifying fields. Neither can
  happen by omission; both require typing the opt-out. If a call site
  wants either, it needs a comment justifying why that page is
  user-independent.

**Expected touch points**

- `src/virtual-hosts.js`
- `src/routes/admin-panel.js`
- `src/app/presentation/request-handlers/admin-panel/admin-users.js`
- Other modules under `src/app/presentation/request-handlers/`

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No module imports `hyperview-request-handlers.js`.
- [ ] The server starts and every migrated route returns its page.
- [ ] Full-page, `skipBaseRender`, and `partial` render modes are each
      reachable from a route that needs them.
- [ ] The login POST invalid-credentials and throttled branches still
      respond 200; the validation branch still responds 422.
- [ ] No migrated call site passes `includePropsInCacheKey: false` or a
      custom `propsHashFunction` without a comment justifying it.
- [ ] Unit tests cover the migrated handlers.

**Validation**

- `node run-tests.js` — full suite, since the removed handlers were
  wired into most routes.
- `node run-linter.js`
- `grep -rn "hyperview-request-handlers" src/` returns nothing.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: HV-1.


### Task HV-3: Migrate the HTML error page renderer

**Status:** Not started
**Depends on:** HV-1
**Documentation:** `src/docs/server-error-handling.md`, `src/app/presentation/README.md`

**Objective**

`renderHtmlErrorPage` renders through `respondWithHypertext()` and keeps
its current contract: it returns `false` to continue the error cascade
for JSON requests and for expected render failures, and rethrows
unexpected ones.

`src/app/presentation/lib/html-error-page.js:68` calls
`HyperviewDynamicPageHandler({ pathname, allowJSON: false })(...)`. Both
the module and the option name are gone; the new equivalent is
`allowJsonResponse`.

**Scope**

- In: `src/app/presentation/lib/html-error-page.js`.
- Out: the error classification logic in the same file, which is
  unaffected.
- Out: the error handler modules that call it, unless the return contract
  changes.

**Design and invariants**

- The `try`/`catch` around the render is load-bearing: a failure to render
  the error page must not replace the original error with a render error.
  The `cause.expected` check (line 74) that downgrades to `false` has to
  survive.
- `respondWithHypertext` throws `NotFoundError` when no page exists at the
  pathname. That is exactly the case the existing catch handles — verify
  `NotFoundError` still carries `expected`, or the error cascade will
  start rethrowing on a missing error-page template.
- The pathname is fixed by the caller, so this is a `options.pathname`
  render, not a request-derived one.
- Page caching must stay off for error pages: they carry per-request error
  props.

**Expected touch points**

- `src/app/presentation/lib/html-error-page.js` — the import and line 68.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Error pages render at the correct status for each entry in
      `STATUS_HEADINGS`.
- [ ] A JSON request still returns `false` without rendering.
- [ ] A missing error-page template still returns `false` rather than
      throwing out of the error handler.
- [ ] Error pages are not written to the rendered-page cache.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation`
- `node run-linter.js src/app/presentation`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: HV-1.


### Task ADMIN-1: Decide and enforce the logged-in gate on login POST

**Status:** Not started
**Depends on:** None (but see HV-2 — do this after it to avoid rework)
**Documentation:** `src/app/presentation/README.md`

**Objective**

`postAdminUserLoginForm` and the two signup handlers agree on what to do
when a request already carries a valid admin session — or the difference
is documented as intentional. Today they disagree silently.

`getNewAdminUserForm` (line 121) and `postNewAdminUserForm` (line 177)
both call `hasValidAdminSession` as their first gate and short-circuit to
the "already logged in" page. `postAdminUserLoginForm` (line 349) has no
such check: an already-authenticated admin who POSTs the login form runs
the full CSRF → throttle → validate → `authenticateAdminCredentials` path
and is silently issued a second session, replacing their cookie.

**Scope**

- In: the entry gate of `postAdminUserLoginForm`; a comment recording the
  decision either way.
- In: `getAdminUserLoginForm`, if the decision is that the login pair
  should mirror the signup pair.
- Out: session lifecycle itself (`setAdminSessionCookie`, the session
  Transaction Scripts). Out: the signup handlers, which already gate.

**Design and invariants**

- Re-login is not obviously wrong — a user with a stale session may
  legitimately want a fresh one. This task is not a foregone conclusion
  that the gate should be added; "confirm re-login is intended and say so
  in a comment" is an acceptable resolution.
- If the gate is added, it must not change the non-enumerating status
  behavior of the credential branch.
- `hasValidAdminSession` swallows only `UnauthenticatedError` (line 55)
  and rethrows everything else. Any new caller inherits that contract.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` —
  entry gate of `postAdminUserLoginForm`.
- `src/templates/pages/login/admin/new/page.html` — only if an
  already-logged-in branch is needed there.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The behavior of login POST under an existing valid session is
      explicit in the code, not incidental.
- [ ] If a gate was added, the login page template renders a coherent
      state for it.
- [ ] If no gate was added, a comment at the handler entry says why the
      login pair deliberately differs from the signup pair.
- [ ] Unit coverage for whichever behavior was chosen.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation` — proves the
  chosen behavior and that the credential/throttle status codes are
  unchanged.
- `node run-linter.js src/app/presentation`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: Needs a maintainer decision on whether re-login is intended.


### Task ADMIN-2: Resolve the session-check-before-CSRF ordering on signup POST

**Status:** Not started
**Depends on:** None (but see HV-2 — do this after it to avoid rework)
**Documentation:** `src/app/presentation/README.md`, `src/docs/server-error-handling.md`

**Objective**

The order of the session gate and CSRF validation in
`postNewAdminUserForm` is deliberate and documented, so a later reader
does not have to work out whether the module's "CSRF first" convention
was broken by accident.

In `postNewAdminUserForm`, `hasValidAdminSession` (line 177) and
`checkSignupSubmissionThrottle` (line 187) both run before
`validateCsrfFormData` (line 192). A cross-site POST from a logged-in
admin's browser therefore returns the friendly "already logged in" page
instead of a `ForbiddenError`.

**Scope**

- In: gate ordering at the top of `postNewAdminUserForm`, or a comment
  justifying the current order.
- Out: the CSRF implementation in `src/app/presentation/lib/csrf.js`.
- Out: the throttle-before-CSRF ordering, which is intentional and
  already carries a comment (lines 181-186) explaining that abusive
  submissions should cost nothing past the IP read.

**Design and invariants**

- Nothing is mutated on the already-logged-in path, so this is not a
  CSRF vulnerability. The defect is that the ordering reads as an
  oversight.
- The throttle gate must stay ahead of body parsing. `validateCsrfFormData`
  parses the body, so moving CSRF earlier would give an unauthenticated
  attacker a parse for free — this is the reason the current order exists
  and any change must respect it.
- The comment at lines 181-186 is the model for what "documented" means
  here.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` —
  lines 174-192.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The ordering of the session, throttle, and CSRF gates is explained
      in a comment at the point of the decision.
- [ ] No submission path parses the request body before the throttle
      gate.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation`
- `node run-linter.js src/app/presentation`
- Read-through: the three gates and their comments explain the full
  ordering rationale without reference to this document.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.


### Task ADMIN-3: Remove the unreachable `|| 500` status fallbacks

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/errors/README.md`, `src/docs/server-error-handling.md`

**Objective**

The four `response.status = error.httpStatusCode || 500` expressions no
longer imply that a normally-rendered HTML page might carry a 500.

The fallback is unreachable. `WrappedError` resolves
`options.httpStatusCode || this.constructor.HTTP_STATUS_CODE` and always
defines the property when the result is not undefined
(`src/kixx/errors/lib/wrapped-error.js:35-55`). Every error reaching
these branches is a `ValidationError` (422, `validation-error.js:23`) or
a `ConflictError` (409, `conflict-error.js:25`), both of which declare a
static `HTTP_STATUS_CODE`. The `|| 500` can never be taken, and it reads
as though a 500 were a live possibility on a branch that is about to
render a normal page body.

Occurrences: lines 222, 244, 253 (approx.), and 369.

**Scope**

- In: the four status assignments in
  `request-handlers/admin-panel/admin-users.js`.
- Out: other handler modules using the same idiom — sweep them only if
  the same proof of unreachability holds there, and note it in the
  handoff.
- Out: any change to the error classes themselves.

**Design and invariants**

- The resulting status values must be identical to today's: 422 for the
  two `ValidationError` branches, 409 for the two `ConflictError`
  branches.
- Prefer the literal status the branch actually means over
  `error.httpStatusCode`, since each branch already knows which error it
  caught. This makes the security-relevant status explicit at the point
  of decision rather than inherited from an error class.
- Do not touch the login credential branch (line 391), which
  deliberately leaves the status at the default 200.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` —
  lines 222, 244, 253, 369.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No `|| 500` remains in this module.
- [ ] The four affected responses still carry 422, 409, 409, and 422
      respectively.
- [ ] The deliberate 200 on the invalid-credentials and throttled
      branches is untouched.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation` — the existing
  status assertions prove the values did not shift.
- `node run-linter.js src/app/presentation`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.


### Task ADMIN-4: Drop the dead `inviteValid` prop from the already-logged-in render

**Status:** Not started
**Depends on:** ADMIN-1 (only if that task adds an already-logged-in
branch to the login page; otherwise none)
**Documentation:** `src/templates/README.md`

**Objective**

`renderAlreadyLoggedIn` sets only the props the template actually reads.

The helper (lines 62-67) returns `{ alreadyLoggedIn: true, inviteValid:
false }`. In `src/templates/pages/users/admin/new/page.html` the
`{{#if alreadyLoggedIn}}` branch at line 2 is self-contained and returns
before the `{{#if inviteValid}}` test at line 15 is ever evaluated, so
`inviteValid` is dead. It suggests a coupling between the two props that
does not exist.

**Scope**

- In: the `renderAlreadyLoggedIn` helper.
- Out: the other render helpers (`renderInvalidInvite`,
  `renderInviteSpentByRace`, `renderSignupThrottled`), whose
  `inviteValid: false` is live — those states fall through to the
  `{{#if inviteValid}}` test and depend on it.

**Design and invariants**

- Confirm against the template before deleting: the claim is that the
  `alreadyLoggedIn` branch never falls through, and the fix is only
  correct while that stays true.
- Rendered output for the already-logged-in state must be byte-identical
  before and after.

**Expected touch points**

- `src/app/presentation/request-handlers/admin-panel/admin-users.js` —
  lines 62-67.

Treat this list as orientation, not permission to ignore other necessary
files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `renderAlreadyLoggedIn` sets `alreadyLoggedIn` only.
- [ ] The already-logged-in page renders unchanged.
- [ ] The other three render helpers still set `inviteValid: false`.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation`
- `node run-linter.js src/app/presentation`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.


Reviewed and Rejected
---------------------

Recorded so they are not re-raised.

**"The already-logged-in render is missing a `links.loginForm` prop."**
Raised because every other no-form branch supplies it. Not a defect: the
`{{#if alreadyLoggedIn}}` branch of
`src/templates/pages/users/admin/new/page.html` (lines 2-13) is
self-contained and never reads `links`, and both `links.loginForm` uses
(lines 98, 158) sit inside the `{{else}}` branch behind their own
`{{#if}}` guards.

**"The invite-guess counter should advance on any non-redeemable token."**
Not a defect: lines 143 and 206 deliberately require
`resolution.record === null` so that an expired or already-spent real
invite — which still resolves to a stored record — does not penalize its
legitimate holder. Only a token matching no known invite is a guess.
