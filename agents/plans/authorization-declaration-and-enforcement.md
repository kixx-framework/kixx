# Authorization Declaration and Enforcement

## Implementation Approach

Today authorization is an optional middleware function that a route author may
place at the head of a target's `requestHandlers` array. Omitting it is silent.
That has already failed in production code: `src/app/lib/roles.js` grants
`ROLE_EDITOR` four `urn:kixx:publishing:*` permissions and
`src/app/lib/permissions.js` implements the trailing-`:*` scoped-resource match
specifically to support `urn:kixx:publishing:page-metadata:/blog/hello`, but
`src/routes/publishing-api-v1.js` declares no gates on any of its seventeen
targets and `assertPermission` is called from exactly one module in the whole
tree. Every publishing token can write every publishing resource regardless of
its roles.

This plan makes authorization **non-optional and declared**, and splits the work
between two layers by what each layer can actually know:

- **Declaration** moves from a middleware entry in `requestHandlers` to a
  required `authorization` field on the target specification, validated when the
  route tree is built. A target that declares nothing fails at boot. This is the
  property whose absence caused the publishing hole.
- **Evaluation** happens at the layer that first knows the resource identity:
  - identity is constant → the router evaluates the declaration directly;
  - identity comes from the URL → the request handler, after it has derived and
    normalized the identity;
  - identity comes from a stored record → the transaction script that loaded it.

Because the framework (`src/kixx/`) must not know the application's role
vocabulary, the framework owns declaration, dispatch, and a completeness
invariant, while the application owns evaluation behind a registered
`Authorizer` service — a port in the sense of `src/plugins/README.md`. The
router refuses to boot when any target declares a decision and no `Authorizer`
is supplied from the initialized service registry, so the port cannot be quietly
left unwired. Target specification parsing remains service-independent: the
router first builds the route tree, then validates its authorization declarations
against the supplied `Authorizer` before accepting requests.

**What is and is not verified.** Boot-time validation proves *coverage* (every
target declares something) and *vocabulary* (declared URNs are registered). A
post-request-phase invariant proves *completion* (a decision was actually
evaluated for the declared action). Nothing proves *correctness of scope* — that
the resource URN was derived from the right data. That remains a test
obligation, and the plan adds the tests rather than pretending the machine
covers it. Note also that the completion invariant fires after the handlers have
already done their work. A write may have landed, another side effect may have
occurred, or a terminal presentation handler may already have rendered and
committed the response representation. Its value is that CI fails loudly on the
first run rather than the gap sitting unnoticed.

Hyperview rendering is terminal presentation behavior, not another protected
resource operation. `HyperviewPageHandler` runs after target authorization, and
direct `respondWithHyperviewPage()` calls from an error handler render the error
representation without declaring or evaluating a second authorization decision.
The completion invariant applies to the matched target's request phase only; it
does not apply recursively to error-handler rendering.

Per `src/docs/server-error-handling.md`, a missing or incomplete decision is a
programmer error, not an operational one: it throws `AssertionError` and is
allowed to propagate to the router's fatal-error policy. It is never converted
into a 403.

**Breaking changes are accepted.** The `authorization` field is required on
every target spec across every route file, including targets declared inline in
`src/virtual-hosts.js`. Any downstream Kixx application must add it.

Task order: T1 → T2 → T3 establish the framework mechanism; T4 migrates the
already-working admin surface onto it; T5 closes the publishing hole; T6
updates the developer documentation.

---

