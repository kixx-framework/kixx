# Hyperview Rendering Boundary

## Implementation Approach

Move Hyperview page rendering behind one presentation facade while separating
transport concerns from `HyperviewService`. Normal route targets end with
`HyperviewPageHandler`; error handlers and other terminal presentation code call
the facade directly. Both paths therefore share option precedence, client render
mode selection, service lookup, and response commitment.

This is a breaking migration. Backward compatibility is a non-goal:

- `HyperviewService#respondWithHypertext()` will be deleted without a wrapper.
- `HyperviewService` will be the only registry name; `Hyperview` will be removed.
- `baseTemplate` in `page.json` and response props is deprecated and removed.
  Full-document rendering reads `baseTemplateId` only from rendering options.
- `response.props` remains template context only. Rendering control travels
  through `ServerResponse#setRenderingOptions()` and facade arguments.

The work is deliberately staged. The facade initially delegates to the current
`respondWithHypertext()` implementation so the response API and application
callers can migrate independently. The final task replaces that internal call
with transport-neutral `renderPage()` and deletes the old service method. If
work stops between tasks, all application rendering still passes through the
new facade; only its private service integration remains to be replaced.

The stable ownership boundaries are:

- `ServerResponse` owns request-scoped template props and a separate rendering
  option bag.
- The presentation facade owns request headers, option precedence, service
  lookup, response status/headers/content type, JSON serialization, and response
  commitment.
- `HyperviewService#renderPage()` owns content snapshots, page assembly,
  template compilation, render-mode output, and rendered-page/template caches.
- Route configuration owns the base template ID. Published page data and
  runtime template props cannot select the base template.

`setRenderingOptions(options)` replaces its option bag with a shallow copy and
returns the response. Replacement lets an error renderer discard rendering
state left by the failed request. A shallow copy preserves valid non-cloneable
option values such as `propsHashFunction` and `Headers`. Facade option precedence
is route/caller defaults, then `response.renderingOptions`, then client-selected
`kixx-partial` and `kixx-boosted` modes.

The final `renderPage(context, options)` API receives a `URL`, plain template
props, page/render/cache options, and no HTTP request or response object. It
returns one of these results:

```js
{ type: 'hypertext', hypertext }
{ type: 'page-context', pageContext }
```

Explicit `.json` requests remain a `renderPage()` responsibility because the
service already owns the configured `allowJsonResponse` policy and pathname
normalization. The facade serializes a `page-context` result; it never asks the
service to mutate a response. A page-context result does not require
`baseTemplateId`, because no base template is rendered.

This plan supersedes tasks HV-1 through HV-3 in
`agents/plans/admin-users-handler-issues.md`. The unrelated ADMIN tasks in that
plan remain valid.

No task installs dependencies, runs the development server, or adds end-to-end
tests.

### Task HVR-1: Separate rendering options from template props

**Status:** Not started
**Depends on:** None
**Documentation:** `src/app/presentation/README.md` ServerResponse section;
`src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`;
`test/unit-tests/README.md`

**Objective**

Give `ServerResponse` a dedicated request-scoped rendering option channel so
presentation handlers can control Hyperview without placing framework control
data in the template context or page-context JSON response.

**Scope**

- In: a private rendering option bag, a read accessor, and
  `ServerResponse#setRenderingOptions(options)`.
- In: unit tests and ServerResponse presentation documentation.
- Out: changing Hyperview callers to use the new channel; HVR-2 owns that
  migration.
- Out: changing `updateProps()` merge and clone semantics.

**Design and invariants**

- A new response starts with empty `renderingOptions` independently of empty
  `props`.
- `setRenderingOptions(options)` requires a plain object, replaces the complete
  existing option bag with a shallow copy, and returns `this`.
- Repeated calls replace rather than merge. Callers can set `{}` to discard stale
  state before rendering another representation, especially an error page.
- Do not use `structuredClone()` for rendering options. Functions such as
  `propsHashFunction`, `Headers`, and other option values accepted by the
  rendering path must remain usable.
- The accessor exposes only rendering options; `updateProps()` never writes to
  it, and `setRenderingOptions()` never writes to `props`.
- Document the mutation, replacement, shallow-copy, and chaining contracts in
  JSDoc.

**Expected touch points**

- `src/kixx/http-router/server-response.js` — rendering option state and public
  API.
