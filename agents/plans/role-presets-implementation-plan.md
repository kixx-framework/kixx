# Role Presets and Revised Admin Role Set — Implementation Plan

## Implementation Approach

This plan reshapes the admin role set and introduces **Role Presets**: named groupings of
roles that an admin chooses when minting an invite token on `/admin/invites`.

Two things change at once, and the second only makes sense in light of the first:

1. **The role grant tables change.** `Super Admin` narrows to a single grant
   (admin user invites). `Platform Admin` is removed. A new `Developer Admin` role
   holds the publishing-API-token and migrations grants. `Editor` gains the `admin`
   role category alongside `publishing`.

2. **Presets replace permission-derived delegation as the authority for invites.**
   Today `createAdminInvite()` requires the granting admin to personally hold every
   permission the conferred role grants (`canGrantRole()`), and the form renders only
   roles that pass the same test. That model cannot express the desired presets: a
   `Super Admin` holds only the invites grant, so it could not confer `Editor` or
   `Developer Admin`. From now on, **passing the existing
   `urn:kixx:admin:admin-user-invites:write` gate authorizes conferring any registered
   preset.** A Super Admin can therefore mint a Developer Admin invite. This is a
   deliberate widening of delegation, decided explicitly.

### Cross-cutting concerns

- **Where safety now lives.** With delegation checks gone, the guard against an invite
  conferring something it should not is a **load-time assertion** over the frozen preset
  table: every preset member must be a registered role in the `admin` category and must
  not be `Root Admin`. A definition mistake fails at import, before any request. This is
  also the only thing that gives Editor's new `admin` category a job — after the
  deletions below, nothing else consumes role categories on the admin side.
- **`Root Admin` remains unreachable by invite** because no preset lists it and the
  assertion forbids it. Do **not** add a redundant runtime `Root Admin` check to
  `createAdminInvite()`; it could never fire and would imply request input can name
  roles, which it cannot. The bootstrap env token stays the only path to `Root Admin`
  (`consume-admin-invite.js:50`) and is untouched by this plan.
- **Roles stay the durable authority.** An invite persists both its expanded `roles`
  array and the `rolePreset` name it came from, but only `roles` confers anything:
  `consumeAdminInvite()` returns `record.get('roles')` and
  `create-admin-user-account.js` copies that onto the new user. `rolePreset` is a
  display and audit label. Redefining a preset later must never change what an
  already-issued invite confers.
- **Dead code is removed, not retained.** `canGrantRole()`, `filterGrantableRoles()`,
  and `listRoles()` lose their last callers and are deleted, along with the
  now-unused `evaluatePermissions` import in `roles.js`. Leaving an exported but
  uncalled authorization helper invites a future agent to wire the abandoned model
  back in. `isRoleName()` and `areRoleGrantsWithinDomain()` **stay** — the publishing
  token form and collection still use them.
- **No legacy handling, no legacy commentary.** This is a reference application whose
  data is reset and re-seeded on every test run. Write no data migration for stored
  `Platform Admin` names, and do **not** document, comment on, or otherwise reference
  the previous role set or the previous delegation model anywhere in the code. The
  result must read as though it was always this way.
- **Naming collision is intentional.** `PRESET_DEVELOPER_ADMIN` and
  `ROLE_DEVELOPER_ADMIN` both hold the string `'Developer Admin'`; preset ids are
  their display names. Note this at the definition site so a later reader does not
  "fix" it. Validation is against the preset registry, so a submitted *role* name is
  rejected unless it happens to also be a preset name.

### Target role table

```js
defineRole(ROLE_ROOT_ADMIN, [ 'admin' ], [
    { action: '*', resource: '*' },
]);
defineRole(ROLE_SUPER_ADMIN, [ 'admin' ], [
    { action: 'urn:kixx:admin:admin-user-invites:*', resource: 'urn:kixx:admin:admin-user-invites' },
]);
defineRole(ROLE_DEVELOPER_ADMIN, [ 'admin' ], [
    { action: 'urn:kixx:admin:publishing-api-tokens:*', resource: 'urn:kixx:admin:publishing-api-tokens' },
    { action: 'urn:kixx:admin:migrations:*', resource: 'urn:kixx:admin:migrations' },
]);
defineRole(ROLE_EDITOR, [ 'admin', 'publishing' ], [
    { action: 'urn:kixx:publishing:page-metadata:put', resource: 'urn:kixx:publishing:page-metadata:*' },
    { action: 'urn:kixx:publishing:include:put', resource: 'urn:kixx:publishing:include:*' },
    { action: 'urn:kixx:publishing:asset:put', resource: 'urn:kixx:publishing:asset' },
    { action: 'urn:kixx:publishing:template:put', resource: 'urn:kixx:publishing:template' },
]);
```

