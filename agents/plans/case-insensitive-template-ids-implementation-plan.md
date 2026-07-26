# Case-Insensitive Template Ids — Implementation Plan

## Implementation Approach

Hyperview resolves template ids from three sources that do not agree on case:

1. **Derived from a page pathname** — the default page template id is
   `{pathname}/page.html`, built from a URL pathname the page handlers already folded
   to lower case (`normalizePagePathname`).
2. **Written by an author** — `metadata.baseTemplate`, `metadata.pageTemplate`, and
   `options.pageTemplate` are resolved verbatim.
3. **Derived from the store** — partial names come from the template file store's own
   directory walk / KV listing (`loadPartials`), and are matched against hand-written
   `{{> name }}` references in template source.

Because a template id becomes a storage key, and the two store adapters disagree on
case (a Cloudflare KV key is case-sensitive; a macOS filesystem path is not), the same
site behaves differently per deploy target. The current code handles this with a
per-kind table — page template ids are folded, base templates and partials are not —
which is correct but requires every reader to hold a three-way rule in their head.

**This plan replaces the three-way rule with one rule: every template id is folded to
lower case at the point where `HyperviewService` hands it to the template file store.**
After this change neither the publishing API request handlers nor the page request
handlers know anything about case.

The convention already exists and is already documented — `src/app/presentation/README.md:51`
tells authors to name everything under `pages/` and `templates/pages/` in lower case,
and warns that an uppercase directory becomes unreachable. Today that warning is
enforced by hope for base templates and partials, and half-enforced for page templates.
This plan makes it mechanical, which is what lets the documentation stop being a
warning about a foot-gun and start being a statement of how resolution works.

### Cross-cutting concerns

- **`HyperviewService` owns the invariant, not the adapters and not the handlers.**
  "Template ids are case-insensitive" is a Hyperview *naming* decision. Storage being
  case-sensitive-or-not is the symptom, not the rule. The service is also the sole
  chokepoint — every read goes through `getBaseTemplate`/`getPageTemplate`, every write
  through `putBaseTemplate`/`putPageTemplate`/`putPartial`, and `loadPartials` has no
  external callers — so one fold per method covers both directions for all three kinds.
  Do **not** fold inside the store adapters: that would duplicate the rule across two
  plugins, require amending `template-file-store-interface.js`, and make the adapters
  silently rewrite caller input. `template-file-store-interface.js` and both adapters
  are untouched by this plan.

- **Fold at method entry, before the cache key is built.** `getBaseTemplate` and
  `getPageTemplate` build `#templateCache` keys as `${buildId}:base:${templateId}` and
  `${buildId}:page:${templateId}`. Folding after the key is computed would leave
  `Site.html` and `site.html` as two cache entries pointing at one stored file — not
  incorrect, but it wastes memory and makes cache-hit logging lie about what was
  resolved. The fold must be the first statement that touches the id.

- **Use `toLowerCase()`, never `toLocaleLowerCase()`.** `toLowerCase()` is
  locale-independent. `toLocaleLowerCase()` would make key resolution depend on the
  server's locale — in a Turkish locale `I` folds to `ı`, not `i`, so the same template
  id would resolve to different keys on different hosts. That is the exact class of
  cross-platform divergence this plan exists to remove.

- **The templating engine stays general-purpose.** `src/kixx/templating/` is a
  standalone component with its own README and LICENSE, and it must not learn Hyperview
  naming policy. It resolves partials solely through `partials.has(name)` and
  `partials.get(name)` (`create-render-function.js:440,444,452,456`) — it never
  iterates, sizes, or spreads the map. That is what makes a case-insensitive `Map`
  subclass, constructed by `HyperviewService` and passed in, a drop-in with no engine
  change. Do not add case handling to `create-render-function.js`.

- **Partial references must not become a documentation-enforced rule.** Per the
  Mustache spec a missing partial renders as an empty string
  (`create-render-function.js:439`) — no error, no log. If authors were merely *told*
  that partial names are lower case, `{{> Nav.html }}` would silently render nothing
  and the author's markup would look correct. Task T2 exists specifically so the rule
  is mechanical rather than advisory.

- **`#createMiniTemplate` needs no change.** It compiles metadata mini-templates with a
  deliberately empty `new Map()` so they cannot reference partials
  (`hyperview-service.js:617-623`). No partial lookup happens there.

- **The empty-segment rejection stays.** `route-params.js` and `put-template.js` reject
  URL path segments that are empty (a leading, doubled, or trailing slash). That guards
  against one resource being addressable by two URLs under two authorization URNs, and
  against a trailing slash producing an unreachable Cloudflare KV key. It is orthogonal
  to case and must survive T3 untouched.

- **No data migration.** Any already-deployed build containing an uppercase template key
  becomes unreachable and must be re-uploaded. This is a reference application whose
  builds are re-deployed rather than migrated in place, so write no migration and no
  legacy-compatibility branch. Do not document or comment on the previous per-kind
  behavior anywhere in the code; the result must read as though it was always this way.

- **No unit tests unless explicitly requested.** Per `AGENTS.md`, tests are not written
  or run as part of this plan. Each task carries a manual verification procedure in
  place of test coverage. Run the linter on every changed JavaScript file.

---

### Task T1: Fold template ids to lower case in HyperviewService

**Status:** Complete
**Depends on:** None
**Documentation:** `src/plugins/README.md` (ports and adapters — why the fold is above the store); `src/docs/code-style-guide.md`

**Objective**

`HyperviewService` resolves every base, page, and partial template id case-insensitively,
in both directions. A template written as `Site.html` is readable as `site.html`,
`SITE.HTML`, or `Site.html`, on every deploy target. After this task the service is the
single authority for the rule, so callers above it can stop folding.

**Scope**

- In: the five id-carrying template methods on `HyperviewService` — `getBaseTemplate`,
  `getPageTemplate`, `putBaseTemplate`, `putPageTemplate`, `putPartial` — plus their
  JSDoc.
- Out: partial *name* lookup (T2); removing the now-redundant folds in the publishing
  API and page handlers (T3); author-facing documentation (T4); both store adapters and
  `template-file-store-interface.js`, which are deliberately unchanged.

**Design and invariants**

- The fold is the first statement touching the id in each method, **before** the
  `#templateCache` key is built, so one stored file never occupies two cache entries.
- Use `toLowerCase()`. Never `toLocaleLowerCase()` — see the cross-cutting note.
- Introduce one private helper (e.g. `#normalizeTemplateId`) rather than five inline
  `.toLowerCase()` calls, so the rule has a single named site and the five methods
  cannot drift. Drift between two byte-identical blocks is what produced the original
  bug in `hyperview-request-handlers.js`.
- The id is folded; the *source text* is never touched.
- `TemplateFileRef.filepath` returned by the store is already derived from the folded id,
  so write responses report the folded key. That is intended — the publishing API should
  tell a client the key its page metadata will resolve.
- Do not add validation here. Traversal and character-whitelist rejection already happen
  at the request edge (`validatePathname`) and again in the store adapters.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — add the private normalizer; apply it at
  the entry of the five methods; update the `templateId`/`filepath` JSDoc on each to
  state that resolution is case-insensitive.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All five methods fold their id before any other use of it, including cache keys.
- [ ] A single named private helper owns the fold; no method folds inline.
- [ ] JSDoc on each of the five methods states that the id resolves case-insensitively.
- [ ] `toLocaleLowerCase()` appears nowhere in the change.
- [ ] No change to `template-file-store-interface.js` or either store adapter.

**Validation**

- `node run-linter.js src/kixx/hyperview/hyperview-service.js` — passes clean.
- Manual: with the dev server running, `GET /admin/style-guide` still renders with its
  base template and body, proving the existing all-lower-case content is unaffected.
- Manual: `PUT /publishing-api/v1/templates/base/Site.html` (`text/plain`, staged
  `Kixx-Build-Id`) writes `base/site.html` in the template store root; a page whose
  metadata sets `"baseTemplate": "Site.html"` then renders against it.

**Progress and handoff**

- Completed: Added a private `#normalizeTemplateId(templateId)` helper
  (`toLowerCase()`, not `toLocaleLowerCase()`) to `HyperviewService`. Applied it
  as the first statement in `getBaseTemplate`, `getPageTemplate`,
  `putBaseTemplate`, `putPageTemplate`, and `putPartial`, before any cache-key
  construction or other use of the id. Updated the `templateId`/`filepath` JSDoc
  on all five methods to state case-insensitive resolution, and added JSDoc to
  the new helper.
- Current state: All five methods fold on entry; no other change made.
- Remaining: Nothing for this task. T2 (partial name lookup) and T3 (removing
  the now-redundant per-kind folds in the publishing API and page handlers) are
  separate tasks and still pending — the per-kind folds in
  `put-template.js`/`hyperview-request-handlers.js` are still in place and now
  redundant with this task's change, but T3 removes them, not T1.
- Decisions and discoveries: `putPartial`'s parameter is named `filepath`, not
  `templateId`; folded that local in place (`filepath = this.#normalizeTemplateId(filepath)`)
  rather than renaming the parameter, matching the existing method signature.
- Actual files changed: `src/kixx/hyperview/hyperview-service.js`.
- Validation run: `node run-linter.js src/kixx/hyperview/hyperview-service.js`
  — passes clean (no output, exit 0). The manual dev-server checks described
  above were **not run**: `AGENTS.md`'s Work Verification section says "Do not
  run the dev server ... for the purpose of work verification or smoke
  testing," which overrides this plan's own Validation section. Whoever
  reviews this task should run the two manual checks themselves:
  1. With the dev server running, `GET /admin/style-guide` still renders with
     its base template and body.
  2. `PUT /publishing-api/v1/templates/base/Site.html` (`text/plain`, staged
     `Kixx-Build-Id`) writes `base/site.html`; a page whose metadata sets
     `"baseTemplate": "Site.html"` then renders against it.
- Blockers: None.

---

### Task T2: Resolve `{{> partial }}` references case-insensitively

**Status:** Complete
**Depends on:** T1
**Documentation:** `src/templates/README.md` (partial resolution, lines ~1204 and ~1295-1300)

**Objective**

A `{{> Nav.html }}` reference resolves the partial stored as `nav.html`. Partial name
matching stops depending on an author remembering a naming convention, which matters
because a missed partial renders as an empty string with no error.

**Scope**

- In: the partials `Map` that `HyperviewService.loadPartials()` builds and hands to
  `compileTemplate`; the case-insensitive map type itself.
- Out: any change to `src/kixx/templating/` (the engine stays general-purpose);
  `#createMiniTemplate`, which passes a deliberately empty map.

**Design and invariants**

- Implement a small `Map` subclass overriding `get(key)` and `has(key)` to fold the
  lookup key, and fold on `set(key, value)` so stored keys are canonical too. The engine
  calls only `has` and `get`; folding in `set` as well keeps the map self-consistent for
  any future reader.
- `loadPartials()` constructs it. The engine receives a plain `Map` *interface* and must
  remain unaware — do not import it into `src/kixx/templating/`.
- Where the class lives is an open choice: a new module under `src/kixx/hyperview/lib/`
  or module-private in `hyperview-service.js`. Prefer module-private unless a second
  consumer appears; there is currently exactly one.
- `loadPartials` passes the partially-built map into `compileTemplate` as it walks, so
  partials can reference earlier partials (`hyperview-service.js:552-556`). The subclass
  must preserve that behavior — it is a live `Map`, not a snapshot.
- The `#partialsCache` key is `buildId || 'null'` and contains no template name, so it
  needs no change.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — the case-insensitive map type; construct
  it in `loadPartials()`; note the behavior in the `loadPartials` JSDoc.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `loadPartials()` returns a map whose `get`/`has`/`set` fold the key.
