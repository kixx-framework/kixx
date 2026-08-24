# Implementation Plan: Structured `ContentTree` input for `commitChanges()`

## Implementation Approach

`ContentAddressableStore#commitChanges(context, buildId, files)` currently
takes a flat `IndexSourceFile[]` manifest — every entry already carrying its
final storage pathname, hash, size, and optional metadata — and does nothing
but build and publish the tree index from it.

The publishing API's `commitChanges` request handler
(`src/app/presentation/request-handlers/publishing-api/mod.js`) now assembles
a structured `ContentTree` object instead: `{ staticAssets,
globalTemplatePartials, baseTemplates, pages, emails }`, grouped by content
kind and keyed by *logical* pathname, where each leaf is the `{hash, size,
metadata}` triple the publishing API's own `stat*` resources already expose
to a client (never a storage pathname — the one exception is a page's
`template` facet, which must carry its own full filepath because a page's
template filename cannot be derived from the page's logical pathname alone).

This plan:

1. Adds a new pure function, `flattenContentTree(contentTree)`, to
   `content-addressable-index.js`, which validates every pathname/key in the
   tree (collecting failures into one `ValidationError`), derives each
   entry's storage pathname via the existing `content-layout.js` builders,
   and returns a flat `IndexSourceFile[]` — the exact input `buildIndex()`
   already accepts today. `flattenContentTree()` does **not** re-validate
   `hash`/`size`/`metadata` shape; `buildIndex()` → `validateIndexSourceFiles()`
   already does that and continues to be the single source of truth for it.
2. Changes `ContentAddressableStore#commitChanges()`'s third parameter from
   `files` (`IndexSourceFile[]`) to `contentTree` (`ContentTree`), flattening
   it internally before calling `ContentAddressableIndex.buildIndex()`. Its
   return value's `rootHash` field is renamed to `hash`, fixing an existing
   mismatch where the request handler already destructures `{ hash,
   nodeCount }` from a method that returns `{ rootHash, nodeCount }`.
3. Updates the existing unit test suites for both modules, which currently
   exercise the old flat-array contract directly, to the new contract.

No changes are needed to
`src/app/presentation/request-handlers/publishing-api/mod.js` — its
`commitChanges` handler already extracts and forwards exactly
`{ staticAssets, globalTemplatePartials, baseTemplates, pages, emails }` from
the parsed JSON:API resource, which is the new `ContentTree` shape.

Every task follows red/green: write the failing test(s) first, confirm they
fail for the expected reason, then implement until they pass, then run the
full suite and linter.

Cross-cutting invariants to preserve throughout:

- `commitChanges()` remains the only place a closure is published; it must
  still call `saveIndex()` before `assignBuild()` (order matters, per the
  existing docstring and CAS's ordering test).
- `flattenContentTree()` must never call an `assert*` helper against a value
  that originated in the HTTP request body (dictionary keys, the template
  facet's pathname) — those are expected operational errors and must surface
  as `ValidationError`, per `src/docs/server-error-handling.md`. Only
  `content-layout.js`'s own builders may assert, and only after
  `flattenContentTree()` has already confirmed the pathname is valid.
- Absent optional keys (a page with no `partials`, a commit with no
  `emails`, etc.) are not errors; they simply produce no manifest entry for
  that facet, exactly like `ContentSnapshot#statPagePartials()` returning
  `null` today.

---

### Task 1: Add `ContentTree` typedef and `flattenContentTree()` to `content-addressable-index.js`

**Status:** Complete
**Depends on:** None
**Documentation:** src/docs/code-style-guide.md, src/docs/code-documentation-guide.md, src/docs/server-error-handling.md, test/unit-tests/README.md

**Objective**

Introduce a standalone, fully-tested function that converts the structured
`ContentTree` shape into the flat `IndexSourceFile[]` manifest
`ContentAddressableIndex.buildIndex()` already consumes. This task owns the
whole transformation and its validation behavior in isolation, independent of
`ContentAddressableStore`.

**Scope**

- In: the `ContentTree` (and per-facet) JSDoc typedefs; the
  `flattenContentTree(contentTree)` function; pathname/key validation and
  `ValidationError` collection; deriving storage pathnames via
  `content-layout.js` builders; the new function's unit tests.
- Out: wiring this into `ContentAddressableStore#commitChanges()` (Task 2);
  any change to `buildIndex()`, `validateIndexSourceFiles()`, or
  `content-layout.js` itself.

**Design and invariants**

- Export `flattenContentTree` from `content-addressable-index.js` alongside
  the existing `getRootHash` and `validateIndexSourceFiles` exports.
- Input shape (document as JSDoc `@typedef {Object} ContentTree` and nested
  typedefs):
  ```
  ContentTree
    staticAssets?:            { [logicalPathname: string]: ContentTreeReference }
    globalTemplatePartials?:  ContentTreeReference
    baseTemplates?:           ContentTreeReference
    pages?:                   { [logicalPathname: string]: ContentTreePageEntry }
    emails?:                  { [logicalPathname: string]: ContentTreeReference }

  ContentTreeReference
    hash:     string
    size:     number
    metadata?: Object|null

  ContentTreePageEntry
    metadata?: ContentTreeReference
    partials?: ContentTreeReference
    includes?: ContentTreeReference
    template?: ContentTreeReference & { pathname: string }  // full filepath incl. filename
  ```
  All five top-level keys are optional; all four page-entry facets are
  optional. Absence means "not part of this commit" — do not require an
  explicit `null`.
- Validation pass (first, before deriving any storage pathname):
  - Every `staticAssets` / `emails` key, every `pages` key, and every page
    entry's `template.pathname` must satisfy `isValidPathname()` from
    `content-layout.js`. Collect every violation into one `ValidationError`
    (mirror `validateIndexSourceFiles()`'s `error.push(message, source)`
    pattern), then throw once if the error has any entries.
  - Do not validate `hash`/`size`/`metadata` here — leave that entirely to
    `buildIndex()`.
  - `contentTree` itself and its `pages`/`staticAssets`/`emails` values (when
    present) are internal-contract shapes coming from
    `parseJsonApiResource()`'s already-validated JSON:API attributes object,
    not raw unchecked user input at this layer — assert their basic shape
    (`isPlainObject`) rather than collecting them as `ValidationError`
    sources. Only *pathname-shaped* values are treated as operational input,
    per server-error-handling.md's distinction between argument-shape
    assertions and user-input validation.
- Storage pathname derivation (second pass, only after validation passes):
  - `staticAssets[key]` → `getStaticAssetPath(key)`
  - `globalTemplatePartials` → `getGlobalTemplatePartialsPath()`
  - `baseTemplates` → `getBaseTemplatesPath()`
  - `pages[key].metadata` → `getPageMetadataPath(key)`
  - `pages[key].partials` → `getPagePartialsPath(key)`
  - `pages[key].includes` → `getPageIncludesPath(key)`
  - `pages[key].template` → `getPageTemplatePath(template.pathname)` (uses
    the facet's own pathname, not the page key)
  - `emails[key]` → `getEmailBundlePath(key)`
- Output: `IndexSourceFile[]`, each entry `{ pathname, hash, size, metadata }`
  (`metadata` passed through as given, including `undefined`/`null`/omitted
  — `buildIndex()` already tolerates all three).
- An empty/all-absent `ContentTree` (`{}`) is valid and produces an empty
  array — `buildIndex()` already handles zero files (root-only tree).

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-index.js` — add
  the typedefs and `flattenContentTree()` export.
- `test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js`
  — add a new `describe('flattenContentTree()', ...)` block.

**Acceptance criteria**

- [ ] `flattenContentTree({})` returns `[]`.
- [ ] Each of the five top-level kinds, when present, produces the correctly
      derived storage pathname (one test per kind, plus the four page
      facets individually).
- [ ] A page entry with only some facets present produces entries only for
      those facets.
- [ ] An invalid key in `staticAssets`, `pages`, or `emails`, and an invalid
      `template.pathname`, each throw `ValidationError` (not
      `AssertionError`).
- [ ] Multiple simultaneous invalid keys across different kinds are all
      reported in a single thrown `ValidationError` (test its `length` or
      collected messages, matching the existing `validateIndexSourceFiles`
      test style).
- [ ] `hash`/`size`/`metadata` are passed through unvalidated by this
      function — a test asserts `flattenContentTree()` does not throw for a
      structurally-odd `hash`/`size` (that failure is deferred to
      `buildIndex()`, exercised in Task 2's integration tests instead).
- [ ] `metadata` omission/`null`/an object are all passed through unchanged.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js` — all new and existing tests pass.
- `node run-linter.js src/kixx/content-addressable-store/content-addressable-index.js test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js` — clean.
- Confirm red-then-green: run the new test block against a stub/missing
  `flattenContentTree` first (or before implementing it) and capture that it
  fails for the expected reason (`undefined is not a function` /
  import error), then implement until green.

**Progress and handoff**

- Completed: `ContentTree`/`ContentTreeReference`/`ContentTreePageEntry` JSDoc
  typedefs and `flattenContentTree()` added and exported from
  `content-addressable-index.js`. Full unit test block added (18 new tests)
  covering the empty tree, each of the five kinds and four page facets,
  partial page facets, per-kind and combined `ValidationError` collection,
  pass-through of unvalidated `hash`/`size`, and metadata pass-through.
  Confirmed red (import error for missing export) before implementing, then
  green after.
- Current state: Done. All acceptance criteria met.
- Remaining: Nothing for this task.
- Decisions and discoveries: `pages[key]` and `pages[key].template` values are
  asserted with `isPlainObject` (internal-contract shapes), not collected as
  `ValidationError` sources, per the plan's invariant — only pathname-shaped
  values (dictionary keys, `template.pathname`) are treated as operational
  input. The three non-template page facets (`metadata`, `partials`,
  `includes`) need no pathname validation of their own since they derive
  their storage pathname from the already-validated page key.
- Actual files changed:
  - `src/kixx/content-addressable-store/content-addressable-index.js`
  - `test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js`
- Validation run:
  - `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js` — 72 tests, all passing.
  - `node run-linter.js src/kixx/content-addressable-store/content-addressable-index.js test/unit-tests/kixx/content-addressable-store/content-addressable-index.test.js` — clean.
- Blockers: None.

---

### Task 2: Change `ContentAddressableStore#commitChanges()` to accept `ContentTree`

**Status:** Complete
**Depends on:** Task 1
**Documentation:** src/docs/code-style-guide.md, src/docs/code-documentation-guide.md, test/unit-tests/README.md

**Objective**

`ContentAddressableStore#commitChanges(context, buildId, contentTree)` builds
and publishes a closure from the structured `ContentTree` shape instead of a
flat `IndexSourceFile[]`, using `flattenContentTree()` from Task 1. Its
return value's root-hash field is renamed from `rootHash` to `hash`,
resolving the existing mismatch with the request handler
(`src/app/presentation/request-handlers/publishing-api/mod.js:283`), which
already destructures `{ hash, nodeCount }`.

**Scope**

- In: `commitChanges()`'s parameter and JSDoc; the `{ hash, nodeCount }`
  rename; existing `commitChanges()` unit tests, updated to the new
  contract.
- Out: `flattenContentTree()`'s own behavior (Task 1, already covered
  there); any change to the request handler (already correct once `hash` is
  returned); `openSnapshot()` and any other method.

**Design and invariants**

- New signature: `async commitChanges(context, buildId, contentTree)`.
  Internally: `const files = flattenContentTree(contentTree);` then the
  existing `ContentAddressableIndex.buildIndex(files)` /
  `getRootHash(entries)` / `saveIndex()` / `assignBuild()` sequence,
  unchanged in order.
- Return value becomes `{ hash, nodeCount }` (was `{ rootHash, nodeCount }`).
  Update the JSDoc `@returns` tag accordingly.
- Update the method's JSDoc `@param {ContentTree} contentTree` (replacing
  `@param {IndexSourceFile[]} files`), importing the typedef from
  `content-addressable-index.js` per the code-documentation-guide's
  `@typedef {import(...)}` convention used elsewhere in this file (e.g. the
  existing `@see ContentStoreInterface` cross-reference style).
- No change to `openSnapshot()`, `hashString()`, `hashSet()`, or the
  pathname-helper methods.

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-store.js` —
  `commitChanges()` signature, body, JSDoc, return value.
- `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
  — rewrite every `commitChanges()` test to pass a `ContentTree` object
  instead of a flat array, and to assert `result.hash` instead of
  `result.rootHash`.

**Acceptance criteria**

- [ ] `commitChanges()` accepts a `ContentTree` object and calls
      `saveIndex()` before `assignBuild()`, as today.
- [ ] The returned object has a `hash` property equal to the published root
      hash, and `nodeCount` as today.
- [ ] Passing an equivalent `ContentTree` twice (different `buildId`)
      derives an identical `hash`.
- [ ] Changing a referenced `hash` inside the `ContentTree` changes the
      resulting `hash`.
- [ ] A malformed `ContentTree` (e.g. an invalid pathname key, or a
      malformed `hash`/`size` on an entry) still throws `ValidationError`,
      exercised via `commitChanges()` end-to-end (not just via
      `flattenContentTree()` directly).
- [ ] `openSnapshot()` can still read back content committed through the new
      `commitChanges()` (rewrite the existing round-trip test using the new
      input shape, e.g. via `globalTemplatePartials`).

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — all tests pass.
- `node run-tests.js` (full suite) — confirms nothing else in the codebase
  depended on the old `commitChanges()` signature or `rootHash` field.
- `node run-linter.js src/kixx/content-addressable-store/content-addressable-store.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — clean.
- Confirm red-then-green: update the tests to the new contract first (they
  will fail against the still-unchanged implementation — either a thrown
  error from the old `buildIndex()` receiving a non-array, or an assertion
  mismatch on `result.hash` being `undefined`), then implement
  `commitChanges()`'s change until green.

**Progress and handoff**

- Completed: `commitChanges()` now takes `(context, buildId, contentTree)`,
  calls `flattenContentTree()` before `ContentAddressableIndex.buildIndex()`,
  and returns `{ hash, nodeCount }` (renamed from `{ rootHash, nodeCount }`).
  JSDoc updated, including a `@typedef {import('./content-addressable-index.js').ContentTree} ContentTree`
  re-export for the parameter type. Every `commitChanges()` test rewritten to
  pass a `ContentTree` object and assert `result.hash`. Confirmed red first
  (assertArray/AssertionError failures against the old array-only
  implementation), then green after the change.
- Current state: Done. All acceptance criteria met.
- Remaining: Nothing for this task.
- Decisions and discoveries: The publishing API handler
  (`src/app/presentation/request-handlers/publishing-api/mod.js:283`) already
  destructures `{ hash, nodeCount }`, confirmed by inspection — no edit
  needed there, matching the plan's prediction.
- Actual files changed:
  - `src/kixx/content-addressable-store/content-addressable-store.js`
  - `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`
- Validation run:
  - `node run-tests.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — 11 tests, all passing.
  - `node run-tests.js` (full suite) — 911 tests, all passing.
  - `node run-linter.js src/kixx/content-addressable-store/content-addressable-store.js test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js` — clean.
- Blockers: None.

---

### Task 3: Full-suite verification and cleanup pass

**Status:** Complete
**Depends on:** Task 1, Task 2
**Documentation:** README.md (Linting, Testing)

**Objective**

Confirm the change is coherent across the codebase: no other caller of
`commitChanges()` or of the old `rootHash` field remains, the publishing API
handler needs no changes (verify this rather than assume it), and the full
test suite and linter are clean.

**Scope**

- In: a repo-wide search for other `commitChanges(` call sites and
  `.rootHash` usages; confirming
  `src/app/presentation/request-handlers/publishing-api/mod.js` needs no
  edits; final full-suite test and lint run.
- Out: any new feature work; touching `content-layout.js`,
  `content-snapshot.js`, or the publishing API's `stat*`/`put*` handlers.

**Design and invariants**

- This task should find zero required source changes outside Tasks 1 and 2
  if the plan's assumptions hold; if it finds another caller of the old
  contract, that caller must be updated to match, and this plan's Task 2
  scope note should be treated as incomplete rather than silently patched
  around.

**Expected touch points**

- None expected, beyond what Tasks 1–2 already changed. Record anything
  found here.

**Acceptance criteria**

- [ ] `grep -rn "commitChanges(" src/ test/` shows every call site using the
      new `ContentTree` argument shape.
- [ ] `grep -rn "rootHash" src/ test/` shows no remaining reference to the
      old return-value field name.
- [ ] `node run-tests.js` passes in full.
- [ ] `node run-linter.js` passes in full (clean or warnings-only).

**Validation**

- `node run-tests.js` — full unit suite.
- `node run-linter.js` — full lint pass.

**Progress and handoff**

- Completed: Grepped for `commitChanges(` and `rootHash` across `src/` and
  `test/`. Every `commitChanges(` call site uses the new `ContentTree`
  argument shape (the publishing API handler and the rewritten unit tests).
  Remaining `rootHash` hits are all a different, pre-existing concept — the
  `ContentAddressableIndex#rootHash` getter, and the `rootHash` parameter
  name used internally by the Cloudflare content-store plugin and its tests
  — not the `commitChanges()` return-value field this plan renamed to
  `hash`; none of them needed changes. Confirmed
  `src/app/presentation/request-handlers/publishing-api/mod.js` needed no
  edit (already destructures `{ hash, nodeCount }`). Ran the full test suite
  and full linter.
- Current state: Done. All acceptance criteria met. No source changes were
  needed beyond Tasks 1 and 2, confirming the plan's assumptions held.
- Remaining: Nothing.
- Decisions and discoveries: None beyond what Tasks 1–2 already recorded.
- Actual files changed: None (verification only).
- Validation run:
  - `node run-tests.js` — 911 tests, all passing.
  - `node run-linter.js` — warnings-only (5 pre-existing `no-warning-comments`
    TODOs in `publishing-api/mod.js`, unrelated to this change), exit 0.
- Blockers: None.