`defineRole()` keeps its array-of-categories signature and its existing load-time
assertion rejecting a bare string.

### Target preset table

Membership is written out explicitly — never computed from the role registry — so that
adding a role later cannot silently widen an existing preset.

| Preset id / label | Member roles |
| --- | --- |
| `Developer Admin` | `Developer Admin`, `Super Admin`, `Editor` |
| `Owner Admin` | `Super Admin`, `Editor` |
| `Editor Admin` | `Editor` |

Definition order is the render order, most-capable first.

### Testing posture

Per `AGENTS.md`, do not write new tests or run the suite unless the user explicitly
asks. A survey of `test/` was done while writing this plan:

- **No existing test covers any behavior this plan changes.** There are no tests for
  `roles.js`, `create-admin-invite.js`, the admin invite form, `AdminInviteCollection`,
  `AdminInviteRecord`, or `list-admin-invites.js`.
- **One test file is impacted, mechanically only.**
  `test/app/presentation/middleware/admin-api-authentication.test.js` imports
  `ROLE_PLATFORM_ADMIN` and will fail at module load once that export is deleted. The
  role there is a stand-in for "some admin role"; every expectation is computed from
  `deriveRolePermissions()` itself, so a rename needs no assertion changes.

Because nothing under test changes behavior, there is no red/green cycle to run against
the existing suite. **If any task below is later expanded in a way that does change
behavior covered by a test, update that test first and watch it fail before writing the
implementation.** The import rename in Task 1 must land in the same commit as the
export deletion so the suite stays loadable at every checkpoint.

Verification for every task: `node run-linter.js <changed files>` must be clean. Do not
start the dev server or otherwise smoke-test; record manual procedures in handoff notes
instead.

---

### Task T1: Role registry reshaped and Role Preset registry established

**Status:** Complete
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `src/docs/server-error-handling.md` (assertions)

**Objective**

`src/app/lib/roles.js` becomes the single owner of both the role vocabulary and the
preset groupings over it, exposing exactly the accessors the rest of the system needs.
Importing the module either yields a provably safe preset table or throws.

**Scope**

- In: the role definitions and their `ROLE_*` constants; deletion of `ROLE_PLATFORM_ADMIN`;
  the preset definitions, `PRESET_*` constants, and preset accessors; the load-time preset
  invariant; deletion of `canGrantRole()`, `filterGrantableRoles()`, `listRoles()`; the
  identifier rename in `admin-api-authentication.test.js`.
- Out: every caller change (T2, T3, T4) — this task leaves the tree momentarily
  referencing deleted exports from `create-admin-invite.js` and `admin-invite-form.js`,
  which T2 and T4 resolve.

**Design and invariants**

- Presets live in `roles.js`, not a separate module: they are meaningless without the
  `ROLE_*` constants, no caller uses one without the other, and the invariant check is
  local (`src/docs/code-style-guide.md:51`, "Smaller modules are not always better").
- Preset ids are their display names. `PRESET_DEVELOPER_ADMIN === ROLE_DEVELOPER_ADMIN`
  by value; comment the deliberate overlap.
- Accessors, and only these two:
  - `listRolePresets()` → frozen preset definitions in definition order, for form options.
  - `resolveRolePreset(name)` → a **fresh copy** of the member role-name array, or
    `null` when the name is not registered.
  Returning `null` makes fail-closed the shape of the API rather than something a caller
  must remember. This is deliberately the opposite of `deriveRolePermissions()`, which
  skips unknown *role* names — correct there (a retired name on a stored record must not
  break a principal) and wrong here (an unknown preset must be refused).
- The preset table and each member array are frozen, and `resolveRolePreset()` copies,
  matching the existing `cloneGrant()` mutation-safety posture.
- Load-time assertion, next to the definitions: for every preset, every member is
  registered, belongs to the `admin` category, and is not `ROLE_ROOT_ADMIN`. Use the
  project `assert` already imported here.