- `test/unit-tests/kixx/http-router/server-response.test.js` — constructor,
  replacement, copying, non-cloneable value, validation, and chaining coverage.
- `src/app/presentation/README.md` — document the second response data channel
  and when to use it.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A new response exposes empty, independent `props` and
      `renderingOptions` objects.
- [ ] `setRenderingOptions()` replaces prior values, shallow-copies its input,
      and returns the response.
- [ ] A rendering option containing a function can be stored without a clone
      error.
- [ ] A non-plain option bag fails as an internal contract violation.
- [ ] Rendering options never appear in `response.props`.
- [ ] The public API and presentation documentation state the replacement
      semantics.

**Validation**

- `node run-linter.js src/kixx/http-router/server-response.js test/unit-tests/kixx/http-router/server-response.test.js` — validates all JavaScript changed by this task.
- `node run-tests.js test/unit-tests/kixx/http-router/server-response.test.js` — proves the ServerResponse contract.
- Read-through: confirm the presentation guide distinguishes template props from
  rendering options.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Rendering options use replacement and a shallow
  copy so error handlers can reset state and callable cache options remain valid.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

### Task HVR-2: Introduce the shared Hyperview presentation facade

**Status:** Not started
**Depends on:** HVR-1
**Documentation:** `src/app/presentation/README.md` Request Handlers and
Rendering sections; `src/plugins/README.md`; `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `test/unit-tests/README.md`

**Objective**

Provide one directly callable presentation function that applies Hyperview HTTP
policy, and make `HyperviewPageHandler` a thin route adapter over it. Rendering
options no longer travel through `response.props`, and the registered service is
consistently named `HyperviewService`.

**Scope**

- In: a presentation facade under `src/app/presentation/lib/`.
- In: `HyperviewPageHandler` delegation and rendering-option migration.
- In: renaming the registered service from `Hyperview` to
  `HyperviewService` in the general plugin and tests.
- In: focused facade and handler unit tests and associated presentation/plugin
  documentation.
- Out: migrating legacy route and error-handler imports; HVR-3 owns those
  callers.
- Out: extracting `renderPage()`; during this task only, the facade delegates to
  `respondWithHypertext()`.

**Design and invariants**

- Export an async facade named `respondWithHyperviewPage` from a clearly named
  module such as
  `src/app/presentation/lib/respond-with-hyperview-page.js`.
- The facade accepts `(context, request, response, defaultOptions)` so it can be
  called directly with the same request lifecycle objects as a request handler.
- It creates a fresh shallow option bag per invocation. Route/caller defaults
  are applied first, `response.renderingOptions` second, and request headers
  last.
- `kixx-partial` supplies `partial`; `kixx-boosted` enables
  `skipBaseRender`. Header behavior remains centralized in the facade.
- The facade retrieves `context.getService('HyperviewService')`. There is no
  registry alias and no remaining in-repository lookup of `Hyperview`.
- During this staged task, the facade passes the merged options to
  `respondWithHypertext()` and returns its response. HVR-4 replaces this
  implementation without changing callers.
- `HyperviewPageHandler(defaultOptions)` does nothing except return a handler
  which delegates to the facade. It does not independently inspect headers,
  services, props, or rendering options.
- Remove every read of `response.props.hyperviewOptions`. Dynamic render control
  uses `response.setRenderingOptions()`.
- Do not deep-clone defaults or response rendering options; accepted options may
  contain functions or Web Platform objects.

**Expected touch points**

- `src/app/presentation/lib/respond-with-hyperview-page.js` — direct facade.
- `src/app/presentation/request-handlers/hyperview/hyperview-page-handler.js` —
  thin adapter.
- `src/plugins/hyperview/plugin.js` — canonical `HyperviewService`
  registration and initialization lookup.
- `test/unit-tests/app/presentation/lib/respond-with-hyperview-page.test.js` —
  facade precedence, headers, service lookup, and return behavior.
- `test/unit-tests/app/presentation/request-handlers/hyperview/hyperview-page-handler.test.js` — handler delegation contract.
- `test/unit-tests/plugins/hyperview/plugin.test.js` — canonical registry name.
- `src/app/presentation/README.md` — direct and chained invocation guidance.
- `src/plugins/README.md` — Hyperview general-plugin example if it names the
  registry entry.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Direct callers and `HyperviewPageHandler` share one facade.
- [ ] Facade tests prove defaults < response rendering options < client header
      precedence.
- [ ] `response.props.hyperviewOptions` is neither read nor documented.
- [ ] Rendering options do not become template props or page-context JSON data.
- [ ] `HyperviewService` is the only registry and lookup name.
- [ ] No `Hyperview` compatibility alias is registered.
- [ ] The handler contains no duplicated request-header or service-resolution
      policy.

**Validation**

- `node run-linter.js src/app/presentation/lib/respond-with-hyperview-page.js src/app/presentation/request-handlers/hyperview/hyperview-page-handler.js src/plugins/hyperview/plugin.js test/unit-tests/app/presentation test/unit-tests/plugins/hyperview/plugin.test.js` — validates changed JavaScript.
- `node run-tests.js test/unit-tests/app/presentation test/unit-tests/plugins/hyperview/plugin.test.js test/unit-tests/kixx/http-router/server-response.test.js` — proves the new facade, handler adapter, response channel, and registry contract together.
- `rg -n "props\\.hyperviewOptions|getService\\('Hyperview'|registerService\\('Hyperview'" src test` — returns no matches.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: The current plugin registers `Hyperview`, while the
  new handler already looks up `HyperviewService`; this task resolves the split
  in favor of `HyperviewService` without an alias.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: HVR-1.

### Task HVR-3: Migrate application rendering and base-template ownership

**Status:** Not started
**Depends on:** HVR-2
**Documentation:** `src/app/presentation/README.md`; `src/templates/README.md`;
`src/docs/frontend-development-guide.md`; `src/docs/server-error-handling.md`;
`src/kixx/static-file-server/README.md`; `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `test/unit-tests/README.md`