### Task T1: Targets declare their authorization decision

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` (interface contract rules); `src/docs/code-documentation-guide.md`

**Objective**

Every HTTP target specification carries a required `authorization` field
describing the decision that governs it. A route tree containing a target
without one cannot be constructed, so forgetting authorization becomes a
startup failure rather than an open endpoint. This task introduces the
declaration and its validation only; nothing evaluates it yet, so the running
behavior of the application is unchanged.

**Scope**

- In: the `authorization` field's supported shapes, validation in
  `HttpTarget.validateSpecification()`, propagation through
  `HttpTarget.fromSpecification()` onto the target instance, JSDoc for both;
  adding the field to every existing target spec so the tree still builds.
- Out: evaluating declarations (T2), recording and asserting completion (T3),
  changing which principal is allowed to do what (T4, T5), documentation
  prose (T6).

**Design and invariants**

- Three supported shapes, and no fourth:
  - `'public'` — deliberately unauthenticated or ungated. The only way to opt
    out, and it must be typed out explicitly.
  - `{ action, resource }` — a fixed decision fully known from the route table.
    Both non-empty strings.
  - `{ action, resource: 'deferred' }` — the action is fixed but the resource
    identity is derived downstream. Declares *that* a decision must happen and
    *which action* it must be for.
- `resource: 'deferred'` is a reserved sentinel. Reject it as an action value,
  and reject any resource string equal to it in the fixed form, so the two
  shapes can never be confused.
- Validation raises `ValidationError` with the existing
  `` `${routeName} target "${spec.name}" .authorization …` `` message style used
  throughout `validateSpecification`, so a misconfiguration names the offending
  target.
- The framework validates *shape only*. It must not inspect the URN namespace
  or know that `urn:kixx:` exists — vocabulary checking is the application's
  job and lands in T2 behind the port.
- Store the declaration frozen on the `HttpTarget` instance as a public
  enumerable `authorization` property, following the `tags`/`allowedMethods`
  pattern in the constructor.
- Migrating existing specs is mechanical in this task: give every current target
  the declaration matching what it enforces today, and `'public'` where it
  enforces nothing. Do not change any effective permission here — a target that
  is ungated today gets `'public'` even where that is wrong. T5 corrects the
  publishing targets deliberately, with tests.

**Expected touch points**

- `src/kixx/http-router/http-target.js` — validation, constructor property, spec propagation, JSDoc
- `src/kixx/http-router/http-route.js` — JSDoc for the target spec shape it documents
- `src/routes/admin-panel.js`, `src/routes/admin-api-v1.js`, `src/routes/publishing-api-v1.js` — add declarations
- `src/virtual-hosts.js` — add declarations to the inline targets (login form, new-user form)
- `test/unit-tests/kixx/http-router/http-target.test.js` — validation and propagation cases

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A target spec with no `authorization` field throws `ValidationError` naming the route and target.
- [ ] Each of the three valid shapes is accepted and reaches the built `HttpTarget` unchanged.
- [ ] Malformed shapes are rejected: empty/non-string `action`, empty/non-string `resource`, `action: 'deferred'`, an unknown string other than `'public'`, a non-object non-string value.
- [ ] `target.authorization` is enumerable and frozen; mutating it does not change the target.
- [ ] Every existing target in `src/routes/` and `src/virtual-hosts.js` declares a value, and the application still boots.
- [ ] JSDoc on both `validateSpecification` and `fromSpecification` documents the field and its three shapes.

**Validation**

- `node run-tests.js test/unit-tests/kixx/http-router` — validation and propagation behavior
- `node run-tests.js` — the full suite still passes; proves the migrated specs build
- `node run-linter.js src/kixx/http-router src/routes src/virtual-hosts.js`
- Unit coverage: one case per rejected shape, one per accepted shape.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T2: Authorizer port and router-evaluated fixed decisions

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/plugins/README.md`; `src/docs/server-error-handling.md`

**Objective**

Targets declaring a fixed `{ action, resource }` decision are enforced by the
router itself, before any request handler runs, by calling an application-supplied
`Authorizer`. The application's role and URN vocabulary stays out of
`src/kixx/`. A route tree containing any non-`'public'` declaration refuses to
boot unless an `Authorizer` is registered, so the enforcement path cannot be
left unwired by omission — the same failure this whole plan exists to remove.

**Scope**

- In: the `Authorizer` interface contract file, its registration and boot-time
  presence check, router dispatch of fixed decisions ahead of the request phase,
  the application `Authorizer` implementation backed by
  `src/app/lib/permissions.js`, and vocabulary validation of declared URNs.
- Out: deferred decisions and the completion invariant (T3), migrating the
  admin gates off `requestHandlers` (T4), publishing scope (T5).