- `deriveRolePermissions()`, `isRegisteredRoleName()`, `isRoleName()`, and
  `areRoleGrantsWithinDomain()` keep their current behavior and signatures.
- Rewrite the `ROLE_SUPER_ADMIN` doc comment to describe only its single grant, and
  document `ROLE_DEVELOPER_ADMIN` in the same style. Keep the existing explanatory
  comment above `ROLE_DEFINITIONS` about the shared name namespace and multi-category
  roles — it is now load-bearing for Editor.

**Expected touch points**

- `src/app/lib/roles.js` — role table, preset table, accessors, assertion, deletions.
- `test/app/presentation/middleware/admin-api-authentication.test.js` — rename
  `ROLE_PLATFORM_ADMIN` → `ROLE_DEVELOPER_ADMIN` at all 6 sites (import plus lines 32,
  49, 60, 69, 87, 101). No assertion or structural changes.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Role table matches "Target role table" above exactly; `ROLE_PLATFORM_ADMIN` is gone.
- [x] Preset table matches "Target preset table" above, with explicit member lists.
- [x] `listRolePresets()` and `resolveRolePreset()` exported and documented per the
      code documentation guide; `resolveRolePreset()` returns `null` for unknown names
      and a fresh array otherwise.
- [x] Importing the module throws if any preset member is unregistered, is not in the
      `admin` category, or is `Root Admin`.
- [x] `canGrantRole()`, `filterGrantableRoles()`, `listRoles()`, and the
      `evaluatePermissions` import are removed; `isRoleName()` and
      `areRoleGrantsWithinDomain()` remain.
- [x] No comment, JSDoc, or identifier anywhere references the removed role or the
      removed delegation model.
- [x] `admin-api-authentication.test.js` imports only existing exports.

**Validation**

- `node run-linter.js src/app/lib/roles.js test/app/presentation/middleware/admin-api-authentication.test.js` — clean.
- Read-through check: `grep -rn "Platform Admin\|canGrantRole\|filterGrantableRoles\|listRoles" src test` returns nothing.

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries:
  - Added a module-level `ADMIN_ROLE_CATEGORY = 'admin'` constant in `roles.js` for the
    load-time assertion. This is the same literal T3 and T4 are deleting from their own
    files; it now lives once, in the module that owns the category vocabulary.
  - The assertion loop reuses `isRoleName(name, 'admin')`, which covers *both*
    "registered" and "in the admin category" in one check. Function declarations hoist,
    so the loop can call it above its definition.
  - Preset shape is `{ name, roles }` (both frozen). `listRolePresets()` returns the
    frozen `PRESET_DEFINITIONS` array directly rather than a copy — the definitions are
    deeply frozen, so there is nothing a caller can mutate.
  - `ROLE_EDITOR` now declares `[ 'admin', 'publishing' ]`. The `admin` category exists
    solely to satisfy the preset assertion; the publishing-token form still selects it
    via `isRoleName(name, 'publishing')`, which is unaffected.
- Actual files changed:
  - `src/app/lib/roles.js`
  - `test/app/presentation/middleware/admin-api-authentication.test.js`
- Validation run:
  - `node run-linter.js src/app/lib/roles.js test/app/presentation/middleware/admin-api-authentication.test.js` — clean, exit 0.
  - `grep -rn "Platform Admin\|canGrantRole\|filterGrantableRoles\|listRoles" src test` — only
    the two out-of-scope call sites remain (`create-admin-invite.js`,
    `admin-invite-form.js`), which T3 and T4 remove as planned.
  - Module load check: importing `roles.js` succeeds and the assertion loop passes;
    `listRolePresets()` yields Developer Admin / Owner Admin / Editor Admin in order and
    `resolveRolePreset('Nope')` returns `null`.
- Blockers: None.

---

### Task T2: Invite records persist the preset name alongside expanded roles

**Status:** Complete
**Depends on:** None (independent of T1; do before T3)
**Documentation:** `src/app/collections/README.md`

**Objective**

An invite record durably carries both the roles it confers and the preset label it was
created from, while the consumed-bootstrap-marker path remains valid under the same
schema.

**Scope**

- In: `rolePreset` on `AdminInviteRecord`'s schema and `validate()`; the
  `createInvite()` argument and write; the bootstrap marker's explicit `null`.
