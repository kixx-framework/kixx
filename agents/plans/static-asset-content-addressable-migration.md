# Static Asset Migration to the Content Addressable Store

Migrate static asset serving off the legacy `StaticFileStore` and onto the
`ContentAddressableStore`, collapse the two request handlers into one, and
replace Build ID asset namespacing with content-hash fingerprinting.

## Implementation Approach

### What changes, and why

Static files are currently served by two request handlers in
`src/kixx/static-file-server/static-file-server-request-handlers.js`, both
reading through a `StaticFileStore` service with platform adapters for Node.js
(a `public/` directory) and Cloudflare (a dedicated KV namespace). That store is
a parallel persistence stack next to the `ContentAddressableStore`, which
already stores static assets under its `/assets` namespace, already publishes
them atomically as part of a closure, and already has both platform adapters
built. The legacy stack is redundant and is removed entirely by this plan.

The two handlers differed only in where they read `key` and `namespace` from,
so they collapse into one factory. The surviving distinction is a genuine one
between two *lookups*:

- **Fingerprinted mode** — the URL carries a content hash
  (`/assets/<hash>/<pathname>`). The blob is read directly by hash, bypassing
  the index entirely. Immutable cache policy.
- **Pathname mode** — the URL carries only a pathname. The blob is resolved
  through the current build's snapshot index. Revalidating cache policy.

### Fingerprinting replaces Build ID namespacing

Asset URLs previously carried the deployment Build ID
(`/assets/:build_id/*pathname`), which invalidated every asset on every deploy
and made `Cache-Control: immutable` true only until a namespace was pruned.
Carrying the blob's content hash instead invalidates exactly the assets whose
bytes changed, and makes the URL genuinely immutable: it names the bytes, so a
stale HTML page either receives exactly the bytes it asked for or a clean 404 —
never different bytes under an immutable policy.

`NO_BUILD_ID_SEGMENT` and Build-ID-addressed asset URLs are removed.

### Accepted design positions

These were decided deliberately. Do not "fix" them without a new decision.

1. **Hash-addressed reads bypass the index and are a bearer capability.** Both
   production adapters ignore the `pathname` argument to `getFile()` and key on
   `hash` alone (`node-content-store/lib/content-store.js:131`,
   `cloudflare-content-store/lib/content-store.js:280`). The `/assets`-scoped
   pathname is therefore *not* an access control in production; it is
   load-bearing only in developer mode, where the store reads by pathname.
   Security rests on hash unguessability alone. This is acceptable because no
   raw blob hash is emitted to unauthenticated clients today: page cache keys
   are derived through `hashString()` and never surface as ETags, and `stat*`
   hashes come only from the authenticated publishing API. **Anything that
   begins publishing raw content hashes to unauthenticated clients must
   re-open this decision.**
2. **No `Content-Length` on fingerprinted responses.** A direct blob read
   returns a bare `ReadableStream` with no size; size lives in the index, which
   this path deliberately skips. Responses go out chunked. Pathname mode keeps
   `Content-Length` from `IndexEntry.size`.
3. **`Content-Type` is always inferred from the pathname extension.** Index
   metadata is unavailable on the fingerprinted path by construction, so
   extension inference is the single source of truth on both paths. A publisher
   cannot control an asset's content type; an unknown or absent extension
   serves as `application/octet-stream`.
4. **No `Last-Modified` / `If-Modified-Since`.** The CAS stores no timestamps.
   The blob hash is a strong validator available unconditionally on both paths,
   which is strictly better than the nullable ETag the legacy store provided.
   `request.ifModifiedSince` remains on `ServerRequestInterface` as generic HTTP
   surface, unused by this module.
