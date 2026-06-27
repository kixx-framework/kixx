# Admin Auth Rate Limiting & Lockout - Implementation Plan

## Implementation Approach

Add temporary, self-resetting throttling to the unauthenticated admin auth surfaces — `POST /login/admin/new`, `POST /users/admin/new`, and the invite-bearing `GET /users/admin/new` — using fixed-window failure counters backed by the existing eventually-consistent Key/Value Store. A generic `RateLimit` collection owns the counter record and its TTL mechanics (counting-window TTL while accumulating failures, cooldown TTL once a scope locks), but holds no policy: thresholds, window, and cooldown are passed in by the caller. Policy lives in `node-config.json` under a `RATE_LIMIT` block and is read through `context.config.env.RATE_LIMIT`, mirroring how Hyperview reads `context.config.env.HYPERVIEW`. A presentation-layer `rate-limit.js` lib (the sibling of `csrf.js`) owns policy reads, scope-key construction, and per-surface helpers; request handlers call those helpers inline and friendly-re-render a "too many attempts" message rather than returning a hard `429`, matching the existing invalid-credentials and invalid-invite UX. Login is keyed two ways — per-IP and per-`(IP, email)` together — so an attacker can never lock a real admin out from the admin's own IP, while broad credential stuffing from one source is still caught. Keep Transaction Scripts unchanged: throttling is a presentation-layer security control, not domain logic. Do not add automated tests unless explicitly requested; run the linter on changed JavaScript files after implementation.

## TODO

