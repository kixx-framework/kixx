# Presentation Layer

This project is a Hypermedia Driven Application, which means the presentation layer is a web presentation, primarily following the Representational State Transfer (REST) and Hypermedia As The Engine Of Application State (HATEOAS) patterns.

For information about Kixx Hyperview templates, the template syntax, template partials, and template helpers see the Kixx Hyperview Templating guide at `templates/README.md`.

The Kixx Hyperview component and plugin is responsible for rendering server-side HTML by combining page metadata and text based content from `pages/` with templates in `/templates/`.

### Hyperview File Layout

Hyperview content is authored in two application directories. As an example:

```text
pages/
├── page.json
├── page.html
└── blog/
    ├── page.json
    ├── page.html
    └── hello-world/
        ├── page.json
        └── intro.md

templates/
├── base/
│   └── website.html
├── pages/
│   ├── page.html
│   └── blog/
│       ├── page.html
│       └── hello-world/
│           └── page.html
└── partials/
    └── website/
        └── styles.css
```

Use `pages/` for route-specific page metadata and text based content:

- `page.json` contains root or directory-level page data.
- Other files in the same page directory can be loaded with `includes`.


Use `templates/` for page specific and shared templates.

- `templates/base/` contains base templates.
- `templates/partials/` contains shared partial templates.
- `templates/pages/` contains specific page templates at defined pathnames.

For a request to `/blog/hello-world`, the default page template is `templates/pages/blog/hello-world/page.html`. If the page data sets `"pageTemplate": "article.html"`, Hyperview loads `templates/pages/blog/hello-world/article.html`.

### Page Context Data

When Hyperview renders a page, it loads root page metadata, page metadata for the requested pathname's ancestor directories, and leaf page metadata for the requested pathname. For a request to `/blog/reviews/music/led-zeppelin`, Hyperview attempts to load and merge:

- `pages/page.json`
- `pages/blog/page.json`
- `pages/blog/reviews/page.json`
- `pages/blog/reviews/music/page.json`
- `pages/blog/reviews/music/led-zeppelin/page.json`

Root and ancestor files are optional, but the final leaf `page.json` must exist or the request is treated as not found. More specific page data overrides earlier page data. Runtime response props, when present, are merged last and override all static page data.

Optional top-level page data fields include:

- `baseTemplate`: Overrides the default base template for this page. This value is a filename relative to `templates/base/`.
- `pageTemplate`: Overrides the default page template filename. This value is a filename relative to `templates/pages/`.
- `includes`: Loads additional text files from the current page directory under `application/pages/`.

Included files can be used as raw text or rendered as mini templates against the assembled page data:

```json
{
    "includes": {
        "intro": { "filename": "intro.md" },
        "sidebar": { "filename": "sidebar.html", "template": true }
    }
}
```

When a `page` object exists, Hyperview fills several metadata defaults:

- `page.pathname` is the request URL pathname.
- `page.canonical_url` defaults to the request URL without query string or hash.
- `page.href` defaults to the full request URL.
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

Hyperview can return the assembled page metadata as JSON when JSON responses are enabled for the route. A request is considered a JSON request when either:

- the pathname ends in `.json`; or
- the `Accept` header includes `application/json`.

This response exposes the same page data object that would otherwise be rendered through the page and base templates. It is useful for inspecting assembled page data for development and debugging, but it is not the contract for application API endpoints.

### HyperviewRequestHandler Options

