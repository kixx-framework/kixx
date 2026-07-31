# Static Asset Request Handler Implementation Plan

Split static file serving into two request handlers with different lookup rules and
cache policies, and move the application's CSS and JavaScript onto Build-ID-namespaced,
long-lived-cacheable URLs.

## Implementation Approach

Today `StaticFileRequestHandler` (`src/kixx/static-file-server/static-file-server-request-handlers.js`)
serves every static file with one rule: the store key comes from the URL pathname and
the namespace always comes from `context.runtime.build?.id`. That single rule cannot
express both of the use cases the application needs:

- **Catch-all files** — `/favicon.ico`, `/robots.txt`, `/site.webmanifest`. Their URLs
  are fixed and un-namespaced, their content changes between builds, and they must be
  revalidated on every use.
- **Immutable build assets** — `/assets/<build-id>/stylesheets/stylesheet.css`. Their URLs
  carry the Build ID, their content can never change for a given URL, and they should be
  cached for a year without revalidation.

The decisive difference is **where the namespace comes from**. The catch-all handler keeps
taking it from the server (`context.runtime.build.id`), so a URL can never reach another
build's files. The new asset handler takes it from the URL, which is what lets HTML cached
by a browser or CDN keep fetching the exact assets it was rendered against after a new
build is promoted. That inversion also makes the Build ID an untrusted input, so the
asset handler must validate it with the same path-safety rule already applied to keys.

Work lands in four sequential partitions: the framework handlers (Task 1), the Build ID
placeholder that lets one URL shape work with and without a deployed build (Task 2), the
application route and template wiring (Task 3), and dev server support so local
development exercises the same URLs as production (Task 4).

### Cross-cutting decisions

These were settled with the user before planning and should not be re-litigated:

1. **URL shape:** `/assets/:build_id/*pathname`. The route pattern extracts both parts;
   the handler reads `request.pathnameParams` and never parses the raw pathname. This
   keeps the URL shape owned by the route, and the resulting key
   (`stylesheets/stylesheet.css`) is byte-identical to the key the publishing API writes
   (`PUT /publishing-api/v1/assets/stylesheets/stylesheet.css`).
2. **Stale Build IDs are served, not rejected.** A URL naming any build still present in
   the store gets a 200. A pruned or unknown build gets a 404 from the ordinary store miss.
   The handler never compares the URL's Build ID against the current one.
3. **The catch-all handler is unchanged.** It keeps using the current Build ID as the
   namespace and keeps its `public, max-age=0, must-revalidate` default, so an atomic
   deploy still swaps `/favicon.ico`.
4. **Immutable policy keeps validators.** `public, max-age=31536000, immutable`, and the
   ETag / `Last-Modified` / 304 machinery stays on so a force-reloading client still gets
   a cheap answer.
5. **Names:** `StaticFileRequestHandler` (existing export, unchanged) and
   `StaticAssetRequestHandler` (new). No breaking rename.
6. **Untrusted Build ID:** validated as a safe path segment before it reaches the store —
   400 when malformed, 404 when well-formed but absent.

### Test strategy

The user has explicitly asked for unit test coverage of this work, so writing **and running**
the tests below is in scope for the tasks that own them. Follow `test/unit-tests/README.md`
for the runner API, hook semantics, and mocking rules.

Three facts set the shape of the coverage:

- **`static-file-server-request-handlers.js` has no test file today.** Task 1 refactors the
  existing handler's internals into helpers shared with a new handler, so the regression
  coverage for `StaticFileRequestHandler` is not optional busywork — it is the only thing
  that will prove the extraction did not change the behavior of the handler already serving
  every static file in the application. Write those cases even though that handler's
  observable behavior is meant to be unchanged.
- **`src/virtual-hosts.js` and the templates are configuration and markup.** This project has
  no unit test for the application's route table, and adding one would test the router, which
  `test/unit-tests/kixx/http-router/` already covers. Task 3 relies on its manual checks.
- **`tools/` has no test harness anywhere in the suite.** Task 4 is dev-only tooling and stays
  manually verified.

The new test file is `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js`,
mirroring the source tree per the guide. `test/unit-tests/kixx/hyperview/hyperview-request-handlers.test.js`
is the closest existing model for request-handler tests — reuse its approach:

- File-local `makeContext()`, `makeStore()`, `makeRequest()`, `makeResponse()`, and
  `catchAsyncError()` factories rather than shared fixtures.
- `makeResponse()` returns a real `ServerResponse` (`src/kixx/http-router/server-response.js`),
  so tests assert on `response.status`, `response.headers.get(name)`, and `response.body`
  instead of on a double's recorded calls.
- The store double's `read` is a `MockTracker` mock, so the arguments the handler passes —
  specifically `namespace` — are directly assertable. That matters more than the return value
  here: the whole design rests on which namespace each handler chooses.
- The result body double only needs a tracked `cancel()` method; the handlers never read it,
  and a real `ReadableStream` would make the 304 and HEAD cancellation cases harder to assert.
- Assert on `error.name` and `error.code`, never `instanceof` — the errors come from a
  vendored module tree.

### Known risk to keep in view

Dropping the `{{#if build_id}}` conditional from the base templates (Task 3) means every
deploy target must produce a servable `/assets/<segment>/...` URL, including a Node deploy
that never sets `BUILD_ID`. Task 2's placeholder segment plus the handler's placeholder →
flat-root mapping is what covers that case. If either half is skipped, an out-of-band
deploy with no Build ID will 404 on every stylesheet.

---

### Task 1: Two static file request handlers with distinct lookup and cache rules

**Status:** Complete
**Depends on:** None
**Documentation:** `src/kixx/static-file-server/README.md`, `src/docs/server-error-handling.md`, `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `test/unit-tests/README.md`

**Objective**

`src/kixx/static-file-server/static-file-server-request-handlers.js` exports two handler
factories. `StaticFileRequestHandler` behaves exactly as it does today. A new
`StaticAssetRequestHandler` reads the Build ID namespace and the store key from route
params instead of from the runtime, and applies an immutable cache policy. The two share
their response-mapping and conditional-request code rather than duplicating it.

**Scope**

- In: both factories, their shared internals, Build-ID-segment validation, the immutable
  cache default, unit tests for both factories, the module README, and the Static File
  Server Guide entry in `AGENTS.md`.
- Out: route registration and templates (Task 3), the Build ID placeholder constant and
  its Hyperview wiring (Task 2), dev server changes (Task 4), any change to the
  `StaticFileStore` adapters or the interface contract.

**Design and invariants**

- `StaticFileRequestHandler` keeps its current name, option surface
  (`contentType`, `cacheControl`, `computeEtag`, `throwNotFound`, `skipWhenFound`,
  `pathname`), default `Cache-Control`, and behavior. Existing callers in
  `src/virtual-hosts.js` and the README examples must not need edits.
- `StaticAssetRequestHandler(options)` accepts:
  - `contentType` — force the response `Content-Type`, as today.
  - `cacheControl` — defaults to `public, max-age=31536000, immutable`.
  - `computeEtag` — defaults to `true`.
  - `buildIdParam` — pathname param holding the Build ID segment, defaults to `'build_id'`.
  - `pathnameParam` — wildcard pathname param holding the key segments, defaults to `'pathname'`.
- `StaticAssetRequestHandler` deliberately has **no** `throwNotFound`, `skipWhenFound`, or
  `pathname` option. It is mounted on a dedicated route, so a miss is always a 404 and
  there is never a later handler to fall through to. Do not add these options
  speculatively.
- **The asset handler must never read `context.runtime.build`.** The URL is the sole
  source of the namespace. This is the property that makes previous-build assets
  reachable; a "sanity check" against the current build would silently destroy it.
- Input rules for the asset handler, in order:
  1. `request.pathnameParams[buildIdParam]` must be a non-empty string, else
     `BadRequestError`.
  2. The Build ID segment goes through `validatePathname()` (`src/kixx/utils/validate-pathname.js`),
     which rejects `..`, `//`, a leading `.`, and any character outside `[a-z0-9_.-]`.
     This is the guard that keeps an attacker-chosen namespace from escaping the store root.
  3. `request.pathnameParams[pathnameParam]` must be a non-empty array, else
     `BadRequestError`.
  4. The segments are joined with `/` and the joined key goes through `validatePathname()`.
     Joining before validating is what makes an empty segment (`/assets/b1/css//main.css`)
     a 400 — the joined string contains `//`. See the equivalent reasoning in
     `src/app/presentation/request-handlers/publishing-api/route-params.js:139-153`.
