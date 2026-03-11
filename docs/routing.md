# Routing

The Kixx routing system maps incoming HTTP requests to handlers using a two-level hierarchy: **virtual hosts** (matched by hostname) and **routes** (matched by URL pathname).

## Overview

When a request arrives:

1. The router matches the request hostname against registered virtual hosts.
2. Within the matched virtual host, it finds the first route whose pattern matches the URL pathname.
3. Within the matched route, it finds the target whose `methods` list includes the request method.
4. The target's middleware chain is invoked, passing the request through handlers.

## File Structure

```
routes/
└── main.js          # Route definitions
virtual-hosts.js     # Hostname-to-routes mapping
```

## Virtual Hosts

Virtual hosts map hostnames to sets of routes. Define them in `virtual-hosts.js`:

```javascript
import mainRoutes from './routes/main.js';

export default [
    {
        name: 'Main',
        pattern: 'localhost',
        routes: mainRoutes,
    },
];
```

### Hostname Patterns

| Pattern | Matches |
|---|---|
| `'localhost'` | Exact hostname `localhost` |
| `'example.com'` | Exact hostname `example.com` |
| `'*'` | Any hostname (catch-all) |

### Multiple Virtual Hosts

If your server handles multiple domains, define multiple virtual hosts. The router tries each in order and uses the first match. When no host matches, it falls back to the first virtual host in the list.

```javascript
export default [
    {
        name: 'Main',
        pattern: 'example.com',
        routes: mainRoutes,
    },
    {
        name: 'Blog',
        pattern: 'blog.example.com',
        routes: blogRoutes,
    },
    {
        name: 'Fallback',
        pattern: '*',
        routes: mainRoutes,
    },
];
```

## Routes

Routes match URL pathnames and delegate to targets. Define them in `routes/main.js`:

```javascript
export default [
    {
        name: 'StaticPages',
        pattern: '*',
        inboundMiddleware: [],
        outboundMiddleware: [],
        errorHandlers: [
            ['HyperviewErrorHandler'],
        ],
        targets: [
            {
                name: 'GetPage',
                methods: ['GET', 'HEAD'],
                handlers: [
                    ['HyperviewRequestHandler'],
                ],
            },
        ],
    },
];
```

Routes are matched in order — put more specific patterns before catch-all patterns.

### Route Properties

| Property | Type | Description |
|---|---|---|
| `name` | string | Descriptive name used in logs |
| `pattern` | string | URL path pattern to match |
| `inboundMiddleware` | array | Middleware to run before the target handler |
| `outboundMiddleware` | array | Middleware to run after the target handler |
| `errorHandlers` | array | Error handlers for this route |
| `targets` | array | HTTP method handlers |

### URL Patterns

Kixx uses `path-to-regexp` syntax for URL patterns.

| Pattern | Matches |
|---|---|
| `*` | All paths (catch-all) |
| `/about` | Exactly `/about` |
| `/blog/:slug` | `/blog/my-post`, `/blog/hello-world` |
| `/api/:version/*` | `/api/v1/users`, `/api/v2/posts/1` |

Named parameters (`:slug`, `:version`) are extracted and available on the request via `request.pathnameParams`.

### Multiple Routes

```javascript
export default [
    {
        name: 'Blog',
        pattern: '/blog/*',
        errorHandlers: [
            ['HyperviewErrorHandler'],
        ],
        targets: [
            {
                name: 'GetBlogPost',
                methods: ['GET', 'HEAD'],
                handlers: [
                    ['HyperviewRequestHandler', { baseTemplate: 'blog.html', useCache: true }],
                ],
            },
        ],
    },
    {
        name: 'AllPages',
        pattern: '*',
        errorHandlers: [
            ['HyperviewErrorHandler'],
        ],
        targets: [
            {
                name: 'GetPage',
                methods: ['GET', 'HEAD'],
                handlers: [
                    ['HyperviewRequestHandler'],
                ],
            },
        ],
    },
];
```

## Targets

Targets define which HTTP methods a route handles and which handlers to invoke.

```javascript
{
    name: 'GetPage',
    methods: ['GET', 'HEAD'],
    tags: [],
    handlers: [
        ['HyperviewRequestHandler'],
    ],
}
```

### Target Properties