- [ ] `src/kixx/templating/` is unchanged.
- [ ] A partial referenced in any case resolves to the stored partial.
- [ ] A genuinely missing partial still renders as an empty string (Mustache spec
      behavior is preserved, not accidentally converted into an error).
- [ ] Cross-partial references (a partial including an earlier partial) still resolve.

**Validation**

- `node run-linter.js src/kixx/hyperview/hyperview-service.js` — passes clean.
- Manual: temporarily change a `{{> ... }}` reference in an existing template to mixed
  case (e.g. `{{> Default-Site-Header.html }}` in a base template) and confirm the page
  renders the header rather than an empty gap; revert the edit afterward.
- Manual: reference a partial that genuinely does not exist and confirm the page renders
  with an empty string in its place rather than throwing.

**Progress and handoff**

- Completed: Added a module-private `CaseInsensitiveMap` class (extends `Map`,
  overrides `get`/`has`/`set` to fold string keys with `.toLowerCase()`) above
  the `HyperviewService` class in `hyperview-service.js`. Changed
  `loadPartials()` to construct `new CaseInsensitiveMap()` instead of
  `new Map()` — the only line changed in that method besides the JSDoc.
  Updated the `loadPartials` JSDoc return description to state that keys
  resolve case-insensitively.
- Current state: Complete. No change made to `src/kixx/templating/` or
  `#createMiniTemplate` (confirmed the mini-template path still passes its own
  empty `new Map()`, untouched).
- Remaining: Nothing for this task.
- Decisions and discoveries: Verified via
  `grep -n "partials\." src/kixx/templating/lib/create-render-function.js`
  that the engine calls only `partials.has(...)` and `partials.get(...)`
  (lines 440, 444, 452, 456) — confirms a plain-Map-shaped subclass is a
  drop-in with no engine-side change needed. `loadPartials` builds the map
  incrementally and passes the same live instance into each `compileTemplate`
  call as it walks (`hyperview-service.js` ~552-556), so cross-partial
  references still resolve — the subclass is a live object, not a snapshot,
  so this was unaffected by the change. Did not add `isString`/type-guarding
  in `get`/`has`/`set`: partial keys are always strings by construction in
  this codebase (author-written `{{> name }}` references and
  `filepath.replace(...)`-derived names), so an `isString` check would be
  validating a scenario that cannot happen, which `src/docs/server-error-handling.md`
  says to avoid.
- Actual files changed: `src/kixx/hyperview/hyperview-service.js` (same file
  as T1; no other file touched).
- Validation run: `node run-linter.js src/kixx/hyperview/hyperview-service.js`
  — passes clean (no output, exit 0). Per `AGENTS.md`'s Work Verification
  section, the dev server was not started and no manual smoke test was run.
  Whoever reviews this task should run the two manual checks themselves:
  1. Temporarily change a `{{> ... }}` reference in an existing base template
     to mixed case (e.g. `{{> Default-Site-Header.html }}`) and confirm the
     page renders the header rather than an empty gap; revert afterward.
  2. Reference a partial that genuinely does not exist and confirm the page
     renders with an empty string in its place rather than throwing.
- Blockers: None.

---

### Task T3: Remove the superseded per-kind and per-handler folds

**Status:** Complete
**Depends on:** T1, T2
**Documentation:** `src/app/presentation/README.md` (presentation layer); `src/docs/server-error-handling.md`

**Objective**

The publishing API request handler and both page request handlers stop knowing about
template id case. With `HyperviewService` owning the rule, the per-kind table and the
per-handler normalizer are dead weight that would let a future reader believe case is
handled in three places.

**Scope**

- In: `CASE_FOLDED_TEMPLATE_KINDS` and the `kind` argument threaded into
  `getWildcardFilepath()` in the publishing API template handler;
  `normalizePageTemplateId()` and its two call sites in the page request handlers; the
  comments and JSDoc that explain the removed behavior.
