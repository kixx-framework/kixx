# Default Request Handlers

A comprehensive guide to Kixx's default middleware, request handlers, error handlers, and routing system.

## Table of Contents

1. [Overview](#overview)
2. [Request Handler Architecture](#request-handler-architecture)
3. [Default Request Handlers](#default-request-handlers)
4. [Default Error Handlers](#default-error-handlers)
5. [Middleware System](#middleware-system)
6. [Default Routes](#default-routes)
7. [Request Flow](#request-flow)
8. [Handler Registration](#handler-registration)
9. [Custom Handlers](#custom-handlers)
10. [Best Practices](#best-practices)

## Overview

Kixx provides a comprehensive request handling system with default handlers for common web application needs. The system is designed to work seamlessly with the page structure and templating system.

### Key Components

- **Virtual Hosts**: Configure different domains and their routing
- **Routes**: Define URL patterns and associate them with middleware, request handlers, and error handlers.
- **Middleware**: Process requests before they reach handlers
- **Request Handlers**: Process HTTP requests and generate responses
- **Error Handlers**: Handle errors and render appropriate error pages

## Request Handler Architecture

The Kixx request handling system follows a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Server                              │
├─────────────────────────────────────────────────────────────┤
│                    Application Server                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Virtual Host  │  │     Router      │  │   Context    │ │
│  │   Management    │  │                 │  │              │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Request Processing                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Middleware    │  │   Handlers      │  │ Error        │ │
│  │                 │  │                 │  │ Handlers     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **HTTP Request** arrives at the server
2. **Application Server** creates framework request/response objects
3. **Virtual Host** configuration is loaded
4. **Router** matches the request to a route
5. **Middleware** processes the request (if any)
6. **Request Handlers** process the request in sequence
7. **Error Handlers** handle any errors that occur
8. **Response** is sent back to the client

## Default Request Handlers
Kixx provides three default request handlers.

### PageHandler
The `PageHandler` is the primary handler for rendering HTML pages using the templating system.

#### Purpose
- Renders HTML pages using the view service
- Supports both HTML and JSON responses
- Integrates with the page structure system

#### Configuration
```json
{
    "name": "ProductsListing",
    "pattern": "/products{.json}",
    "targets": [
        {
            "name": "ProductsList",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["ProductsList"], // Query the products from the DB
                ["kixx.AppPageHandler"] // Render the page at /pages/products/
            ]
        }
    ]
},
{
    "name": "ProductView",
    "pattern": "/products/:product_id/view{.json}",
    "targets": [
        {
            "name": "ProductView",
            "methods": ["GET", "HEAD"],
            "handlers": [
                // Query the product by ID from the DB
                ["ProductView"],
                // Render the page at /pages/products/product_id/view/
                ["kixx.AppPageHandler", {"pathname": "/products/product_id/view"}]
            ]
        }
    ]
}
```

#### Integration with Page Structure
The `PageHandler` works directly with the [Kixx Page Structure](./step-3-page-structure.md):

- **URL Pathname** → **Page Directory**: `/about` → `pages/about/`
- **Page Data**: Loads `pages/about/page.json`
- **Page Template**: Loads `pages/about/page.html`
- **Base Template**: Uses `templates/templates/base.html`

#### How Template Context Data is Created

The `PageHandler` uses the Kixx `ViewService` to load and merge all the data needed to render a page template. The final context object passed to the template engine is the result of a deep merge of:

- Site-wide page data from `site-page-data.json`. See [Application Configuration](./step-1-application-configuration.md).
- Per-page data loaded from a JSON file based on the URL pathname. For example, a request to `/about` will load `pages/about/page.json`
- Additional props from `HttpServerResponse.props` set by upstream handlers via `request.updateProps()`. This allows dynamic data to be injected into the template.


### StaticFileServer

The `StaticFileServer` serves static files from a public directory.

#### Purpose
- Serves static assets (CSS, JS, images, etc.)
- Implements security measures to prevent directory traversal
- Supports conditional requests and caching
- Handles content-type detection

#### Configuration and Default Options

The `StaticFileServer` can be configured with options. If you provide an option directly, it will override the value from the application's configuration. If an option is not provided, the following resolution order is used:

- `publicDirectory`:  
  - If provided as an option, that value is used.
  - Otherwise, defaults to `context.paths.application_public_directory` at runtime.

- `cacheControl`:  
  - If provided as an option, that value is used.
  - Otherwise, uses `config.cacheControl` from the `"Kixx.StaticFileServer"` config namespace.
  - If not set in config, defaults to `'no-cache'`.

#### Security Features
- **Path validation**: Prevents `..` and `//` in paths
- **Character restrictions**: Only allows safe characters
- **File existence checks**: Validates files exist and are actually files
- **Directory traversal prevention**: Blocks attempts to access parent directories

#### Caching Support
- **Last-Modified headers**: Sets based on file modification time
- **If-Modified-Since**: Supports conditional requests
- **Cache-Control**: Configurable caching headers
- **304 Not Modified**: Returns when content hasn't changed

#### Example Usage
Example creation of a StaticFileServer handler in JavaScript.
```javascript
// In route configuration
{
    name: 'StaticFiles',
    methods: ['GET', 'HEAD'],
    handlers: [
        StaticFileServer({
            cacheControl: 'public, max-age=86400'
        })
    ]
}
```

## Default Error Handlers

Kixx provides a default error handler for rendering error pages.

### PageErrorHandler

The `PageErrorHandler` renders error pages using the templating system.

#### Purpose
- Renders user-friendly error pages
- Logs server errors (500+ status codes)
- Sets appropriate HTTP headers
- Integrates with the view service

#### Error Processing
1. **Log errors** for 500+ status codes
2. **Render error page** using view service
3. **Set Allow header** for 405 Method Not Allowed
4. **Return HTML response** with appropriate status code

#### Error Page Rendering
The error handler uses the view service to render error pages:

1. **Try custom error page**: Looks for `pages/{statusCode}/page.html`
2. **Fallback to default**: Uses built-in error page if custom page not found
3. **Set status code**: Uses error's `httpStatusCode` or defaults to 500

#### Example Usage
```javascript
// In route configuration
{
    name: 'DefaultPages',
    pattern: '*',
    errorHandlers: [
        PageErrorHandler({ viewService: 'kixx.AppViewService' })
    ]
}
```

## Middleware System

Kixx provides a middleware system for processing requests before and after request handlers.

## Defining Custom Middleware

Custom middleware in Kixx is defined as a function that receives the following arguments:

- `context`: The application context (services, config, logger, etc.)
- `request`: The HTTP request object
- `response`: The HTTP response object
- `next`: A function to call the next middleware or handler in the chain

A middleware function can perform operations before and/or after calling `next()`. Middleware can be synchronous or asynchronous (returning a Promise).

### Example: Logging Middleware


### Middleware Registration

```javascript
import { registerMiddleware } from '../request-handlers/middleware/mod.js';

// Register custom middleware
registerMiddleware('myMiddleware', function myMiddleware(context, request, response, next) {
    // Process request
    console.log('Processing request:', request.url.pathname);
    
    // Call next middleware/handler
    return next();
});
```

### Middleware Function Signature

```javascript
function middleware(context, request, response, next) {
    // Process request
    // ...
    
    // Call next middleware or handler
    return next();
}
```

### Middleware Execution Order

1. **Global middleware** (registered at application level)
2. **Virtual host middleware** (specific to virtual host)
3. **Route middleware** (specific to route)
4. **Request handlers** (in sequence)
5. **Error handlers** (if error occurs)

## Default Routes

Kixx provides default routes that handle common web application patterns.

### Default Route Configuration

```javascript
export default [
    {
        name: 'ObjectStore',
        pattern: '/kixx/objects/:id',
        errorHandlers: [
            PageErrorHandler({ viewService: 'kixx.AppViewService' })
        ],
        targets: [
            {
                name: 'ObjectStoreGET',
                methods: ['GET', 'HEAD'],
                handlers: [
                    ObjectStoreReader()
                ]
            }
        ]
    },
    {
        name: 'DefaultPages',
        pattern: '*',
        errorHandlers: [
            PageErrorHandler({ viewService: 'kixx.AppViewService' })
        ],
        targets: [
            {
                name: 'PageHandler',
                methods: ['GET', 'HEAD'],
                handlers: [
                    StaticFileServer(),
                    PageHandler({ viewService: 'kixx.AppViewService' })
                ]
            }
        ]
    }
];
```

### Route Structure

#### ObjectStore Route
- **Pattern**: `/kixx/objects/:id`
- **Purpose**: Serve objects from object store
- **Methods**: GET, HEAD
- **Handlers**: ObjectStoreReader
- **Error Handling**: PageErrorHandler

#### DefaultPages Route
- **Pattern**: `*` (catch-all)
- **Purpose**: Handle all other requests
- **Methods**: GET, HEAD
- **Handlers**: StaticFileServer, PageHandler (in sequence)
- **Error Handling**: PageErrorHandler

### Handler Execution Order

For the DefaultPages route:

1. **StaticFileServer**: Check if request is for a static file
   - If file exists: serve it and stop processing
   - If file doesn't exist: continue to next handler
2. **PageHandler**: Render page using templating system
   - Load page data and template
   - Render HTML response

## Request Flow

### Complete Request Processing

```
HTTP Request
    ↓
Application Server
    ↓
Load Virtual Host Configuration
    ↓
Router Match Request to Route
    ↓
Execute Middleware (if any)
    ↓
Execute Request Handlers (in sequence)
    ├── StaticFileServer
    │   ├── File exists? → Serve file → End
    │   └── File doesn't exist? → Continue
    └── PageHandler
        ├── Load page data
        ├── Load page template
        ├── Render HTML
        └── Return response
    ↓
If Error Occurs → Execute Error Handlers
    ↓
HTTP Response
```

### Example Request Flow

**Request**: `GET /about`

1. **Application Server** receives request
2. **Virtual Host** configuration loaded
3. **Router** matches `*` pattern (DefaultPages route)
4. **StaticFileServer** checks for `/about` file in public directory
   - File doesn't exist → continue
5. **PageHandler** processes request:
   - Load `pages/about/page.json` (page data)
   - Load `pages/about/page.html` (page template)
   - Load `templates/templates/base.html` (base template)
   - Render HTML with merged data
6. **Response** sent with HTML content

## Handler Registration

### Built-in Handler Registration

```javascript
// In request-handlers/handlers/mod.js
export const handlers = new Map();

handlers.set('kixx.PageHandler', PageHandler);
handlers.set('kixx.StaticFileServer', StaticFileServer);
handlers.set('kixx.ObjectStoreReader', ObjectStoreReader);

// Application-specific variants
handlers.set('kixx.AppPageHandler', function AppPageHandler(options) {
    const opts = Object.assign({ viewService: 'kixx.AppViewService' }, options || {});
    return PageHandler(opts);
});
```

### Custom Handler Registration

```javascript
import { registerHandler } from '../request-handlers/handlers/mod.js';

// Register custom handler
registerHandler('myCustomHandler', function myCustomHandler(context, request, response) {
    // Handler implementation
    return response.respondWithJSON(200, { message: 'Hello World' });
});
```

### Error Handler Registration

```javascript
import { registerErrorHandler } from '../request-handlers/error-handlers/mod.js';

// Register custom error handler
registerErrorHandler('myErrorHandler', function myErrorHandler(context, request, response, error) {
    // Error handler implementation
    return response.respondWithJSON(error.httpStatusCode || 500, { 
        error: error.message 
    });
});
```

## Custom Handlers

### Creating Custom Request Handlers

```javascript
// plugins/my-plugin/handlers/api-handler.js
export default function ApiHandler(options = {}) {
    return async function apiHandler(context, request, response) {
        const { logger } = context;
        
        try {
            // Process API request
            const data = await processApiRequest(request);
            
            return response.respondWithJSON(200, data);
        } catch (error) {
            logger.error('API handler error', { requestId: request.id }, error);
            throw error;
        }
    };
}
```

### Creating Custom Error Handlers

```javascript
// plugins/my-plugin/error-handlers/api-error-handler.js
export default function ApiErrorHandler() {
    return async function apiErrorHandler(context, request, response, error) {
        const { logger } = context;
        
        // Log error
        logger.error('API error', { requestId: request.id }, error);
        
        // Return JSON error response
        return response.respondWithJSON(
            error.httpStatusCode || 500,
            {
                error: error.message,
                code: error.code || 'INTERNAL_ERROR'
            }
        );
    };
}
```

### Creating Custom Middleware

```javascript
// plugins/my-plugin/middleware/auth-middleware.js
export default function AuthMiddleware(options = {}) {
    return async function authMiddleware(context, request, response, next) {
        const { logger } = context;
        
        // Check authentication
        const token = request.headers.get('authorization');
        
        if (!token) {
            return response.respondWithJSON(401, { error: 'Unauthorized' });
        }
        
        try {
            // Validate token
            const user = await validateToken(token);
            request.user = user;
            
            // Continue to next middleware/handler
            return next();
        } catch (error) {
            logger.error('Auth middleware error', { requestId: request.id }, error);
            return response.respondWithJSON(401, { error: 'Invalid token' });
        }
    };
}
```

## Best Practices

### 1. Handler Organization

```
plugins/
├── my-plugin/
│   ├── handlers/
│   │   ├── api-handler.js
│   │   └── custom-page-handler.js
│   ├── error-handlers/
│   │   ├── api-error-handler.js
│   │   └── custom-error-handler.js
│   └── middleware/
│       ├── auth-middleware.js
│       └── logging-middleware.js
```

### 2. Error Handling

```javascript
// Always handle errors gracefully
export default function MyHandler() {
    return async function myHandler(context, request, response) {
        try {
            // Handler logic
            const result = await processRequest(request);
            return response.respondWithJSON(200, result);
        } catch (error) {
            // Log error for debugging
            context.logger.error('Handler error', { requestId: request.id }, error);
            
            // Re-throw for error handlers
            throw error;
        }
    };
}
```

### 3. Security Considerations

```javascript
// Validate input data
export default function SecureHandler() {
    return async function secureHandler(context, request, response) {
        // Validate request parameters
        const { id } = request.pathnameParams;
        if (!id || !isValidId(id)) {
            throw new BadRequestError('Invalid ID parameter');
        }
        
        // Sanitize user input
        const userInput = sanitizeInput(request.body);
        
        // Process request
        const result = await processSecureRequest(id, userInput);
        return response.respondWithJSON(200, result);
    };
}
```

### 4. Performance Optimization

```javascript
// Use caching where appropriate
export default function CachedHandler() {
    return async function cachedHandler(context, request, response) {
        const cacheKey = generateCacheKey(request);
        
        // Check cache first
        const cached = await context.cache.get(cacheKey);
        if (cached) {
            return response.respondWithJSON(200, cached);
        }
        
        // Process request
        const result = await expensiveOperation();
        
        // Cache result
        await context.cache.set(cacheKey, result, 3600);
        
        return response.respondWithJSON(200, result);
    };
}
```

### 5. Logging and Monitoring

```javascript
// Include request context in logs
export default function LoggedHandler() {
    return async function loggedHandler(context, request, response) {
        const startTime = Date.now();
        
        try {
            // Process request
            const result = await processRequest(request);
            
            // Log success
            context.logger.info('Request processed successfully', {
                requestId: request.id,
                pathname: request.url.pathname,
                duration: Date.now() - startTime
            });
            
            return response.respondWithJSON(200, result);
        } catch (error) {
            // Log error with context
            context.logger.error('Request failed', {
                requestId: request.id,
                pathname: request.url.pathname,
                duration: Date.now() - startTime,
                error: error.message
            }, error);
            
            throw error;
        }
    };
}
```

## Integration with Page Structure

The default request handlers work seamlessly with the page structure system:

### PageHandler Integration

- **URL Mapping**: `/about` → `pages/about/page.html`
- **Data Loading**: `pages/about/page.json`
- **Template Rendering**: `templates/templates/base.html`
- **Error Handling**: `pages/404/page.html` for not found

### StaticFileServer Integration

- **Public Assets**: Serves files from `public/` directory
- **Security**: Prevents access to page templates and data
- **Caching**: Optimizes static asset delivery

### Error Handler Integration

- **Custom Error Pages**: `pages/{statusCode}/page.html`
- **Fallback Pages**: Built-in error pages when custom pages don't exist
- **Consistent Styling**: Uses same base template as regular pages

This integration ensures that the request handling system works harmoniously with the page structure, providing a complete solution for building hypermedia-driven web applications with Kixx. 