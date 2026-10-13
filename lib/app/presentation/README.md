# Presentation Layer

This is a Hypermedia Driven Application: the presentation layer serves server-rendered HTML following REST and HATEOAS. Pages are rendered by the Kixx Hyperview Service from page content and Kixx templates (mustache style, defined in `kixx/vendor/templating/`; syntax, partials, and helpers in `templates/README.md`).

Paths below are relative to `lib/`.

| Path | Contains |
|---|---|
| `virtual-hosts.js` | Virtual hosts, their hostnames, and the route subtrees mounted under each |
| `routes/` | Route subtrees, one module per API or UI surface |
| `app/presentation/request-handlers/` | Request handlers |
| `app/presentation/middleware/` | Inbound and outbound middleware |
| `app/presentation/error-handlers/` | Error handlers |
| `app/presentation/forms/` | Form classes, one subdirectory per feature |
| `app/presentation/lib/` | Presentation helpers shared by more than one handler or middleware (CSRF, JSON:API, Hyperview response) |
| `pages/` | Page metadata, page templates, page-local partials, and include files |
| `templates/base/`, `templates/partials/` | Shared document frames and shared fragments |
| `static-assets/` | Static assets; `stylesheets/` and `javascript/` are served at `/stylesheets/**` and `/javascript/**` |
| `emails/` | Email templates |

Add a route to the `routes/` module that owns its surface. Edit `virtual-hosts.js` only to mount a new subtree, add a virtual host, or change subtree-level middleware and error handlers.

## Routing

Requests resolve through **HttpRouter → VirtualHost → HttpRoute → HttpTarget**:

- **VirtualHost** matches the hostname. If none matches, the first configured virtual host is used.
- **HttpRoute** matches `request.url.pathname` against a `pattern`. Captured params are on `request.pathnameParams`.
- **HttpTarget** declares its `methods` and runs its handler chain. If the route matches but no target accepts the method, the router responds `405` with an `Allow` header.

A route with `routes` is a branch that shares configuration with its children; a route with `targets` is a leaf. Nested routes concatenate patterns and names, and compose middleware (parent inbound first, parent outbound last).

**Matching is ordered, not ranked by specificity.** Nested routes are flattened depth-first in array order, and the first matching route wins. Put specific routes before dynamic ones, and keep catch-alls (`*`, `/:slug`, `/*splat`) last in their route set:

```js
routes: [
    { pattern: '/platform.json', targets: [ ... ] },
    { pattern: '/platform', targets: [ ... ] },
    { pattern: '*', targets: [ ... ] },
]
```

### Route Patterns

Patterns use the vendored `path-to-regexp`. They match the pathname only: no query strings, fragments, or regexp syntax. Escape or avoid the reserved characters `( ) [ ] ? + !`. Matched params are decoded.

| Pattern | Matches | `request.pathnameParams` |
|---|---|---|
| `/users/:userId/posts/:"post-id"` | `/users/42/posts/intro` | `{ userId: '42', 'post-id': 'intro' }` (quote names that are not JS identifiers) |
| `/files/*path` | `/files/a/b.pdf` (one or more segments) | `{ path: [ 'a', 'b.pdf' ] }` |
| `/files{/*path}` | `/files`, `/files/a/b` (zero or more segments) | `path` present only when matched |
| `/files/:file{.:ext}` | `/files/report`, `/files/report.pdf` | `ext` present only when matched |
| `/{index.json}`, `/users{.json}` | `/` and `/index.json`; `/users` and `/users.json` | `{}` |
| `/users/invite{/}` | With or without trailing slash | `{}` |
| `*` | Everything | `{}` |

- Parameter and wildcard names are required (`/users/:` is invalid). Do not use the old modifier syntax (`?`, `*`, `+` after a param).
- `{/}` makes a trailing slash optional without a redirect; use it on API endpoints. A nested route with pattern `'{/}'` means "the parent pattern itself".
- `*` is a project-level shortcut for an unnamed catch-all. Nested, it composes differently: a child `*` under `/admin` becomes `/admin{/*path}` (capturing `path`), and a parent `*` adds nothing to its children's patterns.

