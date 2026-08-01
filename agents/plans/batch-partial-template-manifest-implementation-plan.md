# Batch Partial Template Manifest Implementation Plan

## Implementation Approach

Replace per-file partial-template publishing with one complete-set `PUT` and make that batch the portable operation exposed by Hyperview. The shared contract will remove `putPartial()` in favor of `putPartials(context, namespace, partials)`, require a non-empty namespace for writes, and define successful replacement and return-value semantics without promising transactional recovery after a failed write or ordering concurrent writes.

The two platform adapters will preserve their natural storage layouts. Cloudflare will store a namespaced build's complete partial set in one JSON value at `{buildId}/partials.json` and load it with one cacheable `get()`; Node will keep individual files under `{root}/{buildId}/partials/` and replace only that directory. Un-namespaced reads retain their existing filesystem traversal or KV `list()` plus `get()` behavior. A missing namespaced set is an invariant failure on both platforms, while an explicitly published empty set reads as `[]`. Legacy namespaced partial keys are neither read, migrated, backfilled, nor deleted.

The Publishing API will expose `PUT /publishing-api/v1/templates/partials{/}` as a JSON:API `PartialTemplateSet` replacement endpoint. It will reuse the existing template permission and Build ID safety rules, require a valid `Content-Length` no greater than 25 MiB as a fast rejection path, enforce the same limit against bytes consumed while buffering, normalize and validate the whole collection through a dedicated Form, and return only normalized file references. Base and page templates remain per-file resources. The old partial wildcard endpoint and all single-partial application methods will be removed.

Cross-cutting constraints:

- External prerequisite: the Kixx deployment/publishing tooling must serialize partial-set writes for one Build ID and wait for the replacement request to succeed before deploying that Build ID. This repository does not contain that client and this plan does not establish its ordering behavior. The owning external repository is not identified anywhere in `kixx-framework/kixx`; it must be assigned and verified before rollout. No lock, version check, or separate seal endpoint will be added here.
- Sequential replacements of a staged Build ID remain allowed; writes to the current live Build ID remain forbidden.
- Source strings are ordinary UTF-8 JSON strings and are preserved after JSON decoding. Sources are not trimmed or Base64-encoded.
- The declared `Content-Length` check rejects missing, malformed, negative, or oversized declarations before body consumption. Because parsing JSON already requires the complete document, the handler also counts streamed bytes while buffering and rejects an understated body that crosses the limit. The preflight check avoids buffering a body already known to be oversized; the streaming count is the authoritative limit.
- Unit tests and linting are required. Existing E2E tests are not updated or run by this plan.
- No dependency installation, development server, remote smoke test, migration, or new API documentation guide is in scope.

### Task BPTM-1: Establish the complete partial-set port and Hyperview service contract

**Status:** Complete
**Depends on:** None
**Documentation:** `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/kixx/hyperview/template-file-store-interface.js`

**Objective**

Make complete-set partial publication the only shared write capability exposed by Hyperview, so application code cannot publish a single partial or bypass the build-level replacement invariant.

**Scope**

- In: Update the template-file-store interface types and invariants; replace `HyperviewService.putPartial()` with `putPartials()`; validate service inputs and the non-current Build ID; return written logical file references in submitted order; update Hyperview service unit tests and test doubles.
- Out: Platform storage encodings, HTTP payload parsing, Forms, routes, transaction scripts, and E2E tests.

**Design and invariants**

- `putPartials(context, namespace, partials)` accepts an array of `{ filepath, source }` entries whose filepaths are relative to `partials/`.
- A write namespace is mandatory and non-empty. Read methods retain their existing optional namespace convention.
- A successful call replaces the namespace's complete logical partial set and resolves to `{ filepath }[]` using prefix-included logical paths such as `partials/website/nav.html`, in submitted order. An empty input resolves to `[]`.
- The contract promises the exact set only after successful resolution. A failed write may leave an incomplete staged namespace, which must be retried or abandoned.
- Concurrent calls for one namespace are outside the contract; callers must serialize them.
- `getPartials()` keeps its existing `{ filepath, source }[]` return shape and unspecified listing order.
- For namespaced reads, a never-published partial set is an invariant failure; an explicitly published empty set returns `[]`. Un-namespaced absence continues to return `[]`.
- `HyperviewService` remains the owner of the rule that a template write must target a valid Build ID other than the current runtime Build ID. It asserts the canonical normalized filepath and non-empty source of every entry before delegating once.
- Remove the single-partial method rather than retaining an internal compatibility path.

**Expected touch points**

- `src/kixx/hyperview/template-file-store-interface.js` — replace the single-write property, add precise batch input/result types, and document replacement, namespace, failure, and concurrency guarantees.
- `src/kixx/hyperview/hyperview-service.js` — replace `putPartial()` with the batch service method and preserve live-build protection.
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — cover delegation, ordering, empty input, canonical input assertions, source assertions, required Build ID, and current-build rejection.
- Other unit-test doubles implementing `TemplateFileStoreInterface` — rename the removed method where required to keep tests structurally valid.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No production Hyperview or port API exposes `putPartial()`.
- [ ] `putPartials()` accepts only a namespaced complete set, delegates once, and returns prefix-included references in input order.
- [ ] Empty-set publication and successful replacement semantics are documented without promising failure atomicity or concurrent-write ordering.
- [ ] Namespaced unpublished-set failure versus explicitly empty-set success is part of the portable read contract.
- [ ] Hyperview service unit tests cover the new method's success and invariant failures.

