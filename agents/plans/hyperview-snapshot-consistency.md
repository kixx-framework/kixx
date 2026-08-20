# Hyperview Snapshot Consistency

Date: 2026-08-19
Source report: `TODO.md`, "Issue 2: Rendering Can Combine Different Build Versions"

## Implementation Approach

A single Hyperview response is currently assembled from six to ten independently
timed storage calls, each of which re-resolves `context.runtime.build.id` to
whatever index version is cached at that instant. Publishing repoints the live
build ID — `commitChanges()` defaults `buildId` to `context.runtime.build.id`
(`src/app/transaction-scripts/publishing/mod.js:77`), and `BUILD_ID` comes from
the deploy environment (`src/cloudflare-server.js:22`) — so every content publish
can split an in-flight render across two closures. This is the normal publishing
path, not an exotic one.

Hyperview then extends the window past the storage layer: compiled templates hold
live references to shared mutable `Map` instances, so a template selected for one
request can be invoked after another request has cleared and repopulated the
partials it resolves through.

The work has two halves, and both are required. Pinning storage alone still
leaves the mutable-map race; fixing the maps alone still lets `getPage()` read
across two closures.

**Half one — pin one immutable index per render.** `getIndex()` already returns an
immutable, validated `ContentAddressableIndex`. Nothing needs a new snapshot
format; the defect is only that each read resolves the build pointer again. A
`ContentSnapshot` facade resolves the index once and exposes the same read API
bound to it. Existing context-taking read methods stay, delegating to a
short-lived snapshot, so the publishing API is untouched.

**Half two — stop mutating compiled partial sets.** Rather than giving up the
"update partials without recompiling every template" property, the partials lookup
moves from compile time to render time. Compiled templates then depend on nothing
but their own source, immutable per-etag cache entries replace the in-place
`clear()` discipline, and each render passes the exact partial set belonging to
its own pinned snapshot.

### Prerequisite: kixx-templating render-time partial binding

Tasks HV-3 and HV-4 assume an updated vendored `src/kixx/templating/` in which a
compiled render function accepts an optional partials lookup at invocation time.
The full specification is in `tmp/kixx-templating-render-time-partials.md`.

This landed in commit `734b2964` (2026-08-20). Confirmed provided:

- `createRenderFunction(options, helpers, tree)` — the compile-time `partials`
  parameter is removed entirely, not merely made optional. Compiled functions
  depend on their own source and helpers only, matching HV-3's design.
- The returned function accepts `(data, partials)`, and `renderWithFrame(frame, partials)`
  / `renderWithFrameAndIndent(frame, partials, indent)` accept and forward the same
  lookup — note the argument order is `(frame, partials, indent)`.
- The `partials` argument is **required on every render call, including every
  nested and recursive partial invocation** — it is validated with `assertPartialsLookup()`
  and rejected with a `TypeError` if it is missing or does not provide callable
  `has()`/`get()`. There is no "omit it to preserve current behavior" fallback:
  every call site, with no exceptions, must pass an explicit lookup (an empty
  `Map()` is fine when a render has no partials).
- A registered partial name that resolves to a non-function value now throws a
  `TypeError` at that tag, and a bare partial function (no `renderWithFrame`)
  receives only `frame.value`.
- An invocation-time lookup is used throughout the complete nested render tree,
  including nested and recursive partials, so a compiled template can render
  against different partial sets on successive calls.

HV-1 and HV-2 do not depend on this change and can proceed regardless.

### Cross-cutting decisions

- **Page-cache identity keeps its composite-etag form.** The report suggested
  binding cache identity to the immutable root hash. That is rejected: the root
  hash changes on every publish, so it would cold-cache the entire site each
  time. The existing identity (`page.etag` + global-partials etag +
  base-templates etag + `baseTemplateId`, optionally + props hash) is already
  complete, because `page.etag` covers the ancestor `page.json` cascade and every
  blob in the leaf page directory, including the page template and page-partials
  bundle (`content-addressable-store.js:760`). Its only defect is that the
  component etags are gathered from separately-resolved index versions. Pinning
  makes the same composite describe one real committed closure, and preserves
  reuse across publishes that did not touch a given page.
- **Pure helpers stay on the store.** `hashValue()`, `isValidPathname()`, and
  `normalizePathname()` have no index dependency and are not duplicated onto the
  snapshot.
- **The snapshot is request-scoped, not process-scoped.** It closes over the
  `RequestContext` because blob reads still need the KV binding. It must not be
  cached across requests.