**Design and invariants**

- Interface contract at `src/kixx/http-router/authorizer-interface.js`, written
  to the rules in `src/plugins/README.md` alongside the existing
  `middleware-interface.js` and `error-handler-interface.js`.
- Single method: `authorize(context, decision)` where `decision` is
  `{ action, resource }`. Returns nothing on success; throws on denial. The
  framework does not interpret the thrown error — `ForbiddenError` reaching the
  registered error handlers is the application's business.
- A second method, `assertVocabulary(declaration)`, is called once per protected
  target during `HttpRouter` construction, after the route tree has been built.
  The application can therefore reject an action or resource URN that no
  registered role could ever grant. This makes "vocabulary" machine-checked
  without teaching the framework about URNs. A typo in a route file fails at
  boot instead of denying every request at runtime.
- Target and route construction remain service-independent. `HttpRouter`
  accepts an optional `authorizer` constructor dependency. The Node and
  Cloudflare composition roots run plugin and application initialization first,
  retrieve the registered `Authorizer`, and pass it to the router alongside the
  virtual-host specifications.
- After building the route tree, `HttpRouter` walks every target declaration.
  If any target is protected and no authorizer was supplied, construction
  throws and names the first offending target. If an authorizer was supplied,
  the router calls `assertVocabulary()` once for every protected target. A
  completely public downstream application may omit the dependency.
- Dispatch point is the head of the request phase in
  `HttpTarget#invokeMiddleware()` (`http-target.js:170`), before the
  `#middleware` loop. Running before inbound middleware would break it —
  authentication runs as inbound middleware and must populate `context.user`
  first. Placement is therefore: inbound middleware → fixed-decision dispatch →
  request handlers. This requires splitting the currently-concatenated
  `requestPhaseMiddleware` (`http-target.js:355`) back into its two segments so
  the router has a seam between them.
- The application `Authorizer` lives in the app layer (proposed
  `src/app/lib/authorizer.js`) and delegates to the existing
  `assertPermission` / `evaluatePermissions`. It adds no new decision logic.
- Registration follows the existing `context.registerService(name, service)`
  pattern used by every module under `src/plugins/`.

**Expected touch points**

- `src/kixx/http-router/authorizer-interface.js` — new interface contract
- `src/kixx/http-router/http-target.js` — middleware-segment split and dispatch
- `src/kixx/http-router/http-route.js`, `virtual-host.js` — thread the segments through construction and expose built targets for router validation
- `src/kixx/http-router/http-router.js` — accept the optional authorizer, require it for protected routes, and validate vocabulary
- `src/app/lib/authorizer.js` — application implementation
- Application bootstrap / plugin registration — register `Authorizer`
- `src/node-server.js`, `src/cloudflare-server.js` — pass the initialized registered service to `HttpRouter`
- `test/unit-tests/kixx/http-router/http-target.test.js` — dispatch order
- `test/unit-tests/kixx/http-router/http-router.test.js` — authorizer presence and vocabulary validation at boot
- New `test/unit-tests/app/lib/authorizer.test.js`

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A target with a fixed declaration calls `Authorizer#authorize` exactly once, after inbound middleware and before the first request handler.
- [ ] A denial thrown by the authorizer propagates to the error-handler cascade; no request handler runs.
- [ ] A `'public'` target never calls the authorizer.
- [ ] Constructing `HttpRouter` with a non-`'public'` declaration and no supplied `Authorizer` throws, naming the offending target.
- [ ] `assertVocabulary` is called once per protected target during router construction; an unregistered action or resource URN fails the boot.
- [ ] A route tree containing only `'public'` targets can be constructed without an `Authorizer`.
- [ ] `skip()` semantics and the always-runs outbound phase are unchanged for both authorized and public targets.
- [ ] The application `Authorizer` denies via `ForbiddenError` and adds no logic beyond delegating to `permissions.js`.

**Validation**

