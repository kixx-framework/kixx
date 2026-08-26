# Developer Static Asset Source Migration

Move the browser stylesheet and JavaScript sources into the canonical
`src/static-assets/` tree so developer mode discovers them through the
`ContentAddressableStore`, then remove the devserver's parallel source-file
serving path.

## Implementation Approach

### Use the existing canonical asset root

Relocate the existing source trees without changing their logical URL paths:

| Current source | New source | Logical asset pathname |
| --- | --- | --- |
| `src/stylesheets/**` | `src/static-assets/stylesheets/**` | `/stylesheets/**` |
| `src/javascript/**` | `src/static-assets/javascript/**` | `/javascript/**` |

`DeveloperSourceScanner` already maps every file below its configured
`staticAssetsDirectory` to `/assets/<relative pathname>`, and the Node content
store plugin already defaults that directory to `./src/static-assets`. Moving
the sources therefore uses the existing ownership boundary and requires no new
scanner roots, configuration fields, collision policy, or storage-layout rule.

After the move, the `assets` map supplied to Hyperview contains the stylesheet
and JavaScript entrypoints. Existing `assetUrl` calls in the base templates then
emit `/assets/<hash>/stylesheets/...` and `/assets/<hash>/javascript/...` in
development instead of falling back to bare pathnames.

### Keep imported dependencies on pathname-mode URLs

The current CSS and JavaScript entrypoints use relative imports. A relative
import loaded from `/assets/<entrypoint-hash>/<pathname>` inherits that hash
segment. This is incorrect because production hash-addressed reads key on the
hash alone: a request for a dependency carrying the entrypoint's hash returns
the entrypoint blob, regardless of the dependency pathname.

Convert source-level dependency references to root-relative logical asset URLs:

- CSS imports use `/stylesheets/...`.
- JavaScript imports use `/javascript/...`.

These dependency requests intentionally use the existing pathname-mode static
asset handler. They receive the revalidating cache policy and the dependency's
own ETag. Template-linked entrypoints remain fingerprinted and immutable.
Changing only a dependency does not need to change its entrypoint's URL because
the browser revalidates the root-relative dependency independently.

A future production build may bundle assets or rewrite every dependency to its
own fingerprinted URL. That build work is outside this plan. Do not add a source
transformer, bundler, publication command, or production deployment workflow.

### Make the devserver a proxy again

Delete `tools/devserver/source-file-handler.js` and remove its interception
from `tools/devserver.js`. The interception duplicates the content-store path,
assigns different cache semantics, and currently imports a MIME module that no
longer exists. Once sources live under `src/static-assets/`, both fingerprinted
and pathname requests can pass through the app server and be served from the
developer content snapshot.

The devserver remains responsible for starting, refreshing, and proxying to
the child app server. It must no longer strip an asset hash or read browser
asset bytes itself.

### Preserve browser linting and update source documentation

Move the browser lint target in `eslint.config.js` from the two old roots to
`src/static-assets/`. The server/tooling target must ignore that tree, while the
browser target applies to its JavaScript files. CSS is unaffected because the
project linter only selects `.js` files during directory traversal.

Update active documentation and agent instructions to distinguish physical
source paths from logical public URLs. Record that development now produces
fingerprinted entrypoint URLs through the content store, imported dependencies
use pathname mode, and production publishing remains deferred. The completed
`static-asset-content-addressable-migration.md` plan is historical state and is
not rewritten.

### Accepted scope boundaries

- Production build and publishing tooling remains out of scope.
- No asset bundling, minification, import rewriting, or source transformation
  is introduced.
- `src/public/` and its existing deprecation remain out of scope.
- The static asset handler, `assetUrl` helper, route shape, and CAS storage
  layout do not change.
- No development server, remote server, smoke test, or end-to-end test is run
  for verification.

### Task order

D1 → D2 → D3.

---

### Task D1: Canonical browser asset source tree

**Status:** Complete
**Depends on:** None
**Documentation:** `src/docs/frontend-development-guide.md`; `src/plugins/README.md`; `src/docs/code-style-guide.md`; `test/unit-tests/README.md`