**Objective**

Make every active page and HTML error path use the new handler/facade with an
explicit base template ID. Remove legacy handler imports and eliminate
`baseTemplate` from published page context so route/presentation configuration
is the only source of document-shell selection.

**Scope**

- In: active route targets in `src/virtual-hosts.js` and
  `src/routes/admin-panel.js`, including removal of deleted legacy handler
  imports.
- In: direct facade rendering from `renderHtmlErrorPage` and any required error
  handler option changes.
- In: removal of `baseTemplate` keys from all `src/pages/**/page.json` files.
- In: documentation which currently says page metadata selects the base
  template, including template, frontend, presentation, and static-file guides.
- In: unit tests for migrated route/error behavior and importability.
- Out: unrelated ADMIN behavior issues tracked in
  `agents/plans/admin-users-handler-issues.md`.
- Out: changing the underlying service API; HVR-4 owns that extraction.

**Design and invariants**

- Every full-document route passes `baseTemplateId` through
  `HyperviewPageHandler` options. The current IDs are `default.html` for the
  public shell, `admin.html` for authenticated admin pages, and
  `admin-login.html` for standalone admin authentication pages.
- Dynamic response overrides may use `setRenderingOptions()`, but neither
  `updateProps({ baseTemplate: ... })` nor page metadata may select a base
  template.
- Remove the seven current `baseTemplate` keys rather than leaving deprecated
  inert data in page contexts.
- Replace every `HyperviewStaticPageHandler` and
  `HyperviewDynamicPageHandler` route entry with `HyperviewPageHandler` and
  explicit options. Static/dynamic page data loading remains the responsibility
  of preceding handlers; cache policy remains an option rather than a distinct
  handler type.
- `renderHtmlErrorPage` calls `respondWithHyperviewPage` directly because the
  request-handler phase has already failed. Refactor its growing scalar
  arguments into an options object carrying `pathname`, `baseTemplateId`, and
  `scope`.
- Before rendering an error page, replace response rendering options with the
  complete error render options. This prevents a failed page's pathname,
  partial, base template, or cache policy from leaking into the error render.
- Error pages force `allowJsonResponse: false` and `usePageCache: false`, retain
  the original status and safe error props, return `false` for JSON requests and
  expected render failures, and rethrow unexpected render failures.
- Preserve existing `skip()` behavior on form success: it stops the trailing
  page handler after redirects while still allowing outbound middleware.
- Route modules must be importable after the migration; no source file may name
  the deleted `hyperview-request-handlers.js` module.

**Expected touch points**

- `src/virtual-hosts.js` — authentication-page handler options and dormant
  examples.
- `src/routes/admin-panel.js` — legacy imports and admin handlers.
- `src/app/presentation/lib/html-error-page.js` — direct facade call and error
  render options.