- **Scope boundary.** No content-store port contract
  (`kixx/**/*-store-interface.js`) is written in this plan; that is deferred
  until this change is reviewed.

### Task order

HV-1 → HV-2 → HV-3 → HV-4. Each is independently reviewable, and HV-1 and HV-2
together are a coherent shippable increment even if HV-3 is delayed on the
vendored engine.

---

### Task HV-1: Content reads resolve one immutable index per snapshot

**Status:** Complete
**Depends on:** None
**Documentation:** `TODO.md` Issue 2 "Recommended fix" §1; `src/plugins/README.md`

**Objective**

A caller can open one `ContentSnapshot` and perform every content read through it
with the guarantee that all reads resolve against a single immutable
`ContentAddressableIndex`, so a build reassignment during the snapshot's lifetime
cannot change what it returns. Existing context-taking read methods keep their
current signatures and behavior.

**Scope**

- In: `CloudflareContentStore` snapshot-scoped reads; a new `ContentSnapshot`
  owning the logical-pathname read API; delegation of the existing
  context-taking read methods on `ContentAddressableStore`.
- Out: any Hyperview change (HV-2); publishing/write paths, which continue to use
  the context-taking methods unchanged; the port contract.

**Design and invariants**

- `CloudflareContentStore#openSnapshot(context)` resolves `getIndex(context)`
  exactly once and returns an object closing over that index and the context,
  exposing `statPath(pathname)`, `listStats(prefix, options)`, `getBlob(hash)`,
  `getBlobs(hashes)`, and a `rootHash` accessor (`index['/'][1]`). These methods
  take no `context` argument.
- `computeHashFromStats(stats)` is pure and stays on `CloudflareContentStore`.
- New module `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js`
  exports `ContentSnapshot` and becomes the single owner of the logical pathname
  layout: the four bundle-name constants (`BASE_TEMPLATES_BUNDLE`,
  `TEMPLATE_PARTIALS_BUNDLE`, `PAGE_PARTIALS_BUNDLE`, `PAGE_INCLUDES_BUNDLE`) and
  the `normalizeTemplatePath()` / `normalizePagePath()` helpers move there as
  module-level exports. `content-addressable-store.js` imports them for its
  upload and manifest paths.
- `ContentSnapshot` exposes, with no `context` parameter: `getPage(pathname)`,
  `statTemplatePartials()`, `getTemplatePartials()`, `statBaseTemplates()`,
  `getBaseTemplates()`, `statPageMetadata(pagePath)`, `statPagePartials(pagePath)`,
  `statPageIncludes(pagePath)`, `statPageTemplate(filepath)`,
  `getPageTemplate(filepath)`, and `rootHash`.
- The `#getPath()` logic moves onto `ContentSnapshot` **unchanged in behavior**.
  The Issue 1 fix must be preserved exactly: absent index entry returns `null`; a
  `'tree'` entry throws `AssertionError`; an index entry whose blob is unreadable
  throws `AssertionError` naming both the pathname and the hash. Existing
  assertion messages are preserved verbatim so current tests keep passing.
- `getPage()` moves onto `ContentSnapshot` and performs all of its `statPath()`
  calls, its `listStats()` call, and its blob reads through the one pinned index.
- `ContentAddressableStore#openSnapshot(context)` returns a `ContentSnapshot`.
  Every existing context-taking read method becomes a thin delegate — e.g.
  `async getPage(context, pathname) { return (await this.openSnapshot(context)).getPage(pathname); }`
  — so read logic exists in exactly one place and publishing behavior is
  unchanged.
- Pathname validity assertions stay where they are today, at the public entry of
  each read, and keep their current message text.

**Expected touch points**

- `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js` — new; `ContentSnapshot`, bundle constants, path helpers
- `src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js` — add `openSnapshot()`
- `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js` — add `openSnapshot()`; read methods become delegates; import moved constants
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.test.js` — existing coverage must keep passing
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js` — new

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `openSnapshot()` on both stores resolves the index exactly once per call.
- [x] Every `ContentSnapshot` read method resolves against that one index; no
      snapshot method calls `getIndex()`.
- [x] A build reassignment performed between two reads on the same snapshot does
      not change the second read's result.
- [x] `getPage()` performs all of its stats, its directory listing, and its blob
      reads against one index.
- [x] All existing context-taking read methods keep their signatures, return
      values, and error behavior, including the Issue 1 assertions.