5. **Input handling differs by mode.** Fingerprinted URLs are machine-minted, so
   any deviation is a client error and fails loudly with `400`. Pathname mode
   sits on the catch-all route ahead of the page renderer and must never
   adjudicate URLs it does not own, so it folds case and treats anything
   unusable as a miss. This fixes a latent bug in the current code, where
   `validatePathname()` throws `BadRequestError` for any character outside
   `[a-z0-9_.-]` — so a page URL such as `/my%20page` (WHATWG `URL` does not
   percent-decode `pathname`) currently returns `400` from the static handler
   instead of reaching the page renderer.
6. **`asset_url` receives the asset map as an explicit argument.** Template
   helpers cannot reach request-scoped state: they are handed only
   `frame.value` (`create-render-function.js:391`), and they are bound at
   compile time into render functions cached across requests, so a helper
   closing over a snapshot would capture the first request's snapshot forever.
   Positional arguments *are* resolved through the full frame stack via
   `resolveCompiledArgument()`, so `{{ asset_url assets "/path" }}` is correct
   in every scope including inside `{{#each}}`. The templating engine is a
   separate upstream project (its `README.md` documents an `npm test` and a
   Mustache spec baseline that do not exist in this repo) and is **not**
   modified by this plan.
7. **A missing asset falls back to the unfingerprinted pathname.** Helpers have
   no logger, so a miss is either visible in the output or nowhere. Falling back
   keeps the URL structurally valid, keeps failure proportional, and surfaces as
   an ordinary 404 in devtools and server logs.

### Known limitation: production has no published assets

Build tooling that publishes `src/stylesheets/` and `src/javascript/` into the
CAS `/assets` namespace **does not exist yet**. After this work lands:

- **Development works.** `src/static-assets/` does not exist, so the developer
  asset index is empty, every `asset_url` lookup misses, and the fallback
  renders the bare source path (`/stylesheets/stylesheet.css`), which
  `tools/devserver.js` already serves from source with `Cache-Control:
  no-cache`. This is the intended development path, not an error path.
- **Production has no CSS or JavaScript** until build tooling publishes assets
  under pathnames matching what the base templates request.

Acceptance criteria are scoped accordingly: the fingerprinted path is verified
by unit tests, not by a real build. Do not add validation steps that require
published production assets.

### Deferred follow-up

Pointing the developer scanner at the real asset sources — moving
`src/stylesheets/` and `src/javascript/` under `src/static-assets/`, or adding
them to the scanned tree — would give development the same fingerprinted URLs as
production and eventually allow deleting the devserver's source-file
interception. Deliberately out of scope here.

### Task order

T1 → T2 → T4 → T5 → T6, with T3 able to proceed in parallel with T2 once T1 is
done. T4 requires both T2 and T3.

---

### Task 1: Content-access surface for hash-addressed and index-listed assets

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` (port and adapter boundaries); `src/app/collections/README.md` is not relevant

**Objective**

The content layer can serve every read the new handler and template helper
need: a blob fetched by content hash without an index, the `/assets` tree hash,
and a listing of published assets. Callers never reach past
`ContentAddressableStore` into the `ContentStore` port.

**Scope**

- In: `isValidHash()` in `addressing.js`;
  `ContentAddressableStore#getStaticAssetByHash()`;
  `ContentSnapshot#statStaticAssets()` and `ContentSnapshot#listStaticAssets()`;
  unit tests for all four.
- Out: the request handler (T2), the template helper and page context (T3).

**Design and invariants**

- `getStaticAssetByHash(context, pathname, hash)` delegates to
  `#store.getFile(context, 'stream', getStaticAssetPath(pathname), hash)` and
  resolves `null` when the blob is absent. It returns the raw `ReadableStream`,
  **not** a `StreamContentObject`: there are no index stats to attach, and
  fabricating a partial one would misrepresent what the caller knows.
- This is a third operation on a class whose doc comment currently states it
  owns two "and nothing else". Amend that comment and state the reason: the read
  is deliberately closure-independent, which is precisely why it cannot be a
  snapshot method. Putting it on `ContentSnapshot` would force an index load in
  order to bypass the index.
- `isValidHash()` belongs in `addressing.js`, which already owns `FORMAT` and
  the hash functions. It exists because adapters validate hash shape privately
  and throw `AssertionError` (a 500-class error, e.g.
  `node-content-store/lib/content-store.js:320`); the handler needs a
  predicate so it can raise `BadRequestError` instead.
- `statStaticAssets()` takes no argument and returns the `/assets` tree entry,
  mirroring `statBaseTemplates()` and `statGlobalTemplatePartials()`. Its hash
  changes whenever any asset changes, which makes it both the memoization key
  and the page-cache-key input in T3.
- `listStaticAssets()` returns index entries for published asset blobs with
  **logical** pathnames (the `/assets` prefix stripped), so no caller composes
  or decomposes a storage pathname by hand. Filter to `kind === 'blob'`;
  directory entries are not assets. Building a lookup map from these entries is
  the caller's job, not the snapshot's.
- Both new snapshot methods are index-only and synchronous. Neither touches the
  store.

**Expected touch points**

- `src/kixx/content-addressable-store/addressing.js` — add `isValidHash()`
- `src/kixx/content-addressable-store/content-addressable-store.js` — add
  `getStaticAssetByHash()`; amend the class doc comment
- `src/kixx/content-addressable-store/content-snapshot.js` — add
  `statStaticAssets()` and `listStaticAssets()`
- `test/unit-tests/kixx/content-addressable-store/*.test.js` — extend

**Acceptance criteria**

- [ ] `getStaticAssetByHash()` resolves a `ReadableStream` for a stored blob and
      `null` for an absent one.
- [ ] `getStaticAssetByHash()` passes the `/assets`-scoped storage pathname to
      the port, so developer mode resolves by pathname.
- [ ] `isValidHash()` accepts a well-formed digest and rejects empty strings,
      path separators, `.`, `..`, and control characters.
- [ ] `statStaticAssets()` returns the `/assets` tree entry, and `null` when no
      assets are published.
- [ ] `listStaticAssets()` returns only blobs, with logical pathnames, and an
      empty array when no assets are published.
- [ ] The `ContentAddressableStore` class doc states why this read is not a
      snapshot method.

**Validation**

- `node run-linter.js src/kixx/content-addressable-store` — no lint errors
- `node run-tests.js test/unit-tests/kixx/content-addressable-store` — passes
- Unit coverage for each new function, including the absent-content path.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 2: Unified static asset request handler

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/docs/server-error-handling.md`; `src/app/presentation/README.md`

**Objective**

One request handler factory serves static assets from the
`ContentAddressableStore` in both fingerprinted and pathname modes, with correct
HTTP caching, conditional-request, and HEAD semantics. The legacy handler module
is gone.

**Scope**

- In: the new `src/kixx/static-assets/` module — the handler, `mime-types.js`
  moved from `static-file-server/`, and a rewritten `README.md`; deletion of
  `static-file-server-request-handlers.js`; full test rewrite.
- Out: route wiring (T4); deleting the `StaticFileStore` adapters, interface,
  config blocks, and `static-file-etag.js` (T5).

**Design and invariants**

- Directory is `src/kixx/static-assets/`; the handler file is singular
  (`static-asset-request-handler.js`) because there is now one factory. The old
  name is a misnomer — no server, no store, and the unit is assets, not files.
- Options: `fingerprinted`, `cacheControl`, `contentType`, `throwNotFound`,
  `skipWhenFound`. `computeEtag`, `pathname`, `buildIdParam`, and
  `pathnameParam` are **removed**; the route pattern and the handler are both
  wired in `virtual-hosts.js`, so configurable param names bought nothing. Route
  params are fixed as `hash` and `pathname`.
- `fingerprinted` selects the lookup and seeds both defaults. Assert the `hash`
  route param is present when it is `true`, so a mis-wired route fails loudly on
  first request rather than silently degrading into the other mode.
- Cache policy defaults: `public, max-age=31536000, immutable` when
  fingerprinted, `public, max-age=0, must-revalidate` otherwise.
- `ETag` is the blob hash, quoted. `request.ifNoneMatch` arrives with quotes
  stripped, so compare it against the **unquoted** hash.
- **Fingerprinted mode:**
  - Validate the `hash` segment with `isValidHash()` and the pathname with the
    CAS pathname rules (which require lowercase). Either failure →
    `BadRequestError` (400).
  - A conditional request whose `If-None-Match` equals the URL hash returns
    `304` **before any store read**. The URL names the bytes, so a hash match
    proves the client's copy is the content requested; no I/O can change that
    answer. This is the reason revalidation of an immutable asset costs nothing.
  - Otherwise read via `getStaticAssetByHash()`. `null` → `NotFoundError` (404).
  - `HEAD` must still read (and cancel) to verify existence rather than assert a
    200 for content that may not exist. No `Content-Length`.
- **Pathname mode:**
  - Fold the URL pathname with `store.normalizePathname()` (which lowercases)
    before lookup, because published asset pathnames are always lowercase.
  - If the folded pathname fails the CAS pathname rules, treat it as a **miss**,
    never a throw. This handler runs on the catch-all ahead of the page
    renderer and must express "not mine" as a miss. Optionally
    `logger.debug()` the rejection; never let it reach the response.
  - `statStaticAssets`-backed flow: call `statStaticAsset()` first (in-memory),
    answer `304` and `HEAD` from the stats, and open the stream via
    `getStaticAsset()` only for a real `200`. This avoids opening and
    immediately cancelling a file handle or KV stream.
  - A miss honours `throwNotFound`: throw `NotFoundError`, or return the
    response untouched so the next handler runs.
- `304` and `HEAD` responses MUST cancel any opened stream
  (`StreamContentObject#stream`) so the underlying file handle or binding is
  released.
- `Content-Type` comes from `getContentType()` on the logical pathname unless
  the `contentType` option overrides it.
- The handler resolves only the `ContentAddressableStore` service. It must not
  resolve `ContentStore`.

**Expected touch points**

- `src/kixx/static-assets/static-asset-request-handler.js` — new
- `src/kixx/static-assets/mime-types.js` — moved, unchanged
- `src/kixx/static-assets/README.md` — rewritten
- `src/kixx/static-file-server/static-file-server-request-handlers.js` — deleted
- `test/unit-tests/kixx/static-assets/static-asset-request-handler.test.js` —
  replaces the legacy handler test file

**Acceptance criteria**

- [ ] Fingerprinted mode serves a blob by URL hash with `ETag`, immutable
      `Cache-Control`, inferred `Content-Type`, and no `Content-Length`.
- [ ] Fingerprinted mode returns `304` on a matching `If-None-Match` without
      calling the store at all.
- [ ] Fingerprinted mode returns `400` for a malformed hash, an unsafe
      pathname, and an uppercase pathname.
- [ ] Fingerprinted mode returns `404` when the blob is absent.
- [ ] Pathname mode folds case and serves `/CSS/Main.CSS` from
      `/assets/css/main.css`.
- [ ] Pathname mode sends `Content-Length` from the index entry.
- [ ] Pathname mode treats an unsafe pathname — including one containing `%` —
      as a miss and defers when `throwNotFound` is `false`, and never throws
      `BadRequestError`.
- [ ] Pathname mode honours `throwNotFound` and `skipWhenFound`.
- [ ] `HEAD` returns headers only in both modes, and every `304`/`HEAD` path
      cancels an opened stream.
- [ ] A `fingerprinted` handler wired to a route with no `hash` param fails
      loudly.
- [ ] No `Last-Modified` header is emitted and no `If-Modified-Since` branch
      exists.

**Validation**

- `node run-linter.js src/kixx/static-assets` — no lint errors
- `node run-tests.js test/unit-tests/kixx/static-assets` — passes
- Stream-cancellation assertions using a mock stream that records `cancel()`.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 3: `asset_url` template helper and the page-context asset map

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/templates/README.md`; `src/kixx/templating/README.md`

**Objective**

Templates mint fingerprinted asset URLs at render time, and a change to any
asset correctly invalidates the rendered-page cache.

**Scope**

- In: the `asset_url` helper; the `assets` map in the page context; memoization
  of that map; the `/assets` tree hash as a page-cache-key input; helper
  documentation in `src/templates/README.md`.
- Out: the templating engine itself (explicitly unmodified); base template
  markup (T4).

**Design and invariants**

- **Do not modify `src/kixx/templating/`.** It is a separate upstream project.
  The helper works within the existing contract.
- Helper signature: `{{ asset_url assets "/stylesheets/stylesheet.css" }}`. The
  map is passed explicitly because helpers receive only `frame.value` and are
  compile-time bound into cached render functions; positional arguments resolve
  through the full frame stack, so this form is correct in every scope.
- The map is `logical pathname → hash`. The helper composes
  `/assets/<hash>/<pathname>`, keeping URL shape in one place. **This shape must
  match the T4 route pattern exactly.**
- A pathname absent from the map renders the bare pathname unchanged
  (`/stylesheets/stylesheet.css`). This is the normal development path, not an
  error path — say so in the helper's doc comment so a later reader does not
  "fix" it.
- The helper must escape its output; helper return values are not escaped by
  the renderer.
- The map covers **everything** under `/assets`, built from
  `listStaticAssets()`. Memoize it in `HyperviewService`, keyed by the
  `statStaticAssets()` tree hash, using the same LRU pattern already used for
  compiled templates keyed by bundle hash. The map is identical for every render
  against a given closure.
- Merge `assets` into the page context **last**, after `responseProps`, so
  published page data cannot shadow it. `assets` is a reserved page-context key;
  document it. The base template renders against the same `page.context` object
  (`hyperview-service.js:754-761`), so one merge covers both renders.
- **Page cache invalidation:** the rendered-page cache key currently covers the
  page's own files plus the global partials hash
  (`hyperview-service.js:633-637`). Once fingerprinted URLs are embedded in
  rendered HTML, editing a stylesheet changes no page file, so a cached page
  would keep serving a stale asset URL. The `statStaticAssets()` hash MUST be
  folded into the page cache key.

**Expected touch points**

- `src/kixx/hyperview/helpers/asset-url.js` — new, alongside `format-date.js`
- `src/kixx/hyperview/hyperview-service.js` — register the helper in
  `#customHelpers`; memoize the asset map; pass it into `HyperviewPage`; add the
  assets tree hash to the page cache key
- `src/kixx/hyperview/hyperview-page.js` — merge `assets` into the context last
- `src/templates/README.md` — document the helper and the reserved key
- `test/unit-tests/kixx/hyperview/*.test.js` — extend

**Acceptance criteria**

- [ ] `{{ asset_url assets "/x.css" }}` renders `/assets/<hash>/x.css` for a
      published asset.
- [ ] An unpublished pathname renders the bare pathname.
- [ ] The helper renders correctly inside `{{#each}}` and inside a partial.
- [ ] Helper output is HTML-escaped.
- [ ] The asset map is built once per distinct `/assets` tree hash, not once per
      render.
- [ ] `assets` is present in both the page-template and base-template contexts
      and cannot be shadowed by page data.
- [ ] Changing one asset changes the page cache key while leaving every page
      file unchanged.
- [ ] `src/templates/README.md` documents the helper, the explicit `assets`
      argument, the fallback behavior, and the reserved key.

**Validation**

- `node run-linter.js src/kixx/hyperview` — no lint errors
- `node run-tests.js test/unit-tests/kixx/hyperview` — passes
- A test asserting two renders against the same tree hash build the map once.
- A test asserting the page cache key changes when only the assets tree hash
  changes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 4: Route wiring and base templates

