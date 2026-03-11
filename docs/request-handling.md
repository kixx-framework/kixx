# Request Handling

This guide covers how to write custom middleware, request handlers, and error handlers, and documents the full request/response API.

## Overview

Handlers and middleware are registered on the `ApplicationContext` as factory functions. When a request arrives, the router calls each factory with its options to produce the handler function, then invokes that function with the request context.

## ApplicationContext

The `ApplicationContext` is the central registry created during application startup.

```javascript
import ApplicationContext from './kixx/context/application-context.js';

const appContext = new ApplicationContext({
    runtime: { server: { name: 'server' } },
    config,
    logger,
});
```

### Registration Methods

| Method | Description |
|---|---|
| `registerService(name, service)` | Register a service instance (e.g., database, email) |
| `registerCollection(name, collection)` | Register a data collection |
| `registerMiddleware(name, fn)` | Register a middleware factory |
| `registerRequestHandler(name, fn)` | Register a request handler factory |
| `registerErrorHandler(name, fn)` | Register an error handler factory |

All registration methods return `this` for chaining:

```javascript
appContext
    .registerService('Database', db)
    .registerRequestHandler('UserHandler', UserHandler)
    .registerErrorHandler('HyperviewErrorHandler', HyperviewErrorHandler);
```

### Properties

| Property | Description |
|---|---|
| `appContext.logger` | Application logger |
| `appContext.config` | Configuration manager |
| `appContext.runtime` | Runtime info object |

## RequestContext

Inside handlers and middleware, you receive a `RequestContext` — a read-only view of the application context for a single request.

### Methods

| Method | Description |
|---|---|
| `context.getService(name)` | Retrieve a registered service by name |
| `context.getCollection(name)` | Retrieve a registered collection by name |
| `context.getAllHttpTargets()` | Get all targets from the matched virtual host |
| `context.getHttpTarget(name)` | Get a specific target by name |
| `context.getHttpTargetsByTag(tag)` | Get all targets with a given tag |

### Properties

| Property | Description |
|---|---|
| `context.logger` | Application logger |
| `context.config` | Configuration manager |
| `context.runtime` | Runtime info object |

## Request Handlers

A request handler is a factory function that returns an async handler function.

### Factory Signature

```javascript
function MyHandler(options) {
    // options comes from the route definition:
    // handlers: [['MyHandler', { option1: 'value' }]]
    options = options || {};

    return async function handler(context, request, response) {
        // Handle the request and return a response
        return response.respondWithJSON(200, { message: 'Hello!' });
    };
}
```

### Registration

```javascript
appContext.registerRequestHandler('MyHandler', MyHandler);
```

### Usage in Routes

```javascript
targets: [
    {
        name: 'GetData',
        methods: ['GET'],
        handlers: [
            ['MyHandler', { someOption: true }],
        ],
    },
],
```

### Example: JSON API Handler

```javascript
import { NotFoundError } from './kixx/errors.js';

function UserHandler(options) {
    return async function handler(context, request, response) {
        const db = context.getService('Database');
        const { id } = request.pathnameParams;

        const user = await db.findUser(id);

        if (!user) {
            throw new NotFoundError(`User not found: ${id}`);
        }

        return response.respondWithJSON(200, { user });
    };
}
```

## Middleware

Middleware runs before (inbound) or after (outbound) the handler. Use middleware for cross-cutting concerns like authentication, logging, or setting common headers.

### Factory Signature

```javascript
function MyMiddleware(options) {
    options = options || {};

    return async function middleware(context, request, response, skip) {
        // Do something before the handler...

        // Call skip() to bypass the rest of the middleware chain
        // and proceed directly to the handler
        // skip();

        // ...or just return to continue normally
        return response;
    };
}
```

### Registration

```javascript
appContext.registerMiddleware('MyMiddleware', MyMiddleware);
```

### Usage in Routes

```javascript
{
    name: 'ProtectedPages',
    pattern: '/admin/*',
    inboundMiddleware: [
        ['SessionMiddleware'],
        ['AuthMiddleware', { role: 'admin' }],
    ],
    outboundMiddleware: [
        ['AuditLogMiddleware'],
    ],
    targets: [ ... ],
}
```

### Example: Authentication Middleware

```javascript
import { UnauthenticatedError } from './kixx/errors.js';

function AuthMiddleware(options) {
    return async function middleware(context, request, response, skip) {
        const session = context.getService('SessionService');
        const token = request.getAuthorizationBearer();

        if (!token) {
            throw new UnauthenticatedError('Authentication required');
        }

        const user = await session.verifyToken(token);

        if (!user) {
            throw new UnauthenticatedError('Invalid or expired token');
        }

        // Pass user to downstream handlers via response props
        response.updateProps({ currentUser: user });
    };
}
```

## Error Handlers

Error handlers receive errors thrown by the middleware chain and return a response or `false`.

### Factory Signature

```javascript
function MyErrorHandler(options) {
    options = options || {};

    return async function errorHandler(context, request, response, error) {
        // Return a response if you handle the error
        if (error.code === 'NOT_FOUND') {
            return response.respondWithJSON(404, { error: 'Not found' });
        }

        // Return false to pass to the next error handler
        return false;
    };
}
```

### Registration

```javascript
appContext.registerErrorHandler('MyErrorHandler', MyErrorHandler);
```

## ServerRequest API

The `ServerRequest` object is passed to all handlers and middleware.

### Properties

| Property | Type | Description |
|---|---|---|
| `request.id` | string | Unique request identifier (e.g., `'req-1'`) |
| `request.method` | string | HTTP method (e.g., `'GET'`, `'POST'`) |
| `request.url` | URL | Standard Web API `URL` object |
| `request.headers` | Headers | Request headers |
| `request.pathnameParams` | object | URL parameters extracted from route pattern |
| `request.hostnameParams` | object | Hostname parameters extracted from virtual host pattern |
| `request.queryParams` | URLSearchParams | Query string parameters |
| `request.ifModifiedSince` | Date\|null | Value of `If-Modified-Since` header |
| `request.ifNoneMatch` | string\|null | Value of `If-None-Match` header |

