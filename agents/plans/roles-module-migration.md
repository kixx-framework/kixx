# Role Registry Rewrite: replace `lib/roles.js` with `permissions/roles.js`

## Implementation Approach

`src/app/permissions/roles.js` is the corrected role table: allow-only grants, bare
verb actions (`urn:kixx:get`, `urn:kixx:create`, …), and resource URNs matching what
the route manifests declare. It has no importers. Every live path still reads
`src/app/lib/roles.js`, whose grants use an older action *and* resource vocabulary,
so at runtime every authorization gate is satisfiable only by `Root Admin`. This
work makes the corrected table take effect.

**Backward compatibility is a non-goal.** There is no alias map, no dual-read
window, and no expand/migrate/contract sequencing. Role identity has exactly one
representation — the role `id` — from the first commit of this work. Stored records
holding old role names resolve to no permissions and fail closed, which is the
correct behavior for an identifier the system no longer recognizes.

**Nothing is carried over without a stated purpose.** The old module exports eight
symbols. Five do not survive contact with the new table, because the new table is
*cumulative* where the old one was not: `Developer` already carries every grant
`Admin` has, which already carries every grant `Editor` has. The preset layer
existed to compose non-overlapping roles into a usable bundle. That job no longer
exists.

Measured against the route manifests, each preset reaches exactly the same
decisions as its most capable member alone:

| Preset | Members | Decisions reachable | First member alone |
|---|---|---|---|
| Developer Admin | Developer + Admin + Editor | 17 | 17 |
| Owner Admin | Admin + Editor | 12 | 12 |
| Editor Admin | Editor | 9 | 9 |

### Legacy API disposition

Every export of `src/app/lib/roles.js`, with its fate and the reason:

| Export | Fate | Reason |
|---|---|---|
| `deriveRolePermissions` | **Keep**, id-keyed | The only bridge from a stored principal to `context.user.permissions`. Three call sites. |
| `isRoleName(name, category)` | **Keep as** `isRoleId(id, category)` | Gates where a role may be attached. Still the check that stops a publishing token from carrying admin roles. |
| `isRegisteredRoleName` | **Drop** | Redundant. Its only caller pairs it with a category check, and an unregistered id fails that check already. Two predicates guarding one decision is one too many. |
| `areRoleGrantsWithinDomain` | **Fold into a load-time assertion** | Proves that an `editor`-category role carries only `urn:kixx:publishing:` grants. That is a property of the table, not of a request, so it belongs at import — proven once — not re-derived on every token write. |
| `resolveRolePreset` | **Drop** | Presets are now identity functions on their most capable member. |
| `listRolePresets` | **Replace with** `listAttachableRoles(category)` | The invite form needs selectable options; it no longer needs a preset vocabulary to get them. |
| `ROLE_ROOT_ADMIN` | **Keep** as an id constant | The invite-redemption bootstrap path names it directly. |
| `ROLE_EDITOR` | **Keep** as an id constant | The publishing token admin form's default role. |

Final surface: five exports instead of eight, with one runtime check demoted to a
load-time invariant.

### Cross-cutting concerns

- **Fail closed.** An unresolvable role id confers no permissions rather than
  throwing — a retired role must not break the principal holding it.
- **Root Admin is unattachable.** `categories: []` is the mechanism: no role listing
  and no validation path can offer it, and the env bootstrap token is its only
  route. Assert at load time that `root-admin` carries no category, so the
  guarantee is enforced rather than implied.
- **Category rename.** `'publishing'` becomes `'editor'`. `Editor` carries
  `['admin', 'editor']` and stays attachable to both invites and publishing tokens.
- **Category is not URN domain.** The `editor` category and the
  `urn:kixx:publishing:` URN domain are different vocabularies that share a
  concept. The load-time grant-confinement assertion spans both and must not
  collapse them.
- **No deny effects.** The evaluator ignores `effect` entirely, so a grant written
  with `effect: 'deny'` would silently read as an allow. The table must never carry
  one and `deriveRolePermissions` must not copy the key through.

### Open decision, to settle in Task R1

The `id` values in the table were derived from the *old* names: `Admin` has
`id: 'super-admin'`, `Editor` has `id: 'editor-admin'`. R1 is the moment to choose,
before R4 writes any of them to a record.