- Out: who supplies the value (T3), how it is displayed (T4).

**Design and invariants**

- `rolePreset: { type: [ 'string', 'null' ] }`, **not** added to `required`, following
  the `consumedAt` / `revokedAt` precedent in this record.
- `validate()` accepts `null` or a non-empty string. Do **not** validate the value
  against the preset registry — same reasoning as the existing comment above the `roles`
  check: a name no longer in the registry must not brick a stored record.
- `createInvite(context, { createdBy, roles = [], rolePreset = null })`. Keep defaulting
  at this boundary rather than in `validate()`, consistent with how `roles` is handled.
- `createConsumedBootstrapMarker()` writes `rolePreset: null` explicitly, with a brief
  note in the spirit of the adjacent `roles: []` comment.
- `roles` remains the authority; `rolePreset` is a label. Nothing may read `rolePreset`
  to decide permissions.

**Expected touch points**

- `src/app/collections/admin-invite-record.js` — schema property, `validate()` check.
- `src/app/collections/admin-invite-collection.js` — `createInvite()` signature, JSDoc,
  and write; `createConsumedBootstrapMarker()` write.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `rolePreset` declared nullable and absent from `required`.
- [x] `validate()` rejects a non-null, non-string or empty-string `rolePreset` with a
      field error, and accepts `null`.
- [x] `createInvite()` accepts and persists `rolePreset`, defaulting to `null`.
- [x] Bootstrap marker records store `rolePreset: null`.
- [x] JSDoc updated for the changed signature; the existing `createInvite()` comment is
      reworded so it no longer describes a delegation-checked single role name.

**Validation**

- `node run-linter.js src/app/collections/admin-invite-record.js src/app/collections/admin-invite-collection.js` — clean.

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries:
  - `validate()` treats `undefined` the same as `null` (both pass), matching the
    `consumedAt` / `revokedAt` checks directly below it. `rolePreset` is not in
    `required`, so a record written without the key must remain valid.
  - The rejection message is `'AdminInvite rolePreset must be a non-empty string when
    present'` on field `rolePreset`.
  - Left an inline comment at the `rolePreset` check recording *why* the value is not
    validated against the preset registry: redefining a preset later must not invalidate
    an already-issued invite. This mirrors the existing reasoning above the `roles` check.
- Actual files changed:
  - `src/app/collections/admin-invite-record.js`
  - `src/app/collections/admin-invite-collection.js`
- Validation run:
  - `node run-linter.js src/app/collections/admin-invite-record.js src/app/collections/admin-invite-collection.js` — clean, exit 0.
- Blockers: None.

---

### Task T3: Invite creation authorizes and expands a preset

**Status:** Complete
**Depends on:** T1, T2
**Documentation:** `src/app/transaction-scripts/README.md`, `src/docs/server-error-handling.md`

**Objective**

`createAdminInvite()` takes an opaque preset name, refuses anything unregistered with a
403, and is the only place a preset becomes a set of role names.

**Scope**

- In: the signature, authorization check, expansion, and error contract of
  `create-admin-invite.js`.
- Out: the form and handler that call it (T4).

**Design and invariants**

- Signature: `createAdminInvite(context, { createdBy, rolePreset })`. Keep the existing
  `assertNonEmptyString(createdBy, ...)`.
- Expansion happens **here**, not in the request handler. The expansion step *is* the
  authorization decision: whatever it produces lands on the invite record and is copied
  verbatim onto the new admin user by `create-admin-user-account.js`. Only an opaque
  preset name crosses the presentation boundary, so no request can name a role directly.
- `const roles = resolveRolePreset(rolePreset)`; when `null`, throw `ForbiddenError`
  with code `AdminInvitePresetForbidden` and message
  `'The selected role preset cannot be granted.'`. A 403, not a 422 field error — the
  form only ever renders registered presets, so anything else is tampering and must fail
  closed. (The old error code was referenced nowhere outside this file, so renaming is
  free.)
- No `Root Admin` check, no `isRoleName()` check, no `canGrantRole()` call. The
  `ADMIN_ROLE_CATEGORY` constant becomes unused and is deleted. T1's load-time
  assertion is the guarantee; state that in the JSDoc.