- `node run-tests.js test/unit-tests/kixx/http-router test/unit-tests/app` — dispatch order, boot check, delegation
- `node run-tests.js` — full suite
- `node run-linter.js src/kixx/http-router src/app/lib`
- Unit coverage: dispatch ordering relative to inbound middleware (use `MockTracker` call order), the missing-authorizer boot failure, the all-public case, and vocabulary rejection.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: Decision recording and the completion invariant

**Status:** Not started
**Depends on:** T2
**Documentation:** `src/docs/server-error-handling.md`

**Objective**

Every authorization decision evaluated during a request is recorded on the
request context, and a target that declared a decision but completed its request
phase without one having been evaluated raises a programmer error. This converts
"someone forgot the scoped check in the handler" from a silent hole into a
loud, reproducible CI failure — the guarantee that makes deferred decisions
acceptable at all.

**Scope**

- In: decision recording on `RequestContext`, recording from the application
  authorizer, the post-request-phase invariant in `HttpTarget#invokeMiddleware`,
  and the `skip()` interaction.
- Out: the deferred call sites themselves (T5), admin migration (T4).

**Design and invariants**

- `RequestContext` gains a private decision list with
  `recordAuthorizationDecision({ action, resource })` and a read accessor,
  following the existing `#user` / `setUser` / `get user` pattern. It is
  request-scoped, so there is no cross-request leakage to reason about.
- The application `Authorizer` records on every *successful* decision. A denial
  throws, so it never reaches the invariant.
- The invariant runs after the request-phase loop and **before** the outbound
  phase (`http-target.js:179–185`), so a bug cannot be masked by response
  post-processing.
- Satisfaction rule: for a declaration with action `A`, at least one recorded
  decision must have action `A`. The resource is deliberately not compared —
  for deferred decisions the router does not know the correct resource, and a
  comparison it cannot ground would be theatre.
- **`skip()` does not exempt.** A request phase ended early by `skip()`
  (`http-target.js:176`) is still subject to the invariant: declared
  non-`'public'` with zero recorded decisions is an error whether or not the
  phase was skipped.

  The reasoning, because it is easy to get backwards: `skip()` is the fourth
  middleware argument and is used two ways here — post-redirect-get, where the
  handler that did the work skips at the end (`admin-invites.js:226`,
  `admin-users.js:292`, `admin-publishing-api-tokens.js:212`), and chain
  termination, where a handler positioned *ahead of others* stops them
  (`skipWhenFound` at `static-file-server-request-handlers.js:94`). The second
  shape is the dangerous one: handlers `[A, B]` where B evaluates the deferred
  decision and A skips means B never runs and no decision is evaluated. That
  bypass already exists today — `skip()` jumps over a hand-placed
  `requirePermission` entry just as readily — so this is not a regression, but
  an exemption would leave the invariant unable to catch it.

  Worse, an exemption makes `skip()` a silencer: a developer who hits the
  `AssertionError` can make it disappear by calling `skip()`, converting a loud
  failure into exactly the silent gap this plan exists to close.

  Nothing in the tree today needs an exemption. The three admin skip sites sit
  on targets with fixed declarations, which the router satisfies before the
  request phase runs; the four form targets in `src/virtual-hosts.js` are
  `'public'`; the publishing targets are single-handler and check before
  responding. A future
  chain that legitimately needs to terminate early must move its check earlier
  or change its declaration — that is the conversation the author should be
  forced into, rather than reaching for `skip()`.
- Violations throw `AssertionError` and propagate. Per the error-handling guide
  this is a programmer error: it is not caught, not converted to a 403, and it
  triggers the platform fatal-error policy.
- The message must name the target and the unsatisfied action, since the whole
  point is fast diagnosis.
- The invariant governs only the matched target's request phase. Error handlers
  may call `respondWithHyperviewPage()` directly to render a denial or other
  failure without declaring or recording another decision. This avoids a
  recursive authorization requirement for the error representation.
- Because `HyperviewPageHandler` is a terminal request handler which delegates
  response commitment to `respondWithHyperviewPage()`, an unsatisfied deferred
  declaration may be detected after rendering has completed. The invariant is
  a diagnostic backstop, not a transaction boundary or a guarantee that no
  response representation was prepared before the programmer error.

