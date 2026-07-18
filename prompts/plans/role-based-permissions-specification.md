# Role-Based Permission System Specification

This document specifies the role-based permission system introduced for the
Kixx platform (merged in PR #3, "Migrate permissions to principle roles"). It
serves two audiences:

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

**Adoption status in this application (as of 2026-07):** Publishing API tokens
are the only principals that carry roles. Admin Users authenticate without
roles, and no admin route is gated by `requirePermission` yet — see the
sequencing warning in Section 12.2 before changing that.

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
   application code. Roles are the only producer of grants.
3. **A principal contract.** Authentication middleware sets `context.user`
   with the principal's stored role *names* and the grants *derived* from them
   at request time. Authorization reads only `context.user.permissions`.
4. **Declarative route enforcement.** A `requirePermission(spec)` middleware
   factory attaches the authorization decision to the route configuration, so
   no request handler body makes an authorization decision.
5. **A storage rule.** Persistent records store role names only — never
   grants. There is no permission data to migrate, ever.

The parts are layered so each depends only on the one below it: routes depend
on the middleware, the middleware on the evaluator, authentication on the
registry, and storage on nothing but the role-name strings.

## 2. Terminology

- **Principal** — the authenticated caller a request acts as. May be a human
  user, an API token, a service account, or any other credential. Stored on
  `context.user`.
- **Role** — a named, code-defined set of permission grants (e.g. `Editor`).
- **Grant** — one `{ effect, action, resource }` object in the evaluator
  grammar (Section 5).
- **Action URN** — a stable string naming an operation, e.g.
  `urn:kixx:publishing:page-metadata:put`.
- **Resource URN** — a stable string naming what is operated on, e.g.
  `urn:kixx:publishing:page-metadata:/blog/hello`.
- **Decision** — one `{ action, resource }` pair submitted for evaluation.
- **Registry** — the single application-wide module that owns every role
  definition.
- **Derivation** — resolving stored role names into a flat grant list at
  authentication time.

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

- `<domain>` — the application domain that owns the URN (e.g. `publishing`,
  or a future `admin`). The evaluator does not interpret this segment; it is
  data. Each domain mints its own URNs without coordinating with the
  mechanism.
- `<kind>` — the resource kind within the domain (e.g. `page-metadata`,
  `include`, `asset`, `template`).
- `<verb>` — the operation, on the action side (e.g. `put`).
- `<scope>` — an optional per-instance discriminator on the resource side
  (e.g. a page pathname). Resource kinds that are a single shared capability
  (e.g. `urn:kixx:publishing:asset`) omit the scope entirely.

Two stability rules:

- **URNs are internal contracts, not wire contracts.** They appear in role
  definitions (grants) and in route authorization specs (decisions). They may
  be renamed freely *only* when both sides change in lockstep within one
  deploy. They must never be persisted (Section 9) and never serialized to
  clients.
- **Wildcard scoping is part of the grammar.** A resource grant may end in
  `:*` to cover every scope under a kind (Section 5.3). Design resource URNs
  so the scope is the final segment, making the trailing wildcard meaningful.

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
  principal types. There is one registry module even when multiple domains
  and principal types share it.
- **Roles are frozen module data.** Each definition is
  `{ name, permissions }` where `permissions` is a frozen array of frozen
  grants in the evaluator grammar. Freezing prevents any caller from mutating
  the catalog at runtime.
- **Role-name constants are persistence contracts.** The exported name
  strings (e.g. `ROLE_EDITOR = 'Editor'`) are stored verbatim on principal
  records and must never change. Grant URNs inside a definition may change
  freely (they are derived, not stored) as long as decision URNs change in
  lockstep.

The registry exports three operations:

- `isRoleName(name)` — true only for a registered role name.
- `listRoles()` — every role definition, in definition order. This is the
  source for admin form select options and schema enums, so the UI can never
  drift from the registry.
- `deriveRolePermissions(roleNames)` — flattens stored role names into a
  fresh grant array. This function must **fail closed and never throw for bad
  stored data**: a non-array input yields `[]`; an unrecognized role name
  contributes no grants. It must return *cloned* grant objects so callers
  cannot mutate the frozen registry through the returned array.

**Derivation happens at authentication time, not at mint time.** Records
store role names only; grants are recomputed on every request. Consequences:

- Editing a role definition in code changes what every existing principal
  with that role can do on the next deploy. No data migration accompanies a
  role change, ever.
- A principal whose stored role was retired from the registry silently loses
  those grants (fail closed) rather than erroring.

The reference registry defines one role:

| Role | Grant action | Grant resource |
|---|---|---|
| `Editor` | `urn:kixx:publishing:page-metadata:put` | `urn:kixx:publishing:page-metadata:*` |
| `Editor` | `urn:kixx:publishing:include:put` | `urn:kixx:publishing:include:*` |
| `Editor` | `urn:kixx:publishing:asset:put` | `urn:kixx:publishing:asset` |
| `Editor` | `urn:kixx:publishing:template:put` | `urn:kixx:publishing:template` |

## 7. The Authenticated Principal Contract

Authentication middleware stores the principal on the context with
`context.setUser(principal)`. For a role-carrying principal the middleware
must set, at minimum:

```js
context.setUser({
    id,                                        // stable principal identifier
    type,                                      // principal kind, e.g. 'PublishingApiToken'
    roles,                                     // stored role names, defaulting to []
    permissions: deriveRolePermissions(roles), // derived grants, never stored grants
    // ...audit fields as appropriate: createdBy, credential timestamps, etc.
});
```

Rules:

- **Authorization reads only `context.user.permissions`.** This is the
  invariant the whole design protects: any authentication middleware — for
  any principal type — that derives grants in the evaluator grammar onto the
  principal gets authorization from the same evaluator, assert helper, and
  route middleware for free. Nothing downstream may branch on the principal
  `type` to make an authorization decision.
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
  `ForbiddenError` class defaults.
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
  endpoint. This is the pattern the Publishing API uses: each PUT target
  lists its configured `requirePermission` instance immediately before its
  handler.

Configured instances belong with their domain, not inline in the route file:
the reference implementation collects them in an `authorization.js` module
next to the domain's request handlers, and the route configuration imports
them through the domain's namespace export.

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

- **Persist role names only.** A principal record stores
  `roles: [ 'Editor' ]` — an array of role-name strings. Grants are never
  persisted anywhere. This is what makes role definitions freely editable in
  code with no data migration.
- **`roles` is an array even under a one-role policy.** The UI and forms may
  enforce exactly one role per principal, but the schema stays array-shaped
  so future multi-role support needs no storage change.

### 9.1 Validation layering

Role validation is split across three layers, each owning a different
concern:

| Layer | Rule | Failure type |
|---|---|---|
| Record `validate()` | `roles` is an array of non-empty strings; **an empty array is valid**. No registry-membership check. | `ValidationError` (blocks the write) |
| Form `validate()` (user input boundary) | The submitted role is required and must satisfy `isRoleName()`. | `ValidationError` with a field error on `role` (422) |
| Internal creation API (e.g. a collection's `createToken()`) | `roles` is a non-empty array and every member satisfies `isRoleName()`. | Assertion (programmer error — callers have already validated user input) |

The record layer is deliberately the loosest, for two reasons:

- **Legacy records must stay revocable.** A pre-role record has no `roles`
  attribute. Revocation goes through `update()`, which runs `validate()`; if
  the record required a non-empty roles array, revoking a legacy credential
  would throw — blocking the one security control operators still need. The
  revoke path therefore normalizes a missing `roles` to `[]` before updating,
  and the record accepts the empty array as the fail-closed representation.
- **Retiring a role must not brick stored records.** Registry membership is
  not a record invariant, because a stored role name can legitimately
  outlive the registry entry. Membership is enforced only at write entry
  points, where the role is fresh user or caller input.

### 9.2 Legacy principals and migration policy

Shipping the role system over an existing grant-storing credential scheme
requires **no data migration**. Existing records keep whatever legacy
attributes they have; they continue to authenticate, derive an empty grant
set, and receive 403 on every protected action until an operator reissues
the credential. This is a deliberate deploy consequence: the moment the
system ships, every pre-role credential stops authorizing writes, and a
fresh credential must be minted before the next use. Document this in the
deployment runbook.

## 10. Administrative Surfaces

- **Role selection is registry-driven.** Both the JSON:API creation form and
  the admin-panel HTML form build their role options from `listRoles()`, and
  the JSON:API form's schema `enum` is sourced live from the registry so the
  schema cannot drift from what `isRoleName()` accepts.
- **Listings present role names, never grants.** Role names are
  operator-facing labels; raw grant objects are an internal representation
  and are not exposed by list or create responses. Creation responses return
  `roles` (the stored names).
- **Defaulting is a UI concern.** With a single registered role, the admin
  form may default an empty submission to that role, but it must still
  validate membership so a tampered or future-invalid value is rejected.

## 11. Reference Implementation Map

The implementing modules in this application, layer by layer:

| Responsibility | Module |
|---|---|
| Grant grammar, `evaluatePermissions()`, `assertPermission()` | `application/app/lib/permissions.js` |
| Role registry: `ROLE_EDITOR`, `isRoleName()`, `listRoles()`, `deriveRolePermissions()` | `application/app/lib/roles.js` |
| `requirePermission(spec)` middleware factory | `application/app/presentation/middleware/require-permission.js` |
| Publishing principal authentication (derives grants onto `context.user`) | `application/app/presentation/middleware/publishing-authentication.js` |
| Configured per-endpoint authorization instances (URNs co-located with the domain) | `application/app/presentation/request-handlers/publishing-api/authorization.js` |
| Shared route-param normalization (the Section 8.3 invariant) | `application/app/presentation/request-handlers/publishing-api/route-params.js` |
| Route wiring: authn at the route, authz at the head of each target | `application/virtual-hosts.js` (`/publishing-api/v1` subtree) |
| Role-name storage, structural validation, legacy-safe `revoke()` | `application/app/collections/publishing-api-token-record.js`, `publishing-api-token-collection.js` |
| Write entry points (registry-membership validation of user input) | `application/app/presentation/forms/publishing-api-tokens/` |
| Operator-facing pattern documentation | `application/app/presentation/README.md` ("Authorizing Requests with `requirePermission`") |
| Implementation history and settled decisions | `agents/plans/publishing-token-roles.md`, `agents/plans/generic-role-permission-authorization.md` |

The Publishing API's six protected targets and their decisions:

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

## 12. Adopting the System in Another Kixx Application

### 12.1 Porting steps

1. **Copy the evaluator module** (`permissions.js`) as-is. It has no
   dependencies beyond the framework assertion helpers and `ForbiddenError`.
   Do not extend the pattern grammar without a security review.
2. **Create the role registry** (`roles.js`): frozen definitions, the three
   exported operations, fail-closed derivation with cloned grants. Mint your
   own domain URNs (`urn:kixx:<your-domain>:<kind>:<verb>`).
3. **Copy the `requirePermission` factory.** It depends only on the evaluator
   module and the assertion helpers.
4. **Derive grants in your authentication middleware.** Read stored role
   names off the credential record (defaulting to `[]`), set `roles` and
   `permissions: deriveRolePermissions(roles)` on the principal, and do not
   reject empty or unknown roles.
5. **Store role names on the credential record** with the three-layer
   validation split from Section 9.1. Keep the empty-array-valid rule if any
   maintenance write path (revoke, deactivate) must work on legacy records.
6. **Create a per-domain `authorization.js`** exporting one configured
   `requirePermission` instance per protected endpoint, and a shared
   route-param module when any resource URN is request-dependent
   (Section 8.3).
7. **Wire the routes**: authentication middleware at the route's
   `inboundMiddleware`, each configured authorization instance at the head of
   its target's `requestHandlers`, and the domain's error handler at the
   route level.
8. **Build admin surfaces from `listRoles()`** so role options and schema
   enums cannot drift from the registry.

### 12.2 Adding a new principal type (e.g. Admin Users)

Because authorization reads only `context.user.permissions`, a new principal
type needs no changes to the evaluator, registry mechanism, or middleware
factory. It needs:

1. Role definitions for its domain in the (single, shared) registry, with
   their own action/resource URNs.
2. Stored `roles` on its credential or account records (Section 9).
3. Its authentication middleware updated to derive grants per Section 7.
4. `requirePermission` instances attached to its routes.

**Sequencing warning — gate routes last.** The evaluator fails closed, so
attaching `requirePermission` to a route *before* that route's principals
carry roles will 403 every request. Ship in this order: registry definitions
and storage first, then authentication derivation, then (after existing
principals have been assigned roles) route enforcement. This is exactly why
no admin route in this application is gated yet.

**Known deferred concern:** with a single registry, `listRoles()` returns
every role across all principal types, and form select options are built from
that full list. When a second principal type gains roles, role definitions
will likely need a metadata field for principal-type filtering. Do not add
that field before it is needed.

### 12.3 Adding a role or a domain

- **New role:** add a frozen definition with a new unique name to the
  registry. The name becomes a permanent persistence contract the moment it
  ships. Forms pick it up automatically via `listRoles()`.
- **New protected domain:** mint the domain's URNs in its role grants and its
  `authorization.js` decisions (in lockstep), and wire enforcement per
  Section 12.1 steps 6–7. The mechanism modules do not change.
- **Editing a role's grants:** takes effect for all principals holding that
  role at the next deploy. Removing a grant is a silent capability revocation
  for those principals; treat it with the same care as a credential change.

### 12.4 Deployment consequences checklist

- Shipping the system over legacy grant-storing credentials immediately
  de-authorizes them (Section 9.2). Plan credential reissue before the next
  dependent operation, and say so in the deployment runbook.
- Role-definition edits are live on deploy for all existing holders; there is
  never a role-change data migration.
- Renaming a stored role-name string is a breaking data change and must not
  be done. Renaming URNs is safe only when grants and decisions change
  together in one deploy.

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
  the enforcement path.
- **No principal-type metadata on roles yet.** Deferred until a second
  principal type actually carries roles; speculative metadata would be
  untestable dead weight today.
