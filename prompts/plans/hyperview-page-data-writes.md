# HyperviewService Page Data Writes Plan

## Implementation Approach

Add two thin write methods to `HyperviewService` for the two page-data content
types — page metadata (`page.json`) and include text content — each delegating to
the existing `PageDataStore.putJSONFile` / `putTextFile`. Unlike the template
writes, these deliberately allow the *current* build id (live content editing is
the CMS core), so the only build-id rule is a non-empty string — there is no
"must differ from current" guard, and a brief comment will contrast this with the
template guard so the next reader understands the asymmetry. Cache coherence for
current-build writes is the caller's responsibility through the `page.json`
`version` field (the cache-busting key the service already uses); the methods
neither auto-stamp a version nor purge caches, and this is documented rather than
enforced. Includes are indexed by the caller in the `page.json` they upload, so
`putIncludeContent` writes only the text file (no read-modify-write of
`page.json`) and `putPageMetadata` is a full replacement of the page's `page.json`.
Scope is the service methods only; HTTP upload handlers (analogous to the template
upload handlers) are a natural follow-up and are out of scope here.

- [x] **Add the page metadata and include-content write methods**
  - **Story**: A caller (deploy tooling or a CMS editor) can publish a page's metadata (`page.json`) and an include's text content to a build — the current build for live edits or a new build for staging.
  - **What**: Add two public async methods to `HyperviewService`, placed in the page-data section (after `getIncludes`, before `getBaseTemplate`), mirroring the positional shape of the template write methods. `putPageMetadata(context, buildId, pathname, metadata)`: assert `buildId` is a non-empty string and `pathname` is a non-empty string, build the file path with the existing module-level `joinPageFilepath(pathname, 'page.json')`, and delegate to `this.#pageDataStore.putJSONFile(context, buildId, filepath, metadata)` (full replacement of the page's `page.json`; the store already asserts the value is a non-null object). `putIncludeContent(context, buildId, pathname, filename, source)`: assert `buildId`, `pathname`, and `filename` are non-empty strings, build the file path with `joinPageFilepath(pathname, filename)`, and delegate to `this.#pageDataStore.putTextFile(context, buildId, filepath, source)` (the store already asserts a non-empty `source`). Both return the store's `{ filepath }` ref. Do NOT add a "must differ from current build" guard — add a short comment explaining that page data is editable on the live build, contrasting with `#assertWritableBuildId`. Document both methods per the documentation guide: parameters, the `Promise<PageDataFileRef>` return, the full-replacement semantics of `putPageMetadata`, that the root pathname `'/'` resolves to `page.json`, and — as explicit caller responsibilities, not enforced — that the caller must (a) reference every uploaded include in the `page.json` `includes` map and (b) supply a changed `version` so a current-build write busts the page and includes caches (cache keys embed `version`).
  - **Where**: `src/kixx/hyperview/hyperview-service.js`
  - **Documentation**: `src/kixx/hyperview/page-data-store-interface.js`, `src/plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js`, `src/kixx/hyperview/hyperview-service.js` (`getPageMetadata`, `getIncludes`, `joinPageFilepath`, `#assertWritableBuildId`), `docs/code-quality.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: `putPageMetadata` writes `{pathname}/page.json` under `buildId` via `putJSONFile` and resolves with the logical `{ filepath }`; `putIncludeContent` writes `{pathname}/{filename}` under `buildId` via `putTextFile` and resolves with the logical `{ filepath }`; both accept the current build id (no differ-guard) and reject an empty `buildId`, `pathname`, or `filename` with `AssertionError`; `putPageMetadata` fully replaces the page's `page.json`; the root pathname `'/'` resolves to `page.json`.
  - **Depends on**: none

- [x] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on the changed source file and fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js src/kixx/hyperview/hyperview-service.js`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for the changed source file.
  - **Depends on**: Add the page metadata and include-content write methods

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the page-data write methods delegate correctly and validate their build id and path arguments.
  - **What**: Only if explicitly approved, add focused tests using a mock `PageDataStore` and a `context`. Cover: `putPageMetadata` delegating to `putJSONFile` with `buildId` as the namespace, the `{pathname}/page.json` filepath (including `'/'` → `page.json`), and the metadata unchanged, resolving with `{ filepath }`; `putIncludeContent` delegating to `putTextFile` with `buildId` as the namespace and the `{pathname}/{filename}` filepath; acceptance of the current build id (no differ-guard); and `AssertionError` rejections for empty `buildId`, `pathname`, or `filename`. Only write or run tests after the user explicitly asks for test work.
  - **Where**: `test/kixx/hyperview/hyperview-service.test.js`
  - **Documentation**: `docs/unit-testing-guide.md`, `src/kixx/hyperview/page-data-store-interface.js`
  - **Acceptance criteria**: Tests exercise both methods against a mock store without external services, and are only added or run after explicit user approval.
  - **Depends on**: Add the page metadata and include-content write methods