- **Case is preserved** in the key. Static asset reads resolve the stored key verbatim, so
  folding case here would look for a file no write ever created. This matches
  `getWildcardFilepath()` in the publishing API, which preserves case for exactly this reason.
- A store miss throws `NotFoundError`. Per `src/docs/server-error-handling.md`, both a
  malformed URL and an absent file are expected operational errors, not assertions.
- Extract the shared tail of the current handler — `Cache-Control` / `ETag` /
  `Last-Modified` header assignment, the `isNotModified()` 304 branch, the HEAD branch, and
  the 200 stream response — into one module-private helper both factories call. Keep
  `isNotModified`, `unquoteEtag`, `toEpochSeconds`, and `cancelBody` as the single shared
  copies they already are. Do not fork this logic; a divergence between the two handlers'
  conditional-request behavior would be a subtle cache bug.
- Both factories get full JSDoc per `src/docs/code-documentation-guide.md`. The asset
  handler's block must state that the namespace comes from the URL and that any still-stored
  build is reachable.
- The placeholder → flat-root mapping described in Task 2 is implemented **here**, in the
  asset handler, but is written against the constant Task 2 introduces. If Task 1 lands
  first, add the mapping in Task 2 rather than inventing a second constant.

**Test coverage**

New file: `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js`,
with one top-level `describe` and a nested `describe` per factory.

`StaticFileRequestHandler` — regression coverage proving the refactor preserved today's behavior:

- Passes the leading-slash-stripped pathname as `key` and the current `context.runtime.build.id` as `namespace`.
- Passes `namespace: null` when the runtime has no build.
- Forwards the `computeEtag` option to the store.
- A request for `/` never calls the store and throws `NotFoundError`; with `throwNotFound: false` it returns the response untouched instead.
- A store miss throws `NotFoundError`, or returns the response when `throwNotFound: false`.
- The `pathname` option overrides the request URL when deriving the key.
- The `contentType` option wins over the store's value; the store's value is used otherwise.
- Sets `cache-control: public, max-age=0, must-revalidate` by default, and the override when given.
- Calls `skip()` when `skipWhenFound: true` and a file is found, and does not when it is `false`.
- A traversal pathname throws `BadRequestError` before the store is called.

Shared response behavior — cover under whichever factory is cheaper to set up, and add one
mirror case under the other so a future divergence in the shared helper is caught:

- A hit responds 200 with the body, `content-type`, `content-length`, `etag`, and `last-modified`.
- A matching `If-None-Match` responds 304 with validators, a null body, no `content-length`, and a cancelled body stream.
- A non-matching `If-None-Match` responds 200 even when `If-Modified-Since` would have matched (RFC 9110 §13.2.2 precedence).
- `If-Modified-Since` alone responds 304, including when the stored `lastModified` carries sub-second precision that the header cannot express.
- A HEAD request responds 200 with `content-length` set, a null body, and a cancelled body stream.

`StaticAssetRequestHandler`:

- Resolves `namespace` from `pathnameParams.build_id` and `key` from the joined wildcard segments.
- **Ignores `context.runtime.build.id` entirely** — give the context a *different* current build ID and assert the store received the URL's. This is the regression guard for the design's central decision; without it, a later "sanity check" against the current build could be added without any test failing.
- Serves a stale Build ID: a URL naming a previous build reaches the store under that namespace and responds 200.
- Preserves case in the key (`/assets/b1/CSS/Main.CSS` reads that exact key).
- Missing or empty `build_id` param throws `BadRequestError`.
- Malformed `build_id` (`..`, a leading dot, a space, an out-of-whitelist character) throws `BadRequestError` before the store is called.
- Missing or empty wildcard pathname param throws `BadRequestError`.
- An empty segment in the wildcard (joining to `//`) throws `BadRequestError`.
- A traversal segment in the wildcard throws `BadRequestError`.
- A store miss throws `NotFoundError`.
- Sets `cache-control: public, max-age=31536000, immutable` by default, and honors an override.
- Honors custom `buildIdParam` and `pathnameParam` option names.

The placeholder → `null` namespace case is listed under Task 2, which introduces the constant.

**Expected touch points**