```js
/*
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames to strip from the URL pathname. Defaults to matching an `index.html`, `index.json`, `index.xml`, or `index.md` path segment at the end of the path.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format extensions to strip from the URL pathname last segment for content negotiation. Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them. Falls back to `config.env.HYPERVIEW.ALLOW_JSON_RESPONSE`.
 * @param {boolean} [options.usePageCache] - Enable full page (rendered HTML) caching. Static pages only. Falls back to `config.env.HYPERVIEW.USE_PAGE_CACHE`.
 * @param {boolean} [options.useTemplateCache] - Reuse compiled templates, partials, and includes. Falls back to `config.env.HYPERVIEW.USE_TEMPLATE_CACHE`.
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden per-page via `metadata.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `[pathname]/page.html`. Can be overridden per-page via `metadata.pageTemplate`.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 */
```

## Dynamic Routes

Routes are defined in `virtual-hosts.js` as an array of virtual host specification objects. The HTTP router resolves every request through a four-level hierarchy: **HttpRouter → VirtualHost → HttpRoute → HttpTarget**.

- **VirtualHost** matches the request by hostname. If no hostname match is found, the first virtual configured will be used.
- **HttpRoute** matches the URL pathname using `path-to-regexp` pattern syntax (e.g. `/users/:id`). Named segments are captured and available as `request.pathnameParams`.
- **HttpTarget** declares which HTTP methods it handles and runs a chain of middleware functions to produce the response. When a route matches but no target handles the request method, the router responds `405 Method Not Allowed`.

Routes are configured under the virtual host. This allows you to set up different routing patterns for different hostnames.

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

Catch-all routes must stay last within the route set they belong to. A route such as `*`, `/:slug`, or `/*splat` can shadow later routes if it appears first. After the router chooses the first pathname match, HTTP method selection happens only inside that route's `targets`; a method mismatch returns `405 Method Not Allowed` instead of continuing to another route with the same pathname.

### Route Pattern Matching

Route `pattern` values use the vendored `path-to-regexp` matcher. Static text must match exactly, and named matches are decoded and exposed on `request.pathnameParams` before request handlers run.

The matcher is for ordered path-like strings. Route patterns match `request.url.pathname` only; do not put query strings, URL fragments, JSON, or any arbitrarily ordered data in the pattern.

The pattern string is not a JavaScript `RegExp`. Raw regexp groups and character classes are not supported in route patterns. Characters reserved by `path-to-regexp`, including `(`, `)`, `[`, `]`, `?`, `+`, and `!`, must be avoided or escaped when they need to match literally.

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
}
```

Both `/` and `/index.json` match the first route, while `/users` and `/users.json` match the second route. The third route matches both `/files/report` and `/files/report.pdf`; the `ext` parameter is present only when the extension is present.

Do not use older `path-to-regexp` modifier syntax in new routes:

- For optional path parts, use braces: `/file{.:ext}`.
- For one or more path segments, use a named wildcard: `/*path`.
- For zero or more path segments, put the wildcard in an optional group: `/files{/*path}`.

Use the special app pattern `*` only for unnamed catch-all routes. This is a project-level shortcut; regular `path-to-regexp` wildcards must have names. The app pattern `*` matches every pathname and returns an empty `request.pathnameParams` object. If the handler needs the captured path segments, use a named wildcard pattern such as `/*splat` instead.

The same path syntax is used for reverse pathname compilation through `HttpTarget.compilePathname(params)`. Provide string values for `:name` parameters and arrays for `*name` wildcard parameters:

```js
target.compilePathname({ id: 'BUG-123' }).pathname; // For '/bugs/:id' -> '/bugs/BUG-123'
target.compilePathname({ path: [ 'releases', '2026', 'report.pdf' ] }).pathname; // For '/files/*path'
```

Pathname compilation encodes values for safe URL output, so non-ASCII text and reserved URL characters are escaped in the generated pathname.

### Middleware vs. Request Handlers vs. Error Handlers

- **Route middleware** (`inboundMiddleware`, `outboundMiddleware`) applies to every target in a route subtree. Use it for capabilities like authentication, session loading, request normalization, and shared response headers.
- **Target `requestHandlers`** applies to one endpoint. Use them for loading data for a page, handling a form submission, calling a Transaction Script, setting render props, or returning a redirect/JSON response.
- **Route error handlers** (`errorHandlers`) when an error is encountered in a middleware or request handler it is handed off to the closest target or route error handler. If the closest error handler does not handle the error it propagates up the routes tree, eventually getting handled by the global router handler if no other error handlers handle it.

Execution order for a matched target runs in two phases — a **request phase** followed by an **outbound (response) phase**:

1. Route inbound middleware (parent-first) — request phase
2. Target `requestHandlers` (in order) — request phase
3. Route outbound middleware (child-first) — outbound phase

When middleware throws, the router tries error handlers at three levels in order — target, route, router — stopping when one returns a response. Unexpected errors are emitted for logging and then rethrown so the platform-level server can apply its fatal-error policy. A throw skips the outbound phase for that request.

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

The routing layer is also a source of truth for URLs. Instead of hardcoding pathname strings in handlers, forms, and templates, look up the `HttpTarget` that owns an endpoint and compile its pathname from parameters. This keeps every internal link, redirect `Location`, and form `action` correct when a route `pattern` changes — you edit the pattern in `virtual-hosts.js` and every caller that compiles through the target follows automatically.

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
    requestHandlers: [ getDashboard, HyperviewDynamicPageHandler() ],
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

### Use Cases

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
- Validate forms and translate validation errors into response props.
- Call Transaction Scripts in `app/transaction-scripts/` to load or mutate data.
- Call `response.updateProps({ ... })` to pass render data to `HyperviewRequestHandler`.
- Return redirects, JSON:API responses, or rendered HTML responses through Hyperview or error handlers.

Request handlers should not:

- Put business rules or domain mutations directly in the handler.
- Use native Node.js modules or filesystem access.
- Build HTML strings when the response should be rendered by Hyperview templates.
- Own browser application state that should instead be represented by links, forms, redirects, and server-rendered HTML.

For GET and HEAD requests, request handlers should prepare render data and let the next handler in the chain, typically a HyperviewDynamicPageHandler, render the page:

```js
export async function getBugTicket(context, request, response) {
    const { id } = request.pathnameParams;
    const ticket = await getBugTicketScript(context, id);

    return response.updateProps({
        page: { title: ticket.title },
        ticket,
    });
}
```

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
            return response.updateProps({ form: form.getFormContext(context, err) });
        }
        throw err;
    }

    const ticket = await createBugTicket(context, form);

    skip();
    return response.respondWithRedirect(303, `/bugs/${ ticket.id }`);
}
```

When validation failure should re-render a page, `HyperviewDynamicPageHandler(...)` after this handler in the target chain will run automatically (since `skip()` was not called). When success returns a redirect, `skip()` prevents the Hyperview handler from running and needlessly rendering a page.

## Request and Response Objects

Every middleware function and request handler receives `(context, request, response)`. All three objects are described below.

### RequestContext

`context` is a `RequestContext` instance. It is created once per request and carries the request environment, logger, authenticated user, and registered services and collections.

**Properties:**

| Property | Type | Notes |
|---|---|---|
| `env` | `Object` | Platform specific environment bindings |
| `logger` | `Logger` | Root application logger; use for structured log output |
| `requestId` | `string\|undefined` | Matches `request.id`; use for log correlation |
| `runtime` | `AppRuntime` | Metadata indicating whether the app is serving HTTP or running a CLI command |
| `user` | `Object\|null` | Authenticated user set by auth middleware; `null` when not authenticated |

**Authenticated Principals:**

Authentication middleware should store the current authenticated principal on `context.user` with `context.setUser(principal)`. The principal is often a human user, but it may also represent an API token, service account, webhook sender, or another non-user credential. In those cases, use the same `context.user` property and include enough stable fields for downstream handlers to authorize and audit the request, such as `id`, `type`, `permissions`, `createdBy`, `scopes`, or credential timestamps.

Use `type` to make the principal kind explicit (`'AdminUser'`, `'PublishingApiToken'`, etc.) and avoid assuming every authenticated request is backed by a browser user. Middleware should keep secrets out of the principal: store token ids, hashes, grants, owner ids, and expiry metadata, but never store plaintext bearer tokens or passwords on `context.user`.

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

Pass `{ required: true }` to the string, integer, or float helpers when the application cannot run without that value. Required helpers throw an `AssertionError` when the env var is missing or empty. Numeric helpers also throw an `AssertionError` when a present value cannot be parsed as the expected number type.

### ServerRequest

`request` satisfies the `ServerRequestInterface` contract: `kixx/http-router/server-request-interface.js`

### ServerResponse

`response` is a `ServerResponse` instance defined in `kixx/http-router/server-response.js`. Middleware builds the response by mutating it; the final state is sent to the client.

**Mutable properties** — set directly when needed:

- `response.status` — HTTP status code (default `200`)
- `response.body` — response body: string, Buffer, ReadableStream, or `null`
- `response.headers` — Web API `Headers` instance; use `setHeader()`/`appendHeader()` instead of mutating directly

**Passing data between middleware** — use `updateProps()` to accumulate render context without committing a response body. The rendering handler (usually HyperviewDynamicPageHandler) reads these props to render the page template. Earlier middleware's props are readable via `response.props` if a later handler needs them.

```js
response.updateProps({ page: { title: 'My Page' }, ticket });
```

`updateProps()` deep-merges using `structuredClone`. Pass plain objects only — functions, class instances, and other non-cloneable values will cause it to throw. Nested objects merge rather than replace.

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

**Chaining** — all `respond*`, `setHeader`, `appendHeader`, `setCookie`, `clearCookie`, and `updateProps` methods return `this`, so they can be chained or returned directly:

```js
return response.updateProps({ page: { title: ticket.title }, ticket });
```

# Forms

Forms are the primary organizing logic for getting data into the application. Any data input into the system — HTML form submissions, JSON:API requests, webhooks, external APIs — should go through a form.

Forms which are expected to back HTML pages have static `method`, `target`, and `schema` properties. The `target` is the registered `HttpTarget` name used to compile the browser form action URL. The `schema` extends JSON Schema with HTML form control metadata (`label`, `fieldType`, etc.) that templates can use to render the form. Forms not intended for HTML pages should still provide a `schema` and should still implement `validate()`, `toJSON()`, and an appropriate `from*()` constructor.

*ALL forms SHOULD include a schema definition as best practice.*

```js
import { ValidationError } from '../../kixx/errors/mod.js';
import { isString } from '../../kixx/assertions/mod.js';

export default class CreateBugTicketForm {

    /**
     * HTTP method used by the bug ticket creation endpoint.
     */
    static method = 'POST';

    /**
     * HttpTarget name used to compile the form action URL.
     */
    static target = 'bugs/submit'; // References the HttpTarget "bugs/submit"

    // JSON Schema extended with HTML rendering metadata (label, fieldType, etc.).
    static schema = {
        type: 'object',
        properties: {
            title: { type: 'string', label: 'Title', fieldType: 'text' },
            description: { type: 'string', label: 'Description', fieldType: 'textarea' },
            priority: { type: 'string', enum: [ 'critical', 'high', 'medium', 'low' ], fieldType: 'select' },
        },
        required: [ 'title', 'description' ],
    };

    constructor(values) {
        Object.assign(this, values);
    }

    validate() {
        const error = new ValidationError('The bug ticket form contains invalid fields');
        const priorities = this.constructor.schema.properties.priority.enum;

        // Accumulate errors on the ValidationError instance before throwing

        if (!this.title) {
            error.push('Title is required', 'title');
        }

        if (!this.description) {
            error.push('Description is required', 'description');
        }

        if (this.priority && !priorities.includes(this.priority)) {
            error.push('Priority is invalid', 'priority');
        }

        if (error.length) {
            throw error;
        }
    }

    toJSON() {
        const data = {};
        for (const name of Object.keys(this.constructor.schema.properties)) {
            data[name] = this[name];
        }
        return data;
    }

    /**
     * Builds template render data for the bug ticket form, merging field
     * values and any validation errors from a previous submit attempt.
     * @param {import('../../kixx/context/request-context.js').default} context - Current request context.
     * @param {Error|string|null} [error] - ValidationError or error code string.
     */
    getFormContext(context, error) {
        const fields = {};
        const fieldErrors = new Map();

        let errorCode = null;

        if (error && error.name === 'ValidationError' && Array.isArray(error.errors)) {
            errorCode = 'field_error';
            for (const { message, source } of error.errors) {
                fieldErrors.set(source, message);
            }
        } else if (isString(error)) {
            errorCode = error;
        }

        for (const [ name, field ] of Object.entries(this.constructor.schema.properties)) {
            fields[name] = Object.assign({}, field, { name });

            if (fieldErrors.has(name)) {
                fields[name].error = fieldErrors.get(name);
            }
        }

        const target = context.getHttpTarget(this.constructor.target);

        return {
            name: this.constructor.name,
            method: this.constructor.method,
            // The `this` value should include all parameters needed to hydrate the
            // HttpRoute pathname pattern.
            url: target.compilePathname(this).pathname,
            errorCode,
            fields,
        };
    }

    static fromFormData(formData) {
        return new CreateBugTicketForm(Object.fromEntries(formData.entries()));
    }

    static fromJsonApi(resource) {
        return new CreateBugTicketForm(resource.data?.attributes ?? {});
    }
}
```

## API-Only Forms

Forms used only by JSON:API endpoints do not need `method`, `target`, or `getFormContext()` because they are never rendered as HTML and do not compile a browser form action. They should still define `schema`, normalize input in the constructor, validate field-level errors with `ValidationError`, expose a `fromJsonApi()` constructor, and return server-consumable data from `toJSON()`.

```js
import { isNonEmptyString } from '../../kixx/assertions/mod.js';
import { ValidationError } from '../../kixx/errors/mod.js';