- `src/app/presentation/error-handlers/admin-error-handler.js` — explicit admin
  error base template.
- `src/app/presentation/error-handlers/admin-auth-error-handler.js` — explicit
  authentication error base template.
- `src/pages/page.json`
- `src/pages/admin/page.json`
- `src/pages/admin/errors/page.json`
- `src/pages/admin/style-guide/page.json`
- `src/pages/users/admin/page.json`
- `src/pages/login/admin/page.json`
- `src/pages/login/admin/errors/page.json` — remove deprecated base-template
  context keys.
- `test/unit-tests/app/presentation/lib/html-error-page.test.js` — direct error
  rendering and cascade behavior.
- Route-focused unit tests or existing router manifest tests — prove route
  modules import and use valid handlers/options.
- `src/app/presentation/README.md`
- `src/templates/README.md`
- `src/docs/frontend-development-guide.md`
- `src/kixx/static-file-server/README.md` — remove legacy handler examples and
  show explicit base-template options where full-page rendering follows.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Every active full-document target selects its base template through
      rendering options.
- [ ] No `src/pages/**/page.json` or request handler supplies `baseTemplate` as
      template context.
- [ ] No source or active documentation references the deleted static/dynamic
      Hyperview handlers.
- [ ] Admin, admin-authentication, and public examples select the intended base
      template explicitly.
- [ ] HTML error rendering uses the facade directly and cannot inherit stale
      rendering options from the failed page.
- [ ] Error rendering preserves its JSON-cascade, status, cache, expected-error,
      and unexpected-error behavior.
- [ ] Form redirects still skip trailing page rendering.
- [ ] The route manifests and error-handler modules import successfully under
      unit tests.

**Validation**

- `node run-linter.js src/virtual-hosts.js src/routes/admin-panel.js src/app/presentation/lib/html-error-page.js src/app/presentation/error-handlers test/unit-tests/app/presentation` — validates changed application JavaScript.
- `node run-tests.js test/unit-tests/app/presentation test/unit-tests/kixx/http-router test/unit-tests/plugins/hyperview` — validates migrated routes, error rendering, response options, and plugin wiring without an end-to-end server.
- `node run-tests.js` — full unit suite because route modules and shared error handling affect the whole application surface.
- `rg -n "HyperviewStaticPageHandler|HyperviewDynamicPageHandler|hyperview-request-handlers|\\\"baseTemplate\\\"|baseTemplate:" src/pages src/app src/routes src/virtual-hosts.js src/templates/README.md src/docs/frontend-development-guide.md src/kixx/static-file-server/README.md` — returns no deprecated page-data or handler references; published base-template bundle terminology is intentionally outside this check.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Base-template content files remain published and
  cacheable; only page-context selection through `baseTemplate` is removed.
  Route options use the existing published IDs ending in `.html`.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: HVR-2.

### Task HVR-4: Replace the HTTP-coupled service API with renderPage

**Status:** Not started
**Depends on:** HVR-3
**Documentation:** `src/app/presentation/README.md` rendering contract;
`src/plugins/README.md`; `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `test/unit-tests/README.md`

**Objective**

Make `HyperviewService` render pages without reading or mutating HTTP request and
response objects. The presentation facade converts its returned representation
into the final `ServerResponse`, and `respondWithHypertext()` is deleted.

**Scope**

- In: public `HyperviewService#renderPage(context, options)` and its return
  contract.
- In: moving response commitment and response-only options into
  `respondWithHyperviewPage`.
- In: deleting `respondWithHypertext()` and every reference to it without a
  compatibility wrapper.
- In: rewriting service, facade, handler, and plugin tests around the final API.
- In: final Hyperview and presentation documentation cleanup.
- Out: changing `renderEmail()` except for stale cross-references or shared
  private helpers required by the page extraction.
- Out: changing page content, route business logic, or template syntax.

**Design and invariants**

- `renderPage` accepts the request context plus one plain options object. It does
  not accept `ServerRequest` or `ServerResponse`.
- Required/recognized inputs include `url`, plain `props`, `pathname`,
  `baseTemplateId`, `partial`, `skipBaseRender`, and current page-cache options.
  `responseOptions` is presentation-only and must not enter the service.
- The caller passes `request.url` as `url` and `response.props` as `props`.
  Hyperview continues to clone props while assembling the page context so
  templates cannot mutate the response's source values.