**Objective**

All shared browser stylesheet and JavaScript sources live under the canonical
static asset source root, retain their public logical pathnames, and can be
scanned into the developer content snapshot without inheriting an incorrect
entrypoint hash for imported dependencies.

**Scope**

- In: moving both source trees; changing CSS and JavaScript imports to
  root-relative logical asset URLs; updating browser/server lint target paths;
  focused developer-scanner coverage for the two public namespaces.
- Out: devserver interception removal (D2); prose documentation (D3);
  production bundling, rewriting, and publication.

**Design and invariants**

- Move files; do not duplicate them or retain compatibility copies at the old
  paths.
- Preserve logical URLs exactly: templates and public links continue to use
  `/stylesheets/**` and `/javascript/**`.
- Keep the stylesheet import order unchanged. Only change each import from a
  relative source reference to its root-relative logical pathname.
- Change `site.js`'s `kquery.js` import to `/javascript/lib/kquery.js`. Do not
  alter browser behavior or module contents otherwise.
- Dependencies deliberately use pathname mode. Do not compose a fingerprinted
  dependency URL with the entrypoint hash.
- `eslint.config.js` must classify JavaScript below `src/static-assets/` as
  browser code and exclude it from the server/tooling profile. Remove the two
  obsolete source-root entries from both profiles.
- Extend the existing `DeveloperSourceScanner` test rather than creating an
  integration-test framework. Its manifest must contain
  `/assets/stylesheets/stylesheet.css`, `/assets/stylesheets/admin.css`, and
  `/assets/javascript/site.js` for fixtures below the canonical root.
- Do not change `DeveloperSourceScanner`, the Node content-store plugin, or
  `CONTENT_STORE.staticAssetsDirectory`; their current contract already owns
  this layout.

**Expected touch points**

- `src/stylesheets/**` — moved to the canonical static asset tree
- `src/javascript/**` — moved to the canonical static asset tree
- `src/static-assets/stylesheets/**` — new physical location; root-relative
  imports preserve pathname-mode dependency lookup
- `src/static-assets/javascript/**` — new physical location; root-relative
  module import preserves pathname-mode dependency lookup
- `eslint.config.js` — classify the new tree under browser lint rules
- `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`
  — assert the stylesheet and JavaScript storage pathnames

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `src/stylesheets/` and `src/javascript/` no longer exist.
- [x] Every moved file exists below the corresponding
      `src/static-assets/{stylesheets,javascript}/` path.
- [x] The developer scanner maps the entrypoints to
      `/assets/stylesheets/stylesheet.css`, `/assets/stylesheets/admin.css`,
      and `/assets/javascript/site.js`.
- [x] CSS imports and the JavaScript module import are root-relative logical
      asset URLs; no dependency inherits an entrypoint hash segment.
- [x] The stylesheet import order and browser JavaScript behavior are otherwise
      unchanged.
- [x] Browser JavaScript in its new location is linted under the browser
      profile, not the server/tooling profile.
- [x] No scanner API, content-store configuration, or storage-layout code is
      changed.

**Validation**

- `node run-linter.js eslint.config.js src/static-assets/javascript test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js` — the config, moved browser code, and changed unit test pass linting
- `node run-tests.js test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js` — canonical stylesheet and JavaScript fixtures map to the expected `/assets/**` pathnames
- `rg -n "src/stylesheets|src/javascript" eslint.config.js src/plugins src/kixx test/unit-tests tools` — returns no live code, configuration, test, or tooling references to the old roots

**Progress and handoff**

- Completed: Moved all browser sources to `src/static-assets/`; converted
  entrypoint dependency imports to root-relative logical URLs; updated lint
  profiles; and extended the scanner test for the three entrypoints.
- Current state: Complete.
- Remaining: Nothing for D1.
- Decisions and discoveries: Relative imports from fingerprinted entrypoints
  would carry the wrong hash to dependencies because production direct reads
  key on hash alone. Dependencies therefore use root-relative pathname-mode
  URLs until a future build can rewrite them to their own hashes.