- [x] Publishing transaction scripts and the publishing API require no changes.
- [x] JSDoc on `openSnapshot()` and every `ContentSnapshot` method states the
      pinning guarantee and the request-scoped lifetime.

**Validation**

- `node run-linter.js src/plugins/cloudflare-content-addressable-store test/unit-tests/plugins/cloudflare-content-addressable-store` — style and lint clean
- `node run-tests.js test/unit-tests/plugins/cloudflare-content-addressable-store` — existing store and index suites pass unchanged
- New unit tests: index resolved once per snapshot; reads after a mid-snapshot
  reassignment still return V1; `getPage()` internal consistency under
  reassignment; the three `#getPath()` outcomes (absent entry → `null`, tree entry
  → `AssertionError`, unreadable blob → `AssertionError` naming pathname and hash).

**Progress and handoff**

- Completed: Added request-scoped `ContentSnapshot`; moved all logical read ownership, path helpers, and bundle constants into it; added store facades; preserved publishing paths; and added focused snapshot coverage.
- Current state: Complete.
- Remaining: HV-2.
- Decisions and discoveries: `ContentAddressableIndex` encapsulates its persisted table, so it now exposes a read-only `rootHash` accessor rather than leaking its encoded entries. Existing context-taking read methods validate at their original public boundary, then delegate through a newly opened snapshot.
- Actual files changed: `agents/plans/hyperview-snapshot-consistency.md`; `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js`; `src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js`; `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js`; `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js`; `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.test.js`; `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js`.
- Validation run: `node run-linter.js src/plugins/cloudflare-content-addressable-store test/unit-tests/plugins/cloudflare-content-addressable-store` (pass); `node run-tests.js test/unit-tests/plugins/cloudflare-content-addressable-store` (pass: 160 tests); `git diff --check` (pass).
- Blockers: None.

---

### Task HV-2: One Hyperview render reads from one pinned snapshot

**Status:** Complete
**Depends on:** HV-1
**Documentation:** `TODO.md` Issue 2 "Recommended fix" §1 and §3; `src/app/presentation/README.md`

**Objective**

A single `respondWithHypertext()` call opens exactly one content snapshot and
serves every page, stat, template, and partial read for that response from it,
including the reads that form the rendered-page cache identity. A build
reassignment during the render cannot cause the response to mix closures at the
storage layer.

**Scope**

- In: threading a snapshot through `HyperviewService`'s render workflow;
  page-cache identity computed from the snapshot; keying the global-partials
  single-flight.
- Out: the mutable compiled-template and partial caches, which still mutate
  in place after this task (HV-3); templating engine changes.

**Design and invariants**

- `respondWithHypertext()` opens the snapshot once, after pathname and identifier
  validation and before `getPage()`, so the JSON representation path is served
  from it too.
- The workflow methods take the snapshot in place of the context:
  `getPage(content, url, pathname, responseProps)`,
  `getPageTemplate(content, page)`, `getBaseTemplate(content, templateId)`,
  `loadGlobalPartials(content)`, `getPagePartials(content, page, globalPartials)`.
  These remain public-but-internal so their cache behavior stays directly
  testable, per the existing note at the top of `hyperview-service.js`.
- `#store` is retained solely for the pure helpers `hashValue()`,
  `normalizePathname()`, and `isValidPathname()`, plus `openSnapshot()`.
- Page-cache identity is built from the pinned snapshot: `page.etag` from
  `content.getPage()`, plus `content.statTemplatePartials()`, plus
  `content.statBaseTemplates()` on the full-page path. The composite form and the
  hashing sequence are unchanged; only the source of the etags changes. The root
  hash is deliberately **not** included — see "Cross-cutting decisions".
- The `if (this.#useTemplateCache)` guards whose stated purpose is to "skip the
  stat() round-trip" are removed where the value is now needed unconditionally.
  Against a pinned snapshot a `stat*()` call is a pure in-memory index lookup
  with no I/O, so the guard optimizes nothing and costs correctness. Cache-hit
  checks that genuinely depend on `#useTemplateCache` stay.
- `#globalPartialsLoadPromise` is keyed by the global-partials etag resolved from
  the pinned snapshot, replacing the current unkeyed single-flight
  (`hyperview-service.js:180`). Two concurrent requests on different index
  versions must not share one load. Keep the `finally` cleanup that clears the
  entry only when it is still the one this call installed.