Recommendation: align ids with current names — `root-admin`, `developer`, `admin`,
`editor` — so the table does not permanently encode the names it just moved away
from.

---

### Task R1: Id-keyed role registry

**Status:** Complete
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `test/unit-tests/README.md`

**Objective**

`src/app/permissions/roles.js` exports the five-symbol API its consumers need,
keyed by role id, with its structural guarantees proven at import. No consumer
changes yet, so this lands with zero runtime effect and is provable in isolation.

**Scope**

- In: the role table, the five exports, load-time invariant assertions, unit tests.
- Out: consumers (R2, R3), stored records (R4).

**Design and invariants**

- Settle the id-value decision from the Approach section first.
- Exports:
  - `deriveRolePermissions(roleIds)` — skips unresolvable ids, returns cloned
    mutation-safe grants with no `effect` key, returns `[]` for a non-array.
  - `isRoleId(id, category)` — asserts a non-empty category; a role in several
    categories matches each.
  - `listAttachableRoles(category)` — definition order, most capable first; each
    entry exposes `id` and `name` so a form can render a label and submit an id.
  - `ROLE_ROOT_ADMIN`, `ROLE_EDITOR` — id constants.
- Load-time assertions, each of which must fail the import when violated:
  - Role ids are unique.
  - `root-admin` carries no category, making it unattachable by construction.
  - Every `editor`-category role's grants — action and resource, every grant —
    are confined to the `urn:kixx:publishing:` URN domain. This is the demoted
    `areRoleGrantsWithinDomain` check.
  - `categories` is a non-empty array for every attachable role. A bare string
    must be rejected: `String#includes` matches substrings, so `'admin'` would
    satisfy a check for `'admi'` and silently widen the role's reach.
- Freeze the table, each role, and each grant; hand out copies from
  `deriveRolePermissions` and `listAttachableRoles`.

**Expected touch points**

- `src/app/permissions/roles.js` — the module.
- `test/unit-tests/app/permissions/roles.test.js` — new test file.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The five exports exist and nothing else is exported.
- [x] `deriveRolePermissions` returns `[]` for a non-array, an unknown id, and an
      old role name; grants carry no `effect`; mutating a result cannot affect the table.
- [x] `listAttachableRoles('admin')` omits `root-admin`.
- [x] Each load-time invariant fails the import when deliberately violated.
- [x] No file outside the module and its test imports it.

**Validation**

- `node run-tests.js test/unit-tests/app/permissions` — the new suite.
- `node run-linter.js src test` — clean.
- `node run-tests.js` — full suite still green; nothing changed underneath it.

**Progress and handoff**

- Completed: Implemented the private, frozen id-keyed registry and its five-export API. Added tests for fail-closed derivation, copy safety, attachment listing, exact exports, and deliberately corrupted import-time definitions. Removed the obsolete raw-table reachability checks from the route test; R2 owns replacing them with derived-principal coverage.
- Current state: Complete.
- Remaining: Nothing for R1.
- Decisions and discoveries: Canonical ids will match current role names: `root-admin`, `developer`, `admin`, and `editor`. The stated editor-domain assertion conflicts with the corrected bare-verb action vocabulary if read as requiring the publishing prefix on actions. R1 therefore confines editor grants by requiring actions from the closed publishing verb set (`urn:kixx:get`, `urn:kixx:create`) and resources under `urn:kixx:publishing:`.
- Actual files changed: `src/app/permissions/roles.js`, `test/unit-tests/app/permissions/roles.test.js`, `test/unit-tests/app/presentation/route-authorization.test.js`, `agents/plans/roles-module-migration.md`.
- Validation run: `node run-tests.js test/unit-tests/app/permissions` passed (11 tests); `node run-linter.js src test` passed; `node run-tests.js` passed (1204 tests, 0 disabled).
- Amended during R3: `developer` originally carried `categories: [ 'developer' ]`. No consumer reads that category, so the role was attachable to nothing and unreachable by any invite. It now carries `[ 'admin' ]`. The `listAttachableRoles('admin')` expectation and the non-array-category import fixture in `roles.test.js` were updated to match.
- Blockers: None.

---

### Task R2: Authentication and publishing tokens on role ids