### Methods

| Method | Returns | Description |
|---|---|---|
| `request.isHeadRequest()` | boolean | `true` if method is `HEAD` |
| `request.isJSONRequest()` | boolean | `true` if `Accept: application/json` or `.json` extension |
| `request.isFormURLEncodedRequest()` | boolean | `true` if `Content-Type: application/x-www-form-urlencoded` |
| `request.getCookie(name)` | string\|null | Get a cookie value by name |
| `request.getCookies()` | object | Get all cookies as a plain object |
| `request.getAuthorizationBearer()` | string\|null | Extract bearer token from `Authorization` header |
| `request.json()` | Promise\<any\> | Parse request body as JSON |
| `request.formData()` | Promise\<object\> | Parse request body as URL-encoded form data |

### URL Object

The `request.url` property is a standard `URL` object:

```javascript
request.url.pathname   // '/about/team'
request.url.hostname   // 'example.com'
request.url.protocol   // 'https:'
request.url.search     // '?page=2'
request.url.href       // 'https://example.com/about/team?page=2'
```

### Reading URL Parameters

```javascript
// Route pattern: /blog/:slug
const { slug } = request.pathnameParams;

// Query parameters
const page = request.queryParams.get('page');
```

### Reading Request Body

```javascript
// JSON body
const data = await request.json();

// Form data
const form = await request.formData();
const email = form.email;
```

## ServerResponse API

The `ServerResponse` object is passed to all handlers and middleware.

### Properties

| Property | Type | Description |
|---|---|---|
| `response.id` | string | Matches `request.id` |
| `response.status` | number | Current response status (default: `200`) |
| `response.headers` | Headers | Response headers (Web API `Headers` object) |
| `response.props` | object | Custom properties for passing data between middleware |

### Response Methods

| Method | Description |
|---|---|
| `response.respond(statusCode)` | Send an empty response |
| `response.respondWithJSON(statusCode, data, options)` | Send a JSON response |
| `response.respondWithHTML(statusCode, html, options)` | Send an HTML response |
| `response.respondWithUtf8(statusCode, text, options)` | Send a UTF-8 text response |
| `response.respondWithStream(statusCode, stream, options)` | Stream a response body |
| `response.respondWithRedirect(statusCode, url, options)` | Send a redirect response |

### Setting Headers

```javascript
response.headers.set('x-custom-header', 'value');
response.headers.append('set-cookie', 'session=abc; HttpOnly');
```

Or use the convenience methods:

```javascript
response.setHeader('cache-control', 'no-cache');
response.appendHeader('set-cookie', 'session=abc; HttpOnly');
```

### Cookies

```javascript
// Set a cookie
response.setCookie('session', 'abc123', {
    httpOnly: true,
    secure: true,
    maxAge: 3600,
    path: '/',
});

// Clear a cookie
response.clearCookie('session');
```

### Passing Data Between Middleware

Use `response.updateProps()` to pass data from middleware to downstream handlers. Props are available on `response.props` and are also merged into page data by `HyperviewRequestHandler`.

```javascript
// Middleware sets current user
response.updateProps({ currentUser: user });

// Handler reads it
const { currentUser } = response.props;
```

### Redirect

```javascript
return response.respondWithRedirect(302, '/login');
return response.respondWithRedirect(301, 'https://www.example.com/new-url');
```

### JSON Response

```javascript
return response.respondWithJSON(200, { users: [] });
return response.respondWithJSON(201, { id: newId }, { whiteSpace: 4 });
return response.respondWithJSON(422, { error: 'Validation failed' });
```

### Streaming

```javascript
import { createReadStream } from './kixx/node-filesystem/mod.js';

const stream = createReadStream('/path/to/file.pdf');
return response.respondWithStream(200, stream, { contentLength: fileSize });
```

## Logger API

The logger is available on both `ApplicationContext` and `RequestContext`.

### Log Methods

```javascript
context.logger.debug('Debug message', { extra: 'data' });
context.logger.info('Info message', { requestId: request.id });
context.logger.warn('Warning message', { retries: 3 });
context.logger.error('Error message', { url: request.url.href }, error);
```

### Child Loggers

Create a child logger with a more specific name for better log filtering:

```javascript
const logger = context.logger.createChild('UserHandler');
logger.info('Fetching user', { id: userId });
```

### Log Levels

| Level | Integer | Description |
|---|---|---|
| `DEBUG` | 10 | Detailed diagnostic information |
| `INFO` | 20 | General operational messages |
| `WARN` | 30 | Warning conditions |
| `ERROR` | 40 | Error conditions |

## Complete Handler Example

```javascript
import { NotFoundError, ValidationError } from './kixx/errors.js';

function CreatePostHandler(options) {
    return async function handler(context, request, response) {
        const logger = context.logger.createChild('CreatePostHandler');
        const db = context.getService('Database');
        const { currentUser } = response.props;

        // Read and validate request body
        const body = await request.json();

        if (!body.title) {
            const error = new ValidationError('Validation failed');
            error.push('Title is required', 'title');
            throw error;
        }

        logger.info('creating post', { userId: currentUser.id });

        // Create the resource
        const post = await db.createPost({
            title: body.title,
            content: body.content,
            authorId: currentUser.id,
        });

        logger.info('post created', { postId: post.id });

        // Redirect to the new post
        return response.respondWithRedirect(303, `/blog/${post.slug}`);
    };
}

export default CreatePostHandler;
```