### Handlers and Execution Order

| Kind | Declared on | Use for |
|---|---|---|
| `inboundMiddleware`, `outboundMiddleware` | Routes; applies to every target in the subtree | Authentication, session loading, request normalization, shared response headers |
| `requestHandlers` | One target | Resource authorization, loading page data, form handling, calling Transaction Scripts, render props, redirects |
| `errorHandlers` | Routes and targets | Converting errors into responses |

For a matched target:

1. **Request phase:** route inbound middleware (parent first), then the target's `requestHandlers` in order.
2. **Outbound phase:** route outbound middleware (child first). Always runs, even after `skip()`.

Each function's return value becomes the `response` passed to the next; a nullish return keeps the current one.

```js
// Middleware and request handlers receive skip(); outbound middleware does not.
// See app/presentation/middleware/authenticate-admin-user.js.
async function authenticateAdminUser(context, request, response, skip) {
    const sessionId = request.getCookie(ADMIN_SESSION_COOKIE_NAME);

    if (!isNonEmptyString(sessionId)) {
        throw new UnauthenticatedError('Admin authentication is required.');
    }

    context.setUser(await authenticateAdminSession(context, sessionId));
    return response;
}

// Error handlers may be async. Return the response if handled, false to pass.
function handleAuthenticationError(context, request, response, error) {
    if (error.code !== 'UNAUTHENTICATED_ERROR') {
        return false;
    }
    return response.respondWithJSON(401, { errors: [ { title: 'Authentication required' } ] });
}
```

**`skip()`** ends the request phase: no further inbound middleware or request handlers run. Call it after committing a terminal response (a redirect or JSON document) when a later handler, such as `HyperviewPageHandler`, would otherwise run. If no later handler needs bypassing, just return the response.

**Errors.** When middleware or a handler throws:

1. The router emits an `error` event (the servers log it and, for unexpected errors, begin graceful shutdown). It fires for every failure regardless of what the cascade below produces, so a handler may render a normal-looking page for an unexpected error without preventing shutdown.
2. The error cascade runs: target error handlers, then route error handlers (child before parent), then the router fallback, which serializes expected/HTTP errors as JSON:API `errors` documents. The first handler to return a response wins.
3. If every level returns `false`, the error escapes to the platform server's last-resort handler.

The outbound phase is skipped for a request that enters the error cascade.

### Response Cache Policy

Shared caches such as the Cloudflare Workers Cache store responses without `Cache-Control` heuristically and serve them without running the Worker or its authentication. So caching is opt-in per route, and `HttpRouter` enforces on the way out:

| Response | `Cache-Control` |
|---|---|
| No `Cache-Control` declared | `no-store` |
| Produced by the error cascade | `no-store`; any `ETag` removed |
| `context.user` is set | `private, no-store` |

Enforcement replaces only storage and freshness directives (a declared `no-transform` survives). A response a shared cache may still store also gets `Vary: host`, because the shared cache key may omit the hostname.

To make a response cacheable, declare the policy on the success path: `cacheControl` for `StaticAssetRequestHandler`, `responseOptions.cacheControl` for `HyperviewPageHandler`, or a `cache-control` header from a custom handler. **Never do this for a response built from request-specific state** such as a session, cookie, or CSRF token.

Publishing a content Release does not purge shared caches:

| Policy | After a Release | Origin requests |
|---|---|---|
| `public, no-cache` (default choice) | Visible on the next request | Every request; unchanged pages get `304` |
| `public, max-age=<seconds>` | Visible once the cached copy expires | Only after expiry |

Use a short `max-age` (about a minute) only for high-traffic pages where a brief delay after publishing is worth fewer origin requests.

## Reverse Routing

Never hardcode internal URLs. Look up the `HttpTarget` that owns the endpoint and compile its pathname, so links, redirects, and form actions follow when a pattern changes.