- `src/kixx/static-file-server/static-file-server-request-handlers.js` — both factories and shared internals.
- `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js` — new test file covering both factories.
- `src/kixx/static-file-server/README.md` — document the two handlers, when to reach for each, the immutable cache policy, the URL shape, and the stale-Build-ID behavior.
- `AGENTS.md` — update the Static File Server Guide index entry so it names both handlers.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `StaticFileRequestHandler` is exported with unchanged behavior and options.
- [ ] `StaticAssetRequestHandler` is exported and resolves namespace and key from `request.pathnameParams` only.
- [ ] A missing or malformed Build ID segment produces a `BadRequestError` (400).
- [ ] A missing or empty wildcard pathname produces a `BadRequestError` (400).
- [ ] An empty path segment in the key produces a `BadRequestError` (400).
- [ ] A well-formed URL whose namespace or key is absent from the store produces a `NotFoundError` (404).
- [ ] A found asset responds 200 with `cache-control: public, max-age=31536000, immutable`, plus `ETag` and `Last-Modified` when the store supplies them.
- [ ] `If-None-Match` and `If-Modified-Since` still produce a 304 with validators and no body; HEAD still produces headers with no body; both still cancel the body stream.
- [ ] The 304 / HEAD / 200 response mapping exists once in the module and is shared by both factories.
- [ ] Every case listed under **Test coverage** exists and passes.
- [ ] A test asserts the asset handler reads the URL's Build ID while the context carries a different one.
- [ ] The module README and the `AGENTS.md` index entry describe both handlers.

**Validation**

- `node run-linter.js src/kixx/static-file-server/static-file-server-request-handlers.js test/unit-tests/kixx/static-file-server/` — no lint errors.
- `node run-tests.js test/unit-tests/kixx/static-file-server` — the new suite passes.
- `node run-tests.js` — the full unit suite still passes, proving the shared-helper extraction broke no other caller.
- Read-through check: confirm `context.runtime.build` appears in `StaticFileRequestHandler` only, never in `StaticAssetRequestHandler`.
- Manual verification is deferred to Task 3, where the route exists to exercise these paths.

**Progress and handoff**

- Completed: Added `StaticAssetRequestHandler`, extracted the shared static-file response mapper, and added regression coverage for both handlers. Updated the static-file-server guide and its AGENTS index entry.
- Current state: Complete.
- Remaining: Task 2 must add the shared no-build placeholder and map it to the flat-root namespace.
- Decisions and discoveries: `StaticAssetRequestHandler` reads only pathname params; `context.runtime.build` appears only in `StaticFileRequestHandler`. The placeholder-to-flat-root mapping remains intentionally deferred to Task 2 because its shared constant does not exist yet.
- Actual files changed: `src/kixx/static-file-server/static-file-server-request-handlers.js`, `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js`, `src/kixx/static-file-server/README.md`, `AGENTS.md`.
- Validation run: `node run-linter.js src/kixx/static-file-server/static-file-server-request-handlers.js test/unit-tests/kixx/static-file-server/` (pass); `node run-tests.js test/unit-tests/kixx/static-file-server` (26 pass); `node run-tests.js` (1363 pass); read-through `rg` check confirms one runtime Build ID reference, in `StaticFileRequestHandler` only.
- Blockers: None.

---

### Task 2: A Build ID placeholder so one asset URL shape works with or without a build

**Status:** Complete
**Depends on:** None
**Documentation:** `src/templates/README.md`, `src/docs/code-style-guide.md`, `test/unit-tests/README.md`

**Objective**

The template context always exposes a usable `build_id` value, so base templates can emit a
single `/assets/<build_id>/...` URL shape with no conditional, and that URL still resolves
when the application is running with no `BUILD_ID` (local development and out-of-band
deploys).

**Scope**

- In: the shared placeholder constant, the `metadata.build_id` assignment in
  `HyperviewService`, the asset handler's placeholder → flat-root namespace mapping, and
  unit tests for both behaviors.
- Out: template edits (Task 3), dev server routing (Task 4), and any refactor of the
  fourteen other `context.runtime.build?.id ?? null` call sites.

**Design and invariants**

- Add `src/kixx/utils/build-id.js` exporting `NO_BUILD_ID_SEGMENT = 'dev'`. A shared module
  is the honest owner: the value is a URL-shape contract between the party that writes it
  into the template context (Hyperview) and the party that reads it back off the URL (the
  static asset handler). Neither module should own a constant the other depends on.
