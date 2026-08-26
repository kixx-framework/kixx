# Presentation Layer

This project is a Hypermedia Driven Application, which means the presentation layer is a web presentation, primarily following the Representational State Transfer (REST) and Hypermedia As The Engine Of Application State (HATEOAS) patterns.

**Templates**

The primary view layer for the presentation is provided by mustache style templates called "Kixx templates" as defined in `kixx/templating/`. For information about the template syntax, partials, and helpers see the template guide at `templates/README.md`.

**Template context data and rendering**

The Kixx Hyperview Service assembles page context and rendered hypertext from page metadata and text based content in `pages/` with templates in `templates/`. The presentation facade commits that result to the HTTP response.

**HTTP Routing**

HTTP routes are defined in `virtual-hosts.js` with sub-trees defined in `routes/` and imported by `virtual-hosts.js`.

## Routing

Routes are defined in `virtual-hosts.js` as an array of virtual host specification objects. The HTTP router resolves every request through a four-level hierarchy: **HttpRouter → VirtualHost → HttpRoute → HttpTarget**.

`virtual-hosts.js` Declares the virtual hosts, their hostnames, and the route subtrees mounted under each one. The route subtrees themselves live in `routes/`, one module per API or UI surface. Add a route to the module that owns the surface it belongs to, and reserve edits to `virtual-hosts.js` for mounting a new subtree, adding a virtual host, or changing subtree-level middleware and error handlers.

- **VirtualHost** matches the request by hostname. If no hostname match is found, the first virtual configured will be used.
- **HttpRoute** matches the URL pathname using `path-to-regexp` pattern syntax (e.g. `/users/:id`). Named segments are captured and available as `request.pathnameParams`.
- **HttpTarget** declares which HTTP methods it handles and runs a chain of middleware functions to produce the response. When a route matches but no target handles the request method, the router responds `405 Method Not Allowed`.

Routes may be nested. Nested routes compose their patterns (parent + child), and their middleware chains (parent inbound runs first; parent outbound runs last). A route with a `routes` array is a branch node that shares configuration with its children; a route with a `targets` array is a leaf endpoint.

### Route Matching Order

Route matching is ordered, not specificity-ranked. The router checks the virtual host's flattened route list from top to bottom and uses the first route whose composed `pattern` matches the request pathname. It does not keep looking for a more specific route after a match.

Nested routes are flattened in depth-first order, preserving the order in each `routes` array. Put more specific sibling routes before broader dynamic or wildcard routes:

```js
routes: [
    { pattern: '/platform.json', targets: [ ... ] },
    { pattern: '/platform', targets: [ ... ] },
    { pattern: '*', targets: [ ... ] },
]
```

Catch-all routes must stay last within the route set they belong to. A route such as `*`, `/:slug`, or `/*splat` can shadow later routes if it appears first.

### Route Pattern Matching

Route `pattern` values use the vendored `path-to-regexp` matcher. Static text must match exactly, and named matches are decoded and exposed on `request.pathnameParams` before request handlers run.

The matcher is for ordered path-like strings. Route patterns match `request.url.pathname` only; do not put query strings, URL fragments, JSON, or any arbitrarily ordered data in the pattern.

Use a colon-prefixed parameter to capture arbitrary text within one pathname segment. Parameter names can be any valid JavaScript identifier. Double-quote the name when it contains other characters:

```js
{
    pattern: '/users/:userId/posts/:"post-id"',
    targets: [ ... ],
}
```

A request for `/users/42/posts/intro` produces:

```js
request.pathnameParams.userId; // '42'
request.pathnameParams['post-id']; // 'intro'
```

Parameter names are required after `:`. A pattern such as `/users/:` is invalid; use a named parameter such as `/users/:id`.

The pattern string is not a JavaScript `RegExp`. Raw regexp groups and character classes are not supported in route patterns. Characters reserved by `path-to-regexp`, including `(`, `)`, `[`, `]`, `?`, `+`, and `!`, must be avoided or escaped when they need to match literally.

Use an asterisk-prefixed wildcard parameter to capture one or more characters across multiple pathname segments. Wildcard parameters must be named, and their values are arrays of decoded segment strings:

```js
{
    pattern: '/files/*path',
    targets: [ ... ],
}
```

A request for `/files/releases/2026/report.pdf` produces:

```js
request.pathnameParams.path; // [ 'releases', '2026', 'report.pdf' ]
```

Use braces to mark part of a pattern as optional. Optional groups can contain static text and parameters. Optional parameters are omitted from `request.pathnameParams` when that part of the path is not present:

```js
{
    pattern: '/{index.json}',
    targets: [ ... ],
},
{
    pattern: '/users{.json}',
    targets: [ ... ],
},
{
    pattern: '/files/:file{.:ext}',
    targets: [ ... ],
},
{
    pattern: '/users/invite{/}',
    targets: [ ... ],
}
```

Both `/` and `/index.json` match the first route, while `/users` and `/users.json` match the second route. The third route matches both `/files/report` and `/files/report.pdf`; the `ext` parameter is present only when the extension is present.

The fourth route uses the optional group to make a trailing slash optional: `/users/invite` and `/users/invite/` both match one route, without a redirect or a duplicate route entry. Use `{/}` on API endpoints where clients may or may not send the trailing slash. A nested route can also use the bare pattern `'{/}'` to mean "the parent pattern itself, with or without a trailing slash".

Do not use older `path-to-regexp` modifier syntax in new routes:

- For optional path parts, use braces: `/file{.:ext}`.
- For one or more path segments, use a named wildcard: `/*path`.
- For zero or more path segments, put the wildcard in an optional group: `/files{/*path}`.

Use the special app pattern `*` only for unnamed catch-all routes. This is a project-level shortcut; regular `path-to-regexp` wildcards must have names. The app pattern `*` matches every pathname and returns an empty `request.pathnameParams` object. If the handler needs the captured path segments, use a named wildcard pattern such as `/*splat` instead.

### Middleware vs. Request Handlers vs. Error Handlers

- **Route middleware** (`inboundMiddleware`, `outboundMiddleware`) applies to every target in a route subtree. Use it for capabilities like authentication, session loading, request normalization, and shared response headers.
- **Target `requestHandlers`** applies to one endpoint. Use them for resource authorization, loading data for a page, handling a form submission, calling a Transaction Script, setting render props, or returning a redirect response
- **Error handlers** (`errorHandlers`) Error handlers can be defined for routes and targets. When an error is encountered in a middleware or request handler it is handed off to the closest target or route error handler. When both a target and ancestor route have error handlers, the target error handlers run first, before the route error handlers. If the closest error handler does not handle the error it propagates up the routes tree, eventually getting handled by the global router handler if no other error handlers handle it.

The signature for middleware and request handler functions is:

```js
/**
 * @param {Object} context - Active request context
 * @param {Object} request - Incoming HTTP request
 * @param {Object} response - Response threaded through the middleware chain
 * @param {Function} skip - Stops the remaining request-phase middleware; outbound middleware still runs
 * @returns {Promise<Object>} Response for the next middleware
 */
async function requireAuthenticatedUser(context, request, response, skip) {
    const user = await context.getCurrentUser(request);

    if (!user) {
        response.respondWithJSON(401, { errors: [ { title: 'Sign in required' } ] });
        skip();
    }
    return response;
}
```

The signature for an error handler is:

```js
/**
 * Converts an authentication failure into a JSON response.
 * @param {Object} context - Active request context
 * @param {Object} request - Incoming HTTP request
 * @param {Object} response - Response threaded through the middleware chain
 * @param {Error} error - Error raised while handling the request
 * @returns {Object|false} A response when handled, or false to continue the error-handler cascade
 */
function handleAuthenticationError(context, request, response, error) {
    if (error.code !== 'UNAUTHENTICATED_ERROR') {
        return false;
    }

    return response.respondWithJSON(401, {
        errors: [
            {
                title: 'Authentication required',
                detail: 'Sign in before continuing.',
            },
        ],
    });
}
```

An error handler may also be async; in that case, it returns `Promise<ServerResponse|false>`. If the error handler handles the error, return the `response` object. Otherwise, return `false` to signal the error handler chain to try the next handler.

### Route handling execution order

Execution order for a matched target runs in two phases — a **request phase** followed by an **outbound (response) phase**:

1. Route inbound middleware (parent-first) — request phase
2. Target `requestHandlers` (in order) — request phase
3. Route outbound middleware (child-first) — outbound phase

When middleware or a request handler throws, the router emits an `error` event; for logging and, for unexpected errors, to trigger the platform server's graceful shutdown. Separately, the router runs the error-handler cascade: target, then route, then the router's built-in fallback, stopping at the first one that returns a response. The router error event fires for every failure regardless of what the cascade produces, so a target or route handler is free to render a normal-looking response even for an unexpected error without delaying or preventing the shutdown. Only when every cascade level returns `false` does the error propagate out of the router for the platform server's last-resort fallback.

When the error handling chain is triggered, the outbound phase is skipped for that request.

### Skipping Middleware and Request Handlers

**The `skip()` callback** ends the **request phase** early: when called, no further inbound middleware or request handlers run. The **outbound phase still runs to completion**, so response post-processing such as formatting, shared headers, and logging is never bypassed by `skip()`. Use `skip()` when a request handler has committed a terminal response (a redirect or JSON document) and you want to stop a later request handler — such as a Hyperview render handler — from running. Do not reach for `skip()` merely because you committed a response; if no later request handler needs to be bypassed, just return the response. Outbound middleware is not passed `skip()` and cannot short-circuit the chain.

```js
export async function redirectAfterSuccess(context, request, response, skip) {
    // Stops a later Hyperview render handler in this target from running, while
    // still letting route outbound middleware post-process the redirect response.
    skip();
    return response.respondWithRedirect(303, '/account');
}
```

## Reverse Routing

The routing layer is also a source of truth for URLs. Instead of hardcoding pathname strings look up the `HttpTarget` that owns an endpoint from the request context and compile its pathname from parameters. This keeps every internal link, redirect `Location`, and form `action` correct when a route `pattern` changes — you edit the pattern in `virtual-hosts.js` and every caller that compiles through the target follows automatically.

The `RequestContext` exposes three lookup methods, and each `HttpTarget` can reverse-compile its own pathname.

### Target Names

Targets are addressed by a **fully-qualified name** of the form `routeName/targetName`. Nested routes compose their names parent-first, so a target named `render-form` under a route named `admin-login-form` is addressed as `admin-login-form/render-form`, and a target `render-style-guide-page` under the nested `admin-panel` → `style-guide` routes is `admin-panel/style-guide/render-style-guide-page`. A route with no explicit `name` falls back to its `pattern`.

Give every target you intend to reference a stable `name`. Renaming a route or target changes its fully-qualified name and breaks lookups, so target names are part of your application's internal contract.

### Looking Up Targets

| Method | Returns | Behavior |
|---|---|---|
| `context.getHttpTarget(name)` | `HttpTarget` | Returns the first target whose fully-qualified name matches `name`. Throws `AssertionError` when `name` is not a non-empty string or no target matches. Returns the first match if names collide. |
| `context.getAllHttpTargets()` | `Array<HttpTarget>` | Every target in the matched virtual host's flattened route set, in route iteration order. |
| `context.getHttpTargetsByTag(tag)` | `Array<HttpTarget>` | Only targets that declare `tag`, in route order. Returns an empty array when none match. Throws `AssertionError` when `tag` is not a non-empty string. |

All three resolve against the route set of the virtual host that matched the current request, which the router injects before handlers run. They are request-scoped accessors: call them inside a middleware or request handler, not at module load time.

Tags are declared per target in `virtual-hosts.js` and are useful for grouping endpoints that a single piece of UI needs to enumerate — a primary navigation menu, a sitemap, an admin tool index:

```js
{
    name: 'dashboard',
    methods: [ 'GET', 'HEAD' ],
    tags: [ 'admin-nav' ],
    requestHandlers: [ getDashboard, HyperviewPageHandler() ],
}
```

### Compiling Pathnames

`HttpTarget#compilePathname(params)` reverse-compiles the target's route pattern into a concrete URL.

```js
const target = context.getHttpTarget('bugs/show');
const { method, pathname } = target.compilePathname({ id: 'BUG-123' });
// For pattern '/bugs/:id' -> method: 'GET', pathname: '/bugs/BUG-123'
```

