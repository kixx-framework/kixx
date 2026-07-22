# Role-Based Permissions — Implementation Plan

**Specification:** `prompts/plans/role-based-permissions-specification.md`
**Status:** Not started

## Implementation Approach

This plan adopts the role-based permission system from the specification into
this application. Authorization answers one question per protected endpoint —
*is the authenticated principal allowed to perform this action on this
resource?* — with five layered parts: a grant evaluator, a role registry,
a principal contract, declarative route enforcement (`requirePermission`), and
a storage rule (persist role **names** only, never grants).

The specification is a portable reference describing a richer sibling app. This
plan implements the **mechanism verbatim** while **tailoring the catalog** to
the surfaces that actually exist here. The system is application-layer code, so
adoption is re-implementation of the spec's contracts, not a framework import.

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

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T2: Role registry (`roles.js`)

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: `requirePermission` middleware factory

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: Publishing-token role storage

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Admin-user & invite role storage + principal projection

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T6: Authentication grant derivation

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T7: Publishing route enforcement + shared route-params

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T8: Admin route enforcement + auth relocation

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T9: Invite delegation & role conferral

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T10: Administrative surfaces & forms

**Status:** Not started
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

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
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