- Do **not** add a `getCurrentBuildId(context)` helper in this task. The codebase already
  uses the inline `context.runtime.build?.id ?? null` idiom in fourteen places; introducing
  a second idiom used by one call site makes the code less consistent, not more.
- `src/kixx/hyperview/hyperview-service.js:180` becomes
  `metadata.build_id = buildId ?? NO_BUILD_ID_SEGMENT;`.
- `StaticAssetRequestHandler` maps a Build ID segment equal to `NO_BUILD_ID_SEGMENT` to a
  `null` namespace, which the stores already serve from their flat root
  (`node-static-file-server/lib/static-file-server-store.js:97-99`). This is what keeps an
  out-of-band, no-Build-ID Node deploy working once the templates lose their conditional.
- **Consequence to record in the code:** `{{#if build_id}}` is now always truthy. Any
  template that branches on it is dead-branching and must be updated (Task 3). The
  `?.json` debug output for pages will show `"build_id": "dev"` in development rather than
  `null`.
- `'dev'` is a valid path segment under `validatePathname()`, so it survives the asset
  handler's Build ID validation unchanged.

**Test coverage**

Add to `test/unit-tests/kixx/hyperview/hyperview-service.test.js`, in the `getPageMetadata`
group. Its `makeContext(buildId = 'build-1')` factory already parameterizes the Build ID, and
the existing case asserting `result.metadata.build_id === 'build-2'` already covers the
real-build path — extend, do not rewrite:

- `metadata.build_id` is the placeholder when `context.runtime.build.id` is `null`.
- `metadata.build_id` is the placeholder when the runtime carries no `build` object at all
  (`makeContext()` needs a variant that omits it). Both shapes reach production: `BUILD_ID`
  unset yields `{ id: undefined }`, and a command runtime may have no `build` key.
- Assert against the imported constant, not the literal `'dev'`, so changing the placeholder
  is a one-line change rather than a test hunt.

Add to `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js`
(created in Task 1), in the `StaticAssetRequestHandler` group:

- A URL whose Build ID segment equals the placeholder calls the store with `namespace: null`.
- A URL with any other Build ID passes that literal value through, so the mapping is narrow
  and does not accidentally swallow a real build named something similar.

No test for `src/kixx/utils/build-id.js` itself. It exports one string constant with no
behavior; a test asserting `'dev' === 'dev'` documents nothing and only pins the value in a
second place.

**Expected touch points**

- `src/kixx/utils/build-id.js` — new module holding the placeholder constant.
- `src/kixx/hyperview/hyperview-service.js` — default `metadata.build_id` to the placeholder.
- `src/kixx/static-file-server/static-file-server-request-handlers.js` — map the placeholder to a null namespace.
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — placeholder cases for the absent-build paths.
- `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js` — placeholder namespace mapping cases.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `NO_BUILD_ID_SEGMENT` is exported from one module and imported by both consumers.
- [ ] With `BUILD_ID` set, `metadata.build_id` is the real Build ID.
- [ ] With `BUILD_ID` unset, `metadata.build_id` is the placeholder rather than `null`.
- [ ] `StaticAssetRequestHandler` reads the placeholder segment as a `null` namespace (flat store root) and any other segment as that literal namespace.
- [ ] An inline comment at the `metadata.build_id` assignment explains why a placeholder is used instead of `null`.
- [ ] Every case listed under **Test coverage** exists and passes, asserting against the imported constant rather than the literal.

**Validation**

- `node run-linter.js src/kixx/utils/build-id.js src/kixx/hyperview/hyperview-service.js src/kixx/static-file-server/static-file-server-request-handlers.js test/unit-tests/kixx/` — no lint errors.
- `node run-tests.js test/unit-tests/kixx/hyperview test/unit-tests/kixx/static-file-server` — both suites pass.
- `node run-tests.js` — the full unit suite still passes; the `build_id` default changes a value other Hyperview tests read.
- Manual (after Task 3): `curl -s http://localhost:2026/index.json | grep build_id` reports the placeholder in development.

**Progress and handoff**