**Status:** Not started
**Depends on:** T2, T3
**Documentation:** `src/app/presentation/README.md`

**Objective**

The application serves fingerprinted assets on a dedicated route and
unfingerprinted assets from the catch-all, and base templates request their
stylesheets and scripts through `asset_url`.

**Scope**

- In: the two commented-out route blocks in `src/virtual-hosts.js`; the three
  base templates.
- Out: handler and helper implementation (T2, T3).

**Design and invariants**

- Fingerprinted route pattern is `/assets/:hash/*pathname`, matching the URL the
  helper composes. Wire `fingerprinted: true`, `GET` and `HEAD` only.
- The catch-all keeps its existing shape: the pathname-mode handler with
  `throwNotFound: false` and `skipWhenFound: true`, followed by
  `HyperviewPageHandler`. It exists for assets whose URLs are externally fixed —
  `/favicon.ico`, `/robots.txt` — and for hand-written content references.
- Base templates replace `/assets/{{ build_id }}/stylesheets/...` and
  `/assets/{{ build_id }}/javascript/site.js` with `asset_url` calls. `build_id`
  is referenced by three templates and supplied by nothing, so every reference
  is removed; no `build_id` plumbing exists to clean up.
- `tools/devserver.js:69` strips `/assets/<any-segment>/` before its source-file
  match, so it continues to work unchanged with a hash segment. No devserver
  change is required or wanted.

**Expected touch points**

- `src/virtual-hosts.js` — uncomment and rewrite both route blocks
- `src/templates/base/default.html` — `asset_url` for stylesheet and script
- `src/templates/base/admin.html` — same
- `src/templates/base/admin-login.html` — same

**Acceptance criteria**

- [ ] `/assets/:hash/*pathname` is wired with `fingerprinted: true` for `GET`
      and `HEAD`.
- [ ] The catch-all serves a matching file and otherwise falls through to the
      page renderer.
- [ ] No `{{ build_id }}` reference remains anywhere in `src/templates/`.
- [ ] Both routes reference the handler from `src/kixx/static-assets/`.

**Validation**

- `node run-linter.js src/virtual-hosts.js` — no lint errors
- `node run-tests.js` — full unit suite passes
- `grep -rn "build_id" src/templates/` returns nothing.
- Note: do not attempt to verify asset serving against a running server; no
  build tooling publishes assets yet (see Implementation Approach).

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 5: Remove the legacy static file stack

**Status:** Not started
**Depends on:** T4
**Documentation:** `src/plugins/README.md`

**Objective**

No trace of `StaticFileStore` remains — no service, no adapters, no interface,
no configuration, no tests. A later reader cannot mistake dead code with live
config for something load-bearing.

**Scope**

- In: the framework interface and etag helper, both platform plugins, their
  registry entries, all six config blocks, `NO_BUILD_ID_SEGMENT`, and the
  corresponding tests.
- Out: documentation prose (T6).

**Design and invariants**

- Delete in full:
  - `src/kixx/static-file-server/static-file-server-store-interface.js`
  - `src/kixx/static-file-server/static-file-etag.js` — its only consumers are
    the two adapters; the blob hash is the ETag now
  - `src/plugins/node-static-file-server/` and
    `src/plugins/cloudflare-static-file-server/`, entire
  - The now-empty `src/kixx/static-file-server/` directory
- Remove registry entries at `src/plugins/node.js:5,12` and
  `src/plugins/cloudflare.js:5,13`.
- Remove `STATIC_FILE_STORE` config blocks from all three environments in each
  of `src/node-config.js` (52, 99, 146) and `src/cloudflare-config.js` (63, 124,
  185), including the Cloudflare KV namespace binding.
- Remove `NO_BUILD_ID_SEGMENT` from `src/kixx/utils/build-id.js` and simplify
  `isValidBuildId()`, which currently excludes it. `validateBuildId()` stays —
  `app-runtime.js` still uses it — but its reserved-Build-ID branch goes with
  the constant.