**Validation**

- `node run-linter.js src/kixx/hyperview/template-file-store-interface.js src/kixx/hyperview/hyperview-service.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` — validates changed contract, service, and tests.
- `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` — proves the service-level batch contract and build protections.
- `rg -n "putPartial\\(" src test/unit-tests --glob '*.js'` — identifies any single-partial production path or stale unit-test double remaining for later tasks.

**Progress and handoff**

- Completed: Replaced `putPartial()` with `putPartials(context, namespace, partials)` across the shared interface documentation and `HyperviewService`. Updated the interface's namespace contract to require a non-empty namespace for `putPartials()` while keeping it optional elsewhere, documented complete-replacement/empty-set/failure/concurrency semantics for the write, and documented the unpublished-vs-explicitly-empty read distinction for `getPartials()`. Added a `PartialInput` typedef. `HyperviewService.putPartials()` asserts the input is an array, asserts each entry's `filepath` is canonical and `source` is non-empty, enforces the existing live-build protection via `#assertWritableBuildId()`, and delegates once to the store, returning its result unchanged (store owns prefixing/ordering per adapter contract). Updated `test/unit-tests/kixx/hyperview/hyperview-service.test.js`: renamed the mock store method, and reworked/added cases covering non-canonical filepath rejection, forwarding of canonical batches, single delegation with returned order, empty-set delegation, empty-source rejection, and current-build rejection.
- Current state: Complete. All acceptance criteria met.
- Remaining: None for this task.
- Decisions and discoveries: The batch port is justified by different platform storage costs and layouts; it expresses a portable application operation rather than a Cloudflare-only seal hint. `assertMatches` in `kixx-assert` uses `String.includes()` for plain-string matchers (not regex), so no escaping is needed for message-substring assertions like `partials[].source`. Confirmed via `rg` that remaining `putPartial(` references live only in the Node/Cloudflare adapters, their unit tests, and `put-template.js`/its test — all explicitly out of scope for BPTM-1 and owned by BPTM-2/BPTM-3.
- Actual files changed:
  - `src/kixx/hyperview/template-file-store-interface.js`
  - `src/kixx/hyperview/hyperview-service.js`
  - `test/unit-tests/kixx/hyperview/hyperview-service.test.js`
- Validation run:
  - `node run-linter.js src/kixx/hyperview/template-file-store-interface.js src/kixx/hyperview/hyperview-service.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` — clean.
  - `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` — 37/37 passed.
  - `rg -n "putPartial\(" src test/unit-tests --glob '*.js'` — only BPTM-2/BPTM-3-owned files remain (adapters, adapter tests, `put-template.js`, `put-template.test.js`).
- Blockers: None.

### Task BPTM-2: Implement authoritative namespaced partial sets in both platform adapters

**Status:** Complete
**Depends on:** BPTM-1
**Documentation:** `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/kixx/hyperview/template-file-store-interface.js`

**Objective**

Make namespaced partial reads complete and cacheable on Cloudflare while preserving Node's inspectable filesystem layout and giving both adapters identical observable replacement and missing-set behavior.

**Scope**

- In: Implement `putPartials()` and revised `getPartials()` in the Cloudflare and Node template-file-store adapters; remove their `putPartial()` implementations; update adapter unit tests and mocks.
- Out: Publishing API parsing and validation, application transaction scripts, route changes, legacy data migration, cleanup of legacy KV keys, and E2E tests.

**Design and invariants**

- Cloudflare namespaced writes create one value at `{namespace}/partials.json`. The JSON object maps prefix-included logical keys to source strings, for example `{ "partials/nav.html": "<nav/>" }`.
- A valid manifest is a plain JSON object whose own enumerable keys are canonical, lower-case logical filepaths beginning with exactly one `partials/` prefix and whose values are non-empty source strings. Nested objects, arrays, null values, non-string sources, non-canonical keys, keys outside `partials/`, and traversal or empty path segments are invariant failures.
- The Cloudflare adapter validates manifest structure but never trims, folds case, rewrites prefixes, or otherwise normalizes manifest keys or source values. Canonicalization belongs to the publishing edge; the adapter rejects violations of that internal contract.
- Cloudflare does not also write individual `{namespace}/partials/...` keys and does not list or delete legacy keys. Replacing the manifest replaces the logical set.
- Cloudflare namespaced reads call `kvStore.get(manifestKey, { type: 'json', cacheTtl })` once, using the existing configured namespaced TTL and default of 86400 seconds. They never fall back to `list()` when the manifest is absent.
- A missing or structurally invalid namespaced manifest is an unexpected invariant failure. `{}` is valid and maps to `[]`.
- Cloudflare un-namespaced reads retain the existing `list()` plus bulk `get()` implementation and shorter TTL behavior, including its current legacy limits; expanding that path is out of scope.
- Node writes individual files beneath `{root}/{namespace}/partials/`. On each successful batch it removes only that directory, recreates it, and writes the complete submitted set. Base templates, page templates, and other build data are untouched.
- Node creates an empty `partials/` directory for an empty batch. A missing namespaced directory is an invariant failure; a missing un-namespaced directory remains `[]`.
- Neither adapter promises rollback after a failed replacement or ordering between concurrent replacements.
- Both adapters assert the port-level input shape at their boundary and return prefix-included file references in submitted order.
- Adapters translate only recognized backing-store failures into `OperationalError` and preserve the platform error as `cause`: Node filesystem failures other than the explicitly handled `ENOENT` read case, and rejected Cloudflare KV `get()`/`put()` operations after arguments and manifest data have passed adapter assertions. Assertion-library failures and native programmer errors raised by adapter validation or transformation code propagate unchanged. `HyperviewService.putPartials()` does not catch or translate either category.