**Expected touch points**

- `src/kixx/context/request-context.js` — recording API and accessor
- `src/kixx/http-router/http-target.js` — invariant after the request phase
- `src/app/lib/authorizer.js` — record on success
- `test/unit-tests/kixx/context/` — recording API
- `test/unit-tests/kixx/http-router/http-target.test.js` — invariant, skip interaction

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `recordAuthorizationDecision` accumulates decisions in order and the accessor returns a mutation-safe copy.
- [ ] A target declaring a deferred decision whose handlers record nothing throws `AssertionError` naming the target and action.
- [ ] Recording a decision for a *different* action does not satisfy the declaration.
- [ ] A fixed declaration is satisfied by the router's own dispatch, with no handler cooperation required.
- [ ] A request phase ended by `skip()` is still subject to the invariant: a target declaring a deferred decision whose chain skips before evaluating it throws.
- [ ] The three existing admin `skip()` sites and all four `'public'` form targets in `src/virtual-hosts.js` still pass unchanged, proving the no-exemption rule costs nothing today.
- [ ] `'public'` targets are never subject to the invariant.
- [ ] The invariant runs before outbound middleware.

**Validation**

- `node run-tests.js test/unit-tests/kixx` — invariant, skip interaction, recording
- `node run-tests.js` — full suite
- `node run-linter.js src/kixx src/app/lib`
- Unit coverage: satisfied, unsatisfied, wrong-action, skipped-before-decision, and public cases.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: Migrate the admin surface onto declarations

**Status:** Not started
**Depends on:** T3
**Documentation:** `src/app/presentation/README.md`

**Objective**

The admin panel and admin API enforce exactly the permissions they enforce
today, but through target declarations evaluated by the router instead of gate
functions hand-placed in `requestHandlers`. Nine current gate placements use
six distinct pre-bound decisions. The pre-bound gates in
`admin-authorization.js` and the middleware role of `requirePermission` are
retired, leaving one way to express an authorization decision instead of two.

**Scope**

- In: replacing the nine `AdminAuthorization.*` gate entries across the admin
  route files with declarations, retiring the six exports in
  `admin-authorization.js` and
  `require-permission.js`, and the corresponding unit tests.
- Out: any change to which role may do what — this task is behavior-preserving
  for admin, and a diff that changes an effective permission is a bug in the
  migration.

**Design and invariants**

- Every current gate is a fixed decision with a constant resource (see the
  module comment in `admin-authorization.js`, which says so explicitly), so all
  nine placements migrate to the `{ action, resource }` form with no deferral.
  Repeated placements may use the same one of the six distinct decisions.
- The action and resource strings must be copied verbatim. Any drift silently
  changes who can do what.
- `requirePermission`'s resolver-function form (`resource` as a callback) has no
  remaining callers once the six fixed gates migrate. Delete it rather than
  leave it as a second, unverified path — it is the same
  unverified-resource-derivation surface that deferred decisions handle with an
  invariant.
- `assertPermission` and `evaluatePermissions` in `src/app/lib/permissions.js`
  stay exactly as they are; they are now reached through the `Authorizer`.
- Confirm none of the nine currently gated target placements is left `'public'`
  by accident during the T1 mechanical pass. Targets which are deliberately
  ungated today, such as invite acceptance and authenticated static page
  rendering, remain `'public'` in authorization terms so this task does not
  silently introduce a new permission requirement.

**Expected touch points**

- `src/routes/admin-panel.js`, `src/routes/admin-api-v1.js` — declarations replace gate entries
- `src/app/presentation/middleware/admin-authorization.js` — delete
- `src/app/presentation/middleware/require-permission.js` — delete
- `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js` — update the comment at line 29 referencing the retired "target-head gate"

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All nine admin gate placements are replaced by declarations with verbatim action and resource URNs, preserving the six distinct decisions.
- [ ] `admin-authorization.js` and `require-permission.js` are deleted with no remaining importers.
- [ ] None of the nine formerly gated target placements declares `'public'`; deliberately ungated admin-named targets remain behaviorally unchanged.
- [ ] The admin end-to-end suite passes unchanged — no test edits, which is the evidence that behavior was preserved.
- [ ] Stale comments referring to target-head gates are corrected.