**Status:** Complete
**Depends on:** R1
**Documentation:** `src/app/presentation/README.md`, `src/app/collections/README.md`

**Objective**

All three authentication middlewares derive permissions from the new registry, and
publishing token creation validates role ids. This is the task that makes the
corrected URN vocabulary live: roles other than Root Admin reach their routes for
the first time.

**Scope**

- In: `authenticate-admin-user.js`, `authenticate-admin-api-request.js`,
  `authenticate-publishing-token.js`, `publishing-api-token-collection.js`, and the
  two publishing token Forms.
- Out: the invite path (R3), stored records (R4).

**Design and invariants**

- Keep deriving permissions per request rather than persisting them: editing a
  role's grants in code must change every holder's capabilities on next deploy
  with no data migration.
- `publishing-api-token-collection.js` drops its `isRegisteredRoleName` and
  `areRoleGrantsWithinDomain` checks and keeps one: `isRoleId(id, 'editor')`.
  Registration is subsumed by the category check, and grant confinement is now
  proven at import by R1. Both removals are only safe *because* R1 holds — state
  that in the code comment so neither check is reintroduced as belt-and-braces.
- `create-publishing-api-token-form.js` validates ids; its message currently reads
  "registered publishing role names" and must stop saying "names".
- `publishing-api-token-admin-form.js` defaults to the Editor id.
- Existing token records hold role names and will derive no permissions. That is
  intended: tokens are short-lived and re-issuable.

**Expected touch points**

- `src/app/presentation/middleware/authenticate-admin-user.js`
- `src/app/presentation/middleware/authenticate-admin-api-request.js`
- `src/app/presentation/middleware/authenticate-publishing-token.js`
- `src/app/collections/publishing-api-token-collection.js`
- `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`
- `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js`
- `test/unit-tests/app/presentation/route-authorization.test.js` — extend to check
  reachability through `deriveRolePermissions`.

**Acceptance criteria**

- [x] Every route decision is reachable by its intended role through a real derived
      principal, not merely against the raw table.
- [x] Token creation accepts the Editor id and rejects `admin`, `developer`,
      `root-admin`, an unregistered id, and an empty list.