- Out: the empty-segment rejection in the same functions, which stays; anything in
  `route-params.js`, which concerns page pathnames and includes rather than templates.

**Design and invariants**

- **The empty-segment rejection must survive.** In `put-template.js` it prevents a
  trailing slash from producing a Cloudflare KV key no read will look up; in
  `route-params.js` it prevents one page from being addressable under two authorization
  URNs. Neither has anything to do with case. Removing it would silently reintroduce
  two separate bugs.
- `getWildcardFilepath()` loses its `kind` parameter and returns the validated filepath
  unchanged. `createPutTemplateHandler` keeps `kind` — it still selects the transaction
  script branch.
- The `pageTemplateId` blocks in the two page handlers are byte-identical. They must
  stay identical after the removal; that duplication is pre-existing and is not this
  task's to resolve.
- Page *pathname* folding (`normalizePagePathname`) is unrelated and stays. Only
  `normalizePageTemplateId` is removed.
- Update the `options.pageTemplate` JSDoc in both handler factories: the
  case-insensitivity claim is still true after this task, but it is now delivered by
  `HyperviewService`, so the wording should not imply the handler does it.
- Leave no commentary describing the previous per-kind behavior.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/put-template.js` — remove
  `CASE_FOLDED_TEMPLATE_KINDS`, the `kind` parameter on `getWildcardFilepath()`, and the
  associated comment block; keep the empty-segment guard; drop the now-unused
  `isNonEmptyString` import only if the guard no longer needs it (it does need it).
- `src/kixx/hyperview/hyperview-request-handlers.js` — remove
  `normalizePageTemplateId()` and its two call sites; adjust the two
  `options.pageTemplate` JSDoc entries.

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No case folding remains in `put-template.js` or `hyperview-request-handlers.js`.
- [ ] The empty-segment rejection in `put-template.js` is intact and still returns a
      `BadRequestError` with code `EmptyPathSegment`.
- [ ] `route-params.js` is untouched.
- [ ] No comment or JSDoc anywhere describes the removed per-kind rule.
- [ ] `grep -rn "toLowerCase" src/kixx/hyperview/hyperview-request-handlers.js` returns
      only `normalizePagePathname`.

**Validation**

- `node run-linter.js src/kixx/hyperview/hyperview-request-handlers.js src/app/presentation/request-handlers/publishing-api/`
  — passes clean.
- Manual: `PUT /publishing-api/v1/templates/pages/Blog/Hello/page.html` then
  `PUT /publishing-api/v1/pages/Blog/Hello`; after promoting the build, `GET /Blog/Hello`
  and `GET /blog/hello` both render **with** body content — the end-to-end proof that
  folding still happens, now one layer down.
- Manual: `PUT /publishing-api/v1/templates/base/site.html/` still returns 400
  `EmptyPathSegment`.

**Progress and handoff**

- Completed: In `put-template.js` — removed `CASE_FOLDED_TEMPLATE_KINDS` and the
  `kind` parameter from `getWildcardFilepath()`; that function now just
  validates and returns the filepath unchanged (no folding at all — case
  handling lives solely in `HyperviewService` now). Reworded the response
  comment to drop the "folded name" language that no longer applies. Kept the
  empty-segment guard and its `isNonEmptyString` import untouched — it is
  unrelated to case and still needed.
  In `hyperview-request-handlers.js` — removed `normalizePageTemplateId()` and
  both call sites (`HyperviewStaticPageHandler` and `HyperviewDynamicPageHandler`),
  including their "fold after overrides" comments. Reworded both
  `options.pageTemplate` JSDoc entries to say "HyperviewService resolves the ID
  case-insensitively" instead of implying the handler folds it.
- Current state: Complete. `route-params.js` was not touched (confirmed via
  `git diff --stat` — its only diff is the pre-existing baseline this plan's
  intro describes, not something from this session).
- Remaining: Nothing for this task.
- Decisions and discoveries: **Worth flagging for review** — T1's cross-cutting
  note says "`TemplateFileRef.filepath` returned by the store is already
  derived from the folded id, so write responses report the folded key,"
  but `createPutTemplateHandler` in `put-template.js` never captures
  `putTemplate()`'s return value; the JSON response's `filepath`/`id` come
  from the locally-computed, request-derived `filepath` (now never folded,
  since T3 removed the only fold this file had). So after T1–T3, a
  `PUT .../templates/pages/Blog/Hello/page.html` response echoes back
  `Blog/Hello/page.html` (the client's literal case) even though the store
  now actually holds it under `blog/hello/page.html`. This pre-dates T3 in
  the sense that the response was already computed locally rather than from
  the store's returned ref; T3's literal, unambiguous instruction was
  "`getWildcardFilepath()` ... returns the validated filepath unchanged," so
  I followed that rather than expanding scope to rewire the response around
  the transaction script's return value. Functionally this does not break
  anything the plan's acceptance criteria or manual validation check (reads
  still resolve regardless of case — that's what T3's manual validation
  actually tests), but the publishing API response body no longer reflects
  the canonical (stored) key case for any kind. Flagging so the user can
  decide whether this is acceptable or whether the response construction
  should be revisited outside this plan.
  Also: only the `options.pageTemplate` JSDoc was updated in the two handler
  factories, per T3's explicit scope — `options.baseTemplate` JSDoc still says
  nothing about case (it never did, even before this plan), which is now an
  inconsistency between the two but is outside T3's stated scope to fix.
- Actual files changed: `src/app/presentation/request-handlers/publishing-api/put-template.js`,
  `src/kixx/hyperview/hyperview-request-handlers.js`.
- Validation run:
  - `node run-linter.js src/kixx/hyperview/hyperview-request-handlers.js src/app/presentation/request-handlers/publishing-api/`
    — passes clean (no output, exit 0).
  - `grep -n "toLowerCase" src/kixx/hyperview/hyperview-request-handlers.js` —
    only match is `normalizePagePathname` (line 343), as required.
  - `grep -rn "normalizePageTemplateId\|CASE_FOLDED_TEMPLATE_KINDS" src/` — no
    matches, confirms full removal.
  - `grep -n "isNonEmptyString" .../put-template.js` — still imported and used
    by the empty-segment guard, confirming it was correctly kept.
  - Per `AGENTS.md`'s Work Verification section, the dev server was not
    started and the two manual end-to-end checks were not run. Whoever
    reviews this task should run them:
    1. `PUT /publishing-api/v1/templates/pages/Blog/Hello/page.html` then
       `PUT /publishing-api/v1/pages/Blog/Hello`; after promoting the build,
       `GET /Blog/Hello` and `GET /blog/hello` should both render **with**
       body content.
    2. `PUT /publishing-api/v1/templates/base/site.html/` (trailing slash)
       should still return 400 `EmptyPathSegment`.
- Blockers: None.

---

### Task T4: Document case-insensitive template naming for authors

**Status:** Complete
**Depends on:** T1, T2, T3
**Documentation:** `src/templates/README.md`; `src/app/presentation/README.md`

**Objective**

A template author reading the guides learns that template ids and partial names resolve
case-insensitively, and the existing advisory warning about unreachable uppercase
directories is replaced by a statement of how resolution actually works.

**Scope**

- In: the partial-resolution and "Additional partial rules" sections of the templating
  guide; the lower-case naming paragraph in the presentation layer guide.
- Out: JSDoc, which each of T1–T3 updates in its own files.

**Design and invariants**

- `src/app/presentation/README.md:51` currently says **"Name every directory and file
  under `pages/` and `templates/pages/` in lower case"** and warns that an uppercase
  directory becomes unreachable. After T1–T3 the unreachability is gone. Rewrite it as a
  resolution rule that also covers `templates/base/` and `templates/partials/`, and keep
  the cross-platform rationale — that is still why the rule exists.
- Keep lower-case naming as the **recommended** convention even though it is no longer
  load-bearing; folded storage keys mean a store listing shows lower-case names, and
  matching what you see is less confusing.
- In `src/templates/README.md`, add case-insensitivity to the "Additional partial rules"
  list (~line 1295) next to the existing "Missing partials render as an empty string" and
  "Partial names are literal" entries, and to the partial resolution example (~line 1204).
- Do not describe the previous behavior or frame this as a change. Both guides should
  read as though templates were always resolved this way.
- Note for the engine's own README section (~line 1449): `createRenderFunction` still
  accepts any `Map`; case-insensitivity is a property of the map Hyperview supplies, not
  of the engine. Do not claim the engine is case-insensitive.

**Expected touch points**

- `src/app/presentation/README.md` — rewrite the naming paragraph at line 51.
- `src/templates/README.md` — partial resolution section and "Additional partial rules".

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The presentation guide states the rule for `pages/`, `templates/pages/`,
      `templates/base/`, and `templates/partials/`, without the unreachability warning.
- [ ] The templating guide lists case-insensitive resolution among the partial rules.
- [ ] Neither guide describes the previous per-kind behavior or frames this as a change.
- [ ] The engine API section does not claim the engine itself folds case.
- [ ] A search for other guides mentioning template naming or case has been run and any
      hits reconciled.

**Validation**

- `grep -rn "lower case\|lowercase\|case-insensitive\|case-sensitive" src/templates/README.md src/app/presentation/README.md`
  — every hit reads correctly against the implemented behavior.
- Manual: read both changed sections end to end; an author who has never seen this plan
  should be able to name a partial and reference it without guessing.

**Progress and handoff**

- Completed: Rewrote the naming paragraph at `src/app/presentation/README.md:51`.
  It now states that Hyperview lower-cases every base, page, and partial
  template id (not just page pathnames), covers all four directories
  (`pages/`, `templates/pages/`, `templates/base/`, `templates/partials/`),
  drops the "an uppercase directory becomes unreachable" warning, keeps the
  cross-platform rationale (case-sensitive filesystem/KV vs. case-insensitive),
  and keeps lower-case naming as a recommendation (store listings show the
  folded name) rather than a hard requirement.
  In `src/templates/README.md`: added a one-line case-insensitivity note
  directly under the partial resolution example (~line 1210, right after the
  `application/templates/partials/website/styles.css` code block), and added
  "Partial name resolution is case-insensitive." to the "Additional partial
  rules" list (~line 1301), next to the existing "Missing partials render as
  an empty string" and "Partial names are literal" entries.
- Current state: Complete.
- Remaining: Nothing for this task. This was the last task in the plan — all
  of T1–T4 are now Complete.
- Decisions and discoveries: Confirmed the engine API notes section
  (~line 1449, `createRenderFunction` bullet) makes no case-folding claim
  already, so no edit was needed there — satisfies "the engine API section
  does not claim the engine itself folds case" without any change.
  Searched `grep -rln "template" --include="*.md" src/ | xargs grep -ln
  "lower case\|lowercase\|case-insensitive\|case-sensitive"` and found only
  the two files this task already edits; no other guide (including
  `src/kixx/static-file-server/README.md`, which has no hyperview README
  counterpart) mentions template naming or case, so nothing else needed
  reconciling. The two other case/lowercase hits in
  `src/app/presentation/README.md` (lines 534, 569) are about `Record`
  attribute normalization (e.g. `normalizeLowerCaseStringAttribute` for
  emails) and are unrelated to template naming — left untouched.
- Actual files changed: `src/app/presentation/README.md`,
  `src/templates/README.md`.
- Validation run:
  `grep -n "lower case\|lowercase\|case-insensitive\|case-sensitive"
  src/templates/README.md src/app/presentation/README.md` — every hit reads
  correctly against the implemented behavior (checked above). Read both
  changed sections end-to-end; both read as though templates were always
  resolved this way, with no framing as a change.
- Blockers: None.