**Validation**

- `node run-tests.js --e2e test/end-to-end/010-admin-panel` — behavior preservation, with an unmodified test file
- `node run-tests.js` — full unit suite
- `node run-linter.js src/routes src/app/presentation`
- Manual check: `grep -rn "requirePermission\|admin-authorization" src` returns nothing.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Enforce publishing API permissions

**Status:** Not started
**Depends on:** T3
**Documentation:** `src/app/collections/README.md` (ContentAddressableStore boundary); `src/plugins/README.md`

**Objective**

The publishing API enforces the grants `ROLE_EDITOR` already declares. A token
without a grant for a resource is refused, and the scoped grants
(`urn:kixx:publishing:page-metadata:*`) actually constrain which pathnames a
token may write. This is the security defect that motivated the whole plan.

**Scope**

- In: declarations on all seventeen publishing targets, scoped evaluation inside
  the four handler factories in
  `src/app/presentation/request-handlers/publishing-api/mod.js`, the read
  actions `ROLE_EDITOR` is missing, and tests for both allow and deny paths.
- Out: changing `ContentAddressableStore`, changing the token-minting forms,
  changing the URN grammar in `permissions.js`.

**Design and invariants**

- **The check must run after `store.normalizePathname()`** (`mod.js:31` and
  `mod.js:90`), never on the raw joined segments. Authorizing
  `segments.join('/')` and then writing to the normalized pathname authorizes a
  different string than the one written — the exact class of bug the machine
  cannot catch for you.
- The check belongs in the handler because the handler is the first layer that
  knows the resource identity. Do **not** route these through a transaction
  script: `ContentAddressableStore` holds the logic and a script would be a
  pass-through frame that knows less than the handler already does.
- Do **not** put the check in `ContentAddressableStore`. It is a registered
  service behind a platform port; teaching it the application's role URNs
  inverts the dependency `src/plugins/` exists to protect.
- The four factories (`statHandlerWithPathname`, `statHandlerWithoutPathname`,
  `putHandlerWithPathname`, `putHandlerWithoutPathname`) each gain the action
  URN as a parameter alongside `type`, so one call site per factory covers all
  seventeen exports and the export list at `mod.js:134–322` becomes the readable
  inventory of publishing decisions.
- Resource construction: pathname-scoped handlers build
  `` `urn:kixx:publishing:<kind>:${pathname}` ``, which is what the trailing-`:*`
  branch of `doesPatternMatch` (`permissions.js:118–128`) was written for.
  Pathname-less handlers use the bare `urn:kixx:publishing:<kind>` form, matching
  the unscoped `asset` and `template` grants already in `ROLE_EDITOR`.
- Targets declare `{ action, resource: 'deferred' }` for pathname-scoped
  handlers and the fixed `{ action, resource }` form for pathname-less ones,
  where the router can evaluate directly.
- **`ROLE_EDITOR` must gain read actions.** It currently grants only `:put`
  verbs, so every `stat*` target would deny once enforcement is real. Add the
  read actions for each publishing kind. Widening a role is a deliberate
  security change — state it in the handoff notes, do not let it pass as
  incidental.