**Expected touch points**

- `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js` — add manifest encoding, single-get namespaced reads, required namespaced batch writes, precise manifest-shape invariant checks, no-normalization enforcement, and expected KV rejection translation with preserved cause while preserving the flat fallback.
- `test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js` — cover exact manifest key/value, one cached JSON read, configured TTL, empty manifest, every invalid manifest shape, rejection rather than normalization, replacement unaffected by legacy keys, return shape, and retained un-namespaced listing.
- `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js` — replace the namespaced partial directory, distinguish missing namespaced from missing flat directories, and translate expected filesystem failures with preserved cause.
- `test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` — cover complete replacement, omitted-file removal, nested files, empty sets, missing-set behavior, isolation from other template prefixes, and result ordering.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A Cloudflare namespaced render loads all partial sources through one cacheable JSON `get()` and performs no `list()` or bulk read.
- [ ] Cloudflare stores only the manifest for new namespaced partial batches and ignores any legacy individual keys.
- [ ] Node stores individual partial files and removes files omitted by a later successful batch without touching other build content.
- [ ] Both adapters return `[]` for an explicitly empty set and fail for an unpublished namespaced set.
- [ ] Un-namespaced reads preserve the pre-change behavior on both adapters.
- [ ] Adapter tests prove the storage representations, shared observable contract, expected operational failure translation with preserved cause, and unchanged propagation of assertion/programmer errors.

**Validation**

- `node run-linter.js src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js src/plugins/node-hyperview-template-file-store/lib/template-file-store.js test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` — validates both adapters and their tests.
- `node run-tests.js test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` — proves manifest and filesystem behavior.
- `rg -n "list\\(" src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js` — manually confirm that listing is reachable only from the un-namespaced fallback.

**Progress and handoff**