- Actual files changed: `src/static-assets/stylesheets/**`,
  `src/static-assets/javascript/**`, `eslint.config.js`,
  `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`,
  `agents/plans/developer-static-asset-source-migration.md`; removed
  `src/stylesheets/**` and `src/javascript/**`.
- Validation run: `node run-linter.js eslint.config.js
  src/static-assets/javascript
  test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`
  passed; `node run-tests.js
  test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`
  passed (8 tests); stale-reference and relative-import sweeps passed; `git diff
  --check` passed.
- Blockers: None.

---

### Task D2: Content-store-only development asset serving

**Status:** Complete
**Depends on:** D1
**Documentation:** `src/plugins/README.md`; `src/docs/code-style-guide.md`; `test/unit-tests/README.md`

**Objective**

The development server proxies every static asset request to the application,
leaving source discovery, hashing, conditional requests, and cache headers to
the same content-store and request-handler path used by the application.

**Scope**

- In: removing the source-file handler module; simplifying devserver request
  handling and comments; stale-reference cleanup for the deleted interception.
- Out: changing child-process freshness behavior; changing the application
  static asset handler; development-server smoke tests; documentation prose
  (D3).

**Design and invariants**

- Delete `tools/devserver/source-file-handler.js` in full. Do not retain an
  unused helper or redirect it to `src/static-assets/`.
- Remove the handler import, hash-segment stripping, source-route recognition,
  and early response branch from `tools/devserver.js`.
- `handleRequest()` continues to ensure the child app server is available and
  proxy the original method, URL, headers, and body unchanged.
- Fingerprinted requests reach `/assets/:hash/*pathname`; root-relative imports
  reach the catch-all pathname-mode handler. The devserver does not distinguish
  them.
- Cache behavior now comes from `StaticAssetRequestHandler`: immutable for
  fingerprinted entrypoints and revalidating for pathname dependencies. Do not
  add devserver-specific cache headers.
- Do not run the devserver for verification. The project explicitly prohibits
  server smoke testing for ordinary work verification.

**Expected touch points**

- `tools/devserver.js` — remove filesystem asset interception and proxy all
  requests
- `tools/devserver/source-file-handler.js` — delete

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `tools/devserver/source-file-handler.js` no longer exists.
- [x] `tools/devserver.js` does not import a source-file handler, strip asset
      hash segments, recognize asset source roots, or read asset bytes.
- [x] The original request URL is forwarded unchanged to the child app server.
- [x] Existing child-process startup, restart, failure fallback, activity
      tracking, and shutdown behavior is unchanged.
- [x] No reference to the deleted `static-file-server` module remains under
      `tools/`.

**Validation**

- `node run-linter.js tools/devserver.js` — the simplified proxy passes linting
- `node run-tests.js` — the full unit suite passes after changing Node.js
  tooling code
- `rg -n "serveSourceFile|source-file-handler|assetPathname|sourcePathname|static-file-server" tools` — returns no matches
- Manual code review of `handleRequest()` — confirms `request.url` reaches
  `proxyRequest()` unchanged and non-asset behavior was not altered

**Progress and handoff**

- Completed: Deleted the obsolete source-file handler and its devserver branch.
- Current state: Complete.
- Remaining: Nothing for D2.
- Decisions and discoveries: The existing source-file handler imports the
  deleted `src/kixx/static-file-server/mime-types.js`, so removing the parallel
  path also repairs the devserver's stale module dependency.
- Actual files changed: `tools/devserver.js`,
  `tools/devserver/source-file-handler.js` (deleted),
  `agents/plans/developer-static-asset-source-migration.md`.
- Validation run: `node run-linter.js tools/devserver.js` passed;
  `node run-tests.js` passed (1216 tests); deleted-interception reference sweep
  and `git diff --check` passed. Manual review confirms `proxyRequest()` uses
  `request.url` unchanged.
- Blockers: None.

---

### Task D3: Development asset workflow documentation