- `commitChanges` (`mod.js:339`) is not built by a factory and needs its own
  declaration and check. Decide and record whether it is governed by an existing
  grant or needs a new one; it commits the whole content tree, so it is the most
  consequential target on this surface.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/mod.js` — factory parameters, checks after normalization, `commitChanges`
- `src/routes/publishing-api-v1.js` — declarations on all targets
- `src/app/lib/roles.js` — read actions, and any grant `commitChanges` needs
- `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js` — allow and deny per factory
- `test/end-to-end/020-publishing-api/` — deny paths for a token lacking the grant

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All seventeen publishing targets declare a decision; none is `'public'`.
- [ ] A token whose roles lack the grant is refused on every publishing target, read and write.
- [ ] A scoped grant limited to a pathname prefix permits a write inside it and refuses one outside it — the case that proves scoping is real and not merely coarse.
- [ ] The authorized resource URN is built from the normalized pathname; a test pins this by authorizing a pathname that normalization changes.
- [ ] `ROLE_EDITOR` grants the read actions its `stat*` targets require, and every existing publishing end-to-end test still passes.
- [ ] `commitChanges` is gated, with its governing grant recorded in the handoff notes.
- [ ] Removing any single check from a factory causes a test to fail.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api` — allow and deny per factory
- `node run-tests.js --e2e test/end-to-end/020-publishing-api` — real token flows, both directions
- `node run-tests.js` — full unit suite
- `node run-linter.js src/app src/routes`
- Manual check: temporarily delete one factory's check and confirm the T3 invariant or a test fires.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T6: Document the authorization model

**Status:** Not started
**Depends on:** T4, T5
**Documentation:** `src/app/presentation/README.md`; `src/plugins/README.md`; `src/docs/server-error-handling.md`

**Objective**

An agent or developer with no knowledge of this plan can read the project
documentation and know where an authorization decision is declared, which layer
evaluates it, why that layer, and precisely what the tooling does and does not
verify. Without this the next contributor re-derives the reasoning or, worse,
adds a gate the old way.

**Scope**

- In: the authorization section of the presentation README, the `Authorizer`
  port in the plugins README, the programmer-error classification in the error
  handling guide, and removal of references to the retired middleware.
- Out: code changes.

**Design and invariants**

- State the placement rule as the decision procedure it is: constant identity →
  route table; identity in the URL → request handler, after normalization;
  identity in a stored record → transaction script. Give the reason — the layer
  that first knows the resource identity — so the rule generalizes instead of
  being three memorized cases.
- State the terminal presentation boundary explicitly: authorization precedes
  `HyperviewPageHandler`; neither it nor `respondWithHyperviewPage()` derives or
  evaluates resource authorization. A handler responsible for a deferred
  decision must authorize the normalized resource before adding render data or
  allowing terminal rendering to run.
- Explain that direct Hyperview facade calls from error handlers render the
  failure representation outside the target request phase. They do not require
  a second declaration or decision after the original request was denied.
- Be explicit about the limits, in the documentation and not only in this plan:
  coverage and vocabulary are machine-checked at boot; completion is checked at
  runtime per request; **scope correctness is not checked and is a test
  obligation**; and the invariant fires after handler work, so a write may have
  landed, another side effect may have occurred, or a terminal representation
  may already have been rendered. Note
  also that `skip()` can still jump over a deferred check — the invariant turns
  that into a loud failure rather than a silent one, but it does not prevent the
  chain from being written that way. A reader who believes
  the tooling is stronger than it is will under-test.
- `src/app/presentation/README.md` line 113 currently describes route middleware
  as the place for capabilities including authentication — correct it so
  authorization is not read as belonging there.
- Do not document `requirePermission` or `admin-authorization.js`; they are gone.

**Expected touch points**

- `src/app/presentation/README.md` — authorization section, corrected middleware guidance
- `src/plugins/README.md` — `Authorizer` port
- `src/docs/server-error-handling.md` — missing/incomplete decision as a programmer error
- `src/app/transaction-scripts/README.md` — when a scoped check belongs in a script

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The three-case placement rule and its underlying reason are documented.
- [ ] The terminal rendering and error-rendering boundaries are documented; neither rendering path is presented as a second authorization operation.
- [ ] The verified/not-verified boundary is stated explicitly, including the `skip()` bypass shape and the post-handler timing.
- [ ] The `Authorizer` port is documented alongside the other ports.
- [ ] No documentation references `requirePermission` or `admin-authorization.js`.
- [ ] A reader can follow the docs to add a new authorized route without reading this plan.

**Validation**

- `grep -rn "requirePermission\|admin-authorization" src/**/*.md` returns nothing
- Manual review: follow the documentation to add one new authorized target from scratch and confirm no step is missing.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