- Returns `{ method, pathname }`. The `pathname` is the compiled path; the `method` is the target's **preferred** HTTP method, chosen by the priority order `GET > POST > PUT > PATCH > DELETE > HEAD` (falling back to the target's first declared method). Use `method` to fill a form's `method` attribute or to decide between a link and a form.
- Provide a string for each `:name` parameter and an array of segments for each `*name` wildcard parameter. See [Route Pattern Matching](#route-pattern-matching) for the parameter syntax. Passing an object that already carries the needed keys is fine — extra keys are ignored — which is why forms pass `this` (see [Forms](#forms)).
- Values are URL-encoded for safe output, so non-ASCII text and reserved characters are escaped.
- Throws when the target's pattern is the catch-all `*`, because a wildcard pattern carries no information to rebuild a concrete pathname. Compile against a named target instead.

Query strings and fragments are not part of route patterns, so append them yourself after compiling:

```js
const loginTarget = context.getHttpTarget('admin-login-form/render-form');
const { pathname } = loginTarget.compilePathname();
const location = `${ pathname }?notice=session_create_failed`;
```

### Use Cases for Reverse Routing

- **Form action URLs.** `BaseForm#getFormContext()` resolves `static target` through `getHttpTarget()` and compiles the form's `action` pathname, so a form never hardcodes where it posts. See [Forms](#forms).
- **Redirect targets after a write.** After a successful form submission, compile the destination target's pathname for the `303` `Location` rather than writing a literal string:

  ```js
  const ticketTarget = context.getHttpTarget('bugs/show');
  skip();
  return response.respondWithRedirect(303, ticketTarget.compilePathname({ id: ticket.id }).pathname);
  ```

- **Cross-links between pages.** A handler that renders a page can compile links to related endpoints and pass them as render props, keeping URL construction out of templates:

  ```js
  const newUserTarget = context.getHttpTarget('new-admin-user-form/render-form');
  return response.updateProps({
      links: { newUserForm: newUserTarget.compilePathname().pathname },
  });
  ```

- **Tag-driven navigation and sitemaps.** Enumerate targets by tag to build a menu or index without listing routes by hand. Compile each target and pass the list to the template:

  ```js
  const navTargets = context.getHttpTargetsByTag('admin-nav');
  const nav = navTargets.map((target) => {
      return { name: target.name, href: target.compilePathname().pathname };
  });
  return response.updateProps({ nav });
  ```

- **Introspection and debugging.** `getAllHttpTargets()` returns the full target set for the current virtual host, useful for building a route index page or asserting routing expectations in development.

## Request Handlers

A request handler's job is to interpret the incoming HTTP request and coordinate a response, but it should not contain domain logic. See `app/transaction-scripts/README.md` for how to write the Transaction Scripts which contain the domain logic that request handlers call.

Request handlers may:

- Read `request.pathnameParams`, query string values, headers, cookies, and request body data.
- Parse `FormData` or JSON:API payloads into form classes.
- Validate forms and translate validation errors into response props, setting the response status on inline error re-renders (see [Response Status on Re-rendered Errors](#response-status-on-re-rendered-errors)).
- Call Transaction Scripts in `app/transaction-scripts/` to load or mutate data.
- Call `response.updateProps({ ... })` to pass render data to `HyperviewPageHandler`.
- Return redirects, JSON:API responses, or rendered HTML responses through Hyperview or error handlers.

Request handlers should not:

- Put business rules or domain mutations directly in the handler.
- Use native Node.js modules, filesystem access, or native Cloudflare bindings.
- Build HTML strings when the response should be rendered by Hyperview templates.
- Own browser application state that should instead be represented by links, forms, redirects, and server-rendered HTML.

For write requests from HTML forms, parse and validate the form, call the Transaction Script, then redirect on success or re-render on validation failure:

```js
import CreateBugTicketForm from '../forms/create-bug-ticket-form.js';
import { createBugTicket } from '../../transaction-scripts/bugs/create-bug-ticket.js';
import { ValidationError } from '../../../kixx/errors/mod.js';

export async function handleCreateBugTicket(context, request, response, skip) {
    const form = CreateBugTicketForm.fromFormData(await request.formData());

    try {
        form.validate();
    } catch (err) {
        if (err.name === 'ValidationError') {
            response.status = err.httpStatusCode;
            return response.updateProps({ form: form.getFormContext(context, err) });
        }
        throw err;
    }

    const ticket = await createBugTicket(context, form);
    const ticketTarget = context.getHttpTarget('bugs/show');

    skip();
    return response.respondWithRedirect(303, ticketTarget.compilePathname({ id: ticket.id }).pathname);
}
```

When validation failure should re-render a page, `HyperviewPageHandler(...)` after this handler in the target chain will run automatically (since `skip()` was not called). When success returns a redirect, `skip()` prevents the Hyperview handler from running and needlessly rendering a page.

### Rendering a Page with HyperviewPageHandler

`HyperviewPageHandler()` (`app/presentation/request-handlers/hyperview/hyperview-page-handler.js`) is the route adapter which renders a Hyperview page as the response. Place it **last** in a target's `requestHandlers` chain: earlier handlers read the request, add template data with `response.updateProps()`, add rendering controls with `response.setRenderingOptions()`, and this handler delegates rendering to the shared presentation facade.

```js
{
    name: 'show',
    pattern: '/bugs/:id',
    methods: [ 'GET', 'HEAD' ],
    requestHandlers: [ getBug, HyperviewPageHandler({ pathname: '/bugs/detail' }) ],
}
```

Pass `pathname` whenever the route pattern contains dynamic segments. Without it the page is looked up by the request pathname, so `/bugs/BUG-123` would need its own `pages/` and `templates/pages/` directories. A stable `pathname` points every request at one published page.

The response status is whatever an earlier handler set, so a re-rendered validation error keeps its 4xx.

**Render modes.** The same page serves three granularities, and the client selects one by request header:

| Request header | Rendered output | Used for |
|---|---|---|
| `kixx-partial: <partial-id>` | That page partial alone | Replacing a fragment of the current document in place |
| `kixx-boosted` | The page template, without its base template | Swapping the body during a page transition |
| Neither | The page template wrapped in the base template | A cold request for a complete document |

A full-page render requires `baseTemplateId`; the other two modes ignore it.

**Where the options come from.** Three sources are merged by `respondWithHyperviewPage()`, later sources winning over earlier ones:

1. The options passed to `HyperviewPageHandler(...)` — the route's own configuration, fixed at startup.
2. `response.renderingOptions` — a per-request replacement set by an earlier handler through `response.setRenderingOptions()`. Use it when the render mode depends on what the request handler found, not on the route.
3. The `kixx-partial` and `kixx-boosted` request headers, which win over both.

```js
// Re-render only the results table when the request handler knows the
// client is asking for a filtered list.
response.setRenderingOptions({ partial: 'results-table' });
response.updateProps({ results });
```

`respondWithHyperviewPage(context, request, response, defaultOptions)` is also available from `app/presentation/lib/respond-with-hyperview-page.js` for terminal presentation code such as error handlers. It uses the same option precedence and service lookup as `HyperviewPageHandler`; call it directly only when the normal request-handler phase cannot continue. It passes `request.url` and `response.props` to `HyperviewService#renderPage()`, then owns JSON serialization and HTTP status, headers, content type, and body commitment.

**Options.** All are optional.

| Option | Effect |
|---|---|
| `pathname` | Canonical page identifier; defaults to the normalized request pathname |
| `baseTemplateId` | Canonical base template identifier; required for full-page rendering |
| `partial` | Canonical page-partial identifier to render instead of the page and base templates |
| `skipBaseRender` | Render the page template without its base template |
| `usePageCache` | Enable rendered-page cache reads and writes; defaults to the configured value |
| `cacheKey` | Cache identity component; defaults to request origin, pathname, and query string |
| `includePropsInCacheKey` | Include response props in the cache identity; defaults to true whenever page caching is on |
| `propsHashFunction` | Custom response-props hash, used only with page caching and props-sensitive keys |
| `pageCacheReadTtlSeconds`, `pageCacheExpirationSeconds` | Page-cache read TTL and write expiration; default to the configured values |
| `allowJsonResponse` | Serve assembled page context for `.json` requests; defaults to the configured value |
| `responseOptions` | `{ contentType, headers }` used only by the facade when it commits hypertext |

Leave `includePropsInCacheKey` alone unless you are certain the page renders identically for every viewer. It defaults to `true` with page caching on precisely so a page rendered for one signed-in user is never served to the next.

### Error Handling

Every error a request handler or middlware encounters must be classified into one of two buckets:

- **Expected errors** - also known as "operational errors" - are errors the Requset Handler logic is prepared for and will handle internally.
- **Unexpected errors** - also known as "programmer errors" - are errors which come from code paths the Request Handler logic assumes should be unreachable, or should not be present in a healthy system.

A Request Handler should never attempt to handle unexpected errors, other than by logging and rethrowing. Generally speaking, an unexpected error should crash the system. A Request Handler may decide to wrap an unexpected error and rethrow it as an AssertionError if it can provide more useful context for debugging.

A truthy `error.expected` flag means the error was considered operational from where it was thrown. Wrap a caught expected error as an `AssertionError` (with `cause`) and rethrow only when it arrives from a code path whose occurrence violates the handler's own invariant — one the handler assumed could not produce that error. This is what results in an HTTP 500 and a server crash, which is the intended outcome once an assumed-unreachable path turns out to be reachable.

A Request Handler should act with discretion when expected operational errors occur. Depending on the context:

- **When the caught error is not a defined HTTP error** - When the `error.httpError` flag is falsy - Wrap the error in an HTTP error class from `src/kixx/errors/` (imported as `kixx/errors/mod.js`) or set the `error.httpStatusCode` property so that the status code is properly returned to the client
- **When the error comes from a code path that is not accounted for** - Wrap the cause in an AssertionError and rethrow.

Use error properties like `error.name`, `error.code`, and `error.expected` instead of `instanceof` to drive logical code branches.

Messages on HTTP errors are serialized by the router fallback, so they must be safe to show to clients. Do not put secrets, raw upstream payloads, stack details, KV keys, or internal identifiers in an HTTP error message.

Use a custom `code` when callers or templates need to distinguish a domain-specific outcome while keeping the HTTP status generic.

### Response Status on Re-rendered Errors

A request handler that catches an expected error and re-renders the page inline — rather than letting the error reach the route error handler — owns the response status for that outcome. A caught `ValidationError` or `ConflictError` that only calls `updateProps()` goes out as the default `200` even though the page reports an error.

Be sure to set the status yourself in each inline error re-render branch in a request handler. Set `response.status` from `error.httpStatusCode`, falling back to `500` only when a more appropriate error code cannot be determined. Pass the original caught error even when it has been reclassified for display, so the status describes the error that actually occurred (a name conflict stays `409` even when shown as a field message).

Enumeration-sensitive re-renders — throttled, invalid-invite/verification, and invalid-credentials states — should stay `200` on purpose so the status line does not become an identity or rate-limit oracle. These flows collapse valid, unknown, expired, and throttled outcomes into one indistinguishable response; a distinct `403`/`404`/`429` status would leak exactly the signal the identical HTML bodies work to hide.

## RequestContext, Request and Response Objects

Every middleware function and request handler receives `(context, request, response)`. All three objects are described below.

### RequestContext

`context` is a `RequestContext` instance. It is created once per request and carries the request environment, logger, authenticated principle, and registered services and collections.

**Properties:**

| Property | Type | Notes |
|---|---|---|
| `config` | `Object` | Resolved application configuration |
| `env` | `Object` | Platform specific environment bindings |
| `logger` | `Logger` | Root application logger; use for structured log output |
| `requestId` | `string\|undefined` | Matches `request.id`; use for log correlation |
| `runtime` | `AppRuntime` | Metadata indicating whether the app is serving HTTP or running a CLI command |
| `user` | `Object\|null` | Authenticated user set by auth middleware; `null` when not authenticated |

**Authenticated Principals:**

Authentication middleware should store the current authenticated principal on `context.user` with `context.setUser(principal)`. The principal is often a human user, but it may also represent an API token, service account, webhook sender, or another non-user credential.

**Methods:**

Service and collection access:

| Method | Returns | Notes |
|---|---|---|
| `getCollection(name)` | Collection instance | Preferred way to access durable document data; throws if not registered |
| `getService(name)` | Service instance | Access registered application services (e.g. `'ObjectStorageService'`, `'EmailService'`); throws if not registered |
| `getHttpTarget(name)` | HttpTarget instance | Looks up a registered route target by name for reverse pathname compilation; throws if not found |
| `getAllHttpTargets()` | Array<HttpTarget> | Returns every target in the current virtual host's route set |
| `getHttpTargetsByTag(tag)` | Array<HttpTarget> | Returns targets that declare the given tag, in route order |

See [Reverse Routing](#reverse-routing) for how to use these target lookups with `HttpTarget#compilePathname()` to build form actions, redirect locations, and navigation links without hardcoding URLs.

Accessing environment vars:

```js
const siteName = context.getEnvString('SITE_NAME', { required: true });
const cacheTtl = context.getEnvInteger('CACHE_TTL_SECONDS');
const sampleRate = context.getEnvFloat('LOG_SAMPLE_RATE');
const debugEnabled = context.getEnvBoolean('DEBUG_ENABLED');
```

Use the helper that matches the type your code expects:

- `getEnvString(key, options)` returns a non-empty string, or `undefined` when the env var is missing.
- `getEnvInteger(key, options)` returns an integer number from a numeric value or base-10 string, or `undefined` when the env var is missing.
- `getEnvFloat(key, options)` returns a number from a numeric value or float string, or `undefined` when the env var is missing.
- `getEnvBoolean(key)` returns `true` only for `true`, `1`, `"true"`, or `"1"`. Missing and unrecognized values return `false`.

`getEnvInteger()` and `getEnvFloat()` parse a string value with `Number.parseInt()`/`Number.parseFloat()`, which only consume a leading numeric prefix — they do not require the whole string to be numeric. `getEnvInteger()` returns `1` for `"1.5"` and `12` for `"12px"`; `getEnvFloat()` returns `1.5` for `"1.5px"`. Only a value with no parseable leading number (e.g. `"abc"`) throws. Set the env var to a strictly numeric string if you need the value validated as such.

Pass `{ required: true }` to the string, integer, or float helpers when the application cannot run without that value. Required helpers throw an `AssertionError` when the env var is missing or empty. Numeric helpers also throw an `AssertionError` when a present value has no parseable leading number of the expected type.

### ServerRequest

`request` satisfies the `ServerRequestInterface` contract: `kixx/http-router/server-request-interface.js`

### ServerResponse

`response` is a `ServerResponse` instance defined in `kixx/http-router/server-response.js`. Middleware builds the response by mutating it; the final state is sent to the client.

**Mutable properties** — set directly when needed:

- `response.status` — HTTP status code (default `200`)
- `response.body` — response body: string, Buffer, ReadableStream, or `null`
- `response.headers` — Web API `Headers` instance; use `setHeader()`/`appendHeader()` instead of mutating directly

**Passing template data between middleware** — use `updateProps()` to accumulate render context without committing a response body. The rendering handler (usually `HyperviewPageHandler`) reads these props to render the page template. Earlier middleware's props are readable via `response.props` if a later handler needs them.

```js
response.updateProps({ page: { title: 'My Page' }, ticket });
```

`updateProps()` deep-merges using `structuredClone`. Pass plain objects only — functions, class instances, and other non-cloneable values will cause it to throw. Nested objects merge rather than replace.

**Passing rendering controls** — use `setRenderingOptions()` for rendering behavior that must not become template context or page-context JSON data. It replaces every prior rendering option with a shallow copy, so use `{}` to clear state before rendering another representation. Functions and other non-cloneable option values are allowed.

```js
response.setRenderingOptions({ partial: 'results-table' });
```

**Committing a response** — use the `respond*` methods to set status, headers, and body together:

| Method | Use case |
|---|---|
| `respond(status, headers, body)` | Generic — full control over all three |
| `respondWithRedirect(status, location, options)` | Sets `Location` header; status is typically `301`, `302`, or `303` |
| `respondWithJSON(status, obj, options)` | Serializes to JSON; sets `Content-Type` and `Content-Length` |
| `respondWithHTML(status, html, options)` | Sets `text/html; charset=utf-8`; calculates byte-accurate `Content-Length` |
| `respondWithUtf8(status, text, options)` | General UTF-8 text; defaults to `text/plain` |
| `respondWithStream(status, stream, options)` | Streams a `ReadableStream`; pass `null` for `stream` on HEAD responses |

**Cookie helpers:**

```js
response.setCookie('session', token, { maxAge: 86400, path: '/' });
response.clearCookie('session', { path: '/' });
```

`setCookie` defaults to `Secure; HttpOnly; SameSite=Lax`. Pass `secure: false` for local development. Pass `httpOnly: false` for client-readable cookies.

**Chaining** — all `respond*`, `setHeader`, `appendHeader`, `setCookie`, `clearCookie`, `updateProps`, and `setRenderingOptions` methods return `this`, so they can be chained or returned directly:

```js
return response.updateProps({ page: { title: ticket.title }, ticket });
```

## Forms

Forms are the primary organizing logic for getting data into the application. Any data input into the system — HTML form submissions, JSON:API requests, webhooks, external APIs — should go through a form. A form owns one responsibility: turn an untrusted payload into a normalized, validated value object that a Transaction Script can consume. Keep domain logic, storage access, and CSRF handling out of the form.

Form files live in `app/presentation/forms/`, grouped into a subdirectory per feature (`admin-users/`, `publishing-api-tokens/`, `migrations/`). A single file may export more than one form when the forms belong to the same UI — for example a create form as the `default` export and a companion revoke form as a named export.

### Anatomy of a Form

Every form, HTML-backed or API-only, is built from the same parts:

- **`static schema`** — JSON Schema describing the accepted fields. *ALL forms SHOULD include a schema definition as best practice.* The schema is the single source of truth: `validate()` reads its bounds (`minLength`, `maxLength`, `enum`) rather than duplicating literals, and HTML forms render controls from its metadata.
- **A normalizing `constructor(attributes)`** — destructures the raw payload (guarding with `?? {}`) and assigns one normalized value per field. Normalization and validation are deliberately separate: the constructor cleans up shape (trim, lowercase, coerce absent-to-null) but **preserves invalid input** so `validate()` can still report a field error instead of silently coercing bad data away.
- **`validate()`** — accumulates field errors on a single `ValidationError` via `error.push(message, source)` and throws only when `error.length` is non-zero. Never throw on the first bad field; collect them all so the re-rendered form can show every problem at once.
- **`from*()` static constructor(s)** — `fromFormData(formData)` for browser submissions (provided by `BaseForm`), `fromJsonApi(resource)` for JSON:API payloads, or both when one form backs two entry points.
- **`toJSON()`** — returns the plain, server-consumable value object handed to the Transaction Script. This is also where a form maps its UI-facing fields onto the domain shape (for example, injecting a default permission grant the UI does not expose). `toJSON()` is required for API forms and for any form whose UI-facing field names differ from the domain shape; otherwise the validated form instance is passed to the Transaction Script directly, and adding a pass-through `toJSON()` is unnecessary ceremony.

### HTML Forms Extend `BaseForm`

Forms that back HTML pages extend `BaseForm` (`app/presentation/forms/base-form.js`) and add three static properties:

- **`static target`** — the registered `HttpTarget` name used to compile the browser form action URL through reverse routing (see [Reverse Routing](#reverse-routing)). A form never hardcodes where it posts.
- **`static method`** — the HTTP method for the submission, almost always `'POST'`.
- **`static schema`** — JSON Schema extended with HTML render metadata per property.

`BaseForm` provides the pieces every HTML form would otherwise duplicate:

- **`getFormContext(context, error)`** builds the template render context: it resolves `static target` to an `HttpTarget`, compiles the action `url` (passing the form instance so any route params are hydrated), and projects each schema property into a `fields` map carrying the current value, render metadata, and any per-field error message. Pass it the `ValidationError` caught in the request handler to re-render with inline field errors, or a domain error code string for a form-level message.
- **`getDynamicFieldMetadata(context)`** is the hook for render metadata that cannot be declared statically in the schema. It returns partial field metadata keyed by field name, which `getFormContext()` merges over the schema metadata.
- **`static fromFormData(formData)`** hydrates the subclass from submitted `FormData`, treating each field as a scalar (last value wins on duplicates).

**Never override `getFormContext()`.** It owns the action-URL compilation, the per-field error projection, and the `writeOnly` value omission, and a subclass that rebuilds or patches the context it returns can break any of them — including echoing a submitted password back into a re-rendered form. There are exactly two extension points:

- **`getDynamicFieldMetadata(context)`** — when a field's render metadata is sourced at request time rather than declared statically in the schema. The canonical case is a `select` whose `options` come from a registry (`AdminInviteCreateForm` fills `role_id` from the role registry) so the rendered choices cannot drift from what the Transaction Script accepts.
- **`static fromFormData(formData)`** — when the form has multi-value controls, file inputs, or array-typed fields that need `formData.getAll()`.

```js
getDynamicFieldMetadata() {
    const options = listAttachableRoles('admin').map((role) => ({ value: role.id, label: role.name }));

    return {
        role_id: {
            label: 'Role',
            options,
        },
    };
}
```

The merge is deliberately narrow. Dynamic metadata overrides static schema keys, but `getFormContext()` applies the field `name`, `value`, and `error` afterward, so a subclass can neither defeat the `writeOnly` omission nor forge a field error.

The hook is synchronous, matching `getFormContext()`. When the metadata needs I/O, load it in the request handler, assign it to the form instance, and read it from `this` in the hook. Do not push the I/O into the render path.

### Schema HTML Metadata

`getFormContext()` copies each property's schema keys onto the rendered field, so templates read whatever metadata you declare. Conventions used across the codebase:

- **`label`** — human label for the control.
- **`fieldType`** — the control kind the template should render (`'text'`, `'textarea'`, `'select'`, `'hidden'`).
- **`inputType`** — the HTML `<input type>` (`'email'`, `'password'`), kept distinct from `fieldType` so a template can choose the control independently of the input type.
- **`autocomplete`** — the browser autofill hint (`'email'`, `'new-password'`, `'current-password'`).
- **`hint`** — help text shown near the field.
- **`options`** — value/label pairs for `select` controls.
- **`writeOnly: true`** — a security convention, not decoration: `getFormContext()` omits the field's `value` from the render context so a submitted secret (a password) is never echoed back into a re-rendered form after a validation error.

### Normalization Helpers

Constructors normalize with the shared helpers in `app/presentation/forms/utils.js` rather than re-implementing it. Each helper returns the original value unchanged when it is not usable, which is what keeps invalid input intact for `validate()`:

- **`normalizeStringAttribute(value)`** — trims a required string.
- **`normalizeLowerCaseStringAttribute(value)`** — trims and lowercases; use for email addresses so lookups are case-insensitive.
- **`normalizeSecretStringAttribute(value)`** — coerces to a primitive string but does **not** trim, preserving a password exactly as entered.
- **`normalizeOptionalStringAttribute(value)`** — trims and collapses absent or blank input to `null`.
- **`validateEmailAddressField(error, value, name)`** — pushes a field error when an email value is missing or malformed; call it from `validate()`.

Prefer these to hand-written normalization so behavior stays consistent, and add a new shared helper here when a normalization pattern appears in more than one form.

### Companion Forms in One File

When a feature UI needs a paired action — such as a create form and a per-row revoke form — co-locate them in one file: the primary form as the `default` export, the companion as a named export. A revoke form typically declares its own `static target` (the revoke route shares one action URL across rows) and a single hidden id field, so each rendered row submits exactly one record id:

```js
static schema = {
    type: 'object',
    properties: {
        token_id: { type: 'string', fieldType: 'hidden' },
    },
    required: [ 'token_id' ],
};
```

A form that mints a record from server-derived data only — no operator-entered fields — still exists to carry the CSRF token and compile its reverse-routed action URL, and declares an empty `properties: {}` schema.

## API-Only Forms

Forms used only by JSON:API endpoints do **not** extend `BaseForm` and do not declare `method`, `target`, or `getFormContext()`, because they are never rendered as HTML and never compile a browser form action. They keep the rest of the anatomy: a `schema`, a normalizing constructor (reuse the `utils.js` helpers), a `validate()` that accumulates field errors on a `ValidationError`, a `fromJsonApi(resource)` static constructor that reads `resource.attributes`, and a `toJSON()` that returns server-consumable data. Because these forms have no `BaseForm` to inherit `fromFormData()` from, `fromJsonApi()` is their only entry point.

A form can serve both entry points when the same fields arrive over HTML and JSON:API — extend `BaseForm` for the HTML side and add a `fromJsonApi()` that maps the API attribute names onto the constructor's field names.

```js
import { isString } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { normalizeOptionalStringAttribute } from '../utils.js';

export default class CreateApiTokenForm {

    /**
     * JSON Schema for accepted token-creation attributes.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            description: {
                type: [ 'string', 'null' ],
                description: 'Optional operator-facing token description',
            },
        },
    };

    /**
     * @param {Object} [attributes] - JSON:API token-creation attributes.
     * @param {*} [attributes.description] - Operator-facing token description.
     */
    constructor(attributes) {
        const { description } = attributes ?? {};
        this.description = normalizeOptionalStringAttribute(description);
    }

    /**
     * Validates the normalized token-creation fields.
     * @returns {void}
     * @throws {ValidationError} When a field is invalid.
     */
    validate() {
        const error = new ValidationError('The API token form contains invalid fields');

        if (this.description !== null && !isString(this.description)) {
            error.push('Description must be a string or null', 'description');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the normalized fields consumed by the Transaction Script.
     * @returns {{ description: string|null }} Plain JSON form values.
     */
    toJSON() {
        return {
            description: this.description,
        };
    }

    /**
     * Creates the form from a parsed JSON:API resource.
     * @param {{ attributes: Object }} resource - Parsed resource from parseJsonApiResource().
     * @returns {CreateApiTokenForm} Hydrated token-creation form.
     */
    static fromJsonApi(resource) {
        const { attributes } = resource ?? {};
        return new CreateApiTokenForm(attributes);
    }
}
```

## CSRF-Protected HTML Forms

Use `app/presentation/lib/csrf.js` for browser HTML forms that mutate state or establish authentication. CSRF validation belongs in request handlers before constructing a Form and before calling any Transaction Script.

CSRF tokens are stateless: `app/presentation/lib/csrf-token-signer.js` signs and verifies an HMAC envelope binding a browser-side `sid` cookie value and an expiration, so validating a submission touches no storage. Renders set the `sid` on every response since the value is not sensitive on its own.

On GET handlers, render the form through `getCsrfFormContext()`. The helper calls `form.getFormContext(context, error)`, mints a fresh CSRF token, sets the browser CSRF cookie, and returns the usual form context with `form.csrf.fieldName` and `form.csrf.token` added:

```js
import { getCsrfFormContext } from '../lib/csrf.js';

export async function getCreateBugForm(context, request, response) {
    const form = new CreateBugForm();

    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form),
    });
}
```

On POST handlers, call `validateCsrfFormData()` before constructing the Form. That helper owns `request.formData()` because request bodies are one-shot; do not call `request.formData()` again after it returns, and do not reach for `request.json()`, `request.text()`, or `request.arrayBuffer()` either — any of them reads the same consumed body. Missing, expired, or mismatched CSRF data throws an expected HTTP error before domain logic runs.

```js
import { validateCsrfFormData } from '../lib/csrf.js';

export async function postCreateBugForm(context, request, response, skip) {
    const formData = await validateCsrfFormData(context, request);
    const form = CreateBugForm.fromFormData(formData);

    form.validate();
    await createBug(context, form);

    skip();
    return response.respondWithRedirect(303, '/bugs');
}
```

On validation or domain errors that re-render the form, call `getCsrfFormContext(context, request, response, form, error)` again so the response carries a fresh token. After successful signup, login, or another flow that should end the CSRF cookie's usefulness, call `clearCsrfToken(request, response)` after setting the real session cookie.

The CSRF cookie is browser-wide, so a render does not replace its `sid`: each render mints a fresh token bound to the existing `sid`, and a submission remains valid for as long as the token's expiration allows — it is not spent on use. Opening a second tab, reloading, or rendering several forms on one page therefore leaves every other open form submittable, and a resubmission (e.g. a back-button retry) is accepted rather than rejected. Rotating the signing secret invalidates every form currently open.

A token can still be rejected: the cookie is missing, the submitted field is missing, the token is forged, it is expired, or it was minted for a different `sid` (for example after the cookie was cleared or replaced). Left uncaught, that `ForbiddenError` reaches the route error handler and replaces the whole page with a generic error page, costing the operator their place. Where the surface can recover, catch `error.code === 'InvalidCsrfTokenError'` and hand back a usable page instead: re-render inline with a fresh token when the route owns a page, or redirect to the page that does and carry a notice code.

Templates should render the hidden field directly inside the protected `<form>`:

```html
{{#if form.csrf}}
<input type="hidden" name="{{ form.csrf.fieldName }}" value="{{ form.csrf.token }}">
{{/if}}
```

## Common Task Recipes

### Content-Only Page

For a page whose content is assembled from page metadata, includes, and templates rather than request-specific data:

1. Add or update the route in the `routes/` module that owns the surface, mounted from `virtual-hosts.js`, matching the page's exact pathname. End the target's `requestHandlers` with `HyperviewPageHandler({ baseTemplateId: 'default.html' })`. See [Routing](#routing).
2. Add or update `src/pages/<pathname>/page.json` for metadata and page context, including its `template` directive.
3. Add or update the named template under `src/templates/pages/` for route-specific markup.
4. Put page-local supporting content next to the page and reference it from `includes` in `page.json`.
5. Put page-local partial sources under `src/templates/pages/` and reference them from `partials` in `page.json`.
6. Add shared layout changes to `src/templates/base/` or `src/templates/partials/` only when the change should affect multiple pages.

`baseTemplateId` is required for a full-page render (see [Rendering a Page with HyperviewPageHandler](#rendering-a-page-with-hyperviewpagehandler)); a bare `HyperviewPageHandler()` fails an assertion on a normal request. Because the route pattern matches the page's pathname exactly, no `pathname` option is needed — the page is looked up by the request pathname.

### Dynamic Page

For a page that needs route parameters, records loaded through Transaction Scripts, session state, or other request-specific data:

1. Add or update the route in the `routes/` module that owns the surface, mounted from `virtual-hosts.js`. Reserve edits to `virtual-hosts.js` itself for mounting a new subtree, adding a virtual host, or changing subtree-level configuration. See [Routing](#routing).
2. Add a request handler in the appropriate barrel file in `app/presentation/request-handlers/` to read route parameters, query strings, cookies, headers, or body data.
3. Have the request handler call a Transaction Script when domain data is needed, prepare render data, and call `response.updateProps({ ... })`.
4. When rendering markup, end the target's `requestHandlers` chain with `HyperviewPageHandler(...)`. See [Rendering a Page with HyperviewPageHandler](#rendering-a-page-with-hyperviewpagehandler).
5. If the route pattern contains dynamic segments such as `/:id`, pass a stable `pathname` option to `HyperviewPageHandler` so the handler can locate the appropriate `src/pages/**` directory.
6. Add or update `src/pages/<pathname>/page.json` for metadata and page context, including its `template` directive.
7. Add or update the named template under `src/templates/pages/` for route-specific markup.
8. Put page-local supporting content next to the page and reference it from `includes` in `page.json`.
9. Put page-local partial sources under `src/templates/pages/` and reference them from `partials` in `page.json`.
10. Add shared layout changes to `src/templates/base/` or `src/templates/partials/` only when the change should affect multiple pages.

### Form-Backed HTML Workflow

For a workflow that accepts user input:

1. Define a form class in `app/presentation/forms/` with `method`, `target`, `schema`, a `from*()` constructor, and `validate()`. See [Forms](#forms) above.
2. In the request handler, parse the payload into the form, validate it, and then call the appropriate Transaction Script.
3. On success, prefer an HTTP redirect for browser form submissions.
4. On validation failure, update response props with the form context and render the page with the validation error state.

### JSON:API Endpoint

For an application API endpoint that accepts or returns JSON:API documents:

1. Add a route subtree or leaf route in `virtual-hosts.js`. Expected errors not handled by a route or target error handler reach the router fallback, which serializes them as JSON:API `errors` documents. Unexpected errors continue to propagate to the platform server's fatal-error policy.
2. In the request handler, call `assertJsonApiContentType(request)` before parsing a JSON:API request body. JSON:API requests must use `Content-Type: application/vnd.api+json`; optional media-type parameters are ignored by the helper.
3. Parse resource documents with `parseJsonApiResource(request, expectedType)`, then pass the whole returned resource into an API form (`fromJsonApi`, `validate`, `toJSON`) before calling a Transaction Script. `fromJsonApi(resource)` always takes the resource and reads `resource.attributes` itself — the form owns the mapping from wire shape to domain shape. If destructuring the JSON API payload is trivial, it can be done in the request handler, otherwise use an API form.
4. On success, respond with `jsonApiResource(...)` and `response.respondWithJSON(status, document, { contentType: JSON_API_CONTENT_TYPE })`.

### Serving Static Assets

`StaticAssetRequestHandler` serves content-addressable blobs from the registered `ContentAddressableStore`. Wire it twice: a fingerprinted `/assets/:hash/*pathname` route before the catch-all, then pathname mode ahead of `HyperviewPageHandler` for fixed URLs such as `/favicon.ico`.

```js
import StaticAssetRequestHandler from './kixx/static-assets/static-asset-request-handler.js';

{
    pattern: '/assets/:hash/*pathname',
    name: 'fingerprinted-assets',
    targets: [
        {
            name: 'serve',
            methods: [ 'GET', 'HEAD' ],
            requestHandlers: [
                StaticAssetRequestHandler({ fingerprinted: true }),
            ],
        },
    ],
}
```

Fingerprint URLs carry an immutable content hash, use an immutable cache policy, and can return `304` for a matching `If-None-Match` without reading storage. Pathname URLs resolve through the current snapshot and revalidate by default.

For lookup and caching details, see `kixx/static-assets/README.md`.

## Where Presentation Changes Belong

- `src/pages/` contains route-specific page metadata and included content files.
- `src/templates/pages/` contains page templates and page-local partial source files.
- `src/templates/base/` contains shared HTML document frames.
- `src/templates/partials/` contains shared template fragments such as styles, metadata, and reusable markup.
- `virtual-hosts.js` declares the virtual hosts and mounts the route subtrees under each one.
- `routes/` contains the route subtrees themselves — one module per API or UI surface — connecting patterns and HTTP methods to middleware and request handlers.
- `app/presentation/request-handlers/` contains application request handlers.
- `app/presentation/middleware/` contains application inbound and outbound middleware.
- `app/presentation/error-handlers/` contains application error handlers.
- `app/presentation/forms/` contains form classes used to parse and validate inbound payloads.
- `app/presentation/lib/` contains cross-cutting presentation helpers that are neither handlers, middleware, error handlers, nor forms. Put a module here when more than one handler or middleware needs it and it belongs to the presentation layer rather than to a Transaction Script.

### Hyperview File Layout

Developer-mode Hyperview content is authored under `src/`. The source layout is
translated into the immutable storage layout used by `ContentSnapshot`:

| Storage namespace | Developer source | Behavior |
| --- | --- | --- |
| `/pages/<pathname>/page.json` | `src/pages/<pathname>/page.json` | Direct file |
| `/pages/<pathname>/<template basename>` | `src/templates/pages/<template>` | Relocated from the template named by the leaf `page.json` |
| `/pages/<pathname>/__page-includes-bundle` | Files named by leaf `page.json` `includes` | Assembled JSON bundle |
| `/pages/<pathname>/__page-partials-bundle` | Files named by leaf `page.json` `partials` | Assembled JSON bundle |
| `/templates/__template-partials-bundle` | `src/templates/partials/**` | Assembled JSON bundle |
| `/templates/__base-templates-bundle` | `src/templates/base/**` | Assembled JSON bundle |
| `/assets/**` | `src/static-assets/**` | Direct file |
| `/emails/<pathname>/__email-assets` | `src/emails/<pathname>/email.json` and named files | Assembled JSON bundle |

For example:

```text
src/
├── pages/
│   ├── page.json
│   ├── intro.md
│   └── blog/
│       └── hello-world/
│           └── page.json
├── static-assets/
│   ├── images/
│   │   └── logo.svg
│   ├── javascript/
│   │   └── site.js
│   └── stylesheets/
│       ├── stylesheet.css
│       └── lib/
├── emails/
│   └── welcome/
│       ├── email.json
│       ├── message.html
│       └── message.txt
└── templates/
    ├── pages/
    │   └── article.html
    ├── base/
    │   └── website.html
    └── partials/
        └── website-header.html
```

Use `src/pages/` for route-specific metadata and included text content. `page.json` names page templates and page-specific partial sources under `src/templates/pages/`; template source files do not live beside page metadata. Use `src/templates/base/` and `src/templates/partials/` for shared templates. Static assets belong under `src/static-assets/`. Browser stylesheet and JavaScript sources belong under its `stylesheets/` and `javascript/` directories respectively; their browser URLs remain `/stylesheets/**` and `/javascript/**`.

An email directory contains `email.json` and the files it names. The HTML and text representations are independent; either may be omitted. `partials` lists template ids and filenames in the same email directory. `contextData` supplies static render data:

```json
{
    "contextData": {
        "subject": "Welcome",
        "product": "Kixx"
    },
    "htmlTemplate": {
        "id": "welcome.html",
        "filename": "message.html"
    },
    "textTemplate": {
        "id": "welcome.txt",
        "filename": "message.txt"
    },
    "partials": [
        {
            "id": "signature.html",
            "filename": "signature.html"
        }
    ]
}
```

### Page Context Data

When Hyperview renders a page, it loads page metadata for the requested pathname's ancestor directories, and leaf page metadata for the requested pathname. For a request to `/blog/reviews/music/led-zeppelin`, Hyperview attempts to load and merge:

- `src/pages/page.json`
- `src/pages/blog/page.json`
- `src/pages/blog/reviews/page.json`
- `src/pages/blog/reviews/music/page.json`
- `src/pages/blog/reviews/music/led-zeppelin/page.json`

Root and ancestor files are optional, but the final leaf `page.json` must exist or the request is treated as not found. More specific page data overrides earlier page data. Runtime response props, when present, are merged last and override all static page data.

Top-level build directives include:

- `template`: Names the page template relative to `src/templates/pages/`.
- `partials`: Lists page-local partial ids and template filenames relative to `src/templates/pages/`.
- `includes`: Maps context names to text files in the current page directory.

Build directives direct source assembly and are not exposed in the assembled template context. Runtime response props named `template` or `partials` remain available because response props are merged after the published directives are removed. The `includes` directive is replaced by the resolved content under `includes`.

```json
{
    "template": "blog/article.html",
    "partials": [
        {
            "id": "widget-list-item.html",
            "filename": "blog/widget-list-item.html"
        },
        {
            "id": "feed-item.xml",
            "filename": "blog/feed-item.xml"
        }
    ],
    "includes": {
        "intro": { "filename": "intro.md" },
        "sidebar": { "filename": "sidebar.html" }
    }
}
```

Hyperview creates a `page` object and fills several metadata defaults:

- `pathname` (top-level, not under `page`) defaults to the canonical content pathname used to look up the page.
- `url_pathname` (top-level, not under `page`) defaults to the raw request URL pathname.
- `page.canonical_url` defaults to the request protocol, host, and raw pathname, without query string or hash. It is not lower-cased and does not use the canonical content pathname, so case, duplicate slashes, and a `.json` suffix pass through unchanged.
- `page.href` defaults to the full request URL exactly as requested.
- `page.open_graph.url` defaults to `page.canonical_url`.
- `page.open_graph.type` defaults to `website`.
- `page.open_graph.title`, `description`, and `locale` default to the corresponding `page` values.

`page.title` and `page.description` each accept either a plain string or a template object. When the template object form is used, Hyperview renders the `template` string against the assembled page data and replaces the object with the resulting string before the page template runs:

```json
{
    "page": {
        "title": { "template": "{{ page.author }} — kixx.dev" },
        "description": "A static description string."
    }
}
```

### Hyperview Page-Data JSON Response

Hyperview can return the assembled page metadata as JSON when JSON responses are enabled for the route. A request is considered a JSON request only when the pathname ends in `.json` (matched case-insensitively).

This response exposes the same page data object that would otherwise be rendered through the page and base templates. It is useful for inspecting assembled page data for development and debugging, but it is not the contract for application API endpoints.