- Delete `test/unit-tests/kixx/static-file-server/static-file-etag.test.js` and
  both plugin test suites.
- **Operational consequence to record, not to solve:** the Node adapter read
  from `./public`, so any deploy process copying static files there out of band
  no longer has an effect. All assets must now be published through the CAS.
- `test/end-to-end/020-publishing-api/put-static-asset*.test.js` reference
  `StaticFileStore` in comments only; those comments describe behavior that
  moved to the CAS. Update the comments. Do **not** run the e2e suite as part of
  this task.

**Expected touch points**

- `src/kixx/static-file-server/` — deleted
- `src/plugins/node-static-file-server/`,
  `src/plugins/cloudflare-static-file-server/` — deleted
- `src/plugins/node.js`, `src/plugins/cloudflare.js` — registry entries removed
- `src/node-config.js`, `src/cloudflare-config.js` — config blocks removed
- `src/kixx/utils/build-id.js` — constant removed, `isValidBuildId()` simplified
- `test/unit-tests/kixx/static-file-server/`,
  `test/unit-tests/plugins/{node,cloudflare}-static-file-server/` — deleted
- `test/end-to-end/020-publishing-api/put-static-asset*.test.js` — comments only

**Acceptance criteria**

- [ ] `grep -rn "StaticFileStore" src/ test/` returns nothing.
- [ ] `grep -rn "NO_BUILD_ID_SEGMENT" src/ test/` returns nothing.
- [ ] `grep -rn "STATIC_FILE_STORE" src/` returns nothing.
- [ ] `src/kixx/static-file-server/` no longer exists.
- [ ] `validateBuildId()` still works for `app-runtime.js` and no longer has a
      reserved-Build-ID branch.
- [ ] Both platform plugin registries load with no missing-module errors.

**Validation**

- `node run-linter.js` — no lint errors across the project
- `node run-tests.js` — full unit suite passes
- The three greps above return nothing.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 6: Documentation

**Status:** Not started
**Depends on:** T2, T3, T4, T5
**Documentation:** `src/docs/code-documentation-guide.md`

**Objective**

Every document describing static asset serving describes the CAS-backed,
fingerprinted design, and none describes the removed stack.

**Scope**

- In: the new module README, the presentation-layer static-file section, and
  cross-references to the deleted interface.
- Out: `src/templates/README.md` helper docs, owned by T3.

**Design and invariants**

- `src/kixx/static-assets/README.md` replaces
  `src/kixx/static-file-server/README.md`. It documents the two modes, the
  options, the URL shape, the caching and conditional-request behavior, and it
  states the accepted design positions from the Implementation Approach —
  particularly the bearer-capability model, the absent `Content-Length`, and the
  absent `Last-Modified` — so those are not later read as oversights.
- `src/app/presentation/README.md:809-841` is rewritten for the single handler.
  Its closing cross-reference to `src/kixx/static-file-server/README.md` must
  point at the new path.
- Record the "no build tooling yet" limitation where a developer will hit it:
  the new module README and the presentation-layer section.
- Sweep for stale references. `static-file-server-store-interface.js` currently
  claims Hyperview writes asset URLs containing `NO_BUILD_ID_SEGMENT`, which was
  already untrue before this work; the replacement text must not inherit it.

**Expected touch points**

- `src/kixx/static-assets/README.md` — new
- `src/app/presentation/README.md` — static-file section rewritten
- Any remaining cross-references found by grep

**Acceptance criteria**

- [ ] `grep -rn "static-file-server" src/ test/` returns nothing.
- [ ] The new README documents both modes, every surviving option, the URL
      shape, and the accepted design positions with their rationale.
- [ ] `src/app/presentation/README.md` documents one handler and links to the
      new README path.
- [ ] The build-tooling limitation is stated in both documents.

**Validation**

- `grep -rn "static-file-server" src/ test/` returns nothing.
- Manual read-through of both documents against the implemented handler
  signature and options.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
