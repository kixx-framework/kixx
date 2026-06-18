# Hyperview Template Upload Handlers Plan

## Implementation Approach

Add framework-provided request handlers that publish Hyperview templates by
calling the new `HyperviewService.put*` write methods. The transport is a
RESTful `PUT` whose URL *is* the store's logical address — `buildId` and the
template filepath come from the route's path params (a `:buildId` named param
and a `*path` wildcard), and the raw request body is the template source. To
read that raw body without a handler reaching into the `ReadableStream`, we add
a `text()` body reader to the `ServerRequestInterface` contract and both adapters
(Node and Cloudflare), mirroring the existing `json()`/`formData()` conveniences;
this is the one dependency story the raw-body design requires. A single factory
`HyperviewTemplateUploadHandler({ templateType })` is parameterized by template
type (`base` | `page` | `partial`) and validated at factory time, so the three
near-identical handlers are not triplicated; the application registers it on three
routes. The handler is the HTTP boundary for the build-id rule: it translates a
`buildId` equal to the current (live) build id into a `409 ConflictError`, leaving
the service's `AssertionError` as a defense-in-depth backstop, and it rejects an
empty body or an unsafe filepath with `400 BadRequestError`. Authentication is out
of scope and handled by upstream middleware; route wiring is the application's
responsibility, consistent with the existing page handler factories.

- [x] **Extract a shared pathname-safety validator**
  - **Story**: Both the page handlers and the new upload handlers reject unsafe paths (`..`, `//`, leading-dot or disallowed-character segments) through one validator, so the security rule is not duplicated or allowed to drift.
  - **What**: Move the module-private `validatePathname` and its `DISALLOWED_STATIC_PATH_CHARACTERS` constant out of `hyperview-request-handlers.js` into a small shared module that exports `validatePathname(pathname)` (throws `BadRequestError` on an unsafe path, returns the pathname otherwise). Update `hyperview-request-handlers.js` to import and use it, removing the local copies. Behavior must be unchanged for the page handlers.
  - **Where**: New `src/kixx/hyperview/validate-pathname.js`; edit `src/kixx/hyperview/hyperview-request-handlers.js`
  - **Documentation**: `src/kixx/hyperview/hyperview-request-handlers.js` (existing `validatePathname`), `docs/code-quality.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: `validatePathname` lives in one module, is imported by the page handlers, and still throws `BadRequestError` for `..`, `//`, leading-dot segments, and disallowed characters while returning safe pathnames unchanged.
  - **Depends on**: none

- [x] **Add `text()` to the ServerRequestInterface contract**
  - **Story**: Middleware and request handlers can read a request's raw body as UTF-8 text through the request interface, consistently with `json()` and `formData()`.
  - **What**: Document a `text()` method on `ServerRequestInterface`: add it to the "Application conveniences" list, add an invariant stating it MUST read the body as UTF-8 text and MUST reject with `BadRequestError` when the body cannot be read (mirroring the `json()` invariant), and add the `@property {function(): Promise<string>} text` entry to the typedef. No executable code.
  - **Where**: `src/kixx/http-router/server-request-interface.js`
  - **Documentation**: `src/kixx/http-router/server-request-interface.js` (existing `json`/`formData` docs), `docs/code-documentation-guide.md`
  - **Acceptance criteria**: The interface documents `text()` returning `Promise<string>`, lists it as an application convenience, and states the `BadRequestError`-on-failure invariant.
  - **Depends on**: none

- [x] **Implement `text()` in the Node server-request adapter**
  - **Story**: A Node.js application can read a request's raw body as text through the request interface.
  - **What**: Add an `async text()` method to the Node `ServerRequest` that returns `await this.#request.text()`, catching any failure and rethrowing as `BadRequestError('Request body could not be read as text', { cause }, this.text)` — the same shape as the adapter's existing `json()`. Document it with `@returns {Promise<string>}` and `@throws {BadRequestError}`.
  - **Where**: `src/kixx/node/http-router/server-request.js`
  - **Documentation**: `src/kixx/node/http-router/server-request.js` (existing `json()` method), `src/kixx/http-router/server-request-interface.js`
  - **Acceptance criteria**: `text()` resolves to the body string and rejects with `BadRequestError` on read failure, matching the adapter's `json()` error handling.
  - **Depends on**: Add `text()` to the ServerRequestInterface contract

- [x] **Implement `text()` in the Cloudflare server-request adapter**
  - **Story**: A Cloudflare Workers application can read a request's raw body as text through the request interface.
  - **What**: Add an `async text()` method to the Cloudflare `ServerRequest` that returns `await this.#nativeRequest.text()`, catching any failure and rethrowing as `BadRequestError('Request body could not be read as text', { cause }, this.text)` — the same shape as the adapter's existing `json()`. Document it with `@returns {Promise<string>}` and `@throws {BadRequestError}`.
  - **Where**: `src/plugins/cloudflare-server-request/lib/server-request.js`
  - **Documentation**: `src/plugins/cloudflare-server-request/lib/server-request.js` (existing `json()` method), `src/kixx/http-router/server-request-interface.js`
  - **Acceptance criteria**: `text()` resolves to the body string and rejects with `BadRequestError` on read failure, matching the adapter's `json()` error handling.
  - **Depends on**: Add `text()` to the ServerRequestInterface contract