- [x] **Add rate-limit persistence**
  - **Story**: Auth surfaces can record and read per-scope failure counts that expire on their own
  - **What**: Add a Key/Value Store `RateLimit` collection and record. The record schema holds `failureCount` (number), `windowStartDate` (ISO string), and `lockedUntilDate` (ISO string or null); `validate()` enforces the shape before writes. The collection exposes three policy-driven helpers, each taking an opaque `scopeId` string and a `policy` object `{ maxFailures, windowSeconds, cooldownSeconds }`: `getState(context, scopeId)` returns `{ throttled, retryAfterSeconds }` by reading the record and treating it as throttled only while `lockedUntilDate` is in the future; `recordFailure(context, scopeId, policy)` performs the fixed-window read-modify-write — start a fresh window (count 1, window TTL) when there is no live record or the window has elapsed, otherwise increment within the current window, and once `failureCount` reaches `maxFailures` set `lockedUntilDate = now + cooldownSeconds` and persist with a cooldown-length TTL so the lock self-clears — returning the resulting `{ throttled, retryAfterSeconds }`; `clear(context, scopeId)` deletes the record. Pass `scopeId` as the record `id` so keys are deterministic. Add an inline comment noting that the Key/Value Store has no concurrency control, so concurrent increments can lose updates and slightly undercount, which is acceptable fail-soft behavior for throttling.
  - **Where**: `src/app/collections/rate-limit-collection.js`, `src/app/collections/rate-limit-record.js`
  - **Documentation**: `src/app/collections/README.md`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/error-handling.md`, `src/app/collections/csrf-token-collection.js`, `src/app/collections/csrf-token-record.js`, `src/app/collections/base-key-value-store-collection.js`, `src/app/collections/base-key-value-store-record.js`
  - **Acceptance criteria**: Counter records are stored through a registered Collection keyed by a deterministic scope id; the collection uses Key/Value Store expiration for both the counting window and the cooldown; `recordFailure` returns a throttled state once `maxFailures` is reached and stays throttled until the cooldown TTL elapses; the collection contains no hardcoded thresholds; required fields are validated before writes.
  - **Depends on**: none

- [x] **Register the rate-limit collection**
  - **Story**: Request handlers can access rate-limit persistence through context
  - **What**: Import and register the new `RateLimit` collection from the application registration lifecycle using the existing `KeyValueStore` service, alongside the `CsrfToken` and `UserSession` registrations. No document-store secondary indexes are needed.
  - **Where**: `src/app/app.js`
  - **Documentation**: `src/app/collections/README.md`, `src/app/app.js`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: `context.getCollection('RateLimit')` returns the new collection during HTTP requests; existing collection registrations still work; no document-store indexes are added for rate limiting.
  - **Depends on**: Add rate-limit persistence

- [x] **Add the RATE_LIMIT configuration block**
  - **Story**: Operators tune throttling per environment without code changes
  - **What**: Add a `RATE_LIMIT` object to each environment in `node-config.json` with three independently tunable policy blocks — `LOGIN`, `SIGNUP`, and `INVITE` — each holding `maxFailures`, `windowSeconds`, and `cooldownSeconds`. Seed defaults of LOGIN `{ 5, 900, 900 }`, SIGNUP `{ 10, 900, 900 }`, and a deliberately stricter INVITE `{ 3, 900, 3600 }` (fewer guesses, longer cooldown) since invite tokens are high-entropy and guessing them should get little runway. Keep development values usable for manual testing.
  - **Where**: `src/node-config.json`
  - **Documentation**: `src/node-server.js`, `src/plugins/node-config/lib/config.js`, `src/kixx/hyperview/hyperview-request-handlers.js` (config.env read precedent)
  - **Acceptance criteria**: `context.config.env.RATE_LIMIT.LOGIN`, `.SIGNUP`, and `.INVITE` each resolve to a policy object in every environment; the INVITE policy is stricter than LOGIN; no env vars are introduced for these thresholds.
  - **Depends on**: none

- [x] **Add reusable rate-limit presentation helpers**
  - **Story**: Auth handlers apply throttling consistently without constructing scope keys or reading policy directly
  - **What**: Add a presentation-layer rate-limit module that owns policy reads, scope-key construction, and per-surface helpers. Read the policy blocks from `context.config.env.RATE_LIMIT` with safe in-code fallbacks if a block is absent. Build scope ids from `request.ip` (treat a `null` ip as its own bucket) and, for the per-account login scope, a `sha256Hex(email)` so raw emails are never used as keys: `login:ip:<ip>`, `login:ipemail:<ip>:<hash>`, `signup:ip:<ip>`, `invite:ip:<ip>`. Export: `checkLoginThrottle(context, request, email)` (evaluates both login scopes via `getState`, returns the more-restrictive `{ throttled, retryAfterSeconds }`), `recordLoginFailure(context, request, email)` (increments both login scopes), `clearLoginThrottle(context, request, email)` (clears both); `checkSignupThrottle(context, request)`, `recordSignupFailure(context, request)`, `clearSignupThrottle(context, request)`; `checkInviteThrottle(context, request)`, `recordInviteGuess(context, request)`. Also export a small `throttleMessage(retryAfterSeconds)` formatter that produces the user-facing "Too many attempts. Please try again in N minutes." string so handlers and any future caller render identical copy.
  - **Where**: `src/app/presentation/lib/rate-limit.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/csrf.js`, `src/app/lib/crypto.js`, `src/kixx/http-router/server-request-interface.js` (the `ip` contract), `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/error-handling.md`
  - **Acceptance criteria**: Handlers obtain throttle state and record failures through named helpers without building keys, hashing emails, or reading config; login failures count against both the per-IP and per-`(IP, email)` scopes; successful login can clear both; the helpers return a consistent `{ throttled, retryAfterSeconds }` shape and a shared message formatter; `request.ip` of `null` does not throw.
  - **Depends on**: Register the rate-limit collection, Add the RATE_LIMIT configuration block

- [x] **Throttle the admin login flow**
  - **Story**: Repeated failed admin logins are temporarily throttled
  - **What**: In `postAdminUserLoginForm`, after CSRF validation and form parsing (so the email is available), call `checkLoginThrottle`; when throttled, re-render the login form with a fresh CSRF token and the throttle message instead of attempting authentication. On an `InvalidCredentials` outcome, call `recordLoginFailure` before re-rendering the existing generic, non-enumerating credentials message; if that failure pushes the scope into a locked state, prefer surfacing the throttle message on the next attempt (do not leak which input was wrong). On successful authentication, call `clearLoginThrottle` after setting the session cookie so a legitimate admin starts clean. Preserve all existing validation, invalid-credentials, session-cookie, and redirect behavior.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/rate-limit.js`, `src/app/presentation/lib/csrf.js`, `src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js`, `src/docs/error-handling.md`
  - **Acceptance criteria**: After the configured number of failed `POST /login/admin/new` attempts within the window, further attempts are throttled with a try-again message and `authenticateAdminCredentials` is not called while locked; the lock is scoped to per-IP and per-`(IP, email)` so a real admin is never locked out from a different IP by an attacker; a successful login clears the throttle; credential rejection stays non-enumerating; re-renders carry a fresh CSRF token.
  - **Depends on**: Add reusable rate-limit presentation helpers