- Pass `{ createdBy, roles, rolePreset }` to `invites.createInvite()`.
- Keep the existing storage-failure translation to `AssertionError` with `cause`, and
  the doc comment explaining that the returned raw token exists only here.

**Expected touch points**

- `src/app/transaction-scripts/admin-invites/create-admin-invite.js` — imports,
  signature, guard, expansion, JSDoc `@param`/`@throws`.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Accepts `rolePreset`; no longer accepts `role`.
- [x] An unregistered preset name throws `ForbiddenError` with code
      `AdminInvitePresetForbidden` before any storage call.
- [x] A registered preset stores the full expanded roles array plus the preset name.
- [x] No delegation or `Root Admin` logic remains; unused imports and constants removed.
- [x] JSDoc states the arguments, the 403 condition, and that Root Admin exclusion is
      guaranteed by the preset registry's load-time invariant.

**Validation**

- `node run-linter.js src/app/transaction-scripts/admin-invites/create-admin-invite.js` — clean.

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries:
  - `resolveRolePreset()` returning `null` collapses the "registered?" test and the
    expansion into one statement — the guard is `if (!roles)`. No separate membership
    check is needed or wanted.
  - `context.user.permissions` is no longer read by this script at all. Authorization is
    now entirely the route's existing `urn:kixx:admin:admin-user-invites:write` gate plus
    preset-registry membership.
  - Module constants renamed `ROLE_FORBIDDEN_*` → `PRESET_FORBIDDEN_*`. Confirmed by grep
    that the old code string `AdminInviteRoleForbidden` appears nowhere else in `src`,
    `test`, or templates, so nothing depended on it.
  - `ADMIN_ROLE_CATEGORY` and the `ROLE_ROOT_ADMIN` / `canGrantRole` / `isRoleName`
    imports are gone from this file; only `resolveRolePreset` is imported from `roles.js`.
- Actual files changed:
  - `src/app/transaction-scripts/admin-invites/create-admin-invite.js`
- Validation run:
  - `node run-linter.js src/app/transaction-scripts/admin-invites/create-admin-invite.js` — clean, exit 0.
  - `grep -rn "AdminInviteRoleForbidden" src test templates` — no matches.
- Blockers: None.

---

### Task T4: The /admin/invites surface authors by preset and shows what each invite confers

**Status:** Complete
**Depends on:** T1, T2, T3
**Documentation:** `src/app/presentation/README.md`, `src/templates/README.md`, `src/docs/frontend-development-guide.md`

**Objective**

An admin on `/admin/invites` picks a Role Preset — never a bare role — must pick one
deliberately, and can see from the list what each existing invite grants.

**Scope**

- In: the create form's field and options; the handler argument; the `<select>` markup
  and its placeholder; `presentInvite()`'s projection and the list row's grants line.
- Out: the revoke form and pagination (unchanged); publishing-API-token forms
  (unchanged — they still select `publishing`-category roles via `isRoleName()`).

**Design and invariants**

- Rename the field `role` → `role_preset` throughout: `static schema` property (keep
  `fieldType: 'select'`), the constructor's normalized instance property, `validate()`'s
  required check and message, the `getFormContext()` field key, and the template's
  `name` / `id` / `aria-describedby` / `form.fields.*` references. The label becomes
  `'Role preset'`. Nothing stored or external carries the old field name.
- Options come from `listRolePresets()` mapped to `{ value: name, label: name }`. No
  per-user filtering: any admin who passes the invites-write gate may confer any preset.
  Update the `getFormContext()` doc comment accordingly — it currently explains
  permission-derived filtering, which no longer exists. `filterGrantableRoles` and the
  `ADMIN_ROLE_CATEGORY` constant are removed from this file.
- The form's `validate()` keeps enforcing only that a selection was made; registry
  membership stays `createAdminInvite()`'s decision. Update the class doc comment to
  name the new error code.
- Add a leading `<option value="" disabled selected>Choose a role preset</option>` ahead
  of the option loop. Without it the browser preselects the first option, so an untouched
  submit would mint the most capable preset — and there is no longer a delegation check
  behind it. An empty submission hits the existing "A role preset selection is required"
  field error; no new validation logic.
- `presentInvite()` adds `rolePreset` to its projection. The row renders a grants line
  only when the value is present, so bootstrap markers stay clean. Reuse the card's
  existing `type-body-sm` / `type-label` classes and add no inline styles.