- [x] **Add the HyperviewTemplateUploadHandler factory**
  - **Story**: Deploy tooling can `PUT` a base, page, or partial template's raw source to a target build, writing it under that build's namespace, while an attempt to write the live build returns `409` and a malformed request returns `400`.
  - **What**: Add a new module exporting `HyperviewTemplateUploadHandler(options)`. At factory time, read `options.templateType` and assert it is one of `'base'`, `'page'`, `'partial'` (`AssertionError` otherwise); select the matching service method name (`putBaseTemplate` / `putPageTemplate` / `putPartial`). Return an `async function hyperviewTemplateUploadHandler(context, request, response)` that: (1) reads `buildId` from `request.pathnameParams.buildId` and the filepath from the `*path` wildcard param (an array of segments), joining the segments with `/`; (2) validates the joined filepath with the shared `validatePathname` helper and rejects an empty filepath with `BadRequestError`; (3) reads `const source = await request.text();` and rejects an empty/whitespace-only body with `BadRequestError('Template source must not be empty')`; (4) compares `buildId` against the current build id (`context.runtime.build?.id`) and throws `ConflictError` (409) with a clear message when they are equal — translating the live-build write attempt at the HTTP boundary so the service's `AssertionError` stays a backstop; (5) resolves the Hyperview service via `context.getService('Hyperview')` and calls the selected put method as `service[methodName](context, buildId, filepath, source)`; and (6) responds `200` with `response.respondWithJSON(200, ref, { whiteSpace: 4 })` where `ref` is the store's `{ filepath }` result. Document the factory and its `options.templateType`, the URL/param contract, the `Promise`-returning handler signature (matching the page handler factories), and the `@throws` conditions (`ConflictError`, `BadRequestError`). Do not add authentication — note in the JSDoc that the route must be composed with an upstream auth guard. Note that when no current build exists the service rejects with `AssertionError` (a 500), per the prior decision that template writes require a current build.
  - **Where**: New `src/kixx/hyperview/hyperview-upload-handlers.js`
  - **Documentation**: `src/kixx/hyperview/hyperview-request-handlers.js` (factory/handler idiom), `src/kixx/hyperview/hyperview-service.js` (`put*` methods), `src/kixx/http-router/server-request-interface.js` (`pathnameParams`, `text()`), `src/kixx/http-router/server-response.js` (`respondWithJSON`), `src/kixx/errors/mod.js` (`ConflictError`, `BadRequestError`), `docs/code-quality.md`, `docs/code-documentation-guide.md`
  - **Acceptance criteria**: A valid `PUT` to a non-current build writes the raw body via the correct `put*` method using `buildId` as the namespace and responds `200` with the logical `{ filepath }`; `buildId` equal to the current build id yields `409`; an empty body or unsafe/empty filepath yields `400`; an invalid `templateType` throws `AssertionError` at factory time; nested page template filepaths are supported via the wildcard.
  - **Depends on**: Extract a shared pathname-safety validator; Add `text()` to the ServerRequestInterface contract

- [x] **Run source linting**
  - **Story**: The implementation follows project JavaScript style and lint rules.
  - **What**: Run the linter on the changed and new source files and fix any reported errors. Do not run tests unless explicitly asked.
  - **Where**: `node run-linter.js src/kixx/hyperview src/kixx/http-router/server-request-interface.js src/kixx/node/http-router/server-request.js src/plugins/cloudflare-server-request`
  - **Documentation**: `docs/code-style-guide.md`, `AGENTS.md`
  - **Acceptance criteria**: Linting exits 0 for the changed and new source files.
  - **Depends on**: Add the HyperviewTemplateUploadHandler factory

- [ ] **Add approval-gated unit coverage**
  - **Story**: Maintainers can verify the upload handler's routing-param handling, build-id conflict translation, validation, and delegation, plus the new `text()` readers.
  - **What**: Only if explicitly approved, add focused tests. For the handler: use a mock Hyperview service and a `context` whose `runtime.build.id` is set, plus a mock `request` exposing `pathnameParams` and `text()`; cover the happy path (correct `put*` method, `buildId` namespace, source passthrough, `200` + `{ filepath }`), the `409` on a current-build write, the `400` on empty body and on unsafe/empty filepath, and the factory-time `AssertionError` for a bad `templateType`. For the adapters: cover `text()` resolving to the body string and rejecting with `BadRequestError` on read failure. Only write or run tests after the user explicitly asks for test work.
  - **Where**: `test/kixx/hyperview/hyperview-upload-handlers.test.js`; extend the existing Node/Cloudflare server-request tests if present
  - **Documentation**: `docs/unit-testing-guide.md`, `src/kixx/hyperview/hyperview-upload-handlers.js`
  - **Acceptance criteria**: Tests exercise the handler and `text()` readers against mocks without external services, and are only added or run after explicit user approval.
  - **Depends on**: Add the HyperviewTemplateUploadHandler factory