export default class CreateApiTokenForm {

    static schema = {
        type: 'object',
        properties: {
            description: {
                type: 'string',
                description: 'Operator-facing token description',
            },
        },
        required: [ 'description' ],
    };

    constructor(attributes) {
        const { description } = attributes ?? {};
        this.description = isNonEmptyString(description) ? description.trim() : description;
    }

    validate() {
        const error = new ValidationError('The API token form contains invalid fields');

        if (!isNonEmptyString(this.description)) {
            error.push('Description is required', 'description');
        }

        if (error.length) {
            throw error;
        }
    }

    toJSON() {
        return {
            description: this.description,
        };
    }

    static fromJsonApi(attributes) {
        return new CreateApiTokenForm(attributes);
    }
}
```

## CSRF-Protected HTML Forms

Use `app/presentation/lib/csrf.js` for browser HTML forms that mutate state or establish authentication. CSRF validation belongs in request handlers before constructing a Form and before calling any Transaction Script. Transaction Scripts should continue to receive already-validated Forms and should not be concerned with CSRF cookies or hidden fields.

On GET handlers, render the form through `getCsrfFormContext()`. The helper calls `form.getFormContext(context, error)`, creates a fresh server-side CSRF token record, sets the browser CSRF pre-session cookie, and returns the usual form context with `form.csrf.fieldName` and `form.csrf.token` added:

```js
import { getCsrfFormContext } from '../lib/csrf.js';