- No behavior change to `NotFoundError` on a missing page, to the JSON response
  path, or to the non-empty-hypertext assertions.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — snapshot threading, cache identity, single-flight keying
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — mocked store gains `openSnapshot()`; direct calls to workflow methods pass a snapshot

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `respondWithHypertext()` calls `openSnapshot()` exactly once per invocation,
      on every path including the JSON representation and the page-cache hit path.
- [ ] No `HyperviewService` method calls a context-taking store read method.
- [ ] A build reassignment between page loading and template loading leaves the
      response and the computed cache key wholly on the original closure.
- [ ] The page-cache key is unchanged in form and in value for a given set of
      etags, so existing cache entries are not invalidated by this task.
- [ ] Concurrent renders resolving different global-partials etags do not share a
      single-flight load promise.
- [ ] Existing Hyperview unit tests pass after mechanical updates for the new
      signatures; no test's asserted behavior is weakened to accommodate the
      change.
- [ ] JSDoc for each changed method documents the snapshot parameter and the
      one-snapshot-per-render invariant.

**Validation**

- `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview` — style and lint clean
- `node run-tests.js test/unit-tests/kixx` — Hyperview suite passes
- New unit tests: `openSnapshot()` called once per render; reassignment between
  page and template loading yields a V1-only response and V1-only cache key;
  single-flight is not shared across differing partials etags.
- Deferred-promise sequencing (as in the existing `makeDeferred()` helper), not
  timing, controls every ordering assertion.

**Progress and handoff**

- Completed: Verified HV-1's working-tree changes and its recorded passing validation; opened one snapshot after request validation; threaded it through page loading, template and partial reads, and rendered-page cache etag collection; replaced the global-partials single-flight with an etag-keyed promise map; and adapted render sites to pass render-time partial lookups. Converted every Hyperview test fixture to snapshot-shaped reads and updated affected expectations now that snapshot stats run independently of the rendered-page cache. Added deterministic V1→V2 publication coverage proving the response body and cache-key inputs stay on V1.
- Current state: Complete. `HyperviewService` no longer calls context-taking content reads. The Hyperview unit suite covers one snapshot per JSON/cache-hit response, V1-only rendering/cache identity after a mid-render publication, and separation of global-partials loads by pinned etag. The mutable-cache portion remains HV-3 work.
- Remaining: HV-3.
- Decisions and discoveries: The vendored templating API in commit `734b2964` is already present, but HyperviewService had not adopted it. A minimal compatibility bridge was required while threading snapshots: compilation now uses the new three-argument API, mini templates explicitly supply an empty map, and renderer paths pass layered partials. Cache ownership/immutability is intentionally not yet changed. Stats now run even when template caching is disabled because snapshot stats are pure in-memory index reads and establish the pinned cache identity. Test helper `makeContentStore()` exposes live test doubles through `openSnapshot()`, while `makeSnapshot()` drops the legacy context argument so direct workflow tests exercise the production API shape.
- Actual files changed: `agents/plans/hyperview-snapshot-consistency.md`; `src/kixx/hyperview/hyperview-service.js`; `test/unit-tests/kixx/hyperview/hyperview-service.test.js`.
- Validation run: `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview` (pass with pre-existing `hyperview-request-handlers.js` TODO warning); `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` (pass: 51 tests); `node run-tests.js test/unit-tests/kixx` (pass: 479 tests); `git diff --check` (pass).
- Blockers: None.

---

### Task HV-3: Compiled templates stop depending on mutable partial sets

**Status:** Complete
**Depends on:** HV-2; vendored kixx-templating render-time partial binding (see Prerequisite)
**Documentation:** `TODO.md` Issue 2 "Recommended fix" §2; `tmp/kixx-templating-render-time-partials.md`; `src/templates/README.md`

**Objective**

A compiled template resolves partials from a lookup supplied at render time, so
no cache entry is ever mutated after another request can observe it, and a
template selected for one request always renders against the partial set
belonging to that request's snapshot. The property that motivated the mutable
maps — updating partials without recompiling the templates that reference them —
is preserved and extended to base templates and page partials.

**Scope**

- In: `compileTemplate()` signature; the global-partials, page-partials,
  base-templates, and page-templates caches; per-render partial layering; all
  template invocation sites.
- Out: storage-layer behavior (HV-1); snapshot threading (HV-2); the templating
  engine itself, which is vendored and changed upstream.

**Design and invariants**

- `compileTemplate(templateId, source, customHelpers)` drops its `partials`
  parameter. Compiled functions depend only on their own source and the helper
  set.