- Completed:
  - **Cloudflare adapter** (`src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`): Replaced `putPartial()` with `putPartials(context, namespace, partials)`, which requires a non-empty namespace, asserts each entry (non-empty filepath/source, no `..` segments), builds a manifest object keyed by prefix-included logical paths (`partials/<filepath>`), and writes it as one JSON value to `{namespace}/partials.json` via one `kvStore.put()`, wrapped in try/catch translating rejections to `OperationalError` with `cause`. Rewrote `getPartials()` to branch on namespace: empty/null namespace still uses the original `list()` + bulk `get()` flat-keyspace path unchanged; non-empty namespace calls new private `#loadPartialsManifest()`, which does one `kvStore.get(manifestKey, { type: 'json', cacheTtl })` (using the existing `#resolveCacheTtl()` — namespaced default 86400s), asserts the result is not `null` (missing manifest → `AssertionError`, since a namespace must be staged before it's read), then `#parsePartialsManifest()` validates structure: `isPlainObject()` check (rejects arrays/null/non-objects), and per-key validation via new module-level `isValidManifestKey()` (canonical lower-case, starts with `partials/`, non-empty remainder, no empty/`.`/`..` segments) plus `isNonEmptyString()` on each value — any violation throws `AssertionError` naming the manifest key. No normalization is applied to keys or values (verified by a dedicated test). Legacy per-file `{namespace}/partials/...` KV keys are never read, written, or deleted by the new path. Also added `OperationalError` translation (preserving `cause`) to `#getFile()`/`#putFile()` (used by base/page templates) for consistency with the design invariant that only assertion/programmer errors should propagate raw.
  - **Node adapter** (`src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`): Replaced `putPartial()` with `putPartials(context, namespace, partials)`, which requires a non-empty namespace, resolves each entry's filepath/source (reusing `#resolveFilepath()`/`#resolveKey()`), then does `fsp.rm(prefixDir, { recursive: true, force: true })` followed by `fsp.mkdir(prefixDir, { recursive: true })` and per-entry `mkdir`+`writeFile`, all wrapped in one try/catch translating to `OperationalError` with `cause`. This guarantees complete replacement — a file omitted from a later successful batch no longer exists — and an empty batch still creates an empty `partials/` directory. Rewrote `getPartials()`/replaced `#loadPrefixedFiles()`+`#walkFiles()` with a single `#walkPartialsFiles(dir, safeNamespace, isTopLevel)` that, on `ENOENT` at the top level of a namespaced (non-empty `safeNamespace`) read, throws `AssertionError` ("no published partials directory"); at any other level (top-level flat namespace, or any nested directory during the walk) it returns `[]` as before. File reads during the walk translate non-ENOENT errors to `OperationalError`. Also added the same `OperationalError` translation (preserving `cause`) to `#getFile()`/`#putFile()` (base/page templates) for consistency.
  - **Adapter unit tests**: Rewrote the `putPartial and getPartials` describe blocks in both `test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js` and `test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` as `putPartials and getPartials`, covering: missing-namespace-read failure, single manifest/replace-directory write + round-trip in submitted order, nested filepaths, explicit empty-set success, complete replacement removing an omitted key/file, isolation from other prefixes/namespaces, namespace-required rejection, and (Cloudflare-only) every invalid manifest shape (non-object, key outside `partials/`, non-lower-case key, empty path segment, non-string/empty value) plus a no-normalization proof test and ignoring legacy per-key data. Updated the Cloudflare test's `makeKVNamespace()` mock `get()` to parse JSON when `{ type: 'json' }` is requested (mirroring real Cloudflare KV behavior), since the manifest round-trips through `JSON.stringify`/`JSON.parse`. Updated one pre-existing TTL test (`applies the TTL to the getPartials bulk read` → `applies the TTL to the getPartials manifest read`) to seed a manifest instead of a legacy per-file key, since namespaced reads no longer use `list()`+bulk `get()`.
- Current state: Complete. All acceptance criteria met; both adapters share the same observable replacement/missing-set/empty-set contract while using different storage encodings.
- Remaining: None for this task.
- Decisions and discoveries: The 25 MiB KV value cap is accepted. No runtime migration or backfill exists, so deployments using the new reader must publish a new partial set before becoming live. Extended `OperationalError` translation to the pre-existing `#getFile()`/`#putFile()` helpers (used by base/page templates, not just partials) in both adapters, because the plan's design invariant ("Adapters translate only recognized backing-store failures into `OperationalError`... Node filesystem failures other than the explicitly handled `ENOENT` read case, and rejected Cloudflare KV `get()`/`put()` operations") reads as adapter-wide rather than partials-only, and no existing test depended on the untranslated raw-error form. `isPlainObject()` from `kixx/assertions/mod.js` already excludes arrays and `null`, so no extra type check was needed beyond it for manifest-shape validation.
- Actual files changed:
  - `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`
  - `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`
  - `test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js`
  - `test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js`
- Validation run:
  - `node run-linter.js src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js src/plugins/node-hyperview-template-file-store/lib/template-file-store.js test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` — clean.
  - `node run-tests.js test/unit-tests/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.test.js test/unit-tests/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js` — 89/89 passed.
  - `rg -n "list\(" src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js` — confirmed `list()` is reachable only from the un-namespaced fallback (`#loadPrefixedFiles`).
  - `rg -n "putPartial\(" src test/unit-tests --glob '*.js'` — only `src/app/transaction-scripts/publishing/put-template.js` and its test remain, both owned by BPTM-3.
  - `node run-tests.js test/unit-tests/plugins/node-hyperview-template-file-store/plugin.test.js` — unaffected, still passes (no references to the removed method).
- Blockers: None.

### Task BPTM-3: Replace the per-file partial Publishing API with complete-set JSON:API publication

**Status:** Complete
**Depends on:** BPTM-1
**Documentation:** `src/app/presentation/README.md`; `src/app/transaction-scripts/README.md`; `src/docs/server-error-handling.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `test/unit-tests/README.md`

**Objective**

Expose one authenticated, validated, idempotent collection `PUT` that publishes every partial for a staged build and remove every application path that publishes an individual partial.

**Scope**

- In: Add the batch Form, handler, and transaction script; register the exact optional-trailing-slash route; reuse template authorization; narrow the existing single-template workflow to base/page; remove the wildcard partial route and handler export; add and update unit tests.
- Out: Adapter storage details, new permissions, a build-finalization endpoint, a public API guide, deployment orchestration code, and E2E execution.

**Design and invariants**

- Route: `PUT /publishing-api/v1/templates/partials{/}`. It must be ordered so the exact collection route cannot be shadowed by broader template or catch-all routes.
- Authorization remains action `urn:kixx:publishing:template:put` on resource `urn:kixx:publishing:template`.
- Require `Content-Type: application/vnd.api+json` through the existing JSON:API helper.
- Require `Content-Length` before consuming the body. Missing uses `BadRequestError` with `httpStatusCode: 411` and code `ContentLengthRequired`; values containing anything other than ASCII decimal digits are malformed (`400`); values above `25 * 1024 * 1024` bytes are `PayloadTooLargeError` (`413`). After the fast header check, buffer through `bufferRequestBodyWithLimit()` so the actual bytes consumed are authoritative and an understated declaration cannot bypass the cap. Decode the bounded bytes as UTF-8 and translate malformed JSON into the same `BadRequestError` contract as `request.json()`.
- Request resource type is `PartialTemplateSet`. `data.id` is optional; when present it must equal `partials/<Kixx-Build-Id>` or produce the existing JSON:API conflict style.
- `attributes.partials` is required and must be an array. `[]` is a valid complete empty set. Unknown attributes and entry properties are ignored.
- Each entry requires `filepath` and `source`. Filepaths are relative to the partial prefix, are not trimmed, and are validated with the same safe-path rules as the retired wildcard route before being folded to lower case. Leading, trailing, and doubled slashes are rejected. A leading literal `partials/` is not stripped and therefore represents a nested relative path.
- Sources must be non-empty strings, are not trimmed, and are passed through after JSON decoding. Whitespace-only sources remain allowed under the existing non-empty-string rule.
- Validate the full batch before calling the transaction script. Detect duplicates after normalization and report all applicable field errors through `ValidationError`, using stable nested sources such as `partials[2].filepath`.
- A dedicated API-only Form owns payload normalization and field validation. A dedicated `publishing/put-partials.js` transaction script owns Build ID input/domain errors and delegates to `HyperviewService.putPartials()` once. Expected adapter infrastructure failures must arrive as an expected `OperationalError` (or a more specific expected project error), and the script may translate them to a publishing-specific `OperationalError` while preserving the original error as `cause`. Assertion-library errors, the project `AssertionError`, and native programmer errors such as `TypeError`, `ReferenceError`, and `SyntaxError` must propagate unchanged; the script must not use a catch-all wrapper.
- Build ID rules match existing template writes: required, valid, non-reserved, and different from the current runtime Build ID. Sequential replacement while staged is allowed.
- Remove `partial` from the existing single-template kind set and remove its handler/export/route. Base and page behavior is unchanged.
- Success is `200 application/vnd.api+json` with type `PartialTemplateSet`, id `partials/<buildId>`, and attributes `{ buildId, partials: [{ filepath }, ...] }`. Paths are kind-relative, normalized, submitted-order references; sources and a redundant count are omitted.

**Expected touch points**

- `src/app/presentation/forms/templates/put-partials-form.js` — own JSON:API batch normalization, validation, duplicate detection, and serialization to service inputs.
- `src/app/presentation/request-handlers/publishing-api/put-partials.js` — enforce media type and declared size, parse the resource, validate optional identity, invoke the transaction script, and format the summary response.
- `src/app/transaction-scripts/publishing/put-partials.js` — enforce staged Build ID rules, translate only recognized expected operational write failures with `cause`, and allow programmer/invariant errors to propagate unchanged.
- `src/app/presentation/request-handlers/publishing-api/put-template.js` — remove the partial handler and retain only base/page single-file behavior.
- `src/app/transaction-scripts/publishing/put-template.js` — narrow supported kinds to base/page and remove single-partial delegation.
- `src/app/presentation/request-handlers/publishing-api/mod.js` — export the batch handler and remove the single-partial export.
- `src/routes/publishing-api-v1.js` — replace the partial wildcard target with the complete-set route and reuse `requireTemplatePermission`.
- `test/unit-tests/app/presentation/forms/templates/put-partials-form.test.js` — cover shape validation, empty input, unknown fields, exact source preservation, path normalization/rejection, and normalized duplicates.
- `test/unit-tests/app/presentation/request-handlers/publishing-api/put-partials.test.js` — cover media type, strict Content-Length syntax and statuses, declared and actual-byte caps, JSON:API type/id, authorization assumptions, handler delegation, and response shape.
- `test/unit-tests/app/transaction-scripts/publishing/put-partials.test.js` — cover Build ID rules, one service call, empty sets, result mapping, recognized operational failure translation with preserved cause, and unchanged propagation of assertion and native programmer errors.
- Existing `put-template` handler and transaction-script unit tests — remove partial cases while proving base/page behavior remains unchanged.
- Route or authorization unit tests, if existing coverage requires updates — prove the new route retains the existing coarse template permission.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The only partial publishing route accepts a complete JSON:API set at `/templates/partials` with an optional trailing slash.
- [ ] The handler rejects missing/malformed/oversized declared lengths before body consumption, rejects an understated body when streamed bytes cross the cap, and uses the agreed 411/400/413 errors.
- [ ] The Form accepts empty sets, preserves sources, normalizes safe paths, rejects empty segments, and rejects post-normalization collisions without partial writes.
- [ ] Optional `data.id` is checked against `partials/<buildId>` and the success response uses that same identity with normalized source-free references.
- [ ] The batch transaction script and Hyperview service forbid writes to the live build and allow sequential staged replacements.
- [ ] No application route, handler, transaction script, or service retains single-partial publication.
- [ ] Base and page template publishing remains behaviorally unchanged.
- [ ] Unit tests cover all success and error branches described above.

**Validation**

- `node run-linter.js src/app/presentation/forms/templates/put-partials-form.js src/app/presentation/request-handlers/publishing-api/put-partials.js src/app/presentation/request-handlers/publishing-api/put-template.js src/app/transaction-scripts/publishing/put-partials.js src/app/transaction-scripts/publishing/put-template.js src/app/presentation/request-handlers/publishing-api/mod.js src/routes/publishing-api-v1.js test/unit-tests/app/presentation/forms/templates/put-partials-form.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-partials.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-template.test.js test/unit-tests/app/transaction-scripts/publishing/put-partials.test.js test/unit-tests/app/transaction-scripts/publishing/put-template.test.js` — validates the Publishing API implementation and unit tests.
- `node run-tests.js test/unit-tests/app/presentation/forms/templates/put-partials-form.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-partials.test.js test/unit-tests/app/presentation/request-handlers/publishing-api/put-template.test.js test/unit-tests/app/transaction-scripts/publishing/put-partials.test.js test/unit-tests/app/transaction-scripts/publishing/put-template.test.js` — proves payload, workflow, and retained base/page behavior.
- `rg -n "putPartialTemplate|putPartial\\(" src/app src/routes --glob '*.js'` — must return no retired application publishing path.

**Progress and handoff**

- Completed:
  - **`src/app/presentation/forms/templates/put-partials-form.js`** (new, API-only form): `PutPartialsForm` normalizes each `{filepath, source}` entry (fold `filepath` to lower case only when it already passes the safe-path check; `source` is never touched), preserves invalid input for `validate()`, and validates: overall `partials` array shape, per-entry safe/non-empty `filepath` (reusing `isValidPathname()` from `kixx/utils/validate-pathname.js` plus a local empty-path-segment check for leading/trailing/doubled slashes, since JSON:API input arrives as one string rather than pre-split route segments), non-empty `source`, and post-normalization duplicate `filepath` collisions — reporting every applicable error via `ValidationError` with sources like `partials[2].filepath`. `toJSON()` returns `{ partials }`. `fromJsonApi(resource)` reads `resource.attributes`.
  - **`src/app/presentation/lib/json-api.js`** (refactored, not just extended): split `parseJsonApiResource(request, expectedType)` into a thin wrapper around a new exported `resourceFromJsonApiDocument(document, expectedType)`, which owns the actual JSON:API envelope validation (data object, `type`, `attributes`). This lets the new handler decode its own size-capped, buffered body and still reuse the exact same envelope-validation contract instead of duplicating it. `parseJsonApiResource()`'s external behavior/signature is unchanged, and its own error-shape is verified by the full unit suite (1505/1505 passing) since several other handlers depend on it.
  - **`src/app/presentation/request-handlers/publishing-api/put-partials.js`** (new handler): calls `assertJsonApiContentType()`, then a local `assertDeclaredContentLength()` that requires `Content-Length` (`BadRequestError`, `httpStatusCode: 411`, `code: 'ContentLengthRequired'` when missing; `code: 'ContentLengthInvalid'`/400 when it contains anything other than `^[0-9]+$`; `PayloadTooLargeError`/413 when the declared value exceeds `25 * 1024 * 1024`) — all before touching the body. It then calls the existing `bufferRequestBodyWithLimit()` (unchanged, already enforces the same cap against actually-streamed bytes, so an understated declaration still gets caught), decodes the buffered bytes with a fatal UTF-8 `TextDecoder` + `JSON.parse` inside a try/catch that rethrows as `BadRequestError('Invalid JSON in request body', { cause })` (matching `ServerRequestInterface#json()`'s exact message), parses the resource via `resourceFromJsonApiDocument(document, 'PartialTemplateSet')`, checks an optional `data.id` against `partials/<buildId>` (`ConflictError`, `code: 'JsonApiResourceIdMismatch'` on mismatch), builds and validates a `PutPartialsForm`, calls the new transaction script, and responds `200` with `{ type: 'PartialTemplateSet', id: 'partials/<buildId>', attributes: { buildId, partials: written } }` — `written` entries carry only `{ filepath }` (no `source`), so sources are never echoed back.
  - **`src/app/transaction-scripts/publishing/put-partials.js`** (new script): validates `buildId` is present/valid/non-reserved and differs from the current runtime build id (`BadRequestError`/`ConflictError`, mirroring `put-template.js`'s existing rules), then delegates once to `context.getService('Hyperview').putPartials(context, buildId, partials)`. Unlike `put-template.js`'s catch-all `try { } catch (cause) { throw new AssertionError(...) }`, this script's catch checks `cause.expected` and only translates *expected* failures (`OperationalError`, or any error with `expected: true`) into a publishing-specific `OperationalError` with `cause` preserved; anything else (an `AssertionError`, `TypeError`, etc.) rethrows unchanged, per the plan's explicit "must not use a catch-all wrapper" instruction for this script.
  - **`src/app/presentation/request-handlers/publishing-api/put-template.js`**: removed `putPartialTemplate` (and the `'partial'` call to `createPutTemplateHandler`); updated the shared JSDoc block to describe only base/page and point to `put-partials.js` for partials.
  - **`src/app/transaction-scripts/publishing/put-template.js`**: `TEMPLATE_KINDS` narrowed to `Set(['base', 'page'])`; removed the `service.putPartial(...)` branch; updated JSDoc (`@param {'base'|'page'}`, updated assertion message to "kind must be base or page").
  - **`src/app/presentation/request-handlers/publishing-api/mod.js`**: exports `putBaseTemplate, putPageTemplate` (dropped `putPartialTemplate`) and adds `export { putPartials } from './put-partials.js'`.
  - **`src/routes/publishing-api-v1.js`**: replaced the `/templates/partials/*filepath` wildcard route with `PUT /templates/partials{/}` (exact collection route, optional trailing slash, reuses `Permissions.requireTemplatePermission`), wired to `PublishingAPI.putPartials`.
  - **Tests**: added `test/unit-tests/app/presentation/forms/templates/put-partials-form.test.js` (11 tests: empty set, source preserved untrimmed, case-folding, unknown-field stripping, shape/missing-field/traversal/leading-trailing-doubled-slash/disallowed-character rejection, multi-error reporting, post-normalization duplicate detection); `test/unit-tests/app/presentation/request-handlers/publishing-api/put-partials.test.js` (18 tests, modeled on the existing `put-static-asset.test.js` streaming-body pattern: successful write/response shape, empty-set, `data.id` match/mismatch, resource-type mismatch, media-type rejection, all three Content-Length failure modes including a real `MAX_PARTIALS_BYTES + 1`-byte body for the understated-length/streaming-cap case, malformed-JSON body, Form-validation rejection, build-id rules); `test/unit-tests/app/transaction-scripts/publishing/put-partials.test.js` (9 tests: build-id rules, single delegation with submitted-order-preserving result, empty set, first-deploy-without-current-build, expected-failure→`OperationalError` translation with preserved `cause`, and unchanged propagation of both an `AssertionError`-named error and a native `TypeError`). Updated the existing `put-template.js` handler and transaction-script tests to drop the `'partial'` kind/`putPartial`/`putPartialTemplate` scenarios (rewired the "current build" and "nested segments" cases onto `page`/`putPageTemplate` instead, since removing `partial` outright would have deleted meaningful coverage) — 17 and 8 tests respectively, all still green.
- Current state: Complete. All acceptance criteria met.
- Remaining: None for this task.
- Decisions and discoveries: Existing Forms ignore fields they do not own; the batch Form follows that convention. The project has no dedicated 411 error class, so the handler uses a scoped `BadRequestError` status override (`httpStatusCode: 411`), which `WrappedError`'s constructor supports directly via `options.httpStatusCode`. Refactoring `parseJsonApiResource()` into a thin wrapper over the new `resourceFromJsonApiDocument()` was necessary (not just convenient) because the handler must buffer the body itself to enforce the byte cap before any JSON parsing happens — it cannot call `request.json()` a second time after `bufferRequestBodyWithLimit()` has already consumed the one-shot body stream. This is a pure refactor with no behavior change to `parseJsonApiResource()`'s existing signature/contract, confirmed by the full unit suite passing unchanged.
- Actual files changed:
  - `src/app/presentation/forms/templates/put-partials-form.js` (new)
  - `src/app/presentation/request-handlers/publishing-api/put-partials.js` (new)
  - `src/app/transaction-scripts/publishing/put-partials.js` (new)
  - `src/app/presentation/lib/json-api.js`
  - `src/app/presentation/request-handlers/publishing-api/put-template.js`
  - `src/app/transaction-scripts/publishing/put-template.js`
  - `src/app/presentation/request-handlers/publishing-api/mod.js`
  - `src/routes/publishing-api-v1.js`
  - `test/unit-tests/app/presentation/forms/templates/put-partials-form.test.js` (new)
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/put-partials.test.js` (new)
  - `test/unit-tests/app/transaction-scripts/publishing/put-partials.test.js` (new)
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/put-template.test.js`
  - `test/unit-tests/app/transaction-scripts/publishing/put-template.test.js`
- Validation run:
  - `node run-linter.js <all files listed above>` — clean.
  - `node run-tests.js <all new/changed test files listed above>` — 63/63 passed.
  - `rg -n "putPartialTemplate|putPartial\(" src/app src/routes --glob '*.js'` — no matches (exit 1).
  - `node run-tests.js` (full repo unit suite) — 1505/1505 passed, confirming the `json-api.js` refactor and route change did not regress any other caller.
  - `git diff --check` — clean.
- Blockers: None.

### Task BPTM-4: Complete repository-wide unit verification and stale-contract cleanup

**Status:** Complete
**Depends on:** BPTM-2, BPTM-3
**Documentation:** `test/unit-tests/README.md`; root `README.md` development commands

**Objective**

Verify the new batch contract and adapter replacement semantics through unit tests, remove stale executable references to the retired endpoint, and validate all changed JavaScript without contacting or starting a deployment target.

**Scope**

- In: Perform a repository-wide production and unit-test stale-reference audit; remove or update stale unit-test fixtures and doubles; run linting and the full unit suite; verify complete replacement in adapter unit tests; record that existing E2E files remain unchanged and the E2E suite was intentionally not run.
- Out: Editing or running E2E tests, starting the development server, calling a remote server, installing dependencies, adding a migration/backfill, or creating a new API documentation guide.

**Design and invariants**

- Complete replacement, including omitted-file removal, is an adapter-unit-test responsibility. Node tests inspect the resulting namespace directory; Cloudflare tests inspect and reread the replaced manifest while proving legacy keys have no effect.
- Handler, Form, transaction-script, service, and route unit tests own the JSON:API success and error contract, including authentication middleware placement, strict and understated `Content-Length`, malformed JSON:API, identity conflicts, invalid entries, normalized duplicates, Build ID rules, and empty replacement.
- Existing partial-template E2E files remain unchanged even though they describe the retired endpoint. They are outside this plan and must not be treated as executable acceptance coverage for the new contract.
- Final verification runs the linter for every changed JavaScript file and the complete unit suite. It also runs `git diff --check` and a stale-symbol search scoped to production and unit-test JavaScript.

**Expected touch points**

- All files changed by BPTM-1 through BPTM-3 — include them in final linting and stale-reference review.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Adapter unit tests prove complete replacement, omitted-file removal, empty replacement, and missing-set behavior for both storage representations.
- [ ] Existing E2E files are unchanged and the final handoff records that they still describe the retired endpoint and were intentionally neither updated nor run.
- [ ] No production or unit-test reference to the retired `putPartial()`/`putPartialTemplate` contract remains; existing E2E and historical implementation-plan references are explicitly excluded from this audit.
- [ ] All changed JavaScript passes linting.
- [ ] The complete unit suite passes.
- [ ] No whitespace errors remain.

**Validation**

- `node run-linter.js <every changed JavaScript pathname>` — validates every source and unit-test JavaScript file changed by the implementation.
- `node run-tests.js` — runs the complete unit suite and proves cross-module compatibility.
- `git diff --check` — detects whitespace errors in the complete patch.
- `rg -n "putPartialTemplate|putPartial\\(|templates/partials/\\*filepath" src test/unit-tests --glob '*.js'` — confirms removal of the retired production and unit-test contract without treating unchanged E2E files as in scope.
- E2E editing and execution: intentionally omitted by explicit user instruction.

**Progress and handoff**

- Completed:
  - Confirmed adapter unit tests already prove complete replacement, omitted-file/key removal, empty-set publication, and missing-set failure for both storage representations (delivered as part of BPTM-2; re-verified here rather than re-implemented, since that's where the two storage encodings are directly observable).
  - Ran a repository-wide stale-reference audit: `rg -n "putPartialTemplate|putPartial\(" src/app src/routes --glob '*.js'` (BPTM-3's own check) and the broader `rg -n "putPartialTemplate|putPartial\(|templates/partials/\*filepath" src test/unit-tests --glob '*.js'` (this task's check, covering all of `src/` and `test/unit-tests/`, not just the publishing API) — both returned no matches. No stale unit-test fixtures or doubles remained to remove or update beyond what BPTM-1/BPTM-2/BPTM-3 already handled inline.
  - Confirmed via `git status --short` that no file under `test/end-to-end/` was touched by this implementation; `test/end-to-end/020-publishing-api/put-partial-template.test.js`, `put-partial-template-errors.test.js`, and `test/end-to-end/fixtures/publishing-api/partial-template.html` remain exactly as they were, still describing the retired per-file endpoint. They are explicitly out of scope and were not treated as executable acceptance coverage for the new contract.
  - Ran the linter over the complete set of files changed across BPTM-1 through BPTM-3 (18 files: 5 new, 13 modified) — clean.
  - Ran the complete unit suite (`node run-tests.js`, no path arguments) — 1505/1505 tests passed, confirming no cross-module regression (including from the `json-api.js` refactor in BPTM-3, which other handlers besides the new one depend on).
  - Ran `git diff --check` — no whitespace errors.
  - Noted one pre-existing, unrelated uncommitted change in `AGENTS.md` (a `test/unit/README.md` → `test/unit-tests/README.md` path-typo fix) that predates this session's work; left untouched since it is not part of this plan.
- Current state: Complete. All acceptance criteria met.
- Remaining: None for this task. The plan's four tasks are all complete.
- Decisions and discoveries: Existing E2E coverage remains unchanged and continues to describe the retired endpoint. Complete replacement is proven at the adapter boundary, where both storage representations are directly observable. The full-suite run (1505 tests) is the strongest signal that the `json-api.js` refactor (splitting `parseJsonApiResource()` into a thin wrapper over `resourceFromJsonApiDocument()`) did not change behavior for any of its other callers.
- Actual files changed: None (verification-only task; no source or test edits were needed).
- Validation run:
  - `node run-linter.js <all 18 files changed by BPTM-1–BPTM-3>` — clean.
  - `node run-tests.js` (full suite, no path arguments) — 1505/1505 passed.
  - `git diff --check` — clean.
  - `rg -n "putPartialTemplate|putPartial\(|templates/partials/\*filepath" src test/unit-tests --glob '*.js'` — no matches.
  - `git status --short` — confirmed no `test/end-to-end/` file is part of the change set.
  - E2E editing and execution: intentionally omitted per explicit user/plan instruction; not run.
- Blockers: The external deployment/publishing tooling repository and owner must be identified, and its serialization/deploy-ordering prerequisite verified, before rollout. This is unchanged from earlier tasks and is outside this repository's scope — it does not block any work performed by this plan, only production rollout of the new contract.
