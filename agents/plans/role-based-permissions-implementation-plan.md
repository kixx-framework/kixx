# Role-Based Permissions — Implementation Plan

**Status:** Complete (T1–T10 all done)

## Implementation Approach

This plan adopts a role-based permission system into
this application. Authorization answers one question per protected endpoint —
*is the authenticated principal allowed to perform this action on this
resource?* — with five layered parts: a grant evaluator, a role registry,
a principal contract, declarative route enforcement (`requirePermission`), and
a storage rule (persist role **names** only, never grants).

### Confirmed scope decisions

These were settled in the design interview and must not be re-litigated.

- **Catalog tailored to real surfaces (spec §12.3).** Only roles and grants
  that map to routes that exist here. No `mailing-lists` / `alpha-platform`
  scaffolding. The registered roles are exactly:

  | Role | Category | Grants (action → resource) |
  |---|---|---|
  | `Root Admin` | `admin` | `*` → `*` |
  | `Super Admin` | `admin` | `urn:kixx:admin:admin-user-invites:*` → `urn:kixx:admin:admin-user-invites`; `urn:kixx:admin:publishing-api-tokens:*` → `urn:kixx:admin:publishing-api-tokens`; `urn:kixx:admin:migrations:*` → `urn:kixx:admin:migrations` |
  | `Platform Admin` | `admin` | `urn:kixx:admin:publishing-api-tokens:*` → `urn:kixx:admin:publishing-api-tokens` |
  | `Editor` | `publishing` | `urn:kixx:publishing:page-metadata:put` → `urn:kixx:publishing:page-metadata:*`; `urn:kixx:publishing:include:put` → `urn:kixx:publishing:include:*`; `urn:kixx:publishing:asset:put` → `urn:kixx:publishing:asset`; `urn:kixx:publishing:template:put` → `urn:kixx:publishing:template` |

- **Greenfield — no migrations, no reissue (spec §9.2).** The app is undeployed
  with no production data. There is **no** admin role backfill migration and
  **no** publishing-token reissue step. The first admin enters via bootstrap
  invite carrying `Root Admin`; every admin thereafter is invited with a
  deliberately chosen role. The record layer omits the spec's legacy-tolerance
  code (no "normalize missing `roles` → `[]`" in maintenance writes), but keeps
  the forward-looking leniency (no registry-membership check at the record
  layer, so a future role retirement cannot brick stored records).