- All four caches hold **immutable** entries. No entry is ever cleared and
  repopulated in place:
  - `#globalPartials`: keyed by bundle etag → a `Map` of compiled partials,
    populated once and never mutated. Small bound (4 entries) is sufficient;
    entries beyond the current one exist only across a publish.
  - `#baseTemplates`: keyed by bundle etag → a `Map` of compiled templates. Same
    bound and rationale.
  - `#pagePartials`: keyed by **bundle etag**, not by page pathname. Compiled page
    partials no longer close over global partials, so identical bundles dedupe
    across pages and an entry stays valid across global-partial changes. Bounded
    LRU.
  - `#pageTemplates`: keyed by normalized filepath, validated by the template
    file's own etag alone. Bounded LRU.
- `template.partialsEtag` and its cross-check (`hyperview-service.js:448-457`) are
  removed. That field exists only to detect a `Map` orphaned by a concurrent
  request, a situation that can no longer arise.
- `#pageTemplateCacheEntries` and `#cachePagePathname()` are removed. Their three
  jobs — page-template LRU ordering, evicting `#pagePartials` by pathname, and
  deleting a stale filepath entry when a page changes its template filename — are
  subsumed by a plain bounded LRU on each independently keyed cache. A renamed
  page template leaves its old filepath entry to ordinary LRU eviction, which is
  acceptable for a content-addressed cache.
- `layerPartials(pagePartials, globalPartials)` is retained but becomes a value
  built fresh per render from two immutable maps, rather than a live delegate
  captured at compile time. Page partials continue to shadow global partials of
  the same id.
- Every template invocation passes the layered lookup as the second argument:
  - full page: `pageTemplate(pageContext, layered)` then `baseTemplate(pageContext, layered)`
  - `skipBaseRender`: `template(pageContext, layered)`
  - **partial-only render**: `template(pageContext, layered)`. This path currently
    relies on the compile-time layered delegate to let a page partial reference a
    global partial; without the explicit argument the vendored engine now throws
    a `TypeError` rather than silently rendering an empty string, since `partials`
    is a required render-time argument. It is still the easiest site to miss, but
    a missed call site now fails loudly instead of silently.
  - `createMiniTemplate()` renders with an explicit empty `Map()` in place of
    partials, not by omitting the argument — the vendored engine rejects a
    missing or malformed partials lookup on every call, including this one.
- When `#useTemplateCache` is false, caches are neither read nor populated, as
  today.
- Bound constants are named and commented with the reasoning above; replace
  `MAX_PAGE_TEMPLATE_CACHE_ENTRIES` with per-cache bounds.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — cache structures, `compileTemplate()`, all invocation sites
- `src/templates/README.md` — API notes: render signature and render-time partial binding
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — cache behavior tests

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] No compiled-partials or compiled-template map is mutated after it is
      published to a cache; verified by holding a reference across a version
      change and asserting its contents are unchanged.
- [x] A page template is **not** recompiled when only the global-partials or
      page-partials bundle changes; the next render uses the same compiled
      function with a new lookup.
- [x] A page template **is** recompiled when its own etag changes.
- [x] A compiled page-partials entry is reused across a global-partials change.
- [x] A partial-only render can resolve a global partial referenced from a page
      partial.
- [x] Page partials shadow global partials of the same id, unchanged from today.
- [x] A missing global-partials bundle yields an empty partial set for that render
      only and cannot clear any other render's set.
- [x] `partialsEtag`, `#pageTemplateCacheEntries`, and `#cachePagePathname()` are
      gone, with no behavior they provided left uncovered.
- [x] Each cache respects its bound under sustained distinct keys.

**Validation**

- `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview` — style and lint clean
- `node run-tests.js test/unit-tests/kixx` — Hyperview suite passes
- New unit tests for each acceptance criterion above, including a
  no-recompilation assertion (compile spy call count across a partials-only
  version change) and an entry-immutability assertion.

**Progress and handoff**

- Completed: Replaced the live-map cache design with immutable compiled bundle
  entries, keyed by content etag and bounded with LRU eviction. Page templates
  now cache by their own etag only; page and global partials are layered freshly
  at every render. Removed `partialsEtag`, `#pageTemplateCacheEntries`, and
  `#cachePagePathname()`. Updated template API documentation and focused tests.
- Current state: Complete.
- Remaining: HV-4.
- Decisions and discoveries: The prerequisite specification file named by this
  plan is no longer present in `tmp/`; its required API was verified from the
  recorded prerequisite contract and vendored implementation. The missing
  global bundle is cached as an independent empty map and therefore cannot
  clear a previously published bundle.
