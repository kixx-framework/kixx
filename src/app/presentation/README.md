# Presentation Layer

This project is a Hypermedia Driven Application, which means the presentation layer is a web presentation, primarily following the Representational State Transfer (REST) and Hypermedia As The Engine Of Application State (HATEOAS) patterns.

## Where Presentation Changes Belong

- `pages/` contains route-specific page metadata, and included content files.
- `templates/base/` contains shared HTML document frames.
- `templates/partials/` contains shared template fragments such as styles, metadata, and reusable markup.
- `templates/pages/` contains templates for specific templates
- `virtual-hosts.js` registers Worker routes and connects HTTP methods to middleware and request handlers.
- `app/presentation/request-handlers/` contains application request handlers.
- `app/presentation/middleware/` contains application inbound and outbound middleware.
- `app/presentation/error-handlers/` contains application error handlers.
- `app/presentation/forms/` contains form classes used to parse and validate inbound payloads.

## Common Task Recipes

### Static Hyperview Page

For a page whose content comes from files rather than request-specific data:

1. Add or update `pages/<pathname>/page.json` for metadata and page context.
2. Add or update `templates/pages/<pathname>/page.html` for route-specific markup.
3. Put page-local supporting content next to the page and reference it from `includes` in `page.json`.
4. Add shared layout changes to `/templates/base/` or `templates/partials/` only when the change should affect multiple pages.
5. Read app/presentation/docs/hyperview-rendering.md for page data structure and app/presentation/docs/kixx-templating.md for template syntax, helpers, escaping behavior, and partial inclusion.

### Dynamic Hyperview Page

For a page that needs route parameters, records loaded through Transaction Scripts, session state, or other request-specific data:

1. Add or update the route in `virtual-hosts.js`.
2. Add a request handler in `app/presentation/request-handlers/` to read route parameters, query strings, cookies, headers, or body data.
3. Have the request handler call a Transaction Script when domain data is needed, prepare render data, and call `response.updateProps({ ... })`.
4. When rendering markup, end the target's `requestHandlers` chain with `HyperviewRequestHandler(...)` (see [HyperviewRequestHandler Options](#hyperviewrequesthandler-options) below).
5. If the route pattern contains dynamic segments such as `/:id`, pass a stable Hyperview `pathname` option so the handler can load files from `pages/`. The pathname is a static page-file location such as `/profiles/id`, not the runtime value from the URL.
6. Add the matching `pages/<stable-pathname>/page.json` and `pages/<stable-pathname>/page.html` files.

### Form-Backed HTML Workflow

For a workflow that accepts user input:

1. Define a form class in `app/forms/` with `method`, `target`, `schema`, a `from*()` constructor, and `validate()`. See [Forms](#forms) below.
2. In the request handler, parse the payload into the form, validate it, and then call the appropriate Transaction Script.
3. On success, prefer an HTTP redirect for browser form submissions.
4. On validation failure, update response props with the form context and render the page with the validation error state.

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

### Middleware vs. Request Handlers

- **Route middleware** (`inboundMiddleware`, `outboundMiddleware`, `errorHandlers`) applies to every target in a route subtree. Use it for authentication, session loading, request normalization, shared response headers, and route-wide HTML error preparation.
- **Target `requestHandlers`** applies to one endpoint. Use them for loading data for a page, parsing a form submission, calling a Transaction Script, setting render props, or returning a redirect/JSON response.

For auth, prefer route middleware when the whole subtree requires the same authentication or authorization rule:

```js
{
    pattern: '/account',
    inboundMiddleware: [ requireAuthentication ],
    routes: [
        { pattern: '/', targets: [ ... ] },
        { pattern: '/settings', targets: [ ... ] },
    ],
}
```

Execution order for a matched target:

1. Route inbound middleware (parent-first)
2. Target `requestHandlers` (in order)
3. Route outbound middleware (child-first)

When middleware throws, the router tries error handlers at three levels in order — target, route, router — stopping when one returns a response. Unexpected errors are emitted for logging and then rethrown so the platform-level server can apply its fatal-error policy.

**The `skip()` callback** stops the router from invoking later middleware in the chain.

```js
export async function redirectAfterSuccess(context, request, response, skip) {
    skip();
    return response.respondWithRedirect(303, '/account');
}
```

## Request Handlers

A request handler's job is to interpret the incoming HTTP request and coordinate a response, but it should not contain domain logic. See `app/transaction-scripts/README.md` for how to write the Transaction Scripts that request handlers call.

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

For GET and HEAD requests, prepare render data and let the next handler in the chain render the page:

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

When validation failure should re-render a page, `HyperviewRequestHandler(...)` after this handler in the target chain will run automatically (since `skip()` was not called). When success returns a redirect, `skip()` prevents the Hyperview handler from running.

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

**Methods:**

Service and collection access:

| Method | Returns | Notes |
|---|---|---|
| `getCollection(name)` | Collection instance | Preferred way to access durable document data; throws if not registered |
| `getService(name)` | Service instance | Access registered application services (e.g. `'ObjectStorageService'`, `'EmailService'`); throws if not registered |
| `getHttpTarget(name)` | HttpTarget instance | Looks up a registered route target by name for reverse pathname compilation; throws if not found |
| `getAllHttpTargets()` | Array<HttpTarget> | Returns every target in the current virtual host's route set |
| `getHttpTargetsByTag(tag)` | Array<HttpTarget> | Returns targets that declare the given tag, in route order |

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

**Passing data between middleware** — use `updateProps()` to accumulate render context without committing a response body. `HyperviewRequestHandler` reads these props to render the page template. Earlier middleware's props are readable via `response.props` if a later handler needs them.

```js
response.updateProps({ page: { title: 'My Page' }, ticket });
```

`updateProps()` deep-merges using `structuredClone`. Pass plain objects only — functions, class instances, and other non-cloneable values will cause it to throw. Nested objects merge rather than replace. See @application/docs/hyperview-rendering.md for the full `page` schema (`title`, `description`, `canonical_url`, Open Graph fields).

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