- [x] A principal holding an unregistered role is denied, not crashed.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation` — middleware and route suites.
- `node run-tests.js` — full suite.
- `node run-linter.js src test` — clean.

**Progress and handoff**

- Completed: Repointed all three authentication middlewares at `permissions/roles.js` and corrected their comment vocabulary from role names to role ids. Collapsed the publishing token collection's three role checks into `isRoleId(id, 'editor')`, with a comment naming R1's load-time assertion as the reason the other two are gone. Moved both publishing token Forms onto the Editor id and rewrote the JSON:API validation message. Added derived-principal reachability coverage to the route test and new suites for the creation Form and the collection.
- Current state: Complete.
- Remaining: Nothing for R2.
- Decisions and discoveries: The developer role reaches all 26 declared route decisions; the editor role reaches the 17 publishing API decisions and no admin decision; the admin role reaches the invite decisions and neither the API token nor migration decisions. A non-array `roles` submission to `CreatePublishingApiTokenForm` normalizes to the Editor id rather than failing validation — pre-existing behavior, left as is because it defaults to the least capable publishing role and cannot widen a token. The collection tests construct the Collection with a stub `db`, which is sufficient because every role assertion runs before store access; the accept case is proven by the failure moving past the role assertion.
- Actual files changed: `src/app/presentation/middleware/authenticate-admin-user.js`, `src/app/presentation/middleware/authenticate-admin-api-request.js`, `src/app/presentation/middleware/authenticate-publishing-token.js`, `src/app/collections/publishing-api-token-collection.js`, `src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js`, `src/app/presentation/forms/publishing-api-tokens/publishing-api-token-admin-form.js`, `test/unit-tests/app/presentation/route-authorization.test.js`, `test/unit-tests/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.test.js` (new), `test/unit-tests/app/collections/publishing-api-token-collection.test.js` (new), `agents/plans/roles-module-migration.md`.
- Validation run: `node run-tests.js` passed (1216 tests, 0 disabled); `node run-linter.js src test` clean. `grep -rn "lib/roles.js" src test` now matches only the three invite-path importers R3 owns.
- Blockers: None.

---

### Task R3: Invites confer a role id, and the preset layer is deleted

**Status:** Complete
**Depends on:** R1, R2
**Documentation:** `src/app/transaction-scripts/README.md`, `src/app/presentation/README.md`

**Objective**

An admin invite carries one role id instead of a preset name, the preset registry
is gone, and `src/app/lib/roles.js` is deleted with no importers left behind.

**Scope**

- In: invite creation and redemption, the invite Form, the invite record's role
  attributes, deleting the old module.
- Out: rewriting existing invite records (R4 — they are short-lived and are
  intentionally left to expire).

**Design and invariants**

- The boundary the preset layer was protecting must survive its removal: a request
  still may not confer an arbitrary role. It now names a role id validated with
  `isRoleId(id, 'admin')`, and `root-admin` is unreachable because it carries no
  category. This is the same guarantee by a shorter path — the preset registry's
  load-time "no preset contains Root Admin" assertion is replaced by R1's
  "`root-admin` has no category" assertion, which covers every attachment path at
  once rather than one path per registry.
- `create-admin-invite.js` validates the id and keeps refusing an invalid one with
  `ForbiddenError` code `AdminInvitePresetForbidden` — rename the code to match the
  new vocabulary, since the wire contract is not a compatibility constraint here.
- `consume-admin-invite.js` returns the Root Admin id on the bootstrap path.
- `admin-invite-form.js` renders `listAttachableRoles('admin')`, submitting `id`
  and displaying `name`.
- The invite record's `rolePreset` attribute is removed; `roles` holds ids.
- Delete `src/app/lib/roles.js` in this task. It has no remaining importers once
  R2 and R3 land, and leaving it in place is exactly the legacy-for-its-own-sake
  problem this plan exists to avoid.

**Expected touch points**

- `src/app/transaction-scripts/admin-invites/create-admin-invite.js`
- `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`
- `src/app/collections/admin-invite-collection.js`, `admin-invite-record.js` — role attributes.
- `src/app/presentation/forms/admin-invites/admin-invite-form.js`
- `src/app/lib/roles.js` — deleted.

**Acceptance criteria**

- [x] An invite names a role id; an unregistered or non-`admin`-category id is refused.
- [x] `root-admin` cannot be conferred by an invite.
- [x] A redeemed invite writes role ids onto the new admin user.
- [x] The bootstrap path still confers Root Admin.
- [x] `grep -rn "lib/roles.js" src test` returns no matches.

**Validation**

- `node run-tests.js` — full suite.
- `node run-linter.js src test` — clean.
- Unit coverage for invite creation refusing `root-admin` and an `editor`-only id.

**Progress and handoff**

- Completed: `createAdminInvite()` takes one `roleId` validated with `isRoleId(id, 'admin')` and refuses anything else with `ForbiddenError` code `AdminInviteRoleForbidden`. The invite Form renders `listAttachableRoles('admin')`, submitting the id and displaying the name. The `rolePreset` attribute is gone from the invite record schema, its required list, its validation, and both collection write paths. `consumeAdminInvite()` reads `ROLE_ROOT_ADMIN` from the new registry. `src/app/lib/roles.js` is deleted with no importers left.
- Current state: Complete.
- Remaining: Nothing for R3.
- Decisions and discoveries:
  - **R1's table had to change.** `developer` carried `categories: [ 'developer' ]`, a category no consumer reads, which made the Developer role attachable to nothing at all — no invite could confer it and there was no other path to a Developer account. It now carries `[ 'admin' ]` like every other invite-attachable role. R1's `listAttachableRoles('admin')` test was updated to expect Developer first, and its non-array-category import fixture was re-anchored on the Editor role because the string it targeted no longer exists.
  - The form field is `role_id` (was `role_preset`); the Transaction Script argument is `roleId` (was `rolePreset`).
  - Removing `rolePreset` cost the invite list its human-readable "Grants" label. `list-admin-invites.js` now builds an id-to-name map from `listAttachableRoles('admin')` and presents `roles` as a joined display string, or `null` when the invite carries none, so a bootstrap marker still omits the line and the roles API stays at five exports. An id the registry no longer offers falls back to rendering as itself.
  - The `rolePreset` vocabulary reached beyond the plan's touch points into `list-admin-invites.js`, the admin invites request handler, `src/templates/pages/admin/invites/page.html`, `src/app/presentation/README.md`, and two end-to-end helpers. All were updated; the end-to-end helper now invites `developer`.
- Actual files changed: `src/app/permissions/roles.js`, `src/app/transaction-scripts/admin-invites/create-admin-invite.js`, `src/app/transaction-scripts/admin-invites/consume-admin-invite.js`, `src/app/transaction-scripts/admin-invites/list-admin-invites.js`, `src/app/collections/admin-invite-collection.js`, `src/app/collections/admin-invite-record.js`, `src/app/presentation/forms/admin-invites/admin-invite-form.js`, `src/app/presentation/request-handlers/admin-panel/admin-invites.js`, `src/app/presentation/README.md`, `src/templates/pages/admin/invites/page.html`, `src/app/lib/roles.js` (deleted), `test/unit-tests/app/permissions/roles.test.js`, `test/unit-tests/app/transaction-scripts/admin-invites/create-admin-invite.test.js` (new), `test/unit-tests/app/transaction-scripts/admin-invites/consume-admin-invite.test.js` (new), `test/end-to-end/001-sanity-checks/020-admin-user-invites.test.js`, `test/end-to-end/test-helpers/authenticate.js`, `agents/plans/roles-module-migration.md`.
- Validation run: `node run-tests.js` passed (1221 tests, 0 disabled); `node run-linter.js src test` clean; `grep -rn "lib/roles.js" src test` returns no matches, as does a grep for `rolePreset`, `role_preset`, and every dropped legacy export name.
- Blockers: None.

---

### Task R4: Backfill admin user roles — conditional

**Status:** Not started
**Depends on:** R3
**Documentation:** `src/app/migrations/README.md`

**Objective**

Existing admin user records hold role names and, after R2, confer nothing. This
task rewrites them to role ids.

**Scope**

- In: admin user records only.
- Out: invites and publishing API tokens. Both are short-lived and re-issuable, so
  migrating them buys nothing that waiting does not. They fail closed and are
  re-created through the normal flow.

**Design and invariants**

- **Decide whether to do this task at all before writing it.** It exists for one
  reason: an admin user record is the only role-bearing record that cannot be
  re-created through a normal flow — recovery otherwise means the env bootstrap
  token and re-inviting every admin. If the deployment's admin set is small enough
  that re-inviting is cheaper than an audited migration, skip R4 and record that
  decision here. Recommendation: skip it for a single-operator deployment; write
  it once more than a handful of admins exist.
- If written: id form `YYYY-MM-DD-short-kebab-description`, permanent, never
  renamed or reused.
- One bounded batch per invocation. Pass Collection cursors through unchanged —
  never parse, synthesize, or modify them. `cursor` is `null` exactly when `done`.
- Idempotent: inspect current state before each write so replaying a batch is safe
  and a record already holding ids is skipped.
- `dryRun` performs identical reads and decisions and omits every mutation.
- An unrecognized stored name is left as-is and counted, never dropped and never
  fatal. Dropping silently strips access; failing blocks the backfill on one row.
- Roles are stored under optimistic concurrency; use the Collection write method
  that retries on version conflict rather than a bare put.
- The old-name-to-new-id mapping lives inside this module and nowhere else. It is
  the only place in the codebase that knows the old vocabulary, and it dies with
  the module.

**Expected touch points**

- `src/app/migrations/<id>.js` — the migration module.
- `src/app/migrations/mod.js` — explicit import and registry entry with an
  operator-facing description.
- `test/unit-tests/app/migrations/` — batch, idempotency, and dry-run coverage.

**Acceptance criteria**

- [ ] Names are rewritten to ids on admin user records.
- [ ] A record already holding ids is left untouched, and re-running changes nothing.
- [ ] A dry run mutates nothing and reports the counts the real run would.
- [ ] An unrecognized name is preserved and counted.
- [ ] `done`/`cursor` honor the module contract in every branch.

**Validation**

- `node run-tests.js test/unit-tests/app/migrations` — migration suite.
- `node run-linter.js src test` — clean.
- Operator check that cannot be a command: dry-run through the Admin API in a real
  environment, confirm counts, then run for real and confirm the ledger records
  completion.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