- Actual files changed: `agents/plans/hyperview-snapshot-consistency.md`;
  `src/kixx/hyperview/hyperview-service.js`; `src/templates/README.md`;
  `test/unit-tests/kixx/hyperview/hyperview-service.test.js`.
- Validation run: `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview`
  (pass with the pre-existing `hyperview-request-handlers.js` TODO warning);
  `node run-tests.js test/unit-tests/kixx` (pass: 481 tests); `git diff --check`
  (pass).
- Blockers: None.

---

### Task HV-4: Deterministic race coverage and documentation

**Status:** In progress
**Depends on:** HV-1, HV-2, HV-3
**Documentation:** `TODO.md` Issue 2 "Recommended validation"; `test/unit-tests/README.md`

**Objective**

The specific race scenarios named in the report are covered by deterministic
tests that fail against the pre-change implementation, and the contracts the fix
establishes are written down where the next reader will look for them.

**Scope**

- In: cross-cutting concurrency tests spanning store and Hyperview; JSDoc and
  README updates describing the snapshot and render-time-partial contracts.
- Out: end-to-end tests; the port contract; `TODO.md` itself, which is the source
  report and is left as the historical record.

**Design and invariants**

- Every ordering assertion is driven by deferred promises resolved in an explicit
  sequence, never by timers or timing assumptions. `makeDeferred()` in the
  existing Hyperview suite is the established pattern.
- Scenarios, adapted from the report:
  1. `getPage()` against index V1, paused after its first index-dependent read,
     with V1→V2 reassignment before it resumes, returns resources only from V1.
  2. A complete render against V1 with reassignment between page loading and
     template loading produces a response and a cache key wholly from V1.
  3. A V1 compiled template invoked after the global and page partial caches have
     advanced to V2 still renders V1 partials.
  4. Concurrent V1 and V2 renders both complete correctly, neither mutating the
     other's compiled dependencies.
  5. A page-cache entry is written only under the etags that produced its body.
- Documentation: `src/templates/README.md` API notes gain the render-time partials
  argument; `src/app/presentation/README.md` notes the one-snapshot-per-render
  guarantee where it describes Hyperview request handling; the store contract is
  documented in JSDoc on `openSnapshot()` and `ContentSnapshot` (delivered in
  HV-1, verified complete here).

**Expected touch points**

- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — scenarios 2, 3, 4, 5
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js` — scenario 1
- `src/templates/README.md`, `src/app/presentation/README.md` — contract documentation

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] All five scenarios are covered and pass.
- [x] Each new test is verified to fail when its corresponding fix is reverted;
      record which revert was used for each in the handoff notes.
- [x] No test depends on wall-clock timing or timer ordering.
- [x] The snapshot guarantee and the render-time partials contract are documented
      in the two READMEs and in JSDoc.

**Validation**

- `node run-linter.js` — whole tree clean
- `node run-tests.js` — full unit suite passes
- Manual: for each new test, temporarily revert the relevant change and confirm
  the test fails, then restore.

**Progress and handoff**

- Completed: Added a deterministic `getPage()` V1→V2 reassignment test, a concurrent V1/V2 Hyperview render test that also verifies body-to-page-cache-key pairing, and the two required documentation notes. Existing focused tests cover the V1-only mid-render response/cache identity and cached-bundle immutability; the new concurrency test covers a V1 compiled template completing after V2 global and page partial caches have advanced.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: The presentation README has unrelated, substantial working-tree edits; the snapshot note was added directly after its existing Hyperview introduction without disturbing that restructure. All race ordering uses promises controlled by `makeDeferred()`, never clocks. Revert checks: temporarily redirecting the paused snapshot test's subsequent index reads to the reassigned V2 index fails its V1 metadata assertion; temporarily omitting the `skipBaseRender` layered-partials render argument makes the concurrent V1/V2 test fail with the templating engine's required-partials `TypeError`. These temporary changes were restored before final validation.
- Actual files changed: `agents/plans/hyperview-snapshot-consistency.md`; `src/app/presentation/README.md`; `src/templates/README.md`; `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js`; `test/unit-tests/kixx/hyperview/hyperview-service.test.js`.
- Validation run: Focused `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js` (pass with pre-existing `hyperview-request-handlers.js` TODO warning); focused `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js` (pass: 60 tests); `node run-linter.js` (pass with the same warning); `node run-tests.js` (pass: 882 tests); `git diff --check` (pass).
- Blockers: None.