**Target names** are fully qualified as `routeName/targetName`, with nested route names joined parent first: target `render-style-guide-page` under routes `admin-panel` → `style-guide` is `admin-panel/style-guide/render-style-guide-page`. A route without a `name` uses its `pattern`. Give every referenced target a stable name; renaming breaks lookups.

| Method | Returns |
|---|---|
| `context.getHttpTarget(name)` | First target with that name. Throws `AssertionError` if none matches. |
| `context.getAllHttpTargets()` | Every target of the current virtual host, in route order |
| `context.getHttpTargetsByTag(tag)` | Targets declaring `tag` in their `tags` array, in route order; `[]` if none |

These resolve against the virtual host that matched the request, so call them inside handlers, not at module load.

`target.compilePathname(params)` returns `{ method, pathname }`:

- Pass a string per `:name` param and an array per `*name` wildcard. Extra keys are ignored. Values are URL-encoded.
- `method` is the preferred method: `GET > POST > PUT > PATCH > DELETE > HEAD`, else the first declared.
- Throws for a target whose pattern is `*`.
- Append query strings yourself.

```js
// Redirect after a write
const { pathname } = context.getHttpTarget('bugs/show').compilePathname({ id: ticket.id });
skip();
return response.respondWithRedirect(303, pathname);

// Tag-driven navigation (target declares tags: [ 'admin-nav' ])
const nav = context.getHttpTargetsByTag('admin-nav').map((target) => {
    return { name: target.name, href: target.compilePathname().pathname };
});
return response.updateProps({ nav });
```