- Completed: Added the shared `NO_BUILD_ID_SEGMENT` constant; Hyperview now emits it when a runtime has no Build ID; and the asset handler maps precisely that segment to the flat store root. Added the required tests.
- Current state: Complete.
- Remaining: Task 3 must register the route and emit the asset URL shape in base templates.
- Decisions and discoveries: The placeholder is `dev`, a valid safe pathname segment. The metadata assignment includes the required rationale comment; `build_id` is now always truthy.
- Actual files changed: `src/kixx/utils/build-id.js`, `src/kixx/hyperview/hyperview-service.js`, `src/kixx/static-file-server/static-file-server-request-handlers.js`, `test/unit-tests/kixx/hyperview/hyperview-service.test.js`, `test/unit-tests/kixx/static-file-server/static-file-server-request-handlers.test.js`.
- Validation run: `node run-linter.js src/kixx/utils/build-id.js src/kixx/hyperview/hyperview-service.js src/kixx/static-file-server/static-file-server-request-handlers.js test/unit-tests/kixx/` (pass); `node run-tests.js test/unit-tests/kixx/hyperview test/unit-tests/kixx/static-file-server` (138 pass); `node run-tests.js` (1366 pass).
- Blockers: None.

---

### Task 3: Serve and reference build assets at /assets/:build_id/*pathname

**Status:** Complete
**Depends on:** Task 1, Task 2
**Documentation:** `src/app/presentation/README.md`, `src/templates/README.md`, `src/docs/frontend-development-guide.md`

**Objective**

The application serves `/assets/<build-id>/<key>` through `StaticAssetRequestHandler`, and
every base template references its stylesheet and script through that URL shape with no
conditional fallback.

**Scope**

- In: the new route in `src/virtual-hosts.js`, and the asset URLs in the three base templates.
- Out: framework handler behavior (Task 1), the placeholder constant (Task 2), dev server
  interception (Task 4), page-local `page_stylesheet` includes (inlined, unaffected), and
  unit tests (see **Test coverage** below).

**Design and invariants**

- The route is declared **before** the `'*'` catch-all in `src/virtual-hosts.js:99`. Routes
  match in declaration order, so a later declaration would let the catch-all
  `StaticFileRequestHandler` swallow `/assets/**` and look the whole path up as a key under
  the current build — the exact double-namespacing bug this work exists to remove.
- Route shape:
  ```js
  {
      pattern: '/assets/:build_id/*pathname',
      name: 'build-assets',
      targets: [
          {
              name: 'serve-asset',
              methods: [ 'GET', 'HEAD' ],
              requestHandlers: [ StaticAssetRequestHandler() ],
          },
      ],
  },
  ```
- No `errorHandlers` on the route: a 404 for a missing asset should fall through to the
  virtual host's existing handling, the same as any other unmatched resource.
- Template edits — drop the `{{#if build_id}}` / `{{ else }}` blocks entirely and emit:
  - `src/templates/base/default.html:10-14` → `/assets/{{ build_id }}/stylesheets/stylesheet.css`
  - `src/templates/base/default.html:36-40` → `/assets/{{ build_id }}/javascript/site.js`
  - `src/templates/base/admin.html:9-13` → `/assets/{{ build_id }}/stylesheets/admin.css`
  - `src/templates/base/admin-login.html:9-13` → `/assets/{{ build_id }}/stylesheets/admin.css`
  Note the Build ID moves **before** the `stylesheets/` and `javascript/` segments; the old
  URLs put it in the middle, which no route could map back onto a stored key.
- Keep the existing explanatory template comment, updated to say that the Build ID segment
  namespaces the asset and enables the immutable cache policy.
- **Coordinated change point:** the resulting store keys are `stylesheets/stylesheet.css`,
  `stylesheets/admin.css`, and `javascript/site.js`. Deploy tooling must publish assets at
  exactly those keys via `PUT /publishing-api/v1/assets/<key>` with a staged
  `Kixx-Build-Id`. Note this in the module README if it is not already stated.

**Test coverage**

No unit tests. `src/virtual-hosts.js` is the application's route table and the base templates
are markup; the suite has no precedent for testing either, and a test asserting that a route
entry exists would restate the file rather than verify behavior. Route matching itself is
already covered by `test/unit-tests/kixx/http-router/`, and the handler this route mounts is
covered by Task 1.

The gap this leaves is real and worth naming: nothing automated proves the route is declared
*ahead* of the `'*'` catch-all, which is the one ordering mistake that would silently
reintroduce double-namespacing. The manual checks below are what catch it. If this ever needs
automating, it belongs in `test/end-to-end/` alongside the existing publishing-API suites,
which exercise a running server — not in the unit suite.