**Status:** Complete
**Depends on:** D1, D2
**Documentation:** `README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; `src/kixx/static-assets/README.md`

**Objective**

Project documentation and agent instructions describe one development asset
path: browser sources live below `src/static-assets/`, the developer content
store fingerprints template-linked entrypoints, pathname mode serves their
root-relative dependencies, and the devserver only proxies requests.

**Scope**

- In: project overview development instructions; frontend source-layout guide;
  presentation source-layout example; static asset module documentation;
  repository `AGENTS.md`; active-reference sweep.
- Out: rewriting completed historical plans; production publication
  instructions that do not yet exist; `src/public/` deprecation work.

**Design and invariants**

- Use physical paths such as `src/static-assets/stylesheets/lib/` when
  discussing source organization, and logical paths such as
  `/stylesheets/stylesheet.css` when discussing browser URLs.
- `README.md` and `AGENTS.md` must no longer say the devserver directly serves
  CSS/JavaScript, strips an asset namespace, or assigns `no-cache` itself.
- Document that editing an asset changes its developer content hash on the next
  content scan; no asset build or devserver restart is required.
- Document the split cache behavior: `assetUrl` fingerprints base-template
  entrypoints, while root-relative imported dependencies use pathname mode and
  revalidation until production build tooling can rewrite them.
- State clearly that moving sources makes development work through the CAS but
  does not publish anything to staging or production. Production build and
  publishing tooling remains a separate follow-up.
- Update the presentation-layer example tree to show the real stylesheet and
  JavaScript directories below `static-assets/`.
- Do not change the completed
  `agents/plans/static-asset-content-addressable-migration.md`; it records the
  state and decisions of the earlier migration.

**Expected touch points**

- `README.md` — replace direct source-file interception instructions with the
  developer content-store workflow
- `AGENTS.md` — update development-server and frontend-guide summaries for the
  canonical source paths
- `src/docs/frontend-development-guide.md` — update physical stylesheet paths
  while retaining public URL examples
- `src/app/presentation/README.md` — show browser source directories in the
  canonical `src/static-assets/` layout
- `src/kixx/static-assets/README.md` — document developer fingerprinting,
  pathname dependencies, and the remaining production limitation

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Active documentation names `src/static-assets/stylesheets/` and
      `src/static-assets/javascript/` as the physical browser source roots.
- [x] Public examples continue to use `/stylesheets/**` and `/javascript/**`
      logical URLs.
- [x] No active documentation claims that the devserver reads browser asset
      files, strips a Build ID/hash segment, or sets their cache policy.
- [x] The fingerprinted-entrypoint/pathname-dependency distinction and its hash
      correctness rationale are documented.
- [x] Documentation states that production build and publishing tooling remains
      unavailable and out of scope.
- [x] The old source paths and deleted interception names remain only in
      historical plans, if anywhere.

**Validation**

- `rg -n "src/stylesheets|src/javascript|source-file-handler|serveSourceFile|static-file-server|/assets/<build-id>" README.md AGENTS.md src test tools eslint.config.js` — returns no stale active references to the old source or serving design
- `rg -n "src/static-assets/(stylesheets|javascript)|/stylesheets/|/javascript/" README.md AGENTS.md src/docs/frontend-development-guide.md src/app/presentation/README.md src/kixx/static-assets/README.md` — confirms physical and logical paths are described in their intended contexts
- Manual read-through of the five changed documents against the implemented
  source tree, `StaticAssetRequestHandler`, and `tools/devserver.js`

**Progress and handoff**

- Completed: Updated project, agent, frontend, presentation, and static-asset
  documentation for the content-store workflow.
- Current state: Complete.
- Remaining: Nothing for D3.
- Decisions and discoveries: Production tooling is explicitly excluded by user
  decision. This plan delivers development parity for template-linked
  entrypoints and retains pathname-mode dependency loading as the safe interim
  behavior.
- Actual files changed: `README.md`, `AGENTS.md`,
  `src/docs/frontend-development-guide.md`,
  `src/app/presentation/README.md`, `src/kixx/static-assets/README.md`,
  `agents/plans/developer-static-asset-source-migration.md`.
- Validation run: Both documentation path/reference sweeps passed; manual
  read-through confirmed the documentation matches the canonical source tree,
  static asset handler, and simplified devserver; `git diff --check` passed.
- Blockers: None.