- A hypertext render resolves to `{ type: 'hypertext', hypertext }`. An allowed
  explicit `.json` request resolves to
  `{ type: 'page-context', pageContext }`.
- `renderPage` retains the configured and per-call `allowJsonResponse` behavior.
  When JSON is disabled, a `.json` pathname is not stripped and therefore does
  not become an alias for the HTML page.
- Page-context results bypass rendered-page cache reads/writes and do not require
  `baseTemplateId`. They still use the same immutable content snapshot and
  assembled page context as HTML rendering.
- A full-document hypertext render requires a valid option
  `baseTemplateId`. Partial and page-template-only renders do not. The service
  never reads `baseTemplate` from published metadata or props, even if external
  content still supplies that key.
- Existing cache safety remains unchanged: page content and shared bundle hashes
  participate in cache identity; full-document identity includes the explicit
  base template; render modes cannot collide; props are included by default when
  page caching is enabled; logical identities are hashed before KV use or
  logging.
- Cache hits and newly rendered output return the same result shape. The service
  does not set status, headers, content type, or body.
- The facade handles results exhaustively. It serializes `page-context` with the
  existing formatted JSON behavior and commits `hypertext` with
  `response.respondWithUtf8(response.status, hypertext, responseOptions)`.
- `respondWithHypertext` is removed from source, tests, JSDoc, and guides in the
  same task. Do not retain a deprecated alias or forwarding method.
- Keep one snapshot per render and all existing template/page-cache invalidation
  semantics.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — final service API and result
  creation.
- `src/app/presentation/lib/respond-with-hyperview-page.js` — translate request
  state into render inputs and results into responses.
- `src/app/presentation/request-handlers/hyperview/hyperview-page-handler.js` —
  final public references and documentation.
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — rewrite all page
  rendering assertions around return values and explicit props/URL inputs while
  retaining cache, snapshot, malformed-content, and email coverage.
- `test/unit-tests/app/presentation/lib/respond-with-hyperview-page.test.js` —
  response commitment for both result types and response options.
- `test/unit-tests/plugins/hyperview/plugin.test.js` — final service wiring
  behavior where needed.
- `src/app/presentation/README.md` — final facade, handler, rendering-option, and
  service boundaries.
- `src/templates/README.md` — page-context JSON wording if it refers to the old
  response-coupled implementation.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `HyperviewService` exposes `renderPage()` and `renderEmail()` as its
      rendering entry points.
- [ ] `renderPage()` neither accepts nor mutates a server request/response.
- [ ] Hypertext and page-context results have the documented discriminated
      shapes.
- [ ] The facade, not the service, owns response status, headers, content type,
      JSON serialization, and body commitment.
- [ ] Full-document rendering selects the base template only from
      `baseTemplateId` options.
- [ ] `.json`, full-document, partial, boosted/page-only, metadata mini-template,
      snapshot, template-cache, page-cache, and props-cache-key behavior retain
      focused unit coverage.
- [ ] `respondWithHypertext()` and all references to it are deleted with no
      compatibility API.
- [ ] `HyperviewService` is the only service registry name throughout source,
      tests, and documentation.
- [ ] Full lint and unit test suites pass.

**Validation**

- `node run-linter.js src/kixx/hyperview/hyperview-service.js src/app/presentation/lib/respond-with-hyperview-page.js src/app/presentation/request-handlers/hyperview test/unit-tests/kixx/hyperview/hyperview-service.test.js test/unit-tests/app/presentation test/unit-tests/plugins/hyperview/plugin.test.js` — validates all JavaScript changed by the final API extraction.
- `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js test/unit-tests/app/presentation test/unit-tests/plugins/hyperview/plugin.test.js` — proves the service/facade boundary and plugin integration.
- `node run-linter.js` — required full-project JavaScript lint.
- `node run-tests.js` — required full unit suite.
- `rg -n "respondWithHypertext|props\\.hyperviewOptions|getService\\('Hyperview'|registerService\\('Hyperview'|HyperviewStaticPageHandler|HyperviewDynamicPageHandler" src test` — returns no matches.
- Read-through: verify `renderPage()` JSDoc states its exact inputs, result union,
  NotFound behavior, base-template requirement, and cache-sensitive defaults.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Backward compatibility is explicitly a non-goal;
  the old method and service registry name are removed rather than aliased.
  `.json` remains within `renderPage()` and yields a page-context result for the
  facade to serialize.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: HVR-3.