export async function getCreateBugForm(context, request, response) {
    const form = new CreateBugForm();

    return response.updateProps({
        form: await getCsrfFormContext(context, request, response, form),
    });
}
```

On POST handlers, call `validateCsrfFormData()` before constructing the Form. That helper owns `request.formData()` because request bodies are one-shot; do not call `request.formData()` again after it returns. Missing, expired, or mismatched CSRF data throws an expected HTTP error before domain logic runs.

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

On validation or domain errors that re-render the form, call `getCsrfFormContext(context, request, response, form, error)` again so the response carries a fresh token. After successful signup, login, or another flow that should end the pre-session, call `clearCsrfToken(context, request, response)` after setting the real session cookie.

Templates render the hidden field directly inside the protected `<form>`:

```html
{{#if form.csrf}}
<input type="hidden" name="{{ form.csrf.fieldName }}" value="{{ form.csrf.token }}">
{{/if}}
```

## Common Task Recipes

### Content-Only Hyperview Page

For a page whose content is assembled from page metadata, includes, and templates rather than request-specific data:

1. Add or update `pages/<pathname>/page.json` for metadata and page context.
2. Add or update `templates/pages/<pathname>/page.html` for route-specific markup.
3. Put page-local supporting content next to the page and reference it from `includes` in `page.json`.
4. Add shared layout changes to `/templates/base/` or `templates/partials/` only when the change should affect multiple pages.

Content-only Hyperview pages use the HyperviewStaticPageHandler, which should already be configured for the catch-all route (`"*"`) in `virtual-hosts.js`.

### Dynamic Hyperview Page

For a page that needs route parameters, records loaded through Transaction Scripts, session state, or other request-specific data:

1. Add or update the route in `virtual-hosts.js`.
2. Add a request handler in `app/presentation/request-handlers/` to read route parameters, query strings, cookies, headers, or body data.
3. Have the request handler call a Transaction Script when domain data is needed, prepare render data, and call `response.updateProps({ ... })`.
4. When rendering markup, end the target's `requestHandlers` chain with `HyperviewDynamicPageHandler(...)` (see [HyperviewDynamicPageHandler Options](#hyperviewrequesthandler-options) above).
5. If the route pattern contains dynamic segments such as `/:id`, pass a stable Hyperview `pathname` option to HyperviewDynamicPageHandler so the handler can locate the appropriate `pages/**` and `templates/pages/**` directories, even when the path contains dynamic path segments.
6. Add the matching `pages/<stable-pathname>/page.json` and `templates/pages/<stable-pathname>/page.html` files.

### Form-Backed HTML Workflow

For a workflow that accepts user input:

1. Define a form class in `app/presentation/forms/` with `method`, `target`, `schema`, a `from*()` constructor, and `validate()`. See [Forms](#forms) above.
2. In the request handler, parse the payload into the form, validate it, and then call the appropriate Transaction Script.
3. On success, prefer an HTTP redirect for browser form submissions.
4. On validation failure, update response props with the form context and render the page with the validation error state.

### JSON:API Endpoint

For an application API endpoint that accepts or returns JSON:API documents:

1. Add a route subtree or leaf route in `virtual-hosts.js` and attach `jsonApiErrorHandler` from `app/presentation/error-handlers/json-api-error-handler.js` at the route level. This keeps expected HTTP errors serialized as JSON:API `errors` documents for the whole API surface while unexpected errors continue to propagate to the router fallback.
2. In the request handler, call `assertJsonApiContentType(request)` before parsing a JSON:API request body. JSON:API requests must use `Content-Type: application/vnd.api+json`; optional media-type parameters are ignored by the helper.
3. Parse resource documents with `parseJsonApiResource(request, expectedType)`, then pass the returned `attributes` into an API form (`fromJsonApi`, `validate`, `toJSON`) before calling a Transaction Script.
4. On success, respond with `jsonApiResource(...)` and `response.respondWithJSON(status, document, { contentType: JSON_API_CONTENT_TYPE })`.
5. Do not add a Hyperview request handler after an API handler that commits a JSON response, so the committed JSON response is terminal for the target. Just return the JSON response — the outbound phase still runs either way.

```js
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../lib/json-api.js';
import ExampleApiForm from '../forms/example-api-form.js';
import { createExample } from '../../transaction-scripts/examples/create-example.js';

export async function exampleJsonApiHandler(context, request, response) {
    assertJsonApiContentType(request);

    const { attributes } = await parseJsonApiResource(request, 'Example');
    const form = ExampleApiForm.fromJsonApi(attributes);
    form.validate();

    const example = await createExample(context, form);

    // No Hyperview handler follows this target, so the committed JSON response
    // is terminal. Returning normally (without skip()) lets route outbound
    // middleware still run.
    return response.respondWithJSON(
        201,
        jsonApiResource({
            type: 'Example',
            id: example.id,
            attributes: {
                title: example.title,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
```

### Serving Static Files

For files that ship with the deployment (favicons, images, fonts), wire the framework `StaticFileRequestHandler` into a route in `virtual-hosts.js`. The handler reads the request pathname (query string and hash excluded) as the file key, looks the file up through the registered `StaticFileStore` service, and maps the result onto the response — setting `Content-Type`, `Cache-Control`, `ETag`, and `Last-Modified`, answering conditional requests (`If-None-Match`, then `If-Modified-Since`) with `304`, and serving HEAD as headers only.

```js
// Wired in virtual-hosts.js, alongside the other route handler imports.
import { StaticFileRequestHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';

{
    pattern: '/css/images/*pathname',
    name: 'css-images',
    targets: [
        {
            name: 'serve',
            methods: [ 'GET', 'HEAD' ],
            requestHandlers: [
                StaticFileRequestHandler({ cacheControl: 'public, max-age=86400' }),
            ],
        },
    ],
}
```

`StaticFileRequestHandler(options)` accepts:

- `contentType` — force the `Content-Type` instead of deriving it from the file extension. Takes precedence over the store's value.
- `cacheControl` — force the `Cache-Control` header. Defaults to `public, max-age=0, must-revalidate` (cacheable, but revalidate every time).
- `computeEtag` — compute the `ETag` as a hash of the file contents when the store has no precomputed one. `true` by default; set `false` to skip ETag work.
- `throwNotFound` — throw `NotFoundError` (→ 404) when the file is absent. `true` by default; set `false` to defer to the next request handler instead.
- `skipWhenFound` — skip the remaining request handlers on the route when a file is served. `false` by default.
- `pathname` — override the URL pathname for every request, rewriting which file key is read.

The default options (`throwNotFound: true`, `skipWhenFound: false`) suit a dedicated route that owns its path, such as `/favicon.ico`. For a root-served catch-all, set `throwNotFound: false` and `skipWhenFound: true` and place the handler before the Hyperview renderer so a static file is served when one matches and the request otherwise falls through to page rendering:

```js
requestHandlers: [
    StaticFileRequestHandler({ throwNotFound: false, skipWhenFound: true }),
    HyperviewStaticPageHandler(),
]
```

For the `StaticFileStore` contract, Build ID namespacing for Atomic Deployments, and the Node.js (filesystem + `manifest.json`) and Cloudflare (dedicated KV binding) adapters, see `src/kixx/static-file-server/README.md`.

## Where Presentation Changes Belong

- `pages/` contains route-specific page metadata, and included content files.
- `templates/base/` contains shared HTML document frames.
- `templates/partials/` contains shared template fragments such as styles, metadata, and reusable markup.
- `templates/pages/` contains templates for specific pages.
- `virtual-hosts.js` registers Worker routes and connects HTTP methods to middleware and request handlers.
- `app/presentation/request-handlers/` contains application request handlers.
- `app/presentation/middleware/` contains application inbound and outbound middleware.
- `app/presentation/error-handlers/` contains application error handlers.
- `app/presentation/forms/` contains form classes used to parse and validate inbound payloads.