`BaseForm` uses the same mechanism to compile form actions (see [Forms](#forms)).

## Request Handlers

A request handler interprets the request and coordinates the response. Domain logic belongs in Transaction Scripts (`app/transaction-scripts/README.md`).

Handlers may read params, query, headers, cookies, and body; parse payloads into forms; validate; call Transaction Scripts; set render props; and return redirects, JSON:API responses, or Hyperview pages. They must not:

- Contain business rules or domain mutations.
- Use native Node.js modules, the filesystem, or native Cloudflare bindings.
- Build HTML strings that Hyperview templates should render.
- Own browser state that links, forms, redirects, and server-rendered HTML should represent.

A browser form submission: validate CSRF, parse and validate the form, call the Transaction Script, then redirect on success or re-render on failure:

```js
import CreateBugTicketForm from '../../forms/bugs/create-bug-ticket-form.js';
import { createBugTicket } from '../../../transaction-scripts/bugs/create-bug-ticket.js';
import { getCsrfFormContext, validateCsrfFormData } from '../../lib/csrf.js';

export async function postCreateBugTicket(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = CreateBugTicketForm.fromFormData(formData);

    try {
        form.validate();
    } catch (error) {
        if (error.name === 'ValidationError') {
            response.status = error.httpStatusCode;
            return response.updateProps({
                form: await getCsrfFormContext(context, request, response, form, error),
            });
        }
        throw error;
    }

    const ticket = await createBugTicket(context, form);
    const { pathname } = context.getHttpTarget('bugs/show').compilePathname({ id: ticket.id });

    skip();
    return response.respondWithRedirect(303, pathname);
}
```

On failure, the target's trailing `HyperviewPageHandler` re-renders the page; on success, `skip()` prevents a needless render.

### Error Handling

Classify every error:

- **Expected (operational)** errors are ones the handler is prepared for. `error.expected` is truthy when the thrower considered it operational.
- **Unexpected (programmer)** errors come from paths assumed unreachable. Never handle them beyond logging and rethrowing; they should crash the system. You may wrap one in an `AssertionError` (with `cause`) to add debugging context.

For expected errors:

- If `error.httpError` is falsy, wrap it in an HTTP error class from `kixx/errors/mod.js`, or set `error.httpStatusCode`.
- If an expected error arrives from a path whose occurrence violates the handler's own invariant, wrap it in an `AssertionError` (with `cause`) and rethrow. The resulting 500 and crash are intended.
- Branch on `error.name`, `error.code`, and `error.expected`, not `instanceof`.
- Use a custom `code` when callers or templates need to distinguish a domain outcome under a generic HTTP status.

HTTP error messages are serialized to clients by the router fallback. Never put secrets, raw upstream payloads, stack details, KV keys, or internal identifiers in them.

**Status on inline re-renders.** A handler that catches an error and re-renders the page owns the status; `updateProps()` alone sends `200`. Set `response.status` from the original caught `error.httpStatusCode` (falling back to `500`), even if the error was reclassified for display, so a name conflict stays `409` when shown as a field message.

Exception: enumeration-sensitive re-renders (throttled, invalid invite or verification, invalid credentials) stay `200` on purpose. These flows collapse valid, unknown, expired, and throttled outcomes into one identical response; a distinct `403`/`404`/`429` would leak the signal the identical bodies hide.

### Rendering with HyperviewPageHandler

`HyperviewPageHandler(options)` (`request-handlers/hyperview/hyperview-page-handler.js`) renders a Hyperview page. Place it **last** in `requestHandlers`; earlier handlers add data with `response.updateProps()` and controls with `response.setRenderingOptions()`. The status is whatever earlier handlers set.

```js
{
    name: 'show',
    methods: [ 'GET', 'HEAD' ],
    requestHandlers: [ getBug, HyperviewPageHandler({ baseTemplateId: 'default.html', pathname: '/bugs/detail' }) ],
}
```

Without `pathname`, the page is looked up by request pathname, so pass a stable `pathname` whenever the route pattern has dynamic segments.

The client picks a render mode by request header:

| Request header | Renders | Used for |
|---|---|---|
| `kixx-partial: <partial-id>` | That page partial alone | Replacing a fragment in place |
| `kixx-boosted` | Page template without the base template | Body swap on page transition |
| Neither | Page template inside the base template | A complete document; requires `baseTemplateId` |

A bare `HyperviewPageHandler()` fails an assertion on a full-page request. Every render adds `Vary: kixx-partial, kixx-boosted`.

Options merge in this order, later winning: handler options, then `response.renderingOptions` (merged key by key), then the render-mode headers. For example, `response.setRenderingOptions({ partial: 'results-table' })` renders only the results table when the handler knows the client wants a filtered list.

| Option | Effect |
|---|---|
| `pathname` | Page identifier; defaults to the normalized request pathname |
| `baseTemplateId` | Base template; required for full-page renders |
| `partial` | Render this page partial instead of the page and base templates |
| `skipBaseRender` | Render the page template without its base |
| `usePageCache` | Enable the rendered-page cache; defaults to config |
| `cacheKey` | Cache identity; defaults to request origin, pathname, and query |
| `includePropsInCacheKey` | Include response props in cache identity; defaults to `true` when page caching is on |
| `propsHashFunction` | Custom props hash for props-sensitive cache keys |
| `pageCacheReadTtlSeconds`, `pageCacheExpirationSeconds` | Page-cache TTLs; default to config |
| `allowJsonResponse` | Serve assembled page context for `.json` requests; defaults to config |
| `responseOptions` | `{ contentType, headers, cacheControl }` applied when committing the response |

`responseOptions.cacheControl` opts a public page into shared caching: a `200` to `GET`/`HEAD` gets that header plus a strong `ETag`, and a matching `If-None-Match` gets `304`. See [Response Cache Policy](#response-cache-policy).

Leave `includePropsInCacheKey` alone unless the page renders identically for every viewer; its default keeps a page rendered for one signed-in user from being served to the next. Responses with status `400` or above never touch the page cache.

For terminal code such as error handlers, call `respondWithHyperviewPage(context, request, response, defaultOptions)` from `app/presentation/lib/respond-with-hyperview-page.js` directly. It uses the same option precedence.

## RequestContext, Request, and Response

Every middleware and handler receives `(context, request, response)`.

### RequestContext

Created once per request.

| Property | Notes |
|---|---|
| `config` | Resolved application configuration |
| `env` | Platform environment bindings |
| `logger` | Root application logger |
| `requestId` | Matches `request.id`; use for log correlation |
| `runtime` | `AppRuntime`: whether serving HTTP or running a CLI command |
| `user` | Authenticated principal, or `null`. Auth middleware sets it with `context.setUser(principal)`; it may be a user, API token, service account, or webhook sender. |

`getCollection(name)` and `getService(name)` (e.g. `'EmailService'`) throw if the name is not registered. Target lookups are under [Reverse Routing](#reverse-routing).

| Env helper | Returns |
|---|---|
| `getEnvString(key, { required })` | Non-empty string, else `undefined` |
| `getEnvInteger(key, { required })` | `Number.parseInt()` of a string, or a number binding |
| `getEnvFloat(key, { required })` | `Number.parseFloat()` of a string, or a number binding |
| `getEnvBoolean(key)` | `true` only for `true`, `1`, `"true"`, `"1"`; otherwise `false` |

- `{ required: true }` throws `AssertionError` when the value is missing or empty.
- Numeric helpers parse only a leading number: `"12px"` → `12`, `"1.5"` → `1` for integers. They throw only when no leading number parses (`"abc"`), or, for `getEnvInteger()`, when the binding is a non-integer number.

### ServerRequest

`request` satisfies `kixx/http-router/server-request-interface.js`.

### ServerResponse

`response` is a `ServerResponse` (`kixx/http-router/server-response.js`). Handlers build it by mutation.

- `status` (default `200`), `body`, and `headers` (a `Headers`; use `setHeader()`, `appendHeader()`, `addVary()`).
- `updateProps(obj)` deep-merges template data via `structuredClone`. Pass plain objects only; functions and class instances throw. Read the result from `response.props`.
- `setRenderingOptions(obj)` replaces all rendering options with a shallow copy (pass `{}` to clear). Values need not be cloneable, and they never become template data.
- `setCookie(name, value, options)` defaults to `Secure; HttpOnly; SameSite=Lax`; pass `secure: false` for local HTTP and `httpOnly: false` for client-readable cookies. `clearCookie(name, options)` removes one.
- All mutators and `respond*` methods return `this`.

| Method | Use |
|---|---|
| `respond(status, headers, body)` | Full control |
| `respondWithRedirect(status, location, options)` | `301`, `302`, or `303` |
| `respondWithJSON(status, obj, options)` | Sets `Content-Type` and `Content-Length` |
| `respondWithHTML(status, html, options)` | `text/html; charset=utf-8` |
| `respondWithUtf8(status, text, options)` | Other text; defaults to `text/plain` |
| `respondWithStream(status, stream, options)` | `ReadableStream`; `null` for HEAD |

## Forms

All input (HTML forms, JSON:API, webhooks, external APIs) goes through a form. A form turns an untrusted payload into a normalized, validated value for a Transaction Script. Keep domain logic, storage, and CSRF out of forms.

Every form has:

- **`static schema`**: JSON Schema for accepted fields. It is the source of truth: `validate()` reads its bounds (`minLength`, `maxLength`, `enum`) rather than repeating literals, and HTML forms render from it.
- **A normalizing `constructor(attributes)`**: destructures `attributes ?? {}` and normalizes each field (trim, lowercase, absent to `null`), but **preserves invalid input** so `validate()` can report it.
- **`validate()`**: pushes every field error onto one `ValidationError` with `error.push(message, field)` and throws only if `error.length` is non-zero, so the re-rendered form shows every problem.
- **`from*()` static constructors**: `fromFormData(formData)` (from `BaseForm`) and/or `fromJsonApi(resource)`.
- **`toJSON()`**: the plain value object for the Transaction Script, mapping UI fields onto the domain shape when they differ. Required for API forms and when shapes differ; otherwise pass the validated form itself.

One file may export a primary form (`default`) and a companion (named), such as a per-row revoke form with its own `static target` and a single hidden id field. A form with no user-entered fields still exists to carry CSRF and its action URL, with `properties: {}`.

### HTML Forms

HTML forms extend `BaseForm` (`app/presentation/forms/base-form.js`) and declare `static target` (the `HttpTarget` name the form posts to), `static method` (usually `'POST'`), and `static schema`.

`getFormContext(context, error)` builds the template context: it compiles the action URL from `target` (passing the form so route params hydrate) and maps each schema property to a field with its value, metadata, and error. Pass the caught `ValidationError` for field errors, or a code string for a form-level message.

**Never override `getFormContext()`.** It owns action compilation, error projection, and `writeOnly` omission; patching its output can echo a submitted password back into the page. The only extension points are:

- **`getDynamicFieldMetadata(context)`**: returns metadata keyed by field name, merged over the schema, for values known only at request time (e.g. `AdminInviteCreateForm` fills `role_id` options from the role registry). It is synchronous; load any I/O in the handler and store it on the form. `name`, `value`, and `error` are applied after it, so it cannot defeat `writeOnly` or forge errors. Keys for undeclared fields throw.
- **`static fromFormData(formData)`**: override for multi-value, file, or array fields that need `formData.getAll()`. The default takes the last value of each field.

```js
getDynamicFieldMetadata() {
    const options = listAttachableRoles('admin').map((role) => ({ value: role.id, label: role.name }));
    return { role_id: { label: 'Role', options } };
}
```

Schema properties carry render metadata that templates read:

| Key | Meaning |
|---|---|
| `label`, `hint` | Control label and help text |
| `fieldType` | Control kind: `text`, `textarea`, `select`, `hidden` |
| `inputType` | HTML `<input type>`, e.g. `email`, `password` |
| `autocomplete` | Autofill hint, e.g. `new-password` |
| `options` | `{ value, label }` pairs for selects |
| `writeOnly: true` | **Security:** the value is never echoed into the render context, so a password is not re-rendered after a validation error |

### API-Only Forms

JSON:API-only forms do not extend `BaseForm` and have no `target`, `method`, or `getFormContext()`. `fromJsonApi(resource)` is their entry point and reads `resource.attributes` itself. A form serving both HTML and JSON:API extends `BaseForm` and adds `fromJsonApi()`.

```js
export default class CreateApiTokenForm {

    static schema = {
        type: 'object',
        properties: {
            description: { type: [ 'string', 'null' ] },
        },
    };

    constructor(attributes) {
        const { description } = attributes ?? {};
        this.description = normalizeOptionalStringAttribute(description);
    }

    validate() {
        const error = new ValidationError('The API token form contains invalid fields');

        if (this.description !== null && !isString(this.description)) {
            error.push('Description must be a string or null', 'description');
        }
        if (error.length) {
            throw error;
        }
    }

    toJSON() {
        return { description: this.description };
    }

    static fromJsonApi(resource) {
        return new CreateApiTokenForm(resource?.attributes);
    }
}
```

### Normalization Helpers

Use `app/presentation/forms/utils.js` instead of hand-written normalization. Each returns unusable input unchanged so `validate()` can report it. Add a helper here when a pattern appears in a second form.

| Helper | Behavior |
|---|---|
| `normalizeStringAttribute(value)` | Trims |
| `normalizeLowerCaseStringAttribute(value)` | Trims and lowercases; use for emails |
| `normalizeSecretStringAttribute(value)` | Coerces to string **without trimming**; use for passwords |
| `normalizeOptionalStringAttribute(value)` | Trims; absent or blank becomes `null` |
| `normalizeIntegerStringAttribute(value, defaultValue)` | All-digit string to integer; absent or blank becomes `defaultValue`; other strings returned trimmed |
| `validateEmailAddressField(error, value, name)` | Call from `validate()`; pushes an error for a missing or malformed email |

## CSRF Protection

Browser forms that mutate state or establish authentication must use `app/presentation/lib/csrf.js`. Validate CSRF in the request handler before constructing the form or calling a Transaction Script.

| Helper | Use |
|---|---|
| `getCsrfFormContext(context, request, response, form, error)` | GET renders and every re-render. Returns `form.getFormContext()` plus `csrf.fieldName` and `csrf.token`, and sets the CSRF cookie. |
| `validateCsrfFormData(context, request)` | POST handlers. Reads and returns `request.formData()` after validating. |
| `validateCsrfHeader(context, request)` | Raw upload bodies; checks the `x-kixx-csrf-token` header without reading the body |
| `renderWithFreshCsrf(context, request, response, { form, props, error, status })` | Re-render with status, props, and a fresh token in one call |
| `clearCsrfToken(request, response)` | After login or signup, once the real session cookie is set |

Request bodies are one-shot: after `validateCsrfFormData()`, never call `request.formData()`, `json()`, `text()`, or `arrayBuffer()`.

Render the field inside the protected `<form>`:

```html
{{#if form.csrf}}
<input type="hidden" name="{{ form.csrf.fieldName }}" value="{{ form.csrf.token }}">
{{/if}}
```

Tokens are stateless HMAC envelopes (`csrf-token-signer.js`) binding the browser's `sid` cookie and an expiry, so validation touches no storage. Each render mints a new token for the existing `sid`, and tokens are not spent on use: other tabs and forms stay valid, and a back-button resubmission is accepted. Rotating the signing secret invalidates every open form.

A token is rejected when the cookie or field is missing, or the token is forged, expired, or minted for a different `sid`. The resulting `ForbiddenError` (`code: 'InvalidCsrfTokenError'`) would otherwise replace the page with a generic error page. Where the surface can recover, catch it and either re-render with a fresh token or redirect to the owning page with a notice code.

## Common Recipes

### Page

1. Add the route to its `routes/` module. End `requestHandlers` with `HyperviewPageHandler({ baseTemplateId: 'default.html', responseOptions: { cacheControl: 'public, no-cache' } })`. Omit `cacheControl` for pages built from request-specific data.
2. Add `pages/<pathname>/page.json` with `"template": "page.html"`, and `page.html` beside it.
3. Put page-local includes and partials beside `page.json` and list them in its `includes` and `partials`.
4. Change `templates/base/` or `templates/partials/` only for changes that should affect multiple pages.

For a dynamic page, add a request handler before `HyperviewPageHandler` (in the matching barrel file under `request-handlers/`) that reads the request, calls Transaction Scripts, and calls `response.updateProps()`. Pass a stable `pathname` when the pattern has dynamic segments.

### Form Workflow

Define the form ([Forms](#forms)), render it with `getCsrfFormContext()` on GET, and handle POST as in the [Request Handlers](#request-handlers) example.

### JSON:API Endpoint

Helpers are in `app/presentation/lib/json-api.js`.

1. Call `assertJsonApiContentType(request)` before parsing a body. It requires `Content-Type: application/vnd.api+json` and ignores media-type parameters.
2. Parse with `parseJsonApiResource(request, expectedType)` and pass the whole resource to an API form (`fromJsonApi`, `validate`, `toJSON`). Trivial payloads may be destructured in the handler.
3. Respond with `response.respondWithJSON(status, jsonApiResource(...), { contentType: JSON_API_CONTENT_TYPE })`.

Unhandled expected errors become JSON:API `errors` documents from the router fallback.

The Administrative Data API (`request-handlers/admin-data-api/`) uses stricter JSON:API 1.1 helpers:
- `assertStrictJsonApiContentType()` rejects every media-type parameter except `profile`.
- `assertAcceptsJsonApi()` returns 406 when the client doesn't accept JSON:API.
- `withErrorSource()` and `toJsonApiErrorObjects()` build structured error `source` fields.
- `respondWithJsonApi()` sends the Content-Type without `charset`.

These errors need a route error handler such as `error-handlers/admin-data-api-error-handler.js`, because the router fallback does not add `WWW-Authenticate` on 401.

### Static Assets

`StaticAssetRequestHandler` (`kixx/static-assets/static-asset-request-handler.js`) serves blobs from the `ContentAddressableStore`. `virtual-hosts.js` wires it twice, both before the catch-all:

- **`/assets/:hash/*pathname`** with `{ fingerprinted: true }`: immutable caching; a matching `If-None-Match` gets `304` without a storage read.
- **`/:filename.:extension`** for fixed root files like `/favicon.ico`, with `{ cacheControl: 'public, max-age=86400, stale-while-revalidate=604800', throwNotFound: false, skipWhenFound: true }` followed by `HyperviewPageHandler`. The pattern also matches page URLs like `/index.json`, so a miss must fall through. Never mark root files `immutable`; their URLs never change.

Pathname-mode assets resolve through the current snapshot and revalidate by default. Details: `kixx/static-assets/README.md`.

## Hyperview Content

Source files map to the immutable storage layout read by `ContentSnapshot`:

| Storage path | Source | Treatment |
|---|---|---|
| `/pages/<pathname>/page.json` | `pages/<pathname>/page.json` | Direct file |
| `/pages/<pathname>/<template>` | File named by `template` | Compiled as the page template |
| `/pages/<pathname>/__page-includes-bundle` | Files named by `includes` | Verbatim strings |
| `/pages/<pathname>/__page-partials-bundle` | Files named by `partials` | Compiled page-local partials |
| `/templates/__template-partials-bundle` | `templates/partials/**` | JSON bundle |
| `/templates/__base-templates-bundle` | `templates/base/**` | JSON bundle |
| `/assets/**` | `static-assets/**` | Direct file |
| `/emails/<pathname>/__email-assets` | `emails/<pathname>/email.json` and named files | JSON bundle |

Keep page directories flat: files named by `template`, `partials`, and `includes` sit beside `page.json`, and a child directory is another page, so never create a `partials/` directory inside a page.

### Page Context

For `/blog/reviews/music`, Hyperview merges `pages/page.json`, `pages/blog/page.json`, `pages/blog/reviews/page.json`, and `pages/blog/reviews/music/page.json`, more specific last. Ancestors are optional; a missing leaf is a 404. Response props merge last and override all page data.

`page.json` build directives are removed from the template context:

- `template`: the page template filename (`page.html`).
- `partials`: `[ { id, filename } ]` page-local partials.
- `includes`: `{ name: { filename } }` text files, exposed verbatim under `includes.<name>`. They are never compiled, whatever their extension; use `template` or `partials` for template syntax.

Response props named `template` or `partials` survive, since props merge after directives are removed.

Defaults Hyperview fills when absent:

| Key | Default |
|---|---|
| `pathname` | Canonical content pathname |
| `url_pathname` | Raw request pathname |
| `page.canonical_url` | Protocol, host, and raw pathname (no query or hash; case, slashes, and `.json` pass through) |
| `page.href` | Full request URL |
| `page.open_graph` | `url` from `canonical_url`, `type: 'website'`, `title`/`description`/`locale` from `page` |

`page.title` and `page.description` may be `{ "template": "{{ page.author }} — kixx.dev" }`; Hyperview renders it against the assembled context before the page template runs.

**JSON page context.** With `allowJsonResponse`, a pathname ending in `.json` (case-insensitive) returns the assembled context as JSON; `/blog/index.json` serves `/blog`. It is for development and debugging, not an API contract. It includes merged runtime props, so keep it disabled on routes serving authenticated pages.

### Emails

An email directory holds `email.json` and the files it names. HTML and text templates are each optional; `partials` name files in the same directory; `contextData` is static render data.

```json
{
    "contextData": { "subject": "Welcome" },
    "htmlTemplate": { "id": "welcome.html", "filename": "message.html" },
    "textTemplate": { "id": "welcome.txt", "filename": "message.txt" },
    "partials": [ { "id": "signature.html", "filename": "signature.html" } ]
}
```

### Admin Sidebar

`templates/base/admin.html` renders `admin-nav.html` as the first child of `.admin-layout.with-sidebar`, so an admin page template must render exactly one element after it (normally `<main class="admin-main">`). The login page uses `admin-login.html`, without a sidebar.

The sidebar highlights the section named by `subpage.section` in the section's `page.json`; nested pages inherit it. Never set it in `pages/admin/page.json`, which is the ancestor of every admin page. A new section needs its key in its `page.json` and a link in `templates/partials/admin-nav.html`. `section: "style-guide"` shows the style guide list instead.