**Expected touch points**

- `src/virtual-hosts.js` — import `StaticAssetRequestHandler` and add the route above the catch-all.
- `src/templates/base/default.html` — stylesheet and script URLs.
- `src/templates/base/admin.html` — stylesheet URL.
- `src/templates/base/admin-login.html` — stylesheet URL.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `/assets/:build_id/*pathname` is registered ahead of the `'*'` catch-all and serves GET and HEAD.
- [ ] All three base templates emit the new URL shape with no `{{#if build_id}}` branch.
- [ ] No template still references `/stylesheets/` or `/javascript/` directly.
- [ ] `/favicon.ico` and the other root files still resolve through the catch-all handler.
- [ ] The store keys implied by the templates match what the publishing API writes.

**Validation**

- `node run-linter.js src/virtual-hosts.js` — no lint errors.
- `node run-tests.js` — the full unit suite still passes.
- Manual, with the dev server running (`node tools/devserver.js --port 2026`):
  - `curl -sI http://localhost:2026/favicon.ico` → 200 with `cache-control: public, max-age=0, must-revalidate`.
  - `curl -s http://localhost:2026/ | grep -E 'stylesheet|site.js'` → both tags carry the `/assets/dev/...` shape.
  - `curl -sI 'http://localhost:2026/assets/dev/../../etc/passwd'` → 400.
  - `curl -sI http://localhost:2026/assets/dev/stylesheets/nope.css` → 404.
- Manual, against a deployed build (cannot be run locally): request an asset under the
  previous build's ID after a promotion and confirm a 200 with the immutable
  `Cache-Control`, then confirm `If-None-Match` with the returned ETag gives a 304.

**Progress and handoff**

- Completed: Registered the build-asset GET/HEAD route before the static catch-all and migrated all base-template stylesheet and module-script URLs to `/assets/{{ build_id }}/<key>` without conditional branches.
- Current state: Complete, except for the plan's dev-server manual checks, which were not run because the repository instructions prohibit dev-server/smoke verification unless explicitly requested.
- Remaining: Task 4 must intercept these URLs in the development-server source-file handlers.
- Decisions and discoveries: Both admin templates also contained a direct script URL, so they were migrated along with the explicitly listed stylesheet URLs to satisfy the no-direct-asset-URL invariant.
- Actual files changed: `src/virtual-hosts.js`, `src/templates/base/default.html`, `src/templates/base/admin.html`, `src/templates/base/admin-login.html`.
- Validation run: `node run-linter.js src/virtual-hosts.js` (pass); `node run-tests.js` (1366 pass); read-through checks confirm the asset route is before `'*'` and no template has direct stylesheet/script URLs or `{{#if build_id}}`.
- Blockers: Manual dev-server and deployed-build checks deferred by repository verification policy.
- Blockers: None.

---

### Task 4: Dev server support for the /assets URL shape

**Status:** Complete
**Depends on:** Task 3
**Documentation:** `README.md` (Development Server), `AGENTS.md` (Development Server)

**Objective**

Local development exercises the same `/assets/<segment>/...` URLs as production while
still reading CSS and JavaScript straight from `src/stylesheets/` and `src/javascript/`,
so an edit shows up on the next reload with no build step and no server restart.

**Scope**

- In: dev server interception of `/assets/**`, and the README/AGENTS notes describing it.
- Out: setting `BUILD_ID` on the child process (see below), any change to the app server's
  own handlers, any asset build or bundling step, and unit tests (see **Test coverage** below).

**Design and invariants**

- **Do not set `BUILD_ID` on the app server child to make this work.** The same Build ID
  namespaces the page data store, the template file store, and the Hyperview page cache, so
  a synthetic Build ID in development would send every page lookup to
  `src/pages/<build-id>/` and 404 the entire site. The dev server must fake the Build ID at
  the URL layer only, which is exactly what Task 2's placeholder allows.
- The dev server strips the `/assets/` prefix **and the following Build ID segment**,
  whatever its value, then dispatches the remainder to the existing source-file handlers:
  a remaining path under `stylesheets/` is served from `src/stylesheets/`, and one under
  `javascript/` from `src/javascript/`. The segment's value is ignored entirely — there is
  no build to distinguish in development.
- Keep the existing bare `/stylesheets/` and `/javascript/` prefixes working. They cost
  nothing, and they stay useful for opening a source file directly in a browser.