- **Refactor the evaluator in place (spec §11).** `app/lib/publishing-permissions.js`
  becomes the generic `app/lib/permissions.js`. Existing auth-middleware
  filenames are **kept** (`admin-api-authentication.js` is not renamed to the
  spec's `admin-basic-authentication.js`).

- **Single role per invite.** The invite form offers one grantable role, stored
  as a one-element array. Storage stays array-shaped so multi-role is a
  future form-only change. `Root Admin` is never offered.

- **Publishing token forms: no role picker.** `Editor` is the only publishing
  role; forms default to `['Editor']` and still validate membership. A live
  `listRoles('publishing')` selector is deferred until a second publishing role
  exists.

- **Admin authorization instances live in one flat module**
  (`app/presentation/request-handlers/admin-authorization.js`), shared verbatim
  by the cookie-auth panel and the Basic-auth admin API. No `admin/`
  handler subdirectory is created in this iteration.

- **Publishing 403 wire contract preserved.** Publishing `requirePermission`
  instances pass `code: 'PublishingApiTokenForbidden'` and message
  `'The publishing API token is not authorized for this request.'`; admin
  instances take the `ForbiddenError` class defaults.

- **Testing.** Per the repo default and `AGENTS.md`, **no unit tests are written
  or run** as part of this plan unless the user later asks. Each task records a
  manual verification procedure in its handoff notes. The linter **is** run on
  every changed JavaScript file.

### Cross-cutting architectural decisions

Settled for the whole plan; individual tasks must not re-decide them.

1. **Fail closed everywhere (spec §5.2, §13).** Deny overrides allow; default
   deny. Malformed grants are skipped, not errors. `deriveRolePermissions()`
   never throws on bad stored data (non-array → `[]`; unknown name → no grants).
   A missing principal, missing permissions array, or malformed decision
   evaluates to not-allowed.

2. **Array-action normalization (spec §5.1).** Every consumer of grant objects
   — the evaluator **and** the registry's `areRoleGrantsWithinDomain()` and
   `canGrantRole()` — must normalize a grant's `action` to an array before
   inspecting it. This was a real bug in the reference implementation; each
   helper owns its own normalization.

3. **Authorization reads only `context.user.permissions` (spec §7, §13).** No
   downstream code branches on principal `type` to make an authorization
   decision. All three auth middleware (publishing bearer, admin session cookie,
   admin HTTP Basic) derive grants onto the principal the same way, so every
   `requirePermission` gate is credential-scheme-agnostic.

4. **Persist role names only; derive at auth time (spec §1, §6, §9).** Grants
   are never persisted anywhere. `deriveRolePermissions()` runs on every
   request. Editing a role definition in code changes every holder's
   capabilities on the next deploy with no data migration.

5. **URN grammar is an internal contract (spec §4.3).** URNs appear only in role
   grants and route authorization specs; they are never persisted and never
   serialized to clients. Admin resources are **bare-kind**
   (`urn:kixx:admin:<kind>`); publishing `page-metadata`/`include` are
   **scoped** (`:*` wildcard in grants), `asset`/`template` are **bare-kind**.
   The two forms do not overlap.

6. **Shared-normalization invariant (spec §8.3).** Where a resource URN depends
   on request params, the authorization resolver and the request handler
   normalize those params through the **same** helper module
   (`route-params.js`), guaranteeing the URN that was *authorized* describes the
   pathname the handler *writes*. This is a security invariant, not code reuse.

7. **Startup-time spec validation (spec §8.1, §13).** `requirePermission()`
   validates its spec when called at route-module load, so a misconfigured
   route crashes at startup rather than failing per request.

8. **Three-layer role validation (spec §9.1).** Record `validate()`: `roles` is
   an array of non-empty strings (empty valid), no membership check. Form
   `validate()`: submitted role required and `isRoleName(name, category)`. Mint
   API: non-empty array, every member `isRegisteredRoleName()`, plus any
   capability bound (`areRoleGrantsWithinDomain()`).

### Build / ship order

The evaluator fails closed, so a route gated before its principals carry roles
would 403 every request. Even greenfield, tasks ship bottom-up: mechanism →
storage → authentication derivation → route enforcement → delegation →
surfaces. Enforcement (T7, T8) must not merge before derivation (T6).

### Reused framework surface (already present, do not rebuild)

- `app/lib/publishing-permissions.js` — the evaluator core (`evaluatePermissions`,
  `doesPatternMatch`, deny-overrides-allow loop) is already generic and moves
  wholesale into `permissions.js`.
- `app/presentation/lib/json-api.js` — `parseBasicAuthCredentials`,
  `assertJsonApiContentType`, `parseJsonApiResource`, `jsonApiResource`.
- `kixx/errors/mod.js` — `ForbiddenError` (expected HTTP 403, accepts
  `{ code, cause }`), `UnauthenticatedError`, `BadRequestError`, `AssertionError`.
- `kixx/assertions/mod.js` — `assert`, `assertNonEmptyString`, `isPlainObject`,
  `isString`, `isNonEmptyString`.
- `kixx/utils/validate-pathname.js` — path-traversal-rejecting pathname
  validator already used by the publishing handlers.
- `jsonApiErrorHandler` / `adminErrorHandler` — already attached; expected
  errors with a `code` serialize appropriately.

---

## Task Index

- **T1** — Generic evaluator module (`permissions.js`)
- **T2** — Role registry (`roles.js`)
- **T3** — `requirePermission` middleware factory
- **T4** — Publishing-token role storage
- **T5** — Admin-user & invite role storage + principal projection
- **T6** — Authentication grant derivation (three middleware)
- **T7** — Publishing route enforcement + shared route-params
- **T8** — Admin route enforcement + auth relocation
- **T9** — Invite delegation & role conferral
- **T10** — Administrative surfaces & forms

---

### Task T1: Generic permission evaluator module

**Status:** Complete
**Depends on:** None
**Documentation:** Spec §5 (grants, evaluation, pattern matching, assert helper); §11 (module map).

**Objective**

A single, application-wide, domain-agnostic evaluator: a pure
`evaluatePermissions(permissions, { action, resource })` boolean and a throwing
`assertPermission(context, decision, options)`. This is the one place grant
grammar lives; the registry and middleware depend on it and nothing depends on a
second evaluator.

**Scope**

- In: renaming `publishing-permissions.js` → `permissions.js`; preserving the
  evaluator and pattern-matcher verbatim; adding `assertPermission()`; deleting
  the stored-grant validators.
- Out: the role registry (T2); any change to how grants are produced.

**Design and invariants**

- Keep `evaluatePermissions()` and `doesPatternMatch()` byte-for-byte where
  possible — this is security-reviewed code (spec §5.3 forbids extending the
  grammar without a security review).
- **Delete** `validatePermissions()` and `ALLOW_ALL_PUBLISHING_PERMISSIONS`:
  grants are no longer stored, so validating a stored-grant shape is dead code.
- Add `assertPermission(context, decision, options)` (spec §5.4): evaluates
  `context.user?.permissions`; returns `undefined` when allowed; when denied
  throws `ForbiddenError` with `options.message` or the generic default
  `'You are not authorized to perform this request.'`. The `code` option must
  be **omitted entirely** (not passed as `undefined`) when the caller does not
  override it, so the class default applies.
- Fail closed on malformed input (non-array permissions, non-string
  action/resource → not allowed).

**Expected touch points**

- `src/app/lib/permissions.js` — new file (renamed from `publishing-permissions.js`).
- `src/app/lib/publishing-permissions.js` — removed.
- Importers of the old module updated in later tasks (T6/T7 replace them);
  within T1, update any import that would break the build.

**Acceptance criteria**

- [ ] `evaluatePermissions()` behavior is unchanged (deny-overrides-allow,
      default deny, scoped/bare/full wildcard rules).
- [ ] `assertPermission()` returns `undefined` when allowed and throws
      `ForbiddenError` when denied, honoring `message`/`code` overrides and
      omitting `code` when not supplied.
- [ ] The stored-grant validators are gone and no remaining import references
      them.
- [ ] Linter clean on all changed files.

**Validation**

- `node run-linter.js src/app/lib/permissions.js` — style/lint clean.
- `grep -rn "publishing-permissions" src` returns nothing (rename complete).
- Manual: trace one allow and one deny decision by reading the code path.

**Progress and handoff**

- Completed: `src/app/lib/permissions.js` created (renamed from
  `publishing-permissions.js`) with `evaluatePermissions()` and
  `doesPatternMatch()` preserved byte-for-byte in behavior; the stored-grant
  validators (`validatePermissions()`, `ALLOW_ALL_PUBLISHING_PERMISSIONS`)
  deleted; `assertPermission(context, decision, options)` added, evaluating
  `context.user?.permissions`, throwing `ForbiddenError` with
  `options.message` or the default `'You are not authorized to perform this
  request.'`, and omitting the `code` option key entirely (not `undefined`)
  when the caller does not supply one, so `ForbiddenError`'s
  `WrappedError`-derived class-default `code` applies (verified against
  `src/kixx/errors/lib/wrapped-error.js` constructor logic).
- Current state: Task complete. All acceptance criteria met.
- Remaining: Nothing for T1. Note for T6/T7: `publishing-authentication.js`
  currently imports only `evaluatePermissions` from the new module path
  (mechanical import-path fix only, not a rework) — T6/T7 will replace
  `assertPublishingPermission()` there entirely per their own scope.
- Decisions and discoveries:
  - The old module had two additional importers not listed in the plan's
    "Expected touch points" for T1:
    `create-publishing-api-token-form.js` (used `validatePermissions()`) and
    `publishing-api-token-admin-form.js` (used
    `ALLOW_ALL_PUBLISHING_PERMISSIONS`). Since T1's acceptance criteria
    requires zero remaining imports of the deleted validators, and T2 (role
    registry) is a hard dependency for a real role-based rework of these
    forms (owned by T4/T10), I inlined transitional, file-private
    equivalents in both forms (`isSupportedPermissionsGrant()` in
    `create-publishing-api-token-form.js`; a local frozen
    `ALLOW_ALL_PERMISSIONS` constant in
    `publishing-api-token-admin-form.js`), each marked with a comment noting
    they will be replaced by role-based validation. This preserves current
    behavior/build without importing from `permissions.js` and without
    front-running T4/T10's actual role-storage rework. T4/T10 should
    remove/replace these transitional helpers when they rewrite the forms —
    do not treat them as new permanent abstractions.
  - The spec file `prompts/plans/role-based-permissions-specification.md`
    cited throughout this plan was deleted from the repo in an earlier
    cleanup commit (`34e6aa6`, "Remove old prompts directory") and is not
    present in the working tree. Per user direction, later tasks should
    proceed from this plan document alone rather than recovering the spec
    from git history.
- Actual files changed:
  - `src/app/lib/permissions.js` (new, replaces `publishing-permissions.js`)
  - `src/app/lib/publishing-permissions.js` (deleted)
  - `src/app/presentation/middleware/publishing-authentication.js` (import
    path only)
  - `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`
    (transitional inline validation, see discoveries above)
  - `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js`
    (transitional inline constant, see discoveries above)
- Validation run: `node run-linter.js src/app/lib/permissions.js
  src/app/presentation/middleware/publishing-authentication.js
  src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js
  src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js`
  — clean, exit 0. `grep -rn "publishing-permissions" src` — no matches.
  Manual trace: an allow decision (`evaluatePermissions([{effect:'allow',
  action:['*'], resource:'*'}], {action:'x', resource:'y'})` → `true`) and a
  deny decision (same permissions array plus a matching `deny` grant for the
  same action/resource → `false`, deny-overrides-allow) were traced by
  reading the loop in `evaluatePermissions()`; behavior is unchanged from the
  original module.
- Blockers: None.

---

### Task T2: Role registry (`roles.js`)

**Status:** Complete
**Depends on:** T1
**Documentation:** Spec §6 (registry, categories, domain bounding, delegation, catalog); §5.1 (array-action rule).

**Objective**

The single module owning every role definition and the derived-policy helpers.
Roles are the only producer of grants; storage and authentication depend on this
module resolving names into grants.

**Scope**

- In: frozen role definitions for the tailored catalog; all exported registry
  operations; fail-closed derivation; cloned grants; array-action normalization.
- Out: any persistence; any HTTP concern; UI option rendering (T10 composes
  `filterGrantableRoles`).

**Design and invariants**

- Definitions are frozen `{ name, category, permissions }` with frozen grant
  arrays and frozen grants (spec §6). Role-name constants exported
  (`ROLE_ROOT_ADMIN`, `ROLE_SUPER_ADMIN`, `ROLE_PLATFORM_ADMIN`, `ROLE_EDITOR`)
  — these are permanent persistence contracts.
- Single namespace; names unique across categories.
- Exported operations (spec §6): `isRegisteredRoleName(name)`,
  `isRoleName(name, category)` (category **required**),
  `listRoles(category)` (category required, definition order),
  `deriveRolePermissions(roleNames)` (category-agnostic, fail-closed, returns
  **cloned** grants), `areRoleGrantsWithinDomain(roleName, domain)`,
  `canGrantRole(permissions, roleName)`, `filterGrantableRoles(permissions, category)`.
- `areRoleGrantsWithinDomain()`: prefix is `urn:kixx:<domain>:` (trailing colon
  load-bearing); every action element (normalized to array) **and** resource of
  every grant must start with it; deny grants held to the same bound;
  unregistered name → `false`. `Root Admin`'s `*` fails for every domain.
- `canGrantRole()`: unregistered → `false`; for each grant, each action element
  (normalized) evaluated as decision `{ action: element, resource: grant.resource }`
  against the granter's permissions via `evaluatePermissions()`; all must pass.
  Pattern-vs-pattern, deliberately conservative (spec §6.3) — do **not** add
  subset analysis. `Root Admin` is not special-cased here.
- `filterGrantableRoles()`: `listRoles(category)` filtered by `canGrantRole()`,
  **always excluding `Root Admin`**.

**Expected touch points**

- `src/app/lib/roles.js` — new file.

**Acceptance criteria**

- [ ] The four roles are defined exactly per the catalog table with correct
      categories, grants, and scoped/bare-kind resource forms.
- [ ] Every helper that reads grant `action` normalizes it to an array first.
- [ ] `deriveRolePermissions()` never throws on bad input and returns cloned
      (mutation-safe) grants.
- [ ] `areRoleGrantsWithinDomain('Root Admin', 'admin')` is `false`;
      `areRoleGrantsWithinDomain('Editor', 'publishing')` is `true`.
- [ ] `filterGrantableRoles()` never includes `Root Admin`.
- [ ] Linter clean.

**Validation**

- `node run-linter.js src/app/lib/roles.js`.
- Manual: hand-trace `canGrantRole(superAdminPerms, 'Platform Admin')` → true,
  and `canGrantRole(platformAdminPerms, 'Super Admin')` → false.

**Progress and handoff**

- Completed: `src/app/lib/roles.js` created with the four catalog roles
  (`ROLE_ROOT_ADMIN`, `ROLE_SUPER_ADMIN`, `ROLE_PLATFORM_ADMIN`,
  `ROLE_EDITOR` name constants) as frozen `{ name, category, permissions }`
  definitions with frozen grant arrays and frozen grants (via a private
  `defineRole()` builder), grants matching the catalog table exactly
  (admin grants: bare-kind resource + `:*`-scoped action; publishing
  `page-metadata`/`include`: `:*`-scoped resource + bare `put` action;
  publishing `asset`/`template`: bare-kind resource + bare `put` action).
  All seven exported operations implemented:
  `isRegisteredRoleName`, `isRoleName` (category required, asserted),
  `listRoles` (category required, asserted, definition order via `.filter()`
  over the frozen definitions array), `deriveRolePermissions` (non-array →
  `[]`, unknown name skipped, returns fresh cloned grant objects via a
  private `cloneGrant()` — not frozen, so a caller assembling
  `context.user.permissions` can safely hold/extend the array),
  `areRoleGrantsWithinDomain` (domain required, asserted; `urn:kixx:<domain>:`
  prefix check on every grant's action elements *and* resource, regardless
  of effect; unregistered name → `false`), `canGrantRole` (unregistered →
  `false`; every grant's every normalized action element evaluated as an
  independent `evaluatePermissions()` decision against the granter's
  permissions — no subset analysis), `filterGrantableRoles`
  (`listRoles(category)` filtered by `canGrantRole()`, with `Root Admin`
  excluded by an explicit name check independent of `canGrantRole()`'s
  result, so it is excluded even for a `Root Admin` granter).
- Current state: Task complete. All acceptance criteria met.
- Remaining: Nothing for T2.
- Decisions and discoveries:
  - Grants store `action` as a single string per catalog row (not
    single-element arrays) since every consumer (`evaluatePermissions()` in
    T1, and this module's own `areRoleGrantsWithinDomain()`/`canGrantRole()`)
    already normalizes `Array.isArray(grant.action) ? grant.action :
    [grant.action]` before inspecting it, per the plan's array-action
    cross-cutting rule. This keeps the catalog literals matching the plan's
    table shape exactly (`action → resource`, one pair per row) while still
    satisfying the normalization invariant at every read site.
  - Added `assertNonEmptyString` guards on the `category`/`domain`
    parameters of `isRoleName`, `listRoles`, and `areRoleGrantsWithinDomain`
    since the plan marks them "required" and every real call site supplies a
    literal — an omitted category is a programmer error, not user input, per
    the error-handling guide's assertion rules. `deriveRolePermissions()` and
    `canGrantRole()` were deliberately left unguarded on their
    `roleNames`/`permissions` arguments so they stay fail-closed (never
    throw) on attacker- or storage-influenced input, per the plan's
    fail-closed cross-cutting rule.
  - Validated by hand-trace rather than a throwaway script, per AGENTS.md's
    restriction on writing verification code: confirmed
    `areRoleGrantsWithinDomain('Root Admin', 'admin')` is `false` (its `'*'`
    action doesn't start with `'urn:kixx:admin:'`),
    `areRoleGrantsWithinDomain('Editor', 'publishing')` is `true` (all 4
    grants' action and resource strings start with
    `'urn:kixx:publishing:'`), `canGrantRole(deriveRolePermissions(['Super
    Admin']), 'Platform Admin')` is `true` (Platform Admin's one grant
    exactly matches Super Admin's `publishing-api-tokens` grant), and
    `canGrantRole(deriveRolePermissions(['Platform Admin']), 'Super Admin')`
    is `false` (Super Admin's `admin-user-invites` grant has no match in
    Platform Admin's single-grant set).
- Actual files changed:
  - `src/app/lib/roles.js` (new)
- Validation run: `node run-linter.js src/app/lib/roles.js` — clean, exit 0.
  Hand-traced scenarios above (no script executed).
- Blockers: None.

---

### Task T3: `requirePermission` middleware factory

**Status:** Complete
**Depends on:** T1
**Documentation:** Spec §8 (factory contract, attachment, error ordering).

**Objective**

A factory that attaches an authorization decision to route configuration so no
request-handler body makes an authorization decision.

**Scope**

- In: the `requirePermission({ action, resource, code, message })` factory and
  its startup validation.
- Out: the configured instances (T7 publishing, T8 admin); resolvers (T7).

**Design and invariants**

- `action` required non-empty string. `resource` required: static URN string
  **or** resolver `(context, request) => string`.
- `code`/`message` optional; **only supplied keys forwarded** to
  `assertPermission()` (omitted `code` falls back to class default).
- Validate the spec **when the factory is called** (route-module load): a
  misconfiguration crashes at startup (spec §8.1).
- Returned middleware has `(context, request, response)` signature, is a
  **named** function, resolves the resource (calling a resolver when present),
  calls `assertPermission()`, returns `response`.
- **Resolver errors propagate untouched** (a `BadRequestError` for a malformed
  pathname is ordinary client input; do not catch or wrap).

**Expected touch points**

- `src/app/presentation/middleware/require-permission.js` — new file.

**Acceptance criteria**

- [ ] Calling the factory with an invalid spec throws at construction time.
- [ ] The returned middleware is named, resolves static and function resources,
      and threads `response`.
- [ ] `code`/`message` forwarding omits unset keys.
- [ ] Resolver-thrown errors are not caught.
- [ ] Linter clean.

**Validation**

- `node run-linter.js src/app/presentation/middleware/require-permission.js`.
- Manual: construct a static-resource instance and a resolver instance; confirm
  a bad spec crashes at load.

**Progress and handoff**

- Completed: `src/app/presentation/middleware/require-permission.js` created,
  exporting `requirePermission(spec)`. Validates `spec.action` (required
  non-empty string via `assertNonEmptyString`) and `spec.resource` (required
  — either a non-empty string or a function, via `assert(isNonEmptyString ||
  isFunction, ...)`), plus lightly type-checks optional `spec.code` /
  `spec.message` when present, all synchronously at factory-call time so a
  bad route spec crashes when the route module loads (module-level
  `requirePermission({...})` calls at import time), not on first request.
  Returns a named function `enforcePermission(context, request, response)`
  that resolves `resource` (calling it with `(context, request)` when it's a
  function, using it as-is when it's a static string), calls
  `assertPermission(context, { action, resource: resolvedResource },
  assertionOptions)` from T1's `permissions.js`, and returns `response`.
  `assertionOptions` only contains `code`/`message` keys the caller actually
  supplied, matching T1's `assertPermission()` contract for falling back to
  `ForbiddenError`'s class-default code. The resolver call is not
  try/caught, so a resolver's thrown error (e.g. a `BadRequestError` for a
  malformed pathname, to be wired in T7) propagates untouched instead of
  being reframed as a 403.
- Current state: Task complete. All acceptance criteria met.
- Remaining: Nothing for T3. T7/T8 will construct the actual
  `requirePermission({...})` instances (publishing `authorization.js`,
  admin `admin-authorization.js`) and wire them into `virtual-hosts.js`
  `requestHandlers` arrays.
- Decisions and discoveries:
  - Reviewed `src/virtual-hosts.js` to confirm `requestHandlers` entries are
    plain `(context, request, response)` functions (some are factory-return
    values, e.g. `HyperviewStaticPageHandler()`), so `requirePermission()`
    returning a middleware function to be placed at the head of a target's
    `requestHandlers` array (per T7/T8) fits the existing router contract
    with no changes needed to the router itself.
  - Added conservative type-checks on optional `code`/`message` (must be
    strings when present) beyond the plan's explicit acceptance criteria,
    since a misconfigured non-string value would otherwise silently reach
    `ForbiddenError`'s constructor and produce a confusing runtime error
    far from the route definition that caused it — consistent with
    "validate the spec... so a misconfigured route crashes at startup."
- Actual files changed:
  - `src/app/presentation/middleware/require-permission.js` (new)
- Validation run: `node run-linter.js
  src/app/presentation/middleware/require-permission.js` — clean, exit 0.
  Hand-traced (no script executed, per AGENTS.md): a spec with a missing
  `action` throws `AssertionError` from `assertNonEmptyString` before the
  function returns (construction-time crash, satisfying the startup-crash
  requirement); a spec with `resource` as neither a string nor a function
  throws from the `assert()` call for the same reason; a static-string
  resource instance and a resolver-function instance both produce a
  middleware whose body threads `response` unchanged when
  `assertPermission()` does not throw.
- Blockers: None.

---

### Task T4: Publishing-token role storage

**Status:** Complete
**Depends on:** T2
**Documentation:** Spec §6.2 (domain bounding), §9 (storage), §9.1 (validation layering).

**Objective**

Publishing tokens store role **names** (`roles`), never grants, and the mint
path enforces registered-name membership plus the publishing domain bound.

**Scope**

- In: `publishing-api-token-record.js` schema/`validate()`; `createToken()`
  mint assertions; `revoke()`.
- Out: authentication derivation (T6); token forms/responses (T10).

**Design and invariants**

- Record: **remove** `permissions` from schema/required/writes; **add** `roles`.
  `validate()`: `roles` is an array of non-empty strings, **empty valid**, no
  membership check (spec §9.1). No legacy "missing → `[]`" normalization
  (greenfield).
- `createToken()`: assert `roles` is a non-empty array, every member
  `isRegisteredRoleName()`, **and** `areRoleGrantsWithinDomain(name, 'publishing')`
  (spec §6.2) — both assertions (programmer errors), asserted in order. Clone
  `roles` before persisting.
- `revoke()` continues to work; it sets `revokedAt` and updates. (No missing-role
  normalization needed since every record carries `roles`.)

**Expected touch points**

- `src/app/collections/publishing-api-token-record.js` — schema + validate.
- `src/app/collections/publishing-api-token-collection.js` — `createToken()`.

**Acceptance criteria**

- [ ] Record stores `roles`, not `permissions`; empty `roles` array validates.
- [ ] `createToken()` rejects an unregistered name and any role failing the
      publishing domain bound (e.g. `Root Admin`) via assertion.
- [ ] `roles` cloned before persistence.
- [ ] Linter clean.

**Validation**

- `node run-linter.js src/app/collections/publishing-api-token-record.js src/app/collections/publishing-api-token-collection.js`.
- Manual: attempt `createToken` with `['Root Admin']` → assertion; with
  `['Editor']` → succeeds.

**Progress and handoff**

- Completed: `publishing-api-token-record.js` schema/`validate()` now store
  and validate `roles` (array of non-empty strings via
  `roles.every(isNonEmptyString)`, empty array valid, no registry-membership
  check — an inline comment explains this is intentional so a retired role
  name doesn't brick an existing record) instead of `permissions`. The
  `required` list swaps `'permissions'` → `'roles'`.
  `publishing-api-token-collection.js#createToken()` now takes `args.roles`
  instead of `args.permissions` and asserts, in order: (1) `roles` is a
  non-empty array, (2) `roles.every(isRegisteredRoleName)`, (3)
  `roles.every((name) => areRoleGrantsWithinDomain(name, 'publishing'))` —
  all three as `AssertionError`s (programmer errors: an unregistered or
  out-of-domain role reaching this method is a caller bug, not user input).
  `roles.slice()` clones before persistence (a cheap shallow copy suffices
  since roles are plain strings, unlike the old `structuredClone()` needed
  for nested grant objects).
- Current state: Task complete. All acceptance criteria for T4 met.
- Remaining: Nothing for T4 itself.
- Decisions and discoveries:
  - **Transient break, intentionally left for T10**: the Transaction Script
    `src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js`
    still destructures `permissions` off `form.toJSON()` and passes
    `permissions` (not `roles`) to `createToken()`, and its return value
    still reads `record.get('permissions')` (now `undefined`, since the
    record schema no longer has that field). This will now throw
    `PublishingApiTokenCollection#createToken() roles must be a non-empty
    array` at runtime if that endpoint is hit. This file is an explicit T10
    touch point ("Publishing token forms: no role picker... Mint API
    response returns roles") and was intentionally left alone here — T4's
    scope is storage only, and T10 depends on T9 (delegation pattern
    reference) landing first per the plan's dependency graph. Until T10
    lands, publishing-token creation is broken end-to-end; this is expected
    per the plan's "Build/ship order" note that tasks ship bottom-up with
    transient inconsistency between task boundaries, not per-task
    isolation. **Next agent picking up T10 must update this transaction
    script** (swap `permissions` → `roles` in both the destructure and the
    return value) as part of that task, even though the plan's T10 touch
    point list already names this file for the response-shape change — the
    argument-passing fix is the same edit.
  - The two form files touched transitionally in T1
    (`create-publishing-api-token-form.js`,
    `publishing-api-token-admin-form.js`) still produce `permissions` in
    their `toJSON()` output; T10 will replace that with role-based output
    (`roles: ['Editor']` default, or a validated single role) per its own
    scope, which also resolves the mismatch above.
- Actual files changed:
  - `src/app/collections/publishing-api-token-record.js`
  - `src/app/collections/publishing-api-token-collection.js`
- Validation run: `node run-linter.js
  src/app/collections/publishing-api-token-record.js
  src/app/collections/publishing-api-token-collection.js` — clean, exit 0.
  Hand-traced (no script executed, per AGENTS.md): `createToken()` called
  with `roles: ['Root Admin']` fails the third assertion
  (`areRoleGrantsWithinDomain('Root Admin', 'publishing')` is `false`, per
  T2's hand-trace); called with `roles: ['Editor']` passes all three
  assertions (`Editor` is registered and
  `areRoleGrantsWithinDomain('Editor', 'publishing')` is `true`).
- Blockers: None for T4. Flagging for whoever picks up T9/T10: the
  publishing-token creation path (panel form → admin-api form → Transaction
  Script → Collection) is left in a non-functional transitional state until
  T10 lands; this is a known, plan-anticipated gap, not a regression to
  chase down separately.

---

### Task T5: Admin-user & invite role storage + principal projection

**Status:** Complete
**Depends on:** T2
**Documentation:** Spec §7 (principal contract), §9 (storage), §9.3 (invite storage).

**Objective**

Admin users and admin invites store role **names** with the lenient record
layer, and the admin-user projection carries roles for downstream derivation.

**Scope**

- In: `admin-user-record.js` (schema/`validate()`/`toAuthenticatedUser()`);
  `admin-invite-record.js` (schema/`validate()`); `admin-user-collection.js`
  create path to accept `roles`.
- Out: deriving `permissions` onto the context (T6); delegation enforcement (T9).

**Design and invariants**

- Both records: add `roles`, validate as array of non-empty strings, empty
  valid, no membership check. No legacy normalization.
- `toAuthenticatedUser()` includes `roles` (raw names). It must **not** compute
  `permissions` — derivation belongs to authentication middleware (T6, spec §7),
  keeping the projection persistence-shaped and the derivation single-sourced.
- `createNewAdminUser()` accepts and stores `roles` (defaulting to `[]` only at
  the create call boundary, not via record normalization).

**Expected touch points**

- `src/app/collections/admin-user-record.js`
- `src/app/collections/admin-invite-record.js`
- `src/app/collections/admin-user-collection.js`

**Acceptance criteria**

- [ ] Admin-user and invite records store and validate `roles` leniently.
- [ ] `toAuthenticatedUser()` exposes `roles` and still omits the password hash.
- [ ] `createNewAdminUser()` persists provided `roles`.
- [ ] Linter clean.

**Validation**

- `node run-linter.js src/app/collections/admin-user-record.js src/app/collections/admin-invite-record.js src/app/collections/admin-user-collection.js`.
- Manual: create an admin record with `roles: ['Super Admin']`; confirm
  `toAuthenticatedUser()` carries it.

**Progress and handoff**

- Completed:
  - `admin-user-record.js`: added `roles` (array of non-empty strings,
    empty valid, no registry-membership check) to schema/`required`/
    `validate()`. `toAuthenticatedUser()` now includes `roles: this.get('roles')`
    alongside the existing fields, still omitting `passwordHash`.
  - `admin-invite-record.js`: same `roles` addition to schema/`required`/
    `validate()`.
  - `admin-user-collection.js`: `createNewAdminUser()` now defaults a
    missing `roles` to `[]` **at the create-call boundary** (destructured
    from `attributes` with a default, not inside `validate()`), per the
    plan's explicit instruction not to add legacy-normalization to the
    record layer. Added a `@param`/`@returns` JSDoc block that this method
    previously lacked.
  - Updated `@returns` JSDoc on `authenticate-admin-session.js` and
    `verify-admin-credentials.js` to include `roles: string[]`, since both
    return `user.toAuthenticatedUser()` verbatim and their documented
    return shape was now stale.
- Current state: Task complete. All T5 acceptance criteria met.
- Remaining: Nothing for T5 itself. T9 will add delegation-checked role
  assignment on top of the plumbing below (validating a submitted role,
  passing `roles: [name]` into `createInvite()`, and having
  `consumeAdminInvite()`/`createAdminUserAccount()` thread real role names
  instead of relying on the `[]` defaults introduced here).
- Decisions and discoveries:
  - **Went beyond the listed touch points**: `admin-invite-collection.js`
    was not in T5's "Expected touch points" list, but making `roles`
    *required* on `AdminInviteRecord` means its two existing creation call
    sites (`createInvite()`, `createConsumedBootstrapMarker()`) would
    immediately throw `ValidationError` on every invite creation —
    unconditionally, not just when a mismatched-shape call happens to run
    (unlike T4's transaction-script gap, which only fires on that one
    endpoint). Per the plan's own instruction that touch-point lists are
    "orientation, not permission to ignore other necessary files," I
    applied the same create-call-boundary-default pattern already
    established for `AdminUserCollection`: `createInvite()` now accepts an
    optional `args.roles` defaulting to `[]`, and
    `createConsumedBootstrapMarker()` passes `roles: []` explicitly (a
    bootstrap marker never carries a chosen role — bootstrap redemption
    confers `Root Admin` directly at redemption time per T9, not from this
    record). This keeps `create-admin-invite.js`'s current
    `invites.createInvite(context, { createdBy })` call (no `roles` key)
    working unchanged; T9 will pass an explicit validated `roles: [name]`
    once delegation checking exists, which this plumbing already supports.
  - Confirmed via `grep` that `toAuthenticatedUser()` has exactly three
    callers (`create-admin-user-account.js`, `authenticate-admin-session.js`,
    `verify-admin-credentials.js`); all three return the projection object
    verbatim with no field-picking, so adding `roles` to it required no
    caller changes beyond the two JSDoc corrections above.
  - Did not defensively clone `this.get('roles')` inside `toAuthenticatedUser()`
    before returning it (unlike the codebase's existing
    `structuredClone(record.get('permissions'))` pattern in
    `publishing-authentication.js`, which T6 will remove). Per the plan,
    `context.user.permissions` — the array a request-scoped principal object
    actually needs to be mutation-safe — is produced by T6's
    `deriveRolePermissions()` (which already clones each grant, see T2), not
    by copying the raw stored `roles` names array. Cloning the raw names
    array here would be speculative hardening with no identified caller that
    mutates it; left as a live reference to the record's internal array,
    consistent with every other field this method already returns the same
    way (e.g. `emailAddress`).
- Actual files changed:
  - `src/app/collections/admin-user-record.js`
  - `src/app/collections/admin-invite-record.js`
  - `src/app/collections/admin-user-collection.js`
  - `src/app/collections/admin-invite-collection.js` (not in the plan's
    listed touch points — see discoveries above)
  - `src/app/transaction-scripts/admin-users/authenticate-admin-session.js`
    (JSDoc only)
  - `src/app/transaction-scripts/admin-users/verify-admin-credentials.js`
    (JSDoc only)
- Validation run: `node run-linter.js src/app/collections/admin-user-record.js
  src/app/collections/admin-invite-record.js
  src/app/collections/admin-user-collection.js
  src/app/collections/admin-invite-collection.js
  src/app/transaction-scripts/admin-users/authenticate-admin-session.js
  src/app/transaction-scripts/admin-users/verify-admin-credentials.js` —
  clean, exit 0. Manual trace: an `AdminUserRecord` created via
  `createNewAdminUser(context, { emailAddress, passwordHash })` (no `roles`
  key, matching today's only caller) validates successfully with
  `roles: []`; a record created with `roles: ['Super Admin']` validates and
  `toAuthenticatedUser()` surfaces it unchanged.
- Blockers: None.

---

### Task T6: Authentication grant derivation

**Status:** Complete
**Depends on:** T2, T4, T5
**Documentation:** Spec §7 (principal contract), §3 (request flow).

**Objective**

Every authentication middleware derives grants onto `context.user.permissions`
via `deriveRolePermissions()` so all downstream gates are
credential-scheme-agnostic.

**Scope**

- In: publishing bearer (`publishing-authentication.js`), admin session cookie
  (`admin-authentication.js`), admin HTTP Basic (`admin-api-authentication.js`)
  — each sets `roles` + `permissions: deriveRolePermissions(roles)`.
- Out: `assertPublishingPermission()` (removed in T7); route wiring (T7/T8).

**Design and invariants**

- Read stored role names off the credential record (defaulting to `[]`); set
  `roles` and `permissions` on the principal. **Do not reject** empty or unknown
  roles — that outcome is a later 403, not a 401 (spec §3, §7).
- No secrets on the principal (spec §7): ids, role names, derived grants, audit
  fields only.
- The admin-api Basic middleware must set `context.user` (today the token-create
  handler authenticates inline without it — T8 relocates that; T6 ensures the
  middleware path derives permissions).
- Remove the now-obsolete `structuredClone(record.get('permissions'))` on the
  publishing principal; publishing tokens no longer store grants.

**Expected touch points**

- `src/app/presentation/middleware/publishing-authentication.js`
- `src/app/presentation/middleware/admin-authentication.js`
- `src/app/presentation/middleware/admin-api-authentication.js`
- `src/app/transaction-scripts/.../authenticate-*.js` — only if the projection
  needs role names threaded through (verify during implementation).

**Acceptance criteria**

- [ ] All three middleware set `context.user.permissions` from
      `deriveRolePermissions(roles)`.
- [ ] A valid credential with empty/unknown roles authenticates (no 401) and
      derives `[]`.
- [ ] No plaintext secret or stored-grant array remains on the principal.
- [ ] Linter clean.

**Validation**

- `node run-linter.js` on all three middleware files.
- Manual: trace each scheme setting `roles` + derived `permissions`; confirm an
  empty-roles credential does not 401.

**Progress and handoff**

- Completed: All three authentication middleware now derive
  `context.user.permissions` via `deriveRolePermissions()` from `roles.js`
  (T2):
  - `publishing-authentication.js`: reads `record.get('roles')` (T4's new
    field) and sets both `roles` and `permissions:
    deriveRolePermissions(roles)` on the principal. Removed the obsolete
    `structuredClone(record.get('permissions'))` — publishing tokens no
    longer store grants, only role names. `assertPublishingPermission()`
    and its `evaluatePermissions` import were deliberately left in place
    (T7's job to remove, per T6's explicit "Out" scope).
  - `admin-authentication.js` (session cookie): `authenticateAdminSession()`
    already returns `roles` via T5's `toAuthenticatedUser()`; middleware now
    wraps that with `Object.assign({}, user, { permissions:
    deriveRolePermissions(user.roles) })` before `context.setUser()`.
  - `admin-api-authentication.js` (HTTP Basic): same pattern —
    `Object.assign({}, admin, { permissions: deriveRolePermissions(admin.roles) })`
    before `context.setUser()`. This middleware already called
    `context.setUser()` for every request through it; T6 only added
    derivation. (The token-create handler's separate *inline* Basic-auth
    bypass, which does not go through this middleware at all, is T8's
    relocation target, not touched here.)
  - Did not extract a shared "derive and set user" helper: each call site is
    a 2–3 line `Object.assign` (or, for publishing, direct object literal
    construction) using the same `deriveRolePermissions()` function, so the
    "same way" cross-cutting requirement is satisfied by calling the same
    T2 function, not by sharing a wrapper — a 2-line pattern repeated 3
    times does not meet this project's bar for extracting an abstraction.
- Current state: Task complete. All T6 acceptance criteria met.
- Remaining: Nothing for T6 itself. T7 removes
  `assertPublishingPermission()` from `publishing-authentication.js`
  entirely (along with its now-sole remaining use of `evaluatePermissions`
  in that file) as part of moving publishing enforcement to
  `requirePermission()` instances. T8 relocates the admin-api token-create
  handler's inline Basic-auth into route `inboundMiddleware` so it goes
  through `admin-api-authentication.js` (and therefore now gets derived
  permissions) instead of authenticating ad hoc.
- Decisions and discoveries:
  - Confirmed `authenticatePublishingToken` in
    `transaction-scripts/publishing-api-tokens/authenticate-publishing-token.js`
    returns the raw `PublishingApiTokenRecord` (not a projection), so
    `record.get('roles')` in the middleware is a direct, correct read of
    T4's new field.
  - Confirmed via T5 handoff notes that `toAuthenticatedUser()` on both
    `AdminUserRecord` paths already carries `roles`, so no further record
    changes were needed here — T6 was purely middleware-layer work, as
    scoped.
- Actual files changed:
  - `src/app/presentation/middleware/publishing-authentication.js`
  - `src/app/presentation/middleware/admin-authentication.js`
  - `src/app/presentation/middleware/admin-api-authentication.js`
- Validation run: `node run-linter.js` on all three files above — clean,
  exit 0. Hand-traced (no script executed, per AGENTS.md): a publishing
  token record with `roles: []` authenticates without throwing and derives
  `permissions: []` (no 401, per `deriveRolePermissions()`'s fail-closed,
  never-throws contract from T2); a publishing token record with
  `roles: ['Editor']` derives the four Editor grants; an admin session for a
  user with `roles: ['Root Admin']` derives the single `{action:'*',
  resource:'*'}` grant. Confirmed neither admin principal object carries
  `passwordHash` (both source from `toAuthenticatedUser()`, which already
  omitted it before this task) and the publishing principal no longer
  carries a raw stored grants array (only `roles` names and the freshly
  derived `permissions`).
- Blockers: None.

---

### Task T7: Publishing route enforcement + shared route-params

**Status:** Complete
**Depends on:** T3, T6
**Documentation:** Spec §8 (enforcement), §8.3 (shared-normalization invariant), §11.1 (targets).

**Objective**

Publishing writes are gated at the route layer by configured `requirePermission`
instances; the pathname normalization is shared by resolver and handler.

**Scope**

- In: `publishing-api/route-params.js` (extracted normalization);
  `publishing-api/authorization.js` (instances + resolvers); route wiring;
  removal of in-handler `assertPublishingPermission()` calls.
- Out: admin enforcement (T8); token forms (T10).

**Design and invariants**

- Extract `getWildcardPathname()` and `splitIncludeFilepath()` (currently
  duplicated in `put-page-metadata.js` / `put-page-include.js`, both wrapping
  `validate-pathname.js`) into `route-params.js`, imported by **both** the
  resolvers and the handlers (spec §8.3). Absent page wildcard → `'/'`.
- `authorization.js` exports one instance per target (spec §11.1):
  templates (one shared instance, static `urn:kixx:publishing:template`),
  `pages` (resolver → `urn:kixx:publishing:page-metadata:<pathname>`),
  `includes` (resolver → `urn:kixx:publishing:include:<filepath>`),
  `assets` (static `urn:kixx:publishing:asset`). All pass
  `code: 'PublishingApiTokenForbidden'` and the publishing message.
- Wire each instance at the **head** of its target's `requestHandlers` in
  `virtual-hosts.js`; keep `authenticatePublishingToken` at the subtree
  `inboundMiddleware`.
- Delete `assertPublishingPermission()` and its in-handler calls; handlers keep
  calling `route-params.js` for the pathname they write.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/route-params.js` — new.
- `src/app/presentation/request-handlers/publishing-api/authorization.js` — new.
- `src/app/presentation/request-handlers/publishing-api/put-page-metadata.js`,
  `put-page-include.js`, `put-template.js`, `put-static-asset.js` — drop
  in-handler auth; use shared route-params.
- `src/app/presentation/middleware/publishing-authentication.js` — remove
  `assertPublishingPermission()`.
- `src/virtual-hosts.js` — attach instances.

**Acceptance criteria**

- [ ] Each publishing PUT target has its gate at the head of `requestHandlers`.
- [ ] Resolver and handler use the same `route-params.js` helper (URN authorized
      == pathname written), including root `'/'`.
- [ ] No `assertPublishingPermission()` remains.
- [ ] Publishing 403s carry `code: 'PublishingApiTokenForbidden'`.
- [ ] Linter clean.

**Validation**

- `node run-linter.js` on all changed publishing files and `virtual-hosts.js`.
- Manual: for `PUT /publishing-api/v1/pages` (root) confirm the resolver
  authorizes `...:page-metadata:/` and the Editor scoped wildcard matches;
  confirm a path-traversal pathname yields 400 before 403/415.

**Progress and handoff**

- Completed:
  - `route-params.js` created, exporting `getWildcardPathname(request, name)`
    (unchanged behavior from the old `put-page-metadata.js` version: absent/
    empty wildcard → `'/'`, otherwise `validatePathname('/'+segments)`) and
    `splitIncludeFilepath(request, name)` (unchanged behavior from the old
    `put-page-include.js` version: throws `BadRequestError` with code
    `IncludeFilepathRequired` when segments are absent/empty; otherwise
    returns `{ filepath, pathname, filename }` via `validatePathname`).
  - `authorization.js` created, exporting four `requirePermission()`
    instances built from T3's factory: `requireTemplatePermission` (static
    resource `urn:kixx:publishing:template`), `requirePageMetadataPermission`
    (resolver using `getWildcardPathname()`, resource
    `urn:kixx:publishing:page-metadata:${pathname}`),
    `requireIncludePermission` (resolver using `splitIncludeFilepath()`,
    resource `urn:kixx:publishing:include:${filepath}`), and
    `requireAssetPermission` (static resource `urn:kixx:publishing:asset`).
    All four spread a shared `PUBLISHING_FORBIDDEN_OPTIONS` object
    (`code: 'PublishingApiTokenForbidden'`, the existing publishing forbidden
    message) so the T3 factory forwards those exact overrides to
    `assertPermission()` instead of `ForbiddenError`'s class defaults,
    preserving the publishing 403 wire contract.
  - All four publishing PUT handlers (`put-page-metadata.js`,
    `put-page-include.js`, `put-template.js`, `put-static-asset.js`) had
    their in-handler `assertPublishingPermission(...)` call deleted (replaced
    with a one-line comment noting authorization already ran at the route
    head) and their now-unused `assertPublishingPermission` import removed.
    `put-page-metadata.js` and `put-page-include.js` additionally had their
    local `getWildcardPathname()` / `splitIncludeFilepath()` function bodies
    deleted and replaced with an import from the new `route-params.js` (and
    their now-unused `validatePathname`/`BadRequestError` imports removed
    where nothing else in the file used them). `put-template.js` and
    `put-static-asset.js` keep their own local `getWildcardFilepath()`
    unchanged — per the plan's explicit scope, only `getWildcardPathname()`
    and `splitIncludeFilepath()` move to the shared module, since only the
    pages and includes targets have a resolver that needs to share
    normalization with its handler; the template/asset targets use a static
    resource and have no resolver to share with.
  - `publishing-authentication.js`: deleted `assertPublishingPermission()`
    and its JSDoc block entirely, along with the now-unused
    `evaluatePermissions` (from `permissions.js`) and `ForbiddenError`
    imports.
  - `virtual-hosts.js`: imported the four instances from
    `publishing-api/authorization.js` and prepended each to the head of its
    target's `requestHandlers` array (`requireTemplatePermission` on all
    three template targets — base/page/partial —, `requirePageMetadataPermission`
    on the pages `put-metadata` target, `requireIncludePermission` on the
    includes `put` target, `requireAssetPermission` on the assets `put`
    target), ahead of the existing `PublishingAPI.put*` handler. The subtree
    `inboundMiddleware` (`authenticatePublishingToken`) was left unchanged —
    it still authenticates before any target's gate runs.
- Current state: Task complete. All T7 acceptance criteria met.
- Remaining: Nothing for T7 itself.
- Decisions and discoveries:
  - Resolver functions in `authorization.js` take `(_context, request)` —
    the leading underscore on the unused `context` parameter was required to
    satisfy this project's `no-unused-vars` ESLint rule (`args: 'all'`,
    allowing only `/^_/`-prefixed unused args), discovered only after an
    initial lint failure; the resolver signature itself is fixed by T3's
    `requirePermission()` contract (`(context, request) => string`), so the
    parameter could not simply be dropped.
  - Confirmed via `grep` that no remaining file imports
    `assertPublishingPermission` or references `publishing-permissions`
    (both zero matches across `src/`), satisfying T7's and the
    still-standing T1 acceptance criteria together.
  - Verified route param names align with the resolvers: the `pages` route
    pattern is `/pages{/*pathname}` (param `pathname`, matching
    `getWildcardPathname(request, 'pathname')`) and the `includes` route
    pattern is `/includes/*filepath` (param `filepath`, matching
    `splitIncludeFilepath(request, 'filepath')`) — both already matched the
    param names the pre-existing local handler functions used, so no
    renaming was needed.
- Actual files changed:
  - `src/app/presentation/request-handlers/publishing-api/route-params.js` (new)
  - `src/app/presentation/request-handlers/publishing-api/authorization.js` (new)
  - `src/app/presentation/request-handlers/publishing-api/put-page-metadata.js`
  - `src/app/presentation/request-handlers/publishing-api/put-page-include.js`
  - `src/app/presentation/request-handlers/publishing-api/put-template.js`
  - `src/app/presentation/request-handlers/publishing-api/put-static-asset.js`
  - `src/app/presentation/middleware/publishing-authentication.js`
  - `src/virtual-hosts.js`
- Validation run: `node run-linter.js` on all eight files above (single
  invocation) — clean, exit 0. `grep -rn "publishing-permissions\|assertPublishingPermission" src`
  — no matches. Manual trace (no script executed, per AGENTS.md): for
  `PUT /publishing-api/v1/pages` (no wildcard segment), the resolver's
  `getWildcardPathname()` returns `'/'`, producing resource
  `urn:kixx:publishing:page-metadata:/`; an `Editor` principal's grant
  `{action: 'urn:kixx:publishing:page-metadata:put', resource:
  'urn:kixx:publishing:page-metadata:*'}` matches it via
  `doesPatternMatch()`'s wildcard rule (unchanged from T1), so the request is
  allowed; the handler then calls the same `getWildcardPathname()` and
  receives the identical `'/'`, so the URN authorized and the pathname
  written are provably the same value. For a path-traversal segment (e.g.
  `../etc`), `getWildcardPathname()`/`splitIncludeFilepath()` call
  `validatePathname()` inside the **resolver**, which runs during
  `assertPermission()`'s resolution step inside `enforcePermission()` —
  before the handler executes at all — so `validatePathname()`'s
  `BadRequestError` (400) propagates untouched per T3's "resolver errors
  are not caught" contract, ahead of any 403 or 415 the handler might
  otherwise produce.
- Blockers: None.

---

### Task T8: Admin route enforcement + auth relocation

**Status:** Complete
**Depends on:** T3, T6
**Documentation:** Spec §8.2 (attachment/sequencing), §11.2 (admin capabilities).

**Objective**

Every admin panel and admin-api capability is gated by a shared
`requirePermission` instance; the admin-api token route's authentication moves
from handler body into route middleware.

**Scope**

- In: `admin-authorization.js` (`adminGate()` + instances); wiring for the
  `/admin` panel and `/admin-api/v1` subtrees; relocating token-create auth.
- Out: delegation enforcement (T9); invite/token form option rendering (T10).

**Design and invariants**

- `admin-authorization.js` (flat module) defines
  `adminGate(kind, verb)` → `requirePermission({ action:
  `urn:kixx:admin:${kind}:${verb}`, resource: `urn:kixx:admin:${kind}` })`
  (class-default `code`/`message`), and exports one named instance per
  capability (spec §11.2): `admin-user-invites` read/write,
  `publishing-api-tokens` read/write, `migrations` read/write.
- Panel (`/admin`): keep `authenticateAdminUser` at subtree `inboundMiddleware`;
  add a per-target head gate on invites list (`read`), create/revoke invite
  (`write`), token list (`read`), create/revoke token (`write`). Leave
  style-guide and the static-page catch-all **ungated**.
- Admin API (`/admin-api/v1`): per-route Basic auth (spec §8.2).
  - `migrations`: keep `authenticateAdminApiRequest` inbound; `read` gate on
    list, `write` gate on run.
  - `publishing-api-tokens`: add `authenticateAdminApiRequest` as route
    `inboundMiddleware` + `write` gate at target head; **strip the inline
    Basic-auth** from `createPublishingApiToken` (read `context.user.id`).
  - `accept-invite`: remains **unauthenticated** (invite bearer token).

**Expected touch points**

- `src/app/presentation/request-handlers/admin-authorization.js` — new.
- `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js`
  — remove inline auth; use `context.user.id`.
- `src/virtual-hosts.js` — attach gates and the token-route inbound middleware.

**Acceptance criteria**

- [ ] Every protected admin target (panel + api) has its gate at the head of
      `requestHandlers`; style-guide/static pages remain open to any admin.
- [ ] Token-create authenticates via route middleware, not the handler body.
- [ ] `accept-invite` remains reachable without credentials.
- [ ] Gates are shared verbatim between panel and api surfaces.
- [ ] Linter clean.

**Validation**

- `node run-linter.js` on changed files and `virtual-hosts.js`.
- Manual: a `Platform Admin` principal is denied on the invites and migrations
  gates but allowed on token gates; the token-create API path sets
  `context.user` and enforces `publishing-api-tokens:write`.

**Progress and handoff**

- Completed:
  - `admin-authorization.js` created (flat module, per the plan's confirmed
    scope decision — not a subdirectory) exporting a private `adminGate(kind,
    verb)` builder (`requirePermission({ action:
    urn:kixx:admin:${kind}:${verb}, resource: urn:kixx:admin:${kind} })`,
    class-default `code`/`message`, matching the catalog role grants exactly)
    and six named instances: `requireAdminUserInvitesRead/Write`,
    `requirePublishingApiTokensRead/Write`, `requireMigrationsRead/Write`.
  - Panel (`/admin`): `authenticateAdminUser` left unchanged as the subtree
    `inboundMiddleware`. Added a gate at the head of every protected
    target's `requestHandlers`: `requireAdminUserInvitesWrite` on
    `invites-revoke`'s `revoke` target and `invites`'s `create-invite`
    target; `requireAdminUserInvitesRead` on `invites`'s
    `render-invite-list` target; `requirePublishingApiTokensWrite` on
    `publishing-api-tokens-revoke`'s `revoke` target and
    `publishing-api-tokens`'s `create-token` target;
    `requirePublishingApiTokensRead` on `publishing-api-tokens`'s
    `render-token-list` target. `style-guide` and the `*` `static-pages`
    catch-all were left ungated, per plan.
  - Admin API (`/admin-api/v1`): `migrations` subtree keeps
    `authenticateAdminApiRequest` as its own `inboundMiddleware`; added
    `requireMigrationsRead` at the head of the `list`/`get` target and
    `requireMigrationsWrite` at the head of the `run`/`post` target.
    `accept-invite` (`/users/invite{/}`) left fully untouched — no inbound
    auth, no gate — confirming it stays reachable with only the invite
    bearer token the handler itself validates.
  - `publishing-api-tokens{/}` (admin-api): added `inboundMiddleware:
    [authenticateAdminApiRequest]` to the route (previously had none — the
    `create` target authenticated inline in the handler body instead), and
    added `requirePublishingApiTokensWrite` at the head of the `create`
    target's `requestHandlers`, before `AdminAPI.createPublishingApiToken`.
  - `create-publishing-api-token.js` (admin-api handler): removed the inline
    `parseBasicAuthCredentials()` / `verifyAdminCredentials()` call and its
    now-unused imports (`parseBasicAuthCredentials` from `json-api.js`,
    `verifyAdminCredentials` from the transaction script). The handler now
    reads `context.user.id` (set by `authenticateAdminApiRequest` running as
    this route's `inboundMiddleware`) as the `grantingUserId` argument to
    `createToken()`, replacing the old `admin.id`. Left the
    `permissions`/`roles` field mismatch inside `createToken()`'s
    transaction script and its response untouched — that is T4's flagged,
    T10-owned transitional gap (see T4 handoff notes), not part of T8's
    scope, which is authentication relocation only.
- Current state: Task complete. All T8 acceptance criteria met.
- Remaining: Nothing for T8 itself. Note for T9/T10: the publishing-api-token
  create path now authenticates via route middleware and is
  permission-gated, but minting a token still fails downstream at
  `createToken()` (T4's flagged gap) until T10 lands.
- Decisions and discoveries:
  - Confirmed via reading `virtual-hosts.js` that route-level
    `inboundMiddleware` on a nested route (e.g. `migrations`, and now
    `publishing-api-tokens{/}`) runs in addition to any parent subtree's
    `inboundMiddleware`, and that a route with no `inboundMiddleware` of its
    own (like `accept-invite`, staying a sibling under `/admin-api/v1` which
    itself declares none) is not implicitly authenticated by anything —
    matching the plan's explicit requirement that `accept-invite` remain
    unauthenticated.
  - `adminGate()`'s action/resource shape
    (`urn:kixx:admin:<kind>:<verb>` / `urn:kixx:admin:<kind>`) was checked
    against T2's catalog table: `Super Admin`'s grant action
    `urn:kixx:admin:admin-user-invites:*` is a wildcard verb, so it matches
    both the `:read` and `:write` gates via `doesPatternMatch()`'s existing
    trailing-wildcard rule (unchanged since T1); same for its
    `publishing-api-tokens:*` and `migrations:*` grants. `Root Admin`'s
    `*`→`*` grant matches every gate. `Platform Admin`'s single
    `publishing-api-tokens:*` grant matches only the two
    `publishing-api-tokens` gates, confirming it is denied on invites and
    migrations gates as the plan's manual-verification step expects.
  - Did not touch `admin-publishing-api-tokens.js` or `admin-invites.js`
    (the panel request-handler bodies) — they already read data via
    Transaction Scripts using `context.user` for auditing fields, and adding
    the gates at the route head is sufficient per spec §8 ("no
    request-handler body makes an authorization decision"); no handler body
    contained an authorization check to remove, unlike the publishing
    handlers in T7.
- Actual files changed:
  - `src/app/presentation/request-handlers/admin-authorization.js` (new)
  - `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js`
  - `src/virtual-hosts.js`
- Validation run: `node run-linter.js` on all three files above (single
  invocation) — clean, exit 0. Manual trace (no script executed, per
  AGENTS.md): a `Platform Admin` principal's derived permissions
  (`deriveRolePermissions(['Platform Admin'])` → one grant,
  `{action: 'urn:kixx:admin:publishing-api-tokens:*', resource:
  'urn:kixx:admin:publishing-api-tokens'}`) evaluated against
  `requireAdminUserInvitesRead`'s decision
  (`{action:'urn:kixx:admin:admin-user-invites:read', resource:
  'urn:kixx:admin:admin-user-invites'}`) does not match (different resource
  kind) → denied, consistent with the plan's expected manual check; the same
  principal's permissions evaluated against `requirePublishingApiTokensWrite`'s
  decision does match (wildcard verb, exact resource) → allowed. Traced the
  admin-api token-create path: `authenticateAdminApiRequest` (route
  inbound) sets `context.user` with derived `permissions` before
  `requirePublishingApiTokensWrite` runs, which runs before
  `AdminAPI.createPublishingApiToken`, which now reads `context.user.id`
  instead of re-authenticating.
- Blockers: None.

---

### Task T9: Invite delegation & role conferral

**Status:** Complete
**Depends on:** T2, T5, T6
**Documentation:** Spec §6.3 (delegation), §9.3 (invite lifecycle), §6.4 (Root Admin bootstrap-only).

**Objective**

Admin invites confer a single, delegation-checked role; redemption assigns it to
the new admin; the bootstrap path confers `Root Admin`.

**Scope**

- In: `create-admin-invite.js` (role validation + delegation); `admin-invite-form.js`
  (`role` field); `consume-admin-invite.js` (return roles); `create-admin-user-account.js`
  (assign roles).
- Out: rendering grantable options (T10).

**Design and invariants**

- Creation (spec §9.3): the form submits a single `role`. The Transaction Script
  requires it to be (a) `isRoleName(name, 'admin')`, (b) **not** `Root Admin`,
  (c) `canGrantRole(context.user.permissions, name)`. Any failure is a **403
  `ForbiddenError`** with `code: 'AdminInviteRoleForbidden'` — not a 422 field
  error (tampering fails closed). Store `roles: [name]`, cloned.
- Redemption (spec §9.3): `consumeAdminInvite()` returns the roles to confer —
  bootstrap path → `['Root Admin']` (the only way that role is assigned);
  stored-invite path → the invite's stored roles. `createAdminUserAccount()`
  assigns the returned names to the new admin record.
- A since-retired stored role name confers a role that derives nothing (fail
  closed) — no special handling.

**Expected touch points**

- `src/app/transaction-scripts/admin-invites/create-admin-invite.js`
- `src/app/presentation/forms/admin-invites/admin-invite-form.js`
- `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`
- `src/app/transaction-scripts/admin-users/create-admin-user-account.js`

**Acceptance criteria**

- [ ] A non-grantable or `Root Admin` selection reaching the create script is a
      403 `AdminInviteRoleForbidden`, not a field error.
- [ ] Stored invite persists a one-element cloned `roles` array.
- [ ] Bootstrap redemption confers `['Root Admin']`; stored-invite redemption
      confers the recorded role.
- [ ] New admin user record receives the conferred roles.
- [ ] Linter clean.

**Validation**

- `node run-linter.js` on all changed files.
- Manual: a `Super Admin` invites `Platform Admin` (allowed) but not
  `Super Admin`-beyond-their-grants edge cases; bootstrap redemption produces a
  `Root Admin` account.

**Progress and handoff**

- Completed:
  - `create-admin-invite.js` (Transaction Script): now accepts `args.role` in
    addition to `args.createdBy`. Before writing the invite, computes
    `isGrantable = role !== ROLE_ROOT_ADMIN && isRoleName(role, 'admin') &&
    canGrantRole(context.user?.permissions, role)` and throws `ForbiddenError`
    with `code: 'AdminInviteRoleForbidden'` (message "The selected role
    cannot be granted.") when false — covering all three of the plan's
    required checks (not-Root-Admin, registered-in-admin-category,
    within-granter's-delegation) as a single fail-closed 403, per the plan's
    explicit override of the general three-layer pattern for this specific
    surface. On success, calls `invites.createInvite(context, { createdBy,
    roles: [role] })` — a freshly constructed one-element array literal,
    satisfying "cloned" trivially (no aliased array is stored).
  - `admin-invite-form.js` (`AdminInviteCreateForm`): added a `role` field to
    the schema (`type: 'string', fieldType: 'select'`, `required: ['role']`),
    a constructor that normalizes the submitted `role` attribute, and a
    `validate()` that only checks the selection is a non-empty string
    (basic UI-completeness check, 422 `ValidationError` when missing/blank).
    It deliberately does **not** call `isRoleName()`/`canGrantRole()` — per
    T9's design note, registry-membership and delegation checking are a
    security decision owned exclusively by `createAdminInvite()`, which
    fails closed as 403, not 422, so a tampered-but-present role value must
    reach the Transaction Script unfiltered by this form.
  - `admin-invites.js` (request handler, not in T9's listed touch points —
    see discoveries below): `postCreateAdminInvite()` now builds an
    `AdminInviteCreateForm` from the submitted `FormData` (previously it
    only validated the CSRF token and discarded the returned `formData`,
    since the form had no other fields), calls `form.validate()`, and passes
    `role: form.role` through to `createAdminInvite()`. The pre-existing
    local `const form = new AdminInviteCreateForm()` used later to render
    the response (with no submitted values, since it repopulates the empty
    create form) was renamed to `renderForm` to avoid colliding with the new
    submitted-form binding.
  - `consume-admin-invite.js`: now returns `{ roles: string[] }`. Bootstrap
    redemption returns `{ roles: [ROLE_ROOT_ADMIN] }` (imported from
    `roles.js`) after writing the consumed marker — bootstrap redemption is
    the only code path that ever confers `Root Admin`. Stored-invite
    redemption returns `{ roles: resolution.record.get('roles') }` (the
    invite's own stored role names, set at creation time by
    `create-admin-invite.js` above) after `markConsumed()` succeeds. Updated
    the `@returns` JSDoc accordingly.
  - `create-admin-user-account.js`: destructures `{ roles }` from
    `consumeAdminInvite()`'s return value and passes it through to
    `adminUsers.createNewAdminUser(context, { emailAddress, passwordHash,
    roles })` (previously `roles` was omitted, silently defaulting to `[]`
    at `AdminUserCollection#createNewAdminUser()`'s create-call boundary,
    per T5).
- Current state: Task complete. All T9 acceptance criteria met.
- Remaining: Nothing for T9 itself.
- Decisions and discoveries:
  - **Went beyond the listed touch points**: `admin-invites.js` was not in
    T9's "Expected touch points" list, but making `role` a required schema
    field on `AdminInviteCreateForm` and having `postCreateAdminInvite()`
    still call `createAdminInvite()` with no `role` argument at all would
    mean every invite-creation submission unconditionally 403s (since
    `undefined !== ROLE_ROOT_ADMIN` is true but `isRoleName(undefined,
    'admin')` is `false`). Per the plan's repeated instruction that
    touch-point lists are "orientation, not permission to ignore other
    necessary files" (the same reasoning T5 used for
    `admin-invite-collection.js`), I updated the handler to actually parse
    and forward the submitted role.
  - **Transient break, intentionally left for T10**: I read
    `src/templates/pages/admin/invites/page.html` and confirmed the create-invite
    `<form>` has no role `<select>` control and no other input besides the
    CSRF hidden field — it was built when the form had zero fields. With
    `role` now `required` in the schema, submitting this unmodified template
    will omit `role` entirely, so `form.validate()` will throw a 422
    `ValidationError` (`'A role selection is required'`) on every
    invite-creation submission until T10 adds the `<select>` markup driven
    by `filterGrantableRoles(context.user.permissions, 'admin')` (T10's
    explicit scope: "rendering grantable options"). This mirrors the
    T4 pattern (a task ships storage/logic correctly while the adjacent
    surface is still wired to the old shape) rather than a regression to
    chase down separately — flagging it here since it is not yet visible
    from reading `create-admin-invite.js` or the form in isolation. **Next
    agent picking up T10 must add the role `<select>` to
    `src/templates/pages/admin/invites/page.html`** and pass the
    per-request grantable-options list into the render props from
    `getAdminInvites()`/`postCreateAdminInvite()` in `admin-invites.js`.
  - Verified `isRoleName()` and `canGrantRole()` (T2) are both safe when
    given `undefined`/non-string `role` values (`Map#get()` on an
    unregistered key returns `undefined`, short-circuiting to `false` in
    both functions), so `create-admin-invite.js` does not need its own
    type-guard before calling them — an absent or malformed `role` argument
    fails the `isGrantable` check the same way an unregistered name does,
    with no separate assertion needed.
  - Confirmed via `grep` that `consumeAdminInvite()` has exactly one caller
    (`create-admin-user-account.js`), so changing its return shape from
    `void` to `{ roles }` required no other caller updates.
- Actual files changed:
  - `src/app/transaction-scripts/admin-invites/create-admin-invite.js`
  - `src/app/presentation/forms/admin-invites/admin-invite-form.js`
  - `src/app/presentation/request-handlers/admin-invites.js` (not in the
    plan's listed touch points — see discoveries above)
  - `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`
  - `src/app/transaction-scripts/admin-users/create-admin-user-account.js`
- Validation run: `node run-linter.js` on all five files above (single
  invocation) — clean, exit 0. Manual trace (no script executed, per
  AGENTS.md): a `Super Admin` principal's derived permissions
  (`deriveRolePermissions(['Super Admin'])`, including the
  `urn:kixx:admin:admin-user-invites:*` grant) evaluated via
  `canGrantRole(permissions, 'Platform Admin')` returns `true` (Platform
  Admin's single `publishing-api-tokens:*` grant is covered by Super Admin's
  matching grant), and `role !== 'Root Admin'` and
  `isRoleName('Platform Admin', 'admin')` both hold, so
  `createAdminInvite(context, { createdBy, role: 'Platform Admin' })`
  succeeds; the same principal calling with `role: 'Root Admin'` fails the
  `role !== ROLE_ROOT_ADMIN` check regardless of `canGrantRole()`, so it
  403s before evaluating delegation at all. Traced bootstrap redemption:
  `resolveAdminInvite()` returns `isBootstrap: true` when the presented
  token's hash matches the env `ADMIN_BOOTSTRAP_TOKEN`'s hash;
  `consumeAdminInvite()` then writes the consumed marker and returns
  `{ roles: ['Root Admin'] }` unconditionally, which
  `createAdminUserAccount()` threads into `createNewAdminUser()`.
- Blockers: None for T9 itself. Flagging for T10 (as noted above): the
  admin-invite panel template must add the role `<select>` before invite
  creation is functional end-to-end; this is a known, plan-anticipated gap
  given the bottom-up ship order, not a regression to chase down separately.

---

### Task T10: Administrative surfaces & forms

**Status:** Complete
**Depends on:** T2, T4, T9
**Documentation:** Spec §10 (administrative surfaces), §9.1 (form validation layer).

**Objective**

Role selection is registry-driven and, where delegation applies,
grantability-filtered; surfaces expose role names, never grants.

**Scope**

- In: admin invite form options (per-request `filterGrantableRoles`); publishing
  token forms (default `Editor`, no picker); create responses/listings exposing
  role names.
- Out: enforcement (T7/T8) and delegation checks (T9), which this task's UI only
  mirrors as a courtesy.

**Design and invariants**

- Invite form: offered options computed **per request** from
  `filterGrantableRoles(context.user.permissions, 'admin')` and passed as a
  render prop (not a static schema enum). A surface never offers a role the
  signed-in principal cannot grant; server-side enforcement (T9) is the actual
  guard (spec §10).
- Publishing token forms (panel HTML + admin-api JSON:API): **no role picker**;
  default an omitted/empty submission to `['Editor']`; validate any supplied
  value via `isRoleName(name, 'publishing')`, rejecting others as a 422 field
  error. Mint-time domain bound (T4) still applies.
- Responses/listings present **role names, never grants**. The admin-api
  create-token response returns `roles` (was `permissions`); the token creation
  Transaction Script returns role names.

**Expected touch points**

- `src/app/presentation/forms/admin-invites/admin-invite-form.js`
- `src/app/presentation/request-handlers/admin-invites.js` (render prop)
- `src/app/presentation/forms/publishing-api-tokens/*.js`
- `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js`
  (response `roles`)
- `src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js`
- `src/app/presentation/request-handlers/admin-publishing-api-tokens.js` (listings)

**Acceptance criteria**

- [ ] Invite form options come from `filterGrantableRoles()` per request and
      never include `Root Admin`.
- [ ] Publishing token creation assigns `['Editor']` by default and rejects a
      non-publishing role as a 422 field error at the form boundary.
- [ ] No response or listing exposes raw grant objects; create responses return
      `roles`.
- [ ] Linter clean.

**Validation**

- `node run-linter.js` on all changed files.
- Manual: render the invite form as `Super Admin` (sees `Super Admin`,
  `Platform Admin`; not `Root Admin`); create a token with no role → `Editor`;
  submit `roles: ['Root Admin']` to the token API → 422.

**Progress and handoff**

- Completed:
  - `admin-invite-form.js` (`AdminInviteCreateForm`): overrode
    `getFormContext(context, error)` — calls `super.getFormContext()` then
    replaces `fields.role` with `filterGrantableRoles(context.user?.permissions,
    'admin').map((role) => ({ value: role.name, label: role.name }))` plus a
    `label`. Computed fresh on every call (not cached, not a static schema
    enum), so a rendered page always reflects the signed-in principal's
    current delegation. `Root Admin` is structurally excluded because
    `filterGrantableRoles()` (T2) always excludes it regardless of the
    caller's permissions.
  - `src/templates/pages/admin/invites/page.html`: added the `role` `<select>`
    to the create-invite form (previously the form rendered no fields besides
    the CSRF token — see T9's flagged gap), following the same markup
    pattern as the existing `time_to_live_seconds` select on the publishing
    token page (`form.fields.role.options`, `form.fields.role.value`,
    error/`aria-invalid` wiring). Wrapped the submit button in a `cluster`
    div and switched the form's class from `cluster` to `flow field-stack`
    to match the publishing-token page's field-stack layout now that it has
    a real field, not just a button.
  - `create-publishing-api-token-form.js` (JSON:API mint form): replaced the
    `permissions` field and the T1 transitional `isSupportedPermissionsGrant()`
    shape-check with a `roles` field. `normalizeRoles()` defaults a
    non-array or empty-array submission to `[DEFAULT_PUBLISHING_API_TOKEN_ROLE]`
    (`'Editor'`, newly exported); `validate()` requires the (possibly
    defaulted) array to be non-empty and every member to pass
    `isRoleName(name, 'publishing')`, pushing a single `roles` field error
    (422) otherwise. `roles` is no longer in the schema's `required` list
    since an omission is a valid, defaulted input, not a missing field.
    `toJSON()` returns `roles` instead of `permissions`.
  - `publishing-api-token-admin-form.js` (panel form, no picker per plan):
    replaced the T1 transitional `ALLOW_ALL_PERMISSIONS` grant constant with
    a frozen `DEFAULT_ROLES = [ROLE_EDITOR]` (imported from `roles.js`).
    `toJSON()` now returns `roles: DEFAULT_ROLES` instead of
    `permissions: ALLOW_ALL_PERMISSIONS`. No schema/field changes — this
    form already exposed no permissions/role field to the operator.
  - `create-publishing-api-token.js` (Transaction Script, flagged by T4 as a
    known transitional break): destructures `roles` instead of `permissions`
    from `form.toJSON()`, passes `roles` (not `permissions`) to
    `createToken()`, and returns `roles: record.get('roles')` instead of
    `permissions: record.get('permissions')`. This resolves T4's flagged
    gap — `PublishingApiTokenCollection#createToken()` (already `roles`-shaped
    since T4) now receives the field it actually expects, so token minting
    is functional end-to-end again.
  - `create-publishing-api-token.js` (admin-api response handler): response
    `attributes.roles: token.roles` replaces `attributes.permissions:
    token.permissions`.
  - Verified (no code changes needed): `list-publishing-api-tokens.js`'s
    `presentToken()` and `list-admin-invites.js`'s `presentInvite()` already
    omit both grants and role names entirely from their listing projections,
    so "no listing exposes raw grant objects" was already true; adding
    `roles` to either listing was not required by the acceptance criteria
    and would be scope creep, so neither was touched.
- Current state: Task complete. All T10 acceptance criteria met. This was
  the plan's final task — **the role-based permissions system is now fully
  implemented** across T1–T10.
- Remaining: Nothing planned. See "Manual verification (whole system)" below
  for the end-to-end checklist a human (or a future session with dev-server
  access) should run; this session did not start the dev server or exercise
  requests live, per `AGENTS.md`'s restriction against work verification
  beyond linting.
- Decisions and discoveries:
  - Confirmed `filterGrantableRoles()` and `canGrantRole()` (T2) both
    already handle an `undefined` `context.user?.permissions` safely
    (`evaluatePermissions()` fails closed on non-array input per T1), so no
    guard was needed in `getFormContext()` before calling
    `filterGrantableRoles()` even though `context.user` is always populated
    by the time this form renders (behind `authenticateAdminUser`).
  - The publishing-token JSON:API form's `roles` field intentionally has no
    `required` entry in its schema (unlike the old `permissions` field,
    which was required) — this is a deliberate behavior change matching the
    plan's "default an omitted/empty submission to `['Editor']`" instruction,
    not an oversight.
  - Did not add a `roles` column to the admin publishing-token or invite
    listing templates/props. The plan's acceptance criteria only forbids
    exposing raw grants; it does not require surfacing role names in these
    specific listings, and neither template currently renders any
    permission-adjacent field, so adding one would be an unrequested UI
    change outside this task's scope.
- Actual files changed:
  - `src/app/presentation/forms/admin-invites/admin-invite-form.js`
  - `src/templates/pages/admin/invites/page.html`
  - `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`
  - `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js`
  - `src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js`
  - `src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js`
- Validation run: `node run-linter.js` on every file listed above (single
  invocation) — clean, exit 0. Additionally ran `node run-linter.js src`
  (whole tree) as a final sweep after all ten tasks — clean, exit 0.
  `grep -rn "validatePermissions\|ALLOW_ALL_PUBLISHING_PERMISSIONS\|ALLOW_ALL_PERMISSIONS\|isSupportedPermissionsGrant" src`
  — no matches, confirming every T1-flagged transitional helper has now
  been replaced by real role-based logic. Manual trace (no script executed,
  per AGENTS.md): a `Super Admin` principal's derived permissions passed to
  `filterGrantableRoles(permissions, 'admin')` returns `[Super Admin,
  Platform Admin]` in definition order (both pass `canGrantRole()` against
  Super Admin's grants; `Root Admin` is excluded unconditionally) — matching
  the plan's manual-verification expectation. A JSON:API token-creation
  request with no `roles` attribute normalizes to `['Editor']` and passes
  `validate()`; a request with `roles: ['Root Admin']` normalizes to itself
  (non-empty array, so no default applies) and fails `validate()` because
  `isRoleName('Root Admin', 'publishing')` is `false` (`Root Admin` is
  registered in the `admin` category, not `publishing`) — a 422
  `ValidationError` on the `roles` field, not a 403, consistent with this
  surface's normal three-layer field-validation pattern (distinct from the
  admin-invite surface's deliberate 403-only override in T9).
- Blockers: None.

---

## Manual verification (whole system)

After all tasks, exercise the request flow end-to-end (spec §3, §8.4):

1. **401** — a publishing/admin request with no/invalid credential is rejected by
   authentication middleware.
2. **400** — a malformed publishing pathname is rejected by the resolver before
   authorization.
3. **403** — a valid principal lacking the grant is denied (publishing 403 carries
   `PublishingApiTokenForbidden`; admin 403 uses class defaults).
4. **415/422** — only an authorized caller reaches content-type/body validation.
5. **Delegation** — `Platform Admin` cannot reach invite/migration routes;
   `Super Admin` can invite `Platform Admin` but the invite form never offers
   `Root Admin`; tampered role submissions are 403 `AdminInviteRoleForbidden`.
6. **Bootstrap** — redeeming the bootstrap token yields a `Root Admin` account.