| Property | Type | Description |
|---|---|---|
| `name` | string | Descriptive name for the target |
| `methods` | string[] | HTTP methods this target handles (e.g., `['GET', 'HEAD']`) |
| `tags` | string[] | Optional tags for filtering targets via `context.getHttpTargetsByTag()` |
| `handlers` | array | Request handlers to invoke |

### Targets for Multiple Methods

A single route can have multiple targets for different HTTP methods:

```javascript
targets: [
    {
        name: 'GetForm',
        methods: ['GET', 'HEAD'],
        handlers: [['HyperviewRequestHandler']],
    },
    {
        name: 'SubmitForm',
        methods: ['POST'],
        handlers: [['MyFormHandler']],
    },
],
```

If a request arrives with a method that no target supports (but the route pattern matches), a `405 Method Not Allowed` error is raised with an `Allow` header listing the supported methods.

## Handler References

Handlers, middleware, and error handlers are referenced as tuples where the first element is the registered name and the optional second element is a configuration object:

```javascript
// No options
handlers: [['HyperviewRequestHandler']]

// With options
handlers: [['HyperviewRequestHandler', { useCache: true, baseTemplate: 'base.html' }]]

// Multiple handlers in sequence
handlers: [
    ['AuthMiddleware'],
    ['HyperviewRequestHandler'],
]
```

Handler names must be registered on the `ApplicationContext` before the router processes requests. See [Request Handling](request-handling.md) for how to register custom handlers.

## Middleware

Middleware runs before and after the target handler. Inbound middleware runs in order (top to bottom). Outbound middleware runs in reverse order (bottom to top) after the handler.

```javascript
{
    name: 'ProtectedPages',
    pattern: '/admin/*',
    inboundMiddleware: [
        ['SessionMiddleware'],
        ['AuthMiddleware'],
    ],
    outboundMiddleware: [
        ['CacheHeaderMiddleware'],
    ],
    targets: [ ... ],
}
```

## Error Handling

Errors cascade through three levels:

1. **Target-level** — Error handlers on the matching target (most specific)
2. **Route-level** — Error handlers on the matching route
3. **Router-level** — The router's built-in JSON error handler (catches unhandled HTTP errors)

Each error handler can return a response to stop propagation, or return `false` to pass the error to the next level. See [Error Pages](error-pages.md) for creating custom HTML error pages.

```javascript
{
    name: 'AllPages',
    pattern: '*',
    errorHandlers: [
        ['HyperviewErrorHandler'],
    ],
    targets: [
        {
            name: 'GetPage',
            methods: ['GET', 'HEAD'],
            handlers: [['HyperviewRequestHandler']],
        },
    ],
}
```

## Setting Up the Router

```javascript
import HttpRouter from './kixx/http-router/http-router.js';
import JSModuleHttpRoutesStore from './kixx/http-routes-stores/js-module-http-routes-store.js';
import vhostsConfigs from './virtual-hosts.js';

const { middleware, requestHandlers, errorHandlers } = applicationContext;

const router = new HttpRouter({
    store: new JSModuleHttpRoutesStore(vhostsConfigs),
    middleware,
    handlers: requestHandlers,
    errorHandlers,
});

// Most router errors are informational (404, 403, etc.).
// Fatal errors are thrown by the router and caught by the server.
router.on('error', ({ error, requestId }) => {
    const name = error.name || 'NoErrorName';
    const code = error.code ?? 'NoErrorCode';
    const message = error.message || 'NoErrorMessage';
    logger.debug('http route error', { requestId, name, code, message });
});

// Pass requests to the router
server.startServer((request, response) => {
    return router.handleRequest(applicationContext, request, response);
});
```

### Hot-Reloading Routes (Development)

Use `reloadRoutesAndHandleRequest` to reload routes on every request without restarting the server:

```javascript
server.startServer((request, response) => {
    return router.reloadRoutesAndHandleRequest(appContext, request, response);
});
```

## Accessing Route Information

From within a request handler or middleware, you can access route information through the `RequestContext`:

```javascript
// Get all targets registered on the matched virtual host
const allTargets = context.getAllHttpTargets();

// Get a specific target by name
const submitTarget = context.getHttpTarget('SubmitForm');

// Get targets by tag
const authTargets = context.getHttpTargetsByTag('authenticated');
```