- Reuse `validatePathname()` and the existing resolved-path root check in
  `tools/devserver/stylesheet-file-handler.js:44-60` rather than writing a third copy of the
  traversal guard.
- **Dev must keep responding `cache-control: no-cache`.** The production handler now sends
  a one-year immutable policy; if the dev server ever echoed that, an edited stylesheet
  would be invisible for a year behind the browser cache. This is the single most important
  behavioral difference between the two paths.
- Interception happens before the proxy hop, alongside the existing checks in
  `tools/devserver.js:64-88`, so an asset request never restarts or waits on the app
  server child.

**Test coverage**

No unit tests. Nothing under `tools/` is covered by the unit suite today, and the dev server's
behavior is defined by Node `http` request and response objects that would need substantial
faking to assert against — the harness cost would exceed the value for code that never ships
to a deploy target. The manual checks below are the verification for this task; run all of
them, including the edit-and-reload check, since the caching mistake this task guards against
is invisible to a single `curl`.

If coverage here ever becomes worthwhile, the testable seam is the prefix-stripping function
(pathname in, `{ root, key }` or `null` out), which is pure and could be extracted and tested
without touching the HTTP layer. Do not extract it speculatively as part of this task.

**Expected touch points**

- `tools/devserver/stylesheet-file-handler.js` and/or `tools/devserver/javascript-file-handler.js` — accept the `/assets/<segment>/` prefixed form, or expose the pieces a shared matcher needs.
- `tools/devserver.js` — dispatch `/assets/**` to the source-file handlers.
- `README.md` and `AGENTS.md` — note that the dev server serves the `/assets/**` shape from source and ignores the Build ID segment.

Treat this list as orientation, not permission to ignore other necessary files. Record the
actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `/assets/dev/stylesheets/stylesheet.css` is served from `src/stylesheets/stylesheet.css` without proxying to the app server.
- [ ] `/assets/dev/javascript/site.js` is served from `src/javascript/site.js`.
- [ ] Any Build ID segment value works identically in development.
- [ ] The bare `/stylesheets/**` and `/javascript/**` prefixes still work.
- [ ] Dev responses carry `cache-control: no-cache`, never the immutable policy.
- [ ] A traversal attempt under `/assets/**` is a 400, and a missing file is a 404.
- [ ] Non-GET/HEAD methods still produce 405 with an `Allow` header.

**Validation**

- `node run-linter.js tools/devserver.js tools/devserver/` — no lint errors.
- Manual, with `node tools/devserver.js --port 2026` running:
  - `curl -sI http://localhost:2026/assets/dev/stylesheets/stylesheet.css` → 200, `content-type: text/css`, `cache-control: no-cache`.
  - `curl -sI http://localhost:2026/assets/anything/javascript/site.js` → 200.
  - `curl -sI http://localhost:2026/stylesheets/stylesheet.css` → 200 (legacy prefix still works).
  - `curl -sI 'http://localhost:2026/assets/dev/stylesheets/../../../package.json'` → 400.
  - `curl -sI -X POST http://localhost:2026/assets/dev/stylesheets/stylesheet.css` → 405.
  - Load `http://localhost:2026/` in a browser, edit a rule in `src/stylesheets/stylesheet.css`, reload, and confirm the change appears without restarting the dev server.

**Progress and handoff**

- Completed: Added development-server interception for `/assets/<segment>/stylesheets/**` and `/assets/<segment>/javascript/**`, stripping the URL envelope before dispatching to existing source-file handlers. Documented the behavior in both development-server guides.
- Current state: Complete, except for the plan's dev-server manual checks, which were not run because repository instructions prohibit dev-server/smoke verification unless explicitly requested.
- Remaining: None.
- Decisions and discoveries: The raw request path is used before dispatch so `validatePathname()` can reject dot-segment traversal instead of URL normalization collapsing it first. Existing source-file handlers retain the root check, `no-cache`, 404, and 405 behavior; bare source prefixes remain unchanged.
- Actual files changed: `tools/devserver.js`, `README.md`, `AGENTS.md`.
- Validation run: `node run-linter.js tools/devserver.js tools/devserver/` (pass); `git diff --check` (pass).
- Blockers: Manual curl/browser checks deferred by repository verification policy.
- Blockers: None.
