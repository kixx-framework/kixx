# Role-Based Permission System Specification

This document specifies the role-based permission system for the Kixx platform,
introduced in PR #3 ("Migrate permissions to principle roles") and extended to
the admin domain in PR #4 ("Role based permissions for Admins"). It serves two
audiences:

1. **Maintainers of this application**, as the authoritative description of how
   authorization works here. Sections 3–10 describe contracts this codebase
   must preserve; Section 11 maps them to the implementing modules.
2. **Implementers of other Kixx applications**, as a portable specification.
   The system is application-layer code, not a framework import, so another
   application adopts it by re-implementing these contracts. Section 12 is the
   porting guide.

Normative language ("must", "must not", "should") marks requirements an
implementation has to satisfy to be compatible with this design. Everything
else is description or rationale.

**Adoption status in this application (as of 2026-07):** Two principal types
carry roles. Publishing API tokens hold publishing-category roles and are
enforced across the Publishing API. Admin Users hold admin-category roles,
derived at authentication time by both the session-cookie and HTTP Basic
authentication middleware, and every admin panel and `/admin-api/v1` route is
gated by `requirePermission`. The admin adoption followed the sequencing
described in Section 12.2, including a one-time role-name backfill migration.

**Revision history:**

- 2026-07 (PR #3): initial system — evaluator, registry, `requirePermission`,
  Publishing API token roles.
- 2026-07 (PR #4 + follow-up fix): admin domain adoption — role categories,
  four admin roles, admin route gating, Basic-auth principal derivation,
  role-conferring invites, delegation (`canGrantRole`), domain bounding
  (`areRoleGrantsWithinDomain`), Root Admin backfill migration, array-action
  normalization in registry helpers.

## 1. Overview

The system answers one question per protected endpoint: *is the authenticated
principal allowed to perform this action on this resource?* It answers it with
five cooperating parts:

1. **A grant grammar and evaluator.** A permission is a *grant* — a plain
   object `{ effect, action, resource }` whose action and resource are URN
   strings. A pure function evaluates a list of grants against one
   `{ action, resource }` decision and returns a boolean. Deny overrides
   allow; everything else fails closed.
2. **A role registry.** Roles are named, frozen sets of grants defined in
   application code. Roles are the only producer of grants. The registry also
   owns the two derived policy rules built on grants: *delegation* (a
   principal may confer only capabilities it already holds, Section 6.3) and
   *domain bounding* (a credential may be restricted to roles whose grants
   stay within one URN domain, Section 6.2).
3. **A principal contract.** Authentication middleware sets `context.user`
   with the principal's stored role *names* and the grants *derived* from them
   at request time. Authorization reads only `context.user.permissions`.
4. **Declarative route enforcement.** A `requirePermission(spec)` middleware
   factory attaches the authorization decision to the route configuration, so
   no request handler body makes an authorization decision.
5. **A storage rule.** Persistent records store role names only — never
   grants. Grants are never persisted anywhere, so there is no *grant* data to
   migrate, ever. (Role-*name* backfills are a legitimate, separate adoption
   tool — see Section 9.2.)

The parts are layered so each depends only on the one below it: routes depend
on the middleware, the middleware on the evaluator, authentication on the
registry, and storage on nothing but the role-name strings.

## 2. Terminology

- **Principal** — the authenticated caller a request acts as. May be a human
  user, an API token, a service account, or any other credential. Stored on
  `context.user`.
- **Role** — a named, code-defined set of permission grants (e.g. `Editor`,
  `Super Admin`).
- **Role category** — presentation metadata on a role definition (`'admin'`
  or `'publishing'`) used to scope form options and form-input validation.
  Categories are **not** an enforcement boundary (Section 6.1).
- **Grant** — one `{ effect, action, resource }` object in the evaluator
  grammar (Section 5).
- **Action URN** — a stable string naming an operation, e.g.
  `urn:kixx:publishing:page-metadata:put` or `urn:kixx:admin:migrations:run`.
- **Resource URN** — a stable string naming what is operated on, e.g.
  `urn:kixx:publishing:page-metadata:/blog/hello` or the bare kind
  `urn:kixx:admin:migrations`.
- **Decision** — one `{ action, resource }` pair submitted for evaluation.
- **Registry** — the single application-wide module that owns every role
  definition.
- **Derivation** — resolving stored role names into a flat grant list at
  authentication time.
- **Delegation** — the "only grant roles you hold" rule: a principal may
  confer a role on another principal only when its own permissions authorize
  every grant that role derives (Section 6.3).

## 3. Architecture and Request Flow

A protected request flows through these stages, in order:

```text
route inboundMiddleware:   authenticate<Principal>     → 401 when unauthenticated
                           (sets context.user with roles + derived permissions)

target requestHandlers[0]: requirePermission instance  → 400 when the resource
                           (resolves resource URN,        resolver rejects params
                            asserts the decision)       → 403 when denied

target requestHandlers[1]: the actual request handler  → 415/422/etc. for
                           (no authorization logic)      content problems
```

Multiple authentication middleware can front the same enforcement machinery.
This application has three: publishing bearer-token authentication, admin
session-cookie authentication, and admin HTTP Basic authentication. Each one
derives grants onto `context.user.permissions` the same way, so every
downstream `requirePermission` gate is credential-scheme-agnostic.

The layering encodes two deliberate policies:

- **Authentication and authorization are separate failures.** A missing or
  invalid credential is a 401 from the authentication middleware. A valid
  principal lacking a grant is a 403 from the authorization middleware.
  Authentication must never reject a principal for having unknown or empty
  roles — that outcome belongs to authorization.
- **Authorization precedes content validation.** An unauthorized caller
  receives 403 (or a resolver's 400 for malformed path parameters) *before*
  any content-type or body-validation feedback. Denied callers learn nothing
  about what a well-formed request would look like.

## 4. URN Grammar

Actions and resources are Uniform Resource Names with colon-separated
segments:

```text
action:    urn:kixx:<domain>:<kind>:<verb>
resource:  urn:kixx:<domain>:<kind>[:<scope>]
```

- `<domain>` — the application domain that owns the URN (e.g. `publishing`
  or `admin`). The evaluator does not interpret this segment; it is data.
  Each domain mints its own URNs without coordinating with the mechanism.
  (The domain segment *is* interpreted by one registry helper,
  `areRoleGrantsWithinDomain()` — see Section 6.2.)
- `<kind>` — the resource kind within the domain (e.g. `page-metadata`,
  `include`, `asset`, `template`, `admin-user-invites`, `migrations`).
- `<verb>` — the operation, on the action side (e.g. `put`, `read`, `write`).
- `<scope>` — an optional per-instance discriminator on the resource side
  (e.g. a page pathname).

### 4.1 Scoped and bare-kind resource conventions

There are two valid resource conventions, and a domain must pick one per kind
deliberately, because the wildcard grammar (Section 5.3) treats them
differently:

- **Scoped resources** carry a per-instance discriminator as the final
  segment (`urn:kixx:publishing:page-metadata:/blog/hello`). Role grants for
  scoped kinds use a trailing `:*` wildcard
  (`urn:kixx:publishing:page-metadata:*`) to cover every scope.
- **Bare-kind resources** are the kind itself with no scope
  (`urn:kixx:admin:migrations`, `urn:kixx:publishing:asset`). Role grants for
  bare kinds name the bare kind exactly.

**The two forms do not overlap.** A `:*` scoped wildcard requires a non-empty
remainder after the final colon, so `urn:kixx:admin:migrations:*` does **not**
match the bare `urn:kixx:admin:migrations` — and a bare-kind grant does not
match any scoped value. The admin domain uses bare-kind resources throughout
because every admin route authorizes against a whole kind. If a future admin
route introduces a scoped resource (e.g. `urn:kixx:admin:mailing-lists:<key>`),
the admin role grants must be revisited with both forms in mind, since neither
form covers the other.

### 4.2 Action wildcards in grants

Role grants may use a trailing `:*` on the **action** side to span every verb
under a kind. The admin roles use this: a single grant with action
`urn:kixx:admin:mailing-lists:*` covers the `:read` and `:write` decisions on
that kind. Decisions always carry a concrete verb; only grants carry
wildcards.

### 4.3 Stability rules

- **URNs are internal contracts, not wire contracts.** They appear in role
  definitions (grants) and in route authorization specs (decisions). They may
  be renamed freely *only* when both sides change in lockstep within one
  deploy. They must never be persisted (Section 9) and never serialized to
  clients.
- **Wildcard scoping is part of the grammar.** Design each kind's URNs so
  that the wildcard form you intend to use is meaningful (Section 4.1).

## 5. Permission Grants and the Evaluator

### 5.1 Grant shape

A grant is a plain object:

```js
{
    effect: 'allow',                                    // or 'deny'
    action: 'urn:kixx:publishing:page-metadata:put',    // string or array of strings
    resource: 'urn:kixx:publishing:page-metadata:*',    // string
}
```

- `effect` must be exactly `'allow'` or `'deny'`.
- `action` may be a single pattern string or an array of pattern strings; the
  action matches when *any* element matches.
- `resource` must be a single pattern string.
- A grant that does not satisfy this shape is **skipped**, not an error.
  Malformed stored or derived data narrows what a principal can do; it never
  widens it and never crashes evaluation.

**Every consumer of grant objects must handle both action forms.** The
evaluator is not the only code that reads grants: the registry's delegation
and domain-bounding helpers (Sections 6.2–6.3) iterate grant actions too, and
each must normalize `action` to an array before inspecting it. This rule
exists because the omission was a real bug: the first implementation of those
helpers assumed string actions and would have misjudged any role whose grants
used the array form.

### 5.2 Evaluation algorithm

`evaluatePermissions(permissions, { action, resource })` returns a boolean:

1. If `permissions` is not an array, or `action`/`resource` is not a string,
   return `false` (fail closed on malformed input).
2. Iterate the grants in order. Skip grants with unsupported shapes. Skip
   grants whose action and resource patterns do not both match the decision.
3. A matching grant with `effect: 'deny'` returns `false` **immediately** —
   deny overrides allow regardless of grant order.
4. A matching grant with `effect: 'allow'` latches the result to allowed, but
   iteration continues (a later deny still wins).
5. If no grant matched, return `false` — the default answer is deny.

### 5.3 Pattern matching

Each pattern (action element or resource) matches a decision value by exactly
three rules, applied in order:

1. **Full wildcard:** the pattern `*` matches any value.
2. **Exact match:** the pattern equals the value.
3. **Scoped wildcard:** a pattern ending in `:*` matches any value that starts
   with the pattern's prefix *up to and including the final colon*, with a
   non-empty remainder. `urn:kixx:publishing:page-metadata:*` matches
   `urn:kixx:publishing:page-metadata:/blog/hello` and
   `urn:kixx:publishing:page-metadata:/` (the root page), but not the bare
   `urn:kixx:publishing:page-metadata`.

There are no mid-string wildcards, character classes, or regular expressions.
The narrow grammar is deliberate: pattern semantics are simple enough to
reason about in a security review.

The full wildcard exists for exactly one purpose in this application: the
Root Admin role's single `{ action: '*', resource: '*' }` grant
(Section 6.4). No other role should use it, and Section 6.2 explains the
mechanism that keeps a full-wildcard role off domain-bounded credentials.

### 5.4 The assert helper

`assertPermission(context, decision, options)` is the throwing form used by
enforcement code:

- Evaluates `context.user?.permissions` against the decision. A missing user,
  missing permissions array, or malformed decision evaluates to not-allowed.
- Returns `undefined` when allowed.
- When denied, throws the framework's `ForbiddenError` (an *expected* HTTP 403
  error) with:
  - `options.message` when supplied, else a generic client-safe default
    (`'You are not authorized to perform this request.'`);
  - `options.code` when supplied, else the error class default. The `code`
    option must be omitted entirely — not passed as `undefined` — when the
    caller does not override it, so the class default applies.

The boolean `evaluatePermissions()` remains exported alongside it for
non-throwing callers (e.g. UI that hides links the principal cannot use).

## 6. The Role Registry

One module owns every role definition in the application.

- **Single registry, single namespace.** Role names are unique across all
  principal types and categories. There is one registry module even when
  multiple domains and principal types share it.
- **Roles are frozen module data.** Each definition is
  `{ name, category, permissions }` where `permissions` is a frozen array of
  frozen grants in the evaluator grammar. Freezing prevents any caller from
  mutating the catalog at runtime.
- **Role-name constants are persistence contracts.** The exported name
  strings (e.g. `ROLE_EDITOR = 'Editor'`, `ROLE_ROOT_ADMIN = 'Root Admin'`)
  are stored verbatim on principal and invite records and must never change.
  Grant URNs inside a definition may change freely (they are derived, not
  stored) as long as decision URNs change in lockstep.

The registry exports these operations:

- `isRegisteredRoleName(name)` — true only for a registered role name, in any
  category. This is the category-agnostic membership predicate for
  internal-contract assertions on role names bound for storage.
- `isRoleName(name, category)` — true only for a registered role name tagged
  with the given category. The category argument is **required** (a missing
  category is an assertion failure, not an implicit "any"), so every call
  site is explicit and an admin role can never validate against a publishing
  input context or vice versa. Forms validating user input against the roles
  they offered use this.
- `listRoles(category)` — every role definition in the category, in
  definition order. The category argument is required. This is the source for
  form select options and schema enums, so the UI can never drift from the
  registry.
- `deriveRolePermissions(roleNames)` — flattens stored role names into a
  fresh grant array. Deliberately **category-agnostic**: a principal holds
  role names regardless of category. This function must **fail closed and
  never throw for bad stored data**: a non-array input yields `[]`; an
  unrecognized role name contributes no grants. It must return *cloned* grant
  objects so callers cannot mutate the frozen registry through the returned
  array.
- `areRoleGrantsWithinDomain(roleName, domain)` — the domain-bounding
  predicate (Section 6.2).
- `canGrantRole(permissions, roleName)` — the delegation predicate
  (Section 6.3).
- `filterGrantableRoles(permissions, category)` — the delegation-aware option
  lister (Section 6.3).

**Derivation happens at authentication time, not at mint time.** Records
store role names only; grants are recomputed on every request. Consequences:

- Editing a role definition in code changes what every existing principal
  with that role can do on the next deploy. No data migration accompanies a
  role change, ever.
- A principal whose stored role was retired from the registry silently loses
  those grants (fail closed) rather than erroring.

### 6.1 Role categories are presentation metadata, not enforcement

Each role definition carries a `category` (`'admin'` or `'publishing'`).
Categories exist so forms can offer — and validate submitted input against —
only the roles that make sense for the principal they manage: admin invite
forms list admin roles, token forms list publishing roles.

**Storage and authorization never consult categories.**
`deriveRolePermissions()` derives grants for any registered role name
regardless of category, and the evaluator never sees a category. When a
credential needs an actual capability boundary, bound it by what the grants
*do* (Section 6.2), not by the category label. This split is deliberate: a
category is a UI-affordance fact that may be reorganized freely, while a
capability boundary is a security invariant that must be enforced against the
grants themselves.

### 6.2 Domain bounding for broadly-exposed credentials

`areRoleGrantsWithinDomain(roleName, domain)` reports whether **every** grant
a role derives stays within one URN domain. It exists to bound a credential's
blast radius by capability: a long-lived, broadly-exposed credential (e.g. a
bearer token) should never be able to hold a role that grants anything
outside its domain — most importantly, a full-wildcard role like Root Admin
fails the check by construction.

Contract:

- The prefix compared against is `urn:kixx:<domain>:` — **the trailing colon
  is load-bearing**, so the domain `publishing` cannot accidentally match a
  hypothetical `publishing-drafts` domain.
- Every action element (normalized per Section 5.1's array rule) and the
  resource of every grant must start with the prefix.
- Deny-effect grants are held to the same boundary: a domain-scoped role has
  no business naming another domain's URNs at all.
- Fails closed: an unregistered role name returns `false`.

The reference enforcement point is
`PublishingApiTokenCollection#createToken()`, which asserts two things about
the requested roles, separately and in order:

1. Every name satisfies `isRegisteredRoleName()`. This is asserted at mint
   time — even though derivation would drop unknown names anyway — because
   derivation's fail-closed behavior would otherwise turn a typo minted here
   into a token that authenticates successfully with zero grants, a confusing
   failure discovered only at first use.
2. Every role satisfies `areRoleGrantsWithinDomain(name, 'publishing')`.

Both are assertions (programmer errors), not `ValidationError`s: callers are
forms or scripts that have already validated user input.

### 6.3 Delegation: only grant roles you hold

`canGrantRole(permissions, roleName)` reports whether a principal's
permissions authorize *conferring* a role — true only when the principal
already holds every grant the role would derive. This prevents privilege
escalation through role assignment: an admin can never hand out a capability
they do not themselves have.

Contract:

- Fails closed: an unregistered role name returns `false`.
- For each grant in the role, each action element (normalized per
  Section 5.1) is evaluated as a decision
  `{ action: <element>, resource: <grant resource> }` against the *granting*
  principal's permissions via `evaluatePermissions()`. Every one must be
  allowed.
- **The comparison is pattern-vs-pattern and deliberately conservative.** The
  role's grant patterns are treated as literal decision values. Consequence:
  a granter holding only the exact action `urn:kixx:admin:mailing-lists:read`
  can never grant a role whose grant action is the wildcard
  `urn:kixx:admin:mailing-lists:*`, even though the wildcard "contains" the
  exact value — the literal string `...:*` is not matched by the exact
  grant. Only a granter whose own grants pattern-match the wildcard string
  (in practice: a holder of the same wildcard, or of `*`) passes. This fails
  closed and must not be "fixed" with subset analysis without a security
  review.
- **Deny grants in role definitions are out of scope for delegation.** No
  registered role carries a deny grant today. `canGrantRole()` as specified
  would require the granter to *hold* (be allowed) the deny grant's
  action/resource in order to confer it, which is not obviously the right
  rule for a restriction. If a deny-carrying role is ever added, specify the
  delegation rule for it first.
- Root Admin is intentionally **not** special-cased inside `canGrantRole()`;
  callers exclude it separately because its non-grantability is a lifecycle
  rule (bootstrap-only, Section 6.4), not a capability comparison.

`filterGrantableRoles(permissions, category)` composes the pieces for UI:
it returns `listRoles(category)` filtered to roles the principal may grant,
always excluding Root Admin from the result. Admin surfaces build their role
options from this per request (Section 10).

### 6.4 The registered roles

| Role | Category | Grants (action → resource) |
|---|---|---|
| `Editor` | publishing | `urn:kixx:publishing:page-metadata:put` → `urn:kixx:publishing:page-metadata:*`; `urn:kixx:publishing:include:put` → `urn:kixx:publishing:include:*`; `urn:kixx:publishing:asset:put` → `urn:kixx:publishing:asset`; `urn:kixx:publishing:template:put` → `urn:kixx:publishing:template` |
| `Root Admin` | admin | `*` → `*` (full wildcard) |
| `Super Admin` | admin | `urn:kixx:admin:admin-user-invites:*` → `urn:kixx:admin:admin-user-invites`; `urn:kixx:admin:publishing-api-tokens:*` → `urn:kixx:admin:publishing-api-tokens`; `urn:kixx:admin:alpha-platform:*` → `urn:kixx:admin:alpha-platform`; `urn:kixx:admin:mailing-lists:*` → `urn:kixx:admin:mailing-lists`; `urn:kixx:admin:migrations:*` → `urn:kixx:admin:migrations` |
| `Platform Admin` | admin | `urn:kixx:admin:publishing-api-tokens:*` → `urn:kixx:admin:publishing-api-tokens`; `urn:kixx:admin:alpha-platform:*` → `urn:kixx:admin:alpha-platform` |
| `Marketing Admin` | admin | `urn:kixx:admin:mailing-lists:*` → `urn:kixx:admin:mailing-lists` |

Notes on the admin catalog:

- Admin grants pair a verb-wildcard action (`urn:kixx:admin:<kind>:*`,
  spanning `:read` and `:write`) with a **bare-kind** resource, matching the
  bare-kind route decisions (Section 4.1).
- The migrations grant mutates production data, so it is held only by Super
  Admin here (and by Root Admin through its full wildcard). Platform Admin
  and Marketing Admin intentionally do not carry it.
- **Root Admin is bootstrap-only.** It is conferred solely by redeeming the
  bootstrap invite token, is never offered by the invite UI, is excluded from
  `filterGrantableRoles()`, and a submitted invite selection naming it is
  rejected as tampering (Section 9.3). Its full wildcard also means
  `areRoleGrantsWithinDomain()` rejects it for every domain, so it can never
  be attached to a domain-bounded credential.

## 7. The Authenticated Principal Contract

Authentication middleware stores the principal on the context with
`context.setUser(principal)`. For a role-carrying principal the middleware
must set, at minimum:

```js
const roles = user.roles ?? [];             // stored role names, defaulting to []
context.setUser({
    id,                                        // stable principal identifier
    type,                                      // principal kind, e.g. 'PublishingApiToken'
    roles,
    permissions: deriveRolePermissions(roles), // derived grants, never stored grants
    // ...audit fields as appropriate: createdBy, credential timestamps, etc.
});
```

Rules:

- **Authorization reads only `context.user.permissions`.** This is the
  invariant the whole design protects: any authentication middleware — for
  any principal type or credential scheme — that derives grants in the
  evaluator grammar onto the principal gets authorization from the same
  evaluator, assert helper, and route middleware for free. This application
  proves it three times over (bearer token, session cookie, HTTP Basic).
  Nothing downstream may branch on the principal `type` to make an
  authorization decision.
- **Authentication must not reject unknown or empty roles.** A valid
  credential whose record carries no roles (or retired role names)
  authenticates successfully and derives an empty grant set; every subsequent
  permission check then produces a 403. Legacy principals therefore *fail
  closed* rather than failing authentication.
- **No secrets on the principal.** Store ids, hashes, role names, derived
  grants, owner ids, and expiry metadata — never plaintext bearer tokens or
  passwords.

## 8. Route Enforcement: `requirePermission`

Authorization decisions live in route configuration, not in request handler
bodies. A factory produces the enforcing middleware:

```js
requirePermission({ action, resource, code, message })
```

### 8.1 Factory contract

- `action` — required non-empty string: the action URN of the decision.
- `resource` — required; either a static resource URN string, or a resolver
  function `(context, request) => string` that computes a request-dependent
  URN from route parameters.
- `code`, `message` — optional overrides passed through to
  `assertPermission()`, so a domain can preserve its own 403 wire contract.
  Only supplied keys are forwarded; omitted keys fall back to the
  `ForbiddenError` class defaults. The publishing instances override both to
  preserve a pre-existing wire contract; the admin instances deliberately
  supply neither and take the class defaults.
- The factory validates the spec **when it is called**, which happens at
  module load of the route configuration. A misconfigured route crashes the
  application at startup instead of failing per request.
- The returned middleware has the standard `(context, request, response)`
  signature, resolves the resource (calling the resolver when it is a
  function), calls `assertPermission()`, and returns `response` to thread the
  chain. It should be a *named* function so router error logs and stack
  traces identify it.
- **Resolver errors propagate untouched.** A resolver may throw an expected
  HTTP error (e.g. `BadRequestError` for a malformed pathname); that is
  ordinary client input, handled by the route's error handlers. The
  middleware must not catch or wrap it.

### 8.2 Attachment points

- **Route `inboundMiddleware`** — a coarse gate over a whole route subtree.
- **Head of a target's `requestHandlers`** — a verb-shaped decision on one
  endpoint. This is the pattern both domains use: each protected target
  lists its configured `requirePermission` instance immediately before its
  handler.

Configured instances belong with their domain, not inline in the route file:
each domain collects them in an `authorization.js` module next to its request
handlers, and the route configuration imports them through the domain's
namespace export. When a domain's decisions are uniform (as in the admin
domain, where every decision is `<kind>` × `read`/`write` on a bare-kind
resource), a small local factory keeps the catalog declarative:

```js
function adminGate(kind, verb) {
    return requirePermission({
        action: `urn:kixx:admin:${ kind }:${ verb }`,
        resource: `urn:kixx:admin:${ kind }`,
    });
}

export const requireReadInvitesPermission = adminGate('admin-user-invites', 'read');
export const requireWriteInvitesPermission = adminGate('admin-user-invites', 'write');
// ...one exported instance per protected capability.
```

Authentication attachment has one sequencing subtlety worth recording: attach
authentication middleware at the deepest route level that is uniformly
credentialed. In this application's `/admin-api/v1` subtree, Basic auth is
attached per-route rather than on the parent, because a sibling route
(invite acceptance) must remain reachable without credentials.

### 8.3 The shared-normalization invariant

When the resource URN depends on request parameters, the resolver and the
request handler **must normalize those parameters through the same helper
module**. The reference implementation's `route-params.js` owns wildcard
pathname parsing (including validation that rejects path traversal with a
400) and is called by both the authorization resolvers and the handlers.

This is a security invariant, not a code-reuse nicety: it guarantees the
resource URN that was *authorized* describes exactly the pathname the handler
*writes*. Duplicated normalization logic can drift, opening a gap between
what was checked and what is done.

Edge cases the normalization owns travel with it automatically. Example: the
reference pages route uses an optional wildcard (`/pages{/*pathname}`) so the
site root is publishable; the helper maps an absent wildcard to `'/'`, the
resolver authorizes `urn:kixx:publishing:page-metadata:/`, and the Editor
grant's `page-metadata:*` scoped wildcard matches it.

(The admin domain needs no resolvers today: no admin decision depends on a
request parameter, so every admin gate is static.)

### 8.4 Error ordering

With enforcement at the head of the handler chain, the failure order for a
protected endpoint is:

1. **401** — route authentication middleware (invalid/missing credential).
2. **400** — the authorization resolver rejects malformed route parameters.
3. **403** — the permission decision is denied.
4. **415 / 422 / domain errors** — the handler's own content-type, body, and
   business validation.

Moving authorization ahead of content validation is deliberate (see
Section 3) and is an accepted behavioral change relative to in-handler
authorization checks.

## 9. Storing Role Assignments

- **Persist role names only.** A record stores `roles: [ 'Editor' ]` — an
  array of role-name strings. Grants are never persisted anywhere. This is
  what makes role definitions freely editable in code with no grant
  migration.
- **Role names are stored in two kinds of records:** principal records
  (tokens, admin users), where they drive derivation at authentication time;
  and **admin invite records** (Section 9.3), where they are conferred onto
  the redeeming principal. Both follow the same lenient record-layer
  validation below.
- **`roles` is an array even under a one-role policy.** The UI and forms may
  enforce exactly one role per principal, but the schema stays array-shaped
  so future multi-role support needs no storage change.

### 9.1 Validation layering

Role validation is split across three layers, each owning a different
concern:

| Layer | Rule | Failure type |
|---|---|---|
| Record `validate()` | `roles` is an array of non-empty strings; **an empty array is valid**. No registry-membership check. | `ValidationError` (blocks the write) |
| Form `validate()` (user input boundary) | The submitted role is required and must satisfy `isRoleName(name, category)` for the category the form manages. | `ValidationError` with a field error on `role` (422) |
| Internal creation API (e.g. a collection's `createToken()`) | `roles` is a non-empty array, every member satisfies `isRegisteredRoleName()`, and any credential-specific capability bound (Section 6.2) holds. | Assertion (programmer error — callers have already validated user input) |

The record layer is deliberately the loosest, for two reasons:

- **Legacy records must stay maintainable.** A pre-role record has no `roles`
  attribute. Maintenance writes (revoking a token, revoking or consuming an
  invite) go through `update()`, which runs `validate()`; if the record
  required a non-empty roles array, those paths would throw on legacy
  records — blocking the security controls operators still need. Every such
  maintenance path therefore normalizes a missing `roles` to `[]` before
  updating, and the record accepts the empty array as the fail-closed
  representation.
- **Retiring a role must not brick stored records.** Registry membership is
  not a record invariant, because a stored role name can legitimately
  outlive the registry entry. Membership is enforced only at write entry
  points, where the role is fresh user or caller input.

### 9.2 Legacy principals and adoption strategy

Grants are never migrated — there is no grant data to migrate. But when the
role system (or a newly gated domain) ships over *existing* principals, those
principals have no stored role names, so an adopting application must choose
one of two strategies per principal type:

- **Reissue credentials (fail-closed cutover).** Existing records keep
  whatever legacy attributes they have; they continue to authenticate, derive
  an empty grant set, and receive 403 on every protected action until an
  operator reissues the credential. This application used this strategy for
  Publishing API tokens: the moment the system shipped, every pre-role token
  stopped authorizing writes, and a fresh token had to be minted before the
  next use. Suitable when credentials are cheap to reissue and an
  interruption is acceptable.
- **Backfill a preserving role (continuity cutover).** A one-time,
  idempotent data migration assigns to each existing principal the role that
  reproduces the access it had before gating. This application used this
  strategy for Admin Users: before the role system, no admin route was gated,
  so every existing admin effectively had full access; the
  `2026-07-18-backfill-admin-user-roles` migration assigns `['Root Admin']`
  to any admin whose `roles` is missing or empty, preserving exactly that
  access once the gates go live. The migration skips any record that already
  carries a role, making re-runs and retried batches no-ops. Suitable when
  locking operators out of the control surface that manages roles would be
  self-defeating.

Whichever strategy is chosen, document the deploy consequence in the
deployment runbook (Section 12.4). Note the backfill migrates role *names*
under the normal expand/contract migration rules — it does not contradict the
"grants are never persisted or migrated" rule.

### 9.3 Role conferral via admin invites

Admin invites are the delegation mechanism made durable: an invite records,
at creation time, the role names it will confer, and redemption assigns
exactly those names to the new admin user.

Contract, along the invite lifecycle:

- **Creation.** The invite form submits a multi-value `roles` selection. The
  creating Transaction Script **deduplicates** the submitted names, then
  requires each unique name to be (a) a registered admin-category role
  (`isRoleName(name, 'admin')`), (b) not Root Admin (bootstrap-only), and
  (c) grantable by the authoring admin (`canGrantRole()`). Any failure is a
  **403 `ForbiddenError`** (code `AdminInviteRoleForbidden`), not a 422 field
  error: the UI only offers grantable roles, so a non-grantable selection
  reaching the server is a tampered request, and tampering fails closed
  without re-render feedback. The storage layer clones the roles array before
  persisting so later caller-side mutation cannot change what the write
  intended to store.
- **Storage.** The invite record requires `roles` structurally (array of
  non-empty strings, empty valid) but performs no registry-membership check,
  per Section 9.1 — a role renamed or retired after the invite was minted
  must not make the stored invite unreadable or unrevocable.
- **Redemption.** Consuming the invite returns the roles to confer: the
  bootstrap token path returns `['Root Admin']` (the only way that role is
  ever assigned); the stored-invite path returns exactly the roles recorded
  on the invite, possibly none. The account-creation script assigns the
  returned names to the new admin user record. An invite conferring a
  since-retired role name produces an admin who fails closed on derivation —
  the same rule as every other stale stored name.
- **Maintenance.** Revocation and consumption normalize a missing `roles` to
  `[]` before updating, keeping pre-role legacy invites revocable
  (Section 9.1).

## 10. Administrative Surfaces

- **Role selection is registry-driven, and — where delegation applies —
  grantability-filtered.** The publishing token forms (JSON:API and admin
  panel HTML) build their options and schema `enum` from
  `listRoles('publishing')`, so the schema cannot drift from what
  `isRoleName(name, 'publishing')` accepts. The admin invite form goes
  further: its offered options are computed **per request** from
  `filterGrantableRoles(context.user.permissions, 'admin')` and passed to the
  template as a render prop rather than baked into a static schema, because
  the option set depends on who is asking. A surface must never offer a role
  the signed-in principal cannot grant.
- **UI filtering is a courtesy; the Transaction Script is the enforcement.**
  The grantability rules are re-checked server-side on submission
  (Section 9.3). Rendering only grantable options prevents honest mistakes;
  the 403 on tampered submissions prevents dishonest ones.
- **Listings present role names, never grants.** Role names are
  operator-facing labels; raw grant objects are an internal representation
  and are not exposed by list or create responses. Creation responses return
  `roles` (the stored names).
- **Defaulting is a UI concern.** With a single registered role in a
  category, the form may default an empty submission to that role, but it
  must still validate membership so a tampered or future-invalid value is
  rejected.

## 11. Reference Implementation Map

The implementing modules in this application, layer by layer:

| Responsibility | Module |
|---|---|
| Grant grammar, `evaluatePermissions()`, `assertPermission()` | `application/app/lib/permissions.js` |
| Role registry: role-name constants, categories, `isRegisteredRoleName()`, `isRoleName()`, `listRoles()`, `deriveRolePermissions()`, `areRoleGrantsWithinDomain()`, `canGrantRole()`, `filterGrantableRoles()` | `application/app/lib/roles.js` |
| `requirePermission(spec)` middleware factory | `application/app/presentation/middleware/require-permission.js` |
| Publishing principal authentication (bearer token → derived grants) | `application/app/presentation/middleware/publishing-authentication.js` |
| Admin principal authentication, session cookie (HTML panel) | `application/app/presentation/middleware/admin-authentication.js` |
| Admin principal authentication, HTTP Basic (`/admin-api/v1`) | `application/app/presentation/middleware/admin-basic-authentication.js` |
| Publishing per-endpoint authorization instances | `application/app/presentation/request-handlers/publishing-api/authorization.js` |
| Admin per-endpoint authorization instances (`adminGate()` factory) | `application/app/presentation/request-handlers/admin/authorization.js` |
| Shared route-param normalization (the Section 8.3 invariant) | `application/app/presentation/request-handlers/publishing-api/route-params.js` |
| Route wiring: authn at the route, authz at the head of each target | `application/virtual-hosts.js` |
| Token role storage, structural validation, domain-bounded mint, legacy-safe `revoke()` | `application/app/collections/publishing-api-token-record.js`, `publishing-api-token-collection.js` |
| Admin user role storage and `toAuthenticatedUser()` projection | `application/app/collections/admin-user-record.js`, `admin-user-collection.js` |
| Invite role storage, legacy-safe `markConsumed()`/`revoke()` | `application/app/collections/admin-invite-record.js`, `admin-invite-collection.js` |
| Invite delegation enforcement (dedupe, category, Root Admin exclusion, `canGrantRole()`) | `application/app/transaction-scripts/admin-invites/create-admin-invite.js` |
| Role conferral on redemption (bootstrap → Root Admin; invite → stored roles) | `application/app/transaction-scripts/admin-invites/consume-admin-invite.js`, `admin-users/create-admin-user-account.js` |
| Root Admin backfill migration (Section 9.2 continuity cutover) | `application/app/migrations/2026-07-18-backfill-admin-user-roles.js` |
| Write entry points (category-scoped validation of user input) | `application/app/presentation/forms/publishing-api-tokens/`, `forms/admin-invites/admin-invite-form.js` |
| Operator-facing pattern documentation | `application/app/presentation/README.md` ("Authorizing Requests with `requirePermission`") |
| Implementation history and settled decisions | `agents/plans/publishing-token-roles.md`, `agents/plans/generic-role-permission-authorization.md`, `agents/plans/admin-roles-and-permissions.md` |

### 11.1 Publishing API protected targets

| Target (route) | Action URN | Resource URN |
|---|---|---|
| `PUT /templates/base/*filepath` | `urn:kixx:publishing:template:put` | `urn:kixx:publishing:template` (static) |
| `PUT /templates/pages/*filepath` | `urn:kixx:publishing:template:put` | `urn:kixx:publishing:template` (static) |
| `PUT /templates/partials/*filepath` | `urn:kixx:publishing:template:put` | `urn:kixx:publishing:template` (static) |
| `PUT /pages{/*pathname}` | `urn:kixx:publishing:page-metadata:put` | `urn:kixx:publishing:page-metadata:<pathname>` (resolver) |
| `PUT /includes/*filepath` | `urn:kixx:publishing:include:put` | `urn:kixx:publishing:include:<filepath>` (resolver) |
| `PUT /assets/*filepath` | `urn:kixx:publishing:asset:put` | `urn:kixx:publishing:asset` (static) |

The three template targets share one configured instance because the decision
does not depend on the template kind. The publishing instances all pass
`code: 'PublishingApiTokenForbidden'` and message
`'The publishing API token is not authorized for this request.'` to preserve
the pre-existing 403 wire contract that external publish tooling may match
on.

### 11.2 Admin protected capabilities

Every admin decision is `urn:kixx:admin:<kind>:<verb>` on the static
bare-kind resource `urn:kixx:admin:<kind>`; all instances use the
`ForbiddenError` class defaults for `code` and `message`.

| Kind | `:read` gates | `:write` gates |
|---|---|---|
| `admin-user-invites` | invite list page | create invite, revoke invite |
| `publishing-api-tokens` | token list page | create token (panel), revoke token (panel), create token (`POST /admin-api/v1/publishing-api-tokens`) |
| `mailing-lists` | subscriber list page, CSV export | — |
| `alpha-platform` | user-app list page, user-app edit page | create user app, update user app |
| `migrations` | `GET /admin-api/v1/migrations` | `POST /admin-api/v1/migrations/:id/run` |

The HTML panel routes authenticate via the admin session cookie at the
subtree's `inboundMiddleware`; the `/admin-api/v1` routes authenticate via
HTTP Basic per-route (Section 8.2). Both middleware derive the same
`context.user` shape, so the gates above are shared verbatim between the two
surfaces.

## 12. Adopting the System in Another Kixx Application

### 12.1 Porting steps

1. **Copy the evaluator module** (`permissions.js`) as-is. It has no
   dependencies beyond the framework assertion helpers and `ForbiddenError`.
   Do not extend the pattern grammar without a security review.
2. **Create the role registry** (`roles.js`): frozen `{ name, category,
   permissions }` definitions and the exported operations from Section 6,
   with fail-closed derivation and cloned grants. Keep the array-action
   normalization rule (Section 5.1) in every helper that reads grants. Mint
   your own domain URNs (`urn:kixx:<your-domain>:<kind>:<verb>`), choosing
   the scoped or bare-kind resource convention per kind (Section 4.1).
3. **Copy the `requirePermission` factory.** It depends only on the evaluator
   module and the assertion helpers.
4. **Derive grants in your authentication middleware.** Read stored role
   names off the credential record (defaulting to `[]`), set `roles` and
   `permissions: deriveRolePermissions(roles)` on the principal, and do not
   reject empty or unknown roles. Repeat for every credential scheme that
   fronts protected routes.
5. **Store role names on the credential record** with the three-layer
   validation split from Section 9.1. Keep the empty-array-valid rule if any
   maintenance write path (revoke, deactivate, consume) must work on legacy
   records.
6. **Bound broadly-exposed credentials by capability.** If any credential
   type must stay within one domain, assert
   `areRoleGrantsWithinDomain(name, domain)` (plus registered-name
   membership) at its mint path (Section 6.2).
7. **Create a per-domain `authorization.js`** exporting one configured
   `requirePermission` instance per protected capability (a local factory
   like `adminGate()` when decisions are uniform), and a shared route-param
   module when any resource URN is request-dependent (Section 8.3).
8. **Wire the routes**: authentication middleware at the deepest uniformly
   credentialed route level, each configured authorization instance at the
   head of its target's `requestHandlers`, and the domain's error handler at
   the route level.
9. **Build admin surfaces from `listRoles(category)`** — and from
   `filterGrantableRoles()` wherever the surface confers roles — so options
   and schema enums cannot drift from the registry (Section 10).

### 12.2 Adding a new principal type: the Admin Users worked example

Because authorization reads only `context.user.permissions`, a new principal
type needs no changes to the evaluator, registry mechanism, or middleware
factory. The admin adoption in this application is the reference sequence;
ship the steps **in this order**, because the evaluator fails closed and
gating a route before its principals carry roles would 403 every request:

1. **Registry definitions** for the new domain: the four admin roles, their
   `urn:kixx:admin:*` grants, and the `category` metadata that keeps their
   form options separate from the publishing roles.
2. **Storage**: `roles` added to the admin user record (and to the invite
   record, since invites confer roles) with Section 9.1's lenient
   validation.
3. **Authentication derivation**: both admin middleware (session cookie and
   HTTP Basic) updated to derive permissions per Section 7.
4. **Existing-principal continuity**: the Root Admin backfill migration
   (Section 9.2) run so every pre-existing admin retains the full access it
   already had.
5. **Route enforcement last**: `requirePermission` instances attached to
   every admin panel and admin API target.
6. **Delegation surfaces**: the invite form's grantable-role options and the
   create-invite script's server-side grantability enforcement
   (Section 9.3), so scoped admins can be minted going forward.

A note on categories: an earlier revision of this spec deferred
principal-type metadata on roles until a second principal type needed it.
That need arrived with the admin roles, and the resolution is the `category`
field — deliberately scoped to presentation and input validation, never to
enforcement (Section 6.1).

### 12.3 Adding a role or a domain

- **New role:** add a frozen definition with a new unique name and a category
  to the registry. The name becomes a permanent persistence contract the
  moment it ships. Forms pick it up automatically via `listRoles(category)`
  (filtered by grantability where delegation applies). If the role should be
  attachable to a domain-bounded credential, keep every grant inside that
  domain or `areRoleGrantsWithinDomain()` will reject it at mint time.
- **New protected domain:** mint the domain's URNs in its role grants and its
  `authorization.js` decisions (in lockstep), choose the resource convention
  per kind (Section 4.1), and wire enforcement per Section 12.1 steps 7–8.
  The mechanism modules do not change.
- **Editing a role's grants:** takes effect for all principals holding that
  role at the next deploy. Removing a grant is a silent capability revocation
  for those principals; treat it with the same care as a credential change.
  Also re-check delegation consequences: narrowing a role's grants widens who
  can grant it, and widening them narrows who can.

### 12.4 Deployment consequences checklist

- Shipping the system (or a newly gated domain) over existing principals
  requires choosing an adoption strategy per principal type — credential
  reissue or a preserving-role backfill (Section 9.2) — and saying so in the
  deployment runbook.
- A backfill migration must be idempotent, must skip records that already
  carry roles, and must deploy in the same build as (or before) the route
  gates it protects against, per the expand/contract migration rules.
- Role-definition edits are live on deploy for all existing holders; there is
  never a grant data migration.
- Renaming a stored role-name string is a breaking data change and must not
  be done. Renaming URNs is safe only when grants and decisions change
  together in one deploy.
- Outstanding unredeemed invites carry role names; retiring or renaming a
  role affects what those invites confer (a retired name confers a role that
  derives nothing). Consider outstanding invites part of the blast radius of
  any registry change.

## 13. Design Decisions and Rationale

Settled decisions carried over from the implementation plans, recorded here
so future work does not re-litigate them:

- **Roles over stored grants.** Storing grant objects on records would freeze
  policy into data, requiring a migration for every policy change and
  allowing stored grants to drift from what the application understands.
  Storing names and deriving at auth time keeps policy in code, reviewed and
  deployed like code.
- **Deny-overrides-allow with default deny.** The evaluator's conservative
  semantics make the worst failure mode "someone authorized is blocked"
  rather than "someone unauthorized gets through" — malformed grants, unknown
  roles, missing principals, and malformed decisions all collapse to deny.
- **Authorization reads only `context.user.permissions`.** One evaluator, one
  assert helper, one middleware serve every current and future principal
  type. The alternative — per-principal-type authorization branches — spreads
  policy across the codebase.
- **Declarative route-level enforcement.** Moving decisions out of handler
  bodies makes the protection surface auditable in one place (the route
  configuration plus each domain's `authorization.js`) and makes a *missing*
  check visible in review, which in-handler asserts never are.
- **Startup-time spec validation.** A route misconfiguration is a programmer
  error; crashing at module load is strictly better than 500s (or worse,
  silent allows) at request time.
- **403 before request-validation feedback.** Unauthorized callers get no
  information about the endpoint's expected content type or body shape.
- **`code`/`message` overrides on the 403.** Domains keep their established
  wire contracts (external tooling may match on error codes) without forking
  the enforcement path. Domains without such a contract (admin) take the
  class defaults.
- **Categories are presentation metadata, not principal binding.** Roles stay
  principal-agnostic — the principal type is who holds a capability, not what
  the capability is. The category field scopes form options and input
  validation only; capability boundaries are enforced against the grants
  themselves via `areRoleGrantsWithinDomain()` (Section 6.1–6.2). This
  supersedes the earlier deferral of principal-type metadata.
- **Delegation by capability comparison, not rank.** "May grant a role" is
  defined as "already holds everything the role derives" (`canGrantRole()`),
  not as a role hierarchy. The pattern-vs-pattern comparison is conservative
  by design (Section 6.3); do not replace it with subset analysis without a
  security review.
- **Tampered role selections are 403s, not field errors.** The invite UI
  offers only grantable roles, so a non-grantable submission is not an honest
  validation failure to re-render — it fails closed as `ForbiddenError`
  (`AdminInviteRoleForbidden`) with no feedback about which roles would have
  been accepted.
- **Root Admin is bootstrap-only.** The full-wildcard role is conferred
  exclusively by bootstrap redemption and is never grantable through invites,
  so the number of full-access principals grows only through deliberate
  bootstrap events, not routine delegation.
- **Typo-guarding at mint time.** Creation APIs assert registered-name
  membership even though derivation drops unknown names, because a fail-closed
  read of a misspelled name would otherwise surface as a mysteriously
  powerless credential rather than an immediate programmer error.
