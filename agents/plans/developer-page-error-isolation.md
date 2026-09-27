# Developer page error isolation

Fixes [kixx-framework/kixx#159](https://github.com/kixx-framework/kixx/issues/159):
in developer mode, one invalid `page.json` makes every request fail.

## Implementation Approach

Every developer request runs `ContentAddressableStore#openSnapshot()`, which
calls `DeveloperContentStore#getBuild()`, which runs a full
`DeveloperSourceScanner#scan()`. `#scanPages()` throws the first
`ValidationError` it hits (malformed `page.json`, invalid shape, or a missing
`template`/`partials`/`includes` file), so no index is built and every page
fails with a 422.

Page renders only read content through `ContentSnapshot#batchGetPageAssets()`.
That call reads the `page.json` of each ancestor plus the leaf page's own
directory blobs (template, `partials` bundle, `includes` bundle). So if a
broken page is kept in the scan as an **error recipe** at a pathname only that
page's reads touch, and reading that recipe throws, only that page fails. No
`kixx/` framework code changes.

Decisions:

- **Opt-in isolation.** `DeveloperSourceScanner` gets an `isolatePageErrors`
  constructor option (default `false`). Only `DeveloperContentStore` sets it
  to `true`. `buildReleaseManifest()` and `tools/local-target/seed.js` keep
  today's throw-on-first-error behavior, so a Release still cannot publish a
  broken page.
- **Error recipe placement.**
  - Metadata errors (malformed JSON, invalid `template`/`partials`/`includes`
    shape): the page's metadata entry (`getPageMetadataPath(pathname)`)
    becomes the error recipe. Descendant pages read ancestor metadata, so they
    fail too. This is intended: they cannot render correctly without the
    metadata they inherit.
  - Referenced-file errors (missing file, or a path that is not a file): the
    metadata entry stays normal. The page's partials entry
    (`getPagePartialsPath(pathname)`) becomes the error recipe, and the page
    emits no template or includes entry. Descendants still render.
- **Read-time error.** Reading an error recipe throws a new
  `OperationalError` on every read. It uses `code: 'InvalidDeveloperPage'` and
  `httpStatusCode: 500`, names the page pathname, and keeps the scanner's
  `ValidationError` as `cause`. The `ValidationError` message already names the
  offending file. It is a 500 because a broken source tree is a server fault,
  not invalid client input. Build a new error for each read; do not throw the
  stored instance again.
- **Still fatal to the whole scan:** page directory names that cannot become
  canonical pathnames (no page pathname exists to attach the error to);
  template, static-asset, and email scan errors; the reserved-filename
  `assert` on templates; and `OperationalError` filesystem failures.
- **Index.** `buildDeveloperIndex()` needs no change. An error recipe has
  `sources: []` and `manifests: [ <page.json identity> ]`, so its size is 0.
  Its hash follows the `page.json` identity. When the developer fixes the file,
  the next scan emits a normal recipe with a new hash.

## Tasks

### Task DPI-1: Scanner records broken pages as error recipes

**Status:** Complete
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`;
`test/unit-tests/README.md`; `src/plugins/README.md`

**Objective**

With `isolatePageErrors: true`, `DeveloperSourceScanner#scan()` completes when
pages are invalid. It returns error recipes for the broken pages and normal
recipes for everything else. With the default (`false`), behavior is unchanged.

**Scope**

- In: `isolatePageErrors` constructor option; per-page error capture in
  `#scanPages()` for both phases (metadata validation, referenced-file
  resolution); the `kind: 'error'` recipe shape; scanner JSDoc.
- Out: materializing or throwing error recipes, and wiring the option into
  `DeveloperContentStore` (DPI-2). Email isolation (not requested).

**Design and invariants**

- Error recipe shape:
  `{ kind: 'error', sources: [], manifests: [ makeFileIdentity(page.json) ], error: <ValidationError>, facet: { name: 'page', pathname, field } }`.
  `field` is `'metadata'` or `'partials'`, matching the replaced entry.
- Catch only `ValidationError` (`error.name === 'ValidationError'`). Rethrow
  every other error. `#assertValidRelativePath()` on the `page.json` path
  stays outside the catch, because without a valid path there is no page
  pathname.
- Resolve a page's referenced files into a local list first. Push that page's
  entries only after all of its files resolve, so a broken page never leaves a
  half-emitted template or includes entry.
- A page whose metadata failed goes into the second phase only as its error
  entry. Skip resolving its referenced files.
- Keep `scan()` output sorted and deterministic.
- `#readJson()` caches only valid JSON. Keep that, so a malformed file is
  re-read on the next scan after an edit.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-source-scanner.js` — option,
  per-page capture, JSDoc.
- `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`
  — new cases.

**Acceptance criteria**

- [x] Default scanner still rejects malformed `page.json` and missing
      template/partial/include files with a `ValidationError` (existing tests
      pass unchanged).
- [x] Isolating scanner, missing `template`: `scan()` resolves; the page's
      metadata recipe is normal; its partials recipe is `kind: 'error'` and
      carries a `ValidationError` naming the missing filepath; no template or
      includes recipe exists for that page; other pages' recipes are unaffected.
- [x] Same for a missing `partials` entry and a missing `includes` entry.
- [x] Isolating scanner, malformed JSON and invalid `page.json` shape: the
      page's metadata recipe is `kind: 'error'`; it has no other recipes.
- [x] Isolating scanner still throws for an invalid page directory name and
      for non-page scan errors.
- [x] JSDoc documents the option and the error recipe.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store` — scanner
  behavior in both modes.
- `node run-linter.js src/plugins/node-content-store test/unit-tests/plugins/node-content-store`

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: Page source resolution moved into
  `#scanPageSources()`; `#makePageErrorRecipe()` owns the isolate-or-rethrow
  decision. The reserved-filename `assert` still fails the whole scan.
- Actual files changed:
  `src/plugins/node-content-store/lib/developer-source-scanner.js`,
  `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js`.
- Validation run: `node run-tests.js` (1458 passed); linter clean.
- Blockers: None.

### Task DPI-2: Developer store serves around broken pages

**Status:** Complete
**Depends on:** DPI-1
**Documentation:** `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`;
`test/unit-tests/README.md`; `src/app/presentation/README.md` (error
handlers)

**Objective**

On the dev server, a broken page fails only its own requests (and a malformed
`page.json` also fails its descendants). The response is a 500 whose error
names the page pathname and the offending file. `/` and unrelated pages render
normally. Fixing the file recovers the page on the next request without a
restart.

**Scope**

- In: `getDeveloperBlob()`/`materializeRecipe()` handling of
  `kind: 'error'`; `DeveloperContentStore` constructing its scanner with
  `isolatePageErrors: true`; store and blob JSDoc; a guard in
  `buildReleaseManifest()`.
- Out: scanner changes (DPI-1). Changes to `ContentSnapshot`, Hyperview, or
  error handlers (none needed).

**Design and invariants**

- In `materializeRecipe()`, check `kind: 'error'` after the manifest-existence
  check. A deleted `page.json` still yields `null`, as it does today. Throw
  `new OperationalError(\`Developer page "${ pathname }" is invalid: ${ cause.message }\`, { cause, code: 'InvalidDeveloperPage', httpStatusCode: 500 })`,
  where `pathname` is `recipe.facet.pathname`.
- `DeveloperContentStore#getFiles()` uses `Promise.all`, so the error
  rejects the whole `batchGetPageAssets()` call. That is the intended behavior.
- `buildReleaseManifest()`: assert no recipe has `kind: 'error'`. This keeps
  a lenient scanner from reaching a Release by mistake.
- Every request rescans, so do not log per broken page during `getBuild()`.
  The route error handler logs the thrown error on the failing request.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-blobs.js` — throw for error
  recipes.
- `src/plugins/node-content-store/lib/developer-content-store.js` — pass
  `isolatePageErrors: true`; update class JSDoc.
- `src/plugins/node-content-store/lib/release-manifest-builder.js` — guard
  assertion.
- `test/unit-tests/plugins/node-content-store/developer-content-store.test.js`
  — integration cases through a real `ContentSnapshot`.
- `test/unit-tests/plugins/node-content-store/release-manifest-builder.test.js`
  — guard case.

**Acceptance criteria**

- [x] With a page whose `template` file is missing, `batchGetPageAssets()`
      for `/` and a sibling page succeeds. For the broken page, it rejects with
      `OperationalError`, `code === 'InvalidDeveloperPage'`,
      `httpStatusCode === 500`, a message containing the page pathname and the
      missing filepath, and `cause.name === 'ValidationError'`.
- [x] A missing partial file and a missing include file give the same
      result.
- [x] A child of a page with a missing file still renders. A child of a page
      with malformed `page.json` fails with the same error.
- [x] After the missing file is created, the same store instance serves the
      page on the next `getBuild()`.
- [x] `buildReleaseManifest()` with the default scanner still rejects a
      broken page with `ValidationError`.
- [x] Full suite and linter pass.

**Validation**

- `node run-tests.js` — full unit suite.
- `node run-linter.js src/plugins/node-content-store tools/local-target test/unit-tests/plugins/node-content-store`
- Manual repro from the issue: add `src/pages/example/page.json` with
  `{ "template": "page.html" }` and no `page.html`. Run
  `node tools/devserver.js --port 3004`. Check that
  `curl -i localhost:3004/` returns 200 and `curl -i localhost:3004/example`
  returns 500 with an error naming `/example` and `page.html`. Add the file,
  check that `/example` renders, then delete the test page.

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: The release guard is tested with an isolating
  scanner (AssertionError) and the default scanner (ValidationError).
- Actual files changed:
  `src/plugins/node-content-store/lib/developer-blobs.js`,
  `src/plugins/node-content-store/lib/developer-content-store.js`,
  `src/plugins/node-content-store/lib/release-manifest-builder.js`,
  `test/unit-tests/plugins/node-content-store/developer-content-store.test.js`,
  `test/unit-tests/plugins/node-content-store/release-manifest-builder.test.js`.
- Validation run: `node run-tests.js` (1458 passed); linter clean; manual
  repro on port 3004: `/` 200, `/example` 500 `InvalidDeveloperPage` naming
  `/example` and `page.html`, 200 after adding the file.
- Blockers: None.