- `postCreateAdminInvite()` passes `rolePreset: form.role_preset`. Everything else in
  the handler — the deliberate render-instead-of-redirect for the one-time token, the
  pagination links — stays as it is.

**Expected touch points**

- `src/app/presentation/forms/admin-invites/admin-invite-form.js` — schema, constructor,
  `validate()`, `getFormContext()`, class and method docs.
- `src/app/presentation/request-handlers/admin-invites.js` — `createAdminInvite()` call.
- `src/app/transaction-scripts/admin-invites/list-admin-invites.js` — `presentInvite()`.
- `src/templates/pages/admin/invites/page.html` — select field block, placeholder option,
  grants line in the invite card.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The rendered select is named `role_preset`, labelled `Role preset`, and lists
      exactly `Developer Admin`, `Owner Admin`, `Editor Admin` in that order.
- [x] A disabled placeholder option is preselected; submitting without choosing produces
      the required-field error and creates no invite.
- [x] Choosing a preset creates an invite whose stored roles are the preset's members and
      whose `rolePreset` is the chosen name; the one-time signup URL still renders once.
- [x] Each invite row shows the conferred preset when present and omits the line otherwise.
- [x] No presentation file imports or references the deleted delegation helpers; docs and
      comments in the touched files describe the preset model only.

**Validation**

- `node run-linter.js src/app/presentation/forms/admin-invites/admin-invite-form.js src/app/presentation/request-handlers/admin-invites.js src/app/transaction-scripts/admin-invites/list-admin-invites.js` — clean.
- Manual procedure for the handoff notes (do not run it as verification):
  1. Sign in as a Root Admin, open `/admin/invites`; confirm the placeholder and the
     three preset options.
  2. Submit without choosing → field error, no new invite in the list.
  3. Choose `Owner Admin` → invite link shown once; the new row reads
     `Grants: Owner Admin`.
  4. Add `.json` to the list URL and confirm `form.fields.role_preset.options` and the
     `invites[].rolePreset` values.
  5. Redeem the link at the signup form and confirm the created admin holds
     `Super Admin` and `Editor`, can reach `/admin/invites`, and is refused at
     `/admin/publishing-api-tokens` and `/admin/migrations`.
  6. Repeat step 3–5 with `Developer Admin` while signed in as a `Super Admin`, which
     must succeed under the new delegation model.

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing. The manual procedure above has NOT been run — per `AGENTS.md` this
  agent does not start the dev server. It is left for the user.
- Decisions and discoveries:
  - The placeholder option uses `{{#unless form.fields.role_preset.value}}selected{{/unless}}`
    rather than an unconditional `selected`. On a re-render after a validation error the
    placeholder then yields to the previously chosen option, instead of relying on the
    browser's last-`selected`-wins tiebreak between two `selected` options.
  - The select's `id` is `role-preset` (kebab-case, matching the existing `new-invite-url`
    id style on this page) while `name` is `role_preset` (snake_case, per the form-data
    naming convention). The `aria-describedby` error id follows the `id`.
  - `BaseForm#getFormContext()` keys `fields` straight off `static schema.properties` and
    reads each value from `this[name]`, and `fromFormData()` passes raw FormData entries
    to the constructor. Renaming the schema property, the instance property, and the
    input `name` together is therefore sufficient — no other wiring refers to the field.
  - The grants line renders as `Grants: <span class="type-label">…</span>` inside the
    existing `type-body-sm` paragraph. No new CSS and no inline styles.
- Actual files changed:
  - `src/app/presentation/forms/admin-invites/admin-invite-form.js`
  - `src/app/presentation/request-handlers/admin-invites.js`
  - `src/app/transaction-scripts/admin-invites/list-admin-invites.js`
  - `src/templates/pages/admin/invites/page.html`
- Validation run:
  - `node run-linter.js src/app/presentation/forms/admin-invites/admin-invite-form.js src/app/presentation/request-handlers/admin-invites.js src/app/transaction-scripts/admin-invites/list-admin-invites.js` — clean, exit 0.
  - `node run-linter.js src` (whole tree) — clean, exit 0.
  - `grep -rn "form\.role\b\|fields\.role\b\|filterGrantableRoles\|canGrantRole\|Platform Admin\|listRoles(" src test` — no matches.
- Blockers: None.