- [x] **Throttle the admin signup submit flow**
  - **Story**: Repeated signup POST attempts from one source are temporarily throttled
  - **What**: In `postNewAdminUserForm`, call `checkSignupThrottle` early (per-IP only, so no request body is needed); when throttled, render the limited state — the no-form branch with the throttle message and the login link, matching the existing invalid-invite render — without parsing the body or touching the invite. Call `recordSignupFailure` on non-success outcomes of a processed submission (validation failure, duplicate-email conflict, invalid/spent invite). On successful account creation, call `clearSignupThrottle` after establishing the session. Preserve the existing invite-resolution, validation, conflict, session-failure, and redirect behavior.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/rate-limit.js`, `src/app/presentation/lib/csrf.js`, `src/app/transaction-scripts/admin-users/create-admin-user.js`, `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js`
  - **Acceptance criteria**: After the configured number of failed `POST /users/admin/new` attempts within the window, further attempts render the throttled state without parsing the body, calling `resolveAdminInvite`, or calling `createAdminUser`; a successful signup clears the throttle; existing invite, validation, conflict, and redirect behavior is unchanged.
  - **Depends on**: Add reusable rate-limit presentation helpers

- [x] **Throttle invite-token guessing on the signup form GET**
  - **Story**: Guessing invite tokens against the signup page is temporarily throttled
  - **What**: In `getNewAdminUserForm`, call `checkInviteThrottle` first; when throttled, render the limited state (no form, throttle message, login link). Resolve the invite as today; when a non-empty `invite` query token resolves non-redeemable, call `recordInviteGuess` so only failed guesses count — a request with no token, or a redeemable token, must not increment the counter, so legitimate visitors and expired-link clicks are not penalized. Preserve the existing redeemable-invite render and the invalid-invite render.
  - **Where**: `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/rate-limit.js`, `src/app/transaction-scripts/admin-invites/resolve-admin-invite.js`
  - **Acceptance criteria**: Only requests presenting a non-empty, non-redeemable invite token increment the invite counter; after the stricter configured threshold, `GET /users/admin/new` renders the throttled state and stops resolving invites while locked; requests with no token or a redeemable token never increment the counter and render normally.
  - **Depends on**: Add reusable rate-limit presentation helpers

- [x] **Render throttle messaging in admin auth templates**
  - **Story**: Throttled users see a clear "try again later" message on both auth pages
  - **What**: Add a single throttle callout to both auth page templates, guarded by `{{#if throttled}}` and rendering the handler-supplied message, placed so it shows in both the form and no-form branches of the signup page and above the login form. Reuse the existing `callout` component classes (no inline `style` attributes). Decide one consistent prop contract with the handlers — a `throttled` boolean plus a ready-to-render message string — and use it from every throttle path so login, signup POST, and invite GET render identical styling.
  - **Where**: `src/templates/pages/login/admin/new/page.html`, `src/templates/pages/users/admin/new/page.html`
  - **Documentation**: `src/templates/README.md`, `src/app/presentation/README.md`, `AGENTS.md` (Use General Styles), `src/pages/admin/style-guide/aesthetic/`
  - **Acceptance criteria**: Both pages show the throttle callout only when `throttled` is set; the message renders in the signup page's no-form branch as well as the form branch; styling reuses existing callout classes with no inline styles; non-throttled renders are visually unchanged.
  - **Depends on**: Throttle the admin login flow, Throttle the admin signup submit flow, Throttle invite-token guessing on the signup form GET

- [x] **Document the rate-limit pattern**
  - **Story**: Future agents can apply throttling to another sensitive route consistently
  - **What**: Add a short section to the presentation guide describing the rate-limit helpers: where policy lives (`node-config.json` → `context.config.env.RATE_LIMIT`), how handlers check before doing work and record failures after detecting them, the fixed-window-with-cooldown semantics and Key/Value Store undercount caveat, the login per-IP + per-`(IP, email)` keying rationale (avoids account-lockout DoS), and that throttling is a presentation-layer control that leaves Transaction Scripts untouched.
  - **Where**: `src/app/presentation/README.md`
  - **Documentation**: `src/app/presentation/README.md`, `src/app/presentation/lib/rate-limit.js`, `src/app/collections/rate-limit-collection.js`, `src/app/presentation/request-handlers/admin-users.js`
  - **Acceptance criteria**: The guide explains how to throttle another HTML route without duplicating counter logic, documents where policy is configured, and states the keying and Transaction-Script boundaries.
  - **Depends on**: Render throttle messaging in admin auth templates

- [x] **Run lint on changed JavaScript files**
  - **Story**: Implementation is clean and observable
  - **What**: Run the linter on the changed JavaScript files and fix any reported issues. Do not write or run tests unless explicitly requested.
  - **Where**: `src/app/collections/rate-limit-collection.js`, `src/app/collections/rate-limit-record.js`, `src/app/app.js`, `src/app/presentation/lib/rate-limit.js`, `src/app/presentation/request-handlers/admin-users.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `README.md`
  - **Acceptance criteria**: `node run-linter.js` passes for the changed JavaScript files; no automated tests are written or run in this step unless the user separately asks for them.
  - **Depends on**: Document the rate-limit pattern
