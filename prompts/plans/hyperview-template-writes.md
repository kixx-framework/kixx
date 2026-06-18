# HyperviewService Template Writes Plan

## Implementation Approach

`HyperviewService` is read-only today: every read derives its namespace from the
currently-served build id (`context.runtime.build?.id`). This plan adds a write
path for base templates, page templates, and partial templates that delegates to
the `TemplateFileStore` `put*` methods (which already exist and own persistence),
so the change is contained to `src/kixx/hyperview/hyperview-service.js` with no
store or interface changes. All three writes are gated by one private guard
enforcing the deploy-safety invariant: a current build id MUST exist, a non-empty
`buildId` MUST be provided, and the two MUST differ — so a deploy can never mutate
the namespace the live site is serving. Sources are stored verbatim (no
compile-on-write), keeping template validation at render time and sidestepping the
partial cross-reference problem (a single partial cannot compile in isolation when
it references sibling partials not yet written in the new build). No cache work is
required because the service's per-build caches (`#templateCache`,
`#partialsCache`, `#includesCache`) are keyed by build id and writes always target
a non-current build; page-data writes and store-layer changes are out of scope.

- [x] **Add the writable-build-id guard**
  - **Story**: Template writes are rejected unless a current build exists, a `buildId` is provided, and the provided `buildId` differs from the current build id, so a deploy can never overwrite the live build in place.
  - **What**: Add a private `#assertWritableBuildId(context, buildId)` method to `HyperviewService`. Resolve the current build id from `context.runtime.build?.id ?? null`. Assert (in this order, each with a distinct message): the current build id is a non-empty string (`'HyperviewService template writes require a current build id'`); `buildId` is a non-empty string (`'HyperviewService template writes require a buildId'`); and `buildId !== currentBuildId` (`'HyperviewService template write buildId must not match the current build id'`). The method validates only and returns nothing. Add `assertNonEmptyString` to the existing `'../assertions/mod.js'` import (alongside `assert`, `isNonEmptyString`); use `assertNonEmptyString` for the `buildId` argument check and `assert(isNonEmptyString(currentBuildId), ...)` for the current-build state check. Document the method per the documentation guide, including the deploy-safety rationale and the `@throws {AssertionError}` conditions.
  - **Where**: `src/kixx/hyperview/hyperview-service.js`
  - **Documentation**: `src/kixx/assertions/mod.js`, `src/kixx/hyperview/template-file-store-interface.js`, `docs/code-quality.md`, `docs/code-style-guide.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: Calling a guarded write throws `AssertionError` when `context.runtime.build?.id` is unset/empty, when `buildId` is missing or not a non-empty string, and when `buildId` equals the current build id; the guard passes (does not throw) when a current build exists and a distinct non-empty `buildId` is supplied.
  - **Depends on**: none

- [x] **Add the base, page, and partial template write methods**
  - **Story**: Deploy tooling can write a base template, a page template (filepath may be nested several segments deep), or a partial template to a target build through `HyperviewService`, publishing a new build's templates without touching the live build.
  - **What**: Add three public async methods to `HyperviewService`, each mirroring the `TemplateFileStore` positional shape `(context, buildId, <address>, source)`: `putBaseTemplate(context, buildId, templateId, source)`, `putPageTemplate(context, buildId, templateId, source)`, and `putPartial(context, buildId, filepath, source)`. (Base/page use `templateId` to match the read methods `getBaseTemplate`/`getPageTemplate`; the partial address uses `filepath` to match the store, which has no single-partial read counterpart.) Each method first calls `this.#assertWritableBuildId(context, buildId)`, then delegates to the matching store method passing `buildId` as the namespace — `this.#templateFileStore.putBaseTemplate(context, buildId, templateId, source)`, `putPageTemplate(context, buildId, templateId, source)`, and `putPartial(context, buildId, filepath, source)` respectively — and returns the store's resolved `{ filepath }` ref verbatim. Do not compile, cache, or otherwise transform the source. Document each method per the documentation guide: parameters, the `Promise<{filepath: string}>` return (reference `TemplateFileRef` from the template store interface), and `@throws {AssertionError}` delegating to the guard's conditions.
  - **Where**: `src/kixx/hyperview/hyperview-service.js`
  - **Documentation**: `src/kixx/hyperview/template-file-store-interface.js`, `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`, `docs/code-quality.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: Each method rejects via the guard before any store call when the build-id rules are violated; on a valid call each delegates to the corresponding `TemplateFileStore.put*` method with `buildId` as the namespace and resolves with the store's logical `{ filepath }`; sources are passed through unmodified; nested page template filepaths are supported.
  - **Depends on**: Add the writable-build-id guard

- [x] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on the changed source file and fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js src/kixx/hyperview/hyperview-service.js`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for the changed source file.
  - **Depends on**: Add the base, page, and partial template write methods

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the template write methods satisfy the build-id guard and delegate correctly.
  - **What**: Only if explicitly approved, add focused tests using a mock `TemplateFileStore` and a `context` whose `runtime.build.id` is set. Cover: each write rejecting with `AssertionError` when the current build id is unset, when `buildId` is missing/empty, and when `buildId` equals the current build id; each write delegating to the matching store `put*` method with `buildId` as the namespace and the source unchanged; and each resolving with the store's `{ filepath }`. Only write or run tests after the user explicitly asks for test work.
  - **Where**: `test/kixx/hyperview/hyperview-service.test.js`
  - **Documentation**: `docs/unit-testing-guide.md`, `src/kixx/hyperview/template-file-store-interface.js`
  - **Acceptance criteria**: Tests exercise the guard and the delegation against a mock store without external services, and are only added or run after explicit user approval.
  - **Depends on**: Add the base, page, and partial template write methods
