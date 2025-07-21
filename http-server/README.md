# HTTP Server

The HTTP server module provides a complete, lightweight HTTP server implementation with routing, virtual hosts, middleware support, and comprehensive request/response handling.

## Architecture Overview

The HTTP server follows a layered architecture with clear separation of concerns:

```
HttpServer (Top Level)
    ↓
HttpRouter (Routing & Virtual Hosts)
    ↓
VirtualHost (Hostname Matching)
    ↓
HttpRoute (Pathname Matching)
    ↓
HttpTarget (Method & Middleware)
    ↓
BaseServerRequest/Response (Data Handling)
```

## Core Components

### HttpServer
The main server class that wraps Node.js's built-in `http.Server`. Provides lifecycle management, event emission, and request handling.

**Key Features:**
- Starts/stops HTTP server on configurable port
- Emits events for server lifecycle and request/response activity
- Handles graceful shutdown with timeout
- Provides default request handler (can be overridden)
- Error handling and logging

**Usage:**
```javascript
import HttpServer from './http-server.js';

const server = new HttpServer({ port: 8080 });
server.startServer();

server.on('error', (err) => console.error('Server error:', err));
server.on('info', (info) => console.log('Server info:', info));
server.on('debug', (debug) => console.log('Debug:', debug));
```

### HttpRouter
Routes HTTP requests to appropriate virtual hosts, routes, and targets. Handles 404 and 405 errors.

**Key Features:**
- Virtual host matching and routing
- Request/response context management
- Error handling with fallback mechanisms
- Method validation

**Usage:**
```javascript
import HttpRouter from './http-router.js';

const router = new HttpRouter(virtualHosts);
const handler = router.getHttpRequestHandler();
// Use handler as request listener in HTTP server
```

### VirtualHost
Represents a single virtual host with hostname matching and route management.

**Key Features:**
- Hostname pattern matching (exact or regex)
- Route dispatching within virtual host
- Support for wildcard hostnames (`*`)

**Usage:**
```javascript
import VirtualHost from './virtual-host.js';

const vhost = new VirtualHost({
    name: 'api.example.com',
    hostname: 'api.example.com',
    routes: [route1, route2]
});
```

### HttpRoute
Represents a single HTTP route with pathname matching and target management.

**Key Features:**
- Pathname pattern matching with parameter extraction
- Multiple HTTP method support
- Error handling at route level
- Target selection based on HTTP method

**Usage:**
```javascript
import HttpRoute from './http-route.js';

const route = new HttpRoute({
    name: 'user-profile',
    patternMatcher: (pathname) => {
        // Return { params: { id: '123' } } if matches
        // Return null if no match
    },
    targets: [getTarget, postTarget],
    errorHandlers: [errorHandler]
});
```

### HttpTarget
Represents a specific HTTP endpoint with middleware stack and error handling.

**Key Features:**
- HTTP method validation
- Middleware execution chain
- Error handling with short-circuit support
- Async/await support

**Usage:**
```javascript
import HttpTarget from './http-target.js';

const target = new HttpTarget({
    name: 'get-user',
    allowedMethods: ['GET'],
    middleware: [authMiddleware, userHandler],
    errorHandlers: [userErrorHandler]
});
```

### BaseServerRequest
Provides a structured, immutable interface for accessing HTTP request data.

**Key Features:**
- Immutable request metadata (id, method, headers, url)
- Parameter accessors (hostname, pathname, query)
- Cookie parsing and retrieval
- Authorization header parsing (Bearer tokens)
- Request type detection (JSON, form)
- Body parsing methods (JSON, form, raw)

**Usage:**
```javascript
// Access request data
const method = request.method;
const headers = request.headers;
const url = request.url;
const queryParams = request.queryParams; // URLSearchParams
const cookies = request.getCookies();
const bearerToken = request.getAuthorizationBearer();

// Parse request body
const jsonData = await request.json();
const formData = await request.formData();
const rawData = await request.getBufferedStringData('utf8');
```

### BaseServerResponse
Provides a comprehensive interface for building HTTP responses.

**Key Features:**
- Status code and headers management
- Cookie setting with full options support
- Response type helpers (JSON, HTML, redirect, stream)
- Custom properties with deep freezing
- Chaining support

**Usage:**
```javascript
// Basic response
response.status = 200;
response.setHeader('content-type', 'text/plain');
response.body = 'Hello World';

// JSON response
response.respondWithJSON(200, { message: 'Success' });

// Redirect
response.respondWithRedirect(302, '/new-location');

// Set cookies
response.setCookie('session', 'abc123', {
    maxAge: 3600,
    secure: true,
    httpOnly: true,
    sameSite: 'Strict'
});
```

## Request Flow

1. **HttpServer** receives Node.js request
2. **HttpRouter** matches hostname to VirtualHost
3. **VirtualHost** matches pathname to HttpRoute
4. **HttpRoute** validates HTTP method and selects HttpTarget
5. **HttpTarget** executes middleware chain
6. **BaseServerRequest/Response** handle data parsing and formatting

## Error Handling

The system provides multiple levels of error handling:

1. **Target Level**: HttpTarget error handlers
2. **Route Level**: HttpRoute error handlers  
3. **Router Level**: HttpRouter default error handling
4. **Server Level**: HttpServer error events

Errors are handled in order, with each level having the opportunity to handle the error before it bubbles up.

## Middleware System

The middleware system supports both programmatic and declarative configuration. Middleware can be defined as functions or referenced by name in route configurations.

### Middleware Function Signature

Middleware functions receive:
- `context`: Application context
- `request`: BaseServerRequest instance
- `response`: BaseServerResponse instance  
- `skip`: Function to short-circuit middleware chain

**Example Middleware:**
```javascript
async function authMiddleware(context, request, response, skip) {
    const token = request.getAuthorizationBearer();
    if (!token) {
        return response.respondWithJSON(401, { error: 'Unauthorized' });
    }
    // Continue to next middleware
    return response;
}
```

### Middleware Registration

Middleware can be registered programmatically:

```javascript
import { registerMiddleware } from '../request-handlers/middleware/mod.js';

registerMiddleware('AuthMiddleware', (options) => {
    return async function authMiddleware(context, request, response, skip) {
        // Middleware implementation
    };
});
```

### Middleware Types

- **Inbound Middleware**: Executed before target handlers (outside-in)
- **Outbound Middleware**: Executed after target handlers (inside-out)
- **Error Handlers**: Executed when errors occur (inside-out)

### Middleware Composition

Middleware can be composed with options:

```json
{
    "inboundMiddleware": [
        ["AuthMiddleware", { "requireAdmin": true }],
        ["LoggingMiddleware", { "level": "debug" }]
    ]
}
```

### Middleware Execution Order

1. **Inbound Middleware** (parent → child)
2. **Target Handlers**
3. **Outbound Middleware** (child → parent)
4. **Error Handlers** (if error occurs)

## Virtual Host Configuration

Virtual hosts support multiple matching strategies:

### Hostname Matching

- **Exact hostname**: `'api.example.com'` - matches exactly
- **Wildcard**: `'*'` - matches any hostname
- **Pattern**: `'api.*.example.com'` - regex pattern matching

### Hostname Pattern Examples

```json
[
    {
        "name": "Main",
        "hostname": "example.com",
        "routes": ["app://main.json"]
    },
    {
        "name": "API",
        "pattern": "api.example.com",
        "routes": ["app://api.json"]
    },
    {
        "name": "Wildcard",
        "hostname": "*",
        "routes": ["app://wildcard.json"]
    }
]
```

### Hostname Parameter Extraction

Pattern-based virtual hosts can extract parameters:

```json
{
    "name": "Tenant",
    "pattern": ":tenant.example.com",
    "routes": ["app://tenant.json"]
}
```

This extracts the `tenant` parameter from hostnames like `acme.example.com`.

## Route Pattern Matching

The routing system uses a declarative JSON-based configuration approach with pattern matching powered by `path-to-regexp`. Routes are defined in JSON files and automatically converted to executable route objects.

### Pattern Syntax

Routes use `path-to-regexp` syntax for pattern matching:

- **Static paths**: `/about` - matches exactly
- **Parameters**: `/:id` - captures parameter as `id`
- **Optional segments**: `/:id?` - optional parameter
- **Wildcards**: `*` - matches any path
- **File extensions**: `{.json}` - matches `.json` extension
- **Nested patterns**: `/users/:id/posts/:postId`

### Route Configuration Structure

Routes are defined in JSON files with this structure:

```json
{
    "name": "RouteName",
    "pattern": "/path/:param",
    "inboundMiddleware": [
        ["MiddlewareName", { "options": "value" }]
    ],
    "outboundMiddleware": [
        ["MiddlewareName"]
    ],
    "errorHandlers": [
        ["ErrorHandlerName"]
    ],
    "targets": [
        {
            "name": "TargetName",
            "methods": ["GET", "POST"],
            "handlers": [
                ["HandlerName", { "options": "value" }]
            ],
            "errorHandlers": [
                ["TargetErrorHandler"]
            ]
        }
    ],
    "routes": [
        // Nested routes (inherits parent middleware)
    ]
}
```

### Virtual Host Configuration

Virtual hosts are configured in `virtual-hosts.json`:

```json
[
    {
        "name": "Main",
        "hostname": "example.com",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    },
    {
        "name": "API",
        "pattern": "api.example.com",
        "routes": [
            "app://api.json"
        ]
    }
]
```

### Route Resolution

Routes can be loaded from:
- **`app://`** - Application-specific routes from `routes/` directory
- **`kixx://`** - Built-in Kixx routes (defaults, etc.)

### Nested Routes

Routes can be nested to inherit middleware and create hierarchical structures:

```json
{
    "name": "Admin",
    "pattern": "/admin",
    "inboundMiddleware": [
        ["AdminAuth"]
    ],
    "routes": [
        {
            "name": "Users",
            "pattern": "/users",
            "targets": [
                {
                    "name": "ListUsers",
                    "methods": ["GET"],
                    "handlers": [
                        ["UserListHandler"]
                    ]
                }
            ]
        }
    ]
}
```

This creates the path `/admin/users` with `AdminAuth` middleware applied.

## Events

The HttpServer emits several event types:

- **`error`**: Server or request errors
- **`info`**: Server lifecycle events (listening, closed)
- **`debug`**: Request/response activity

## Application Structure

A typical Kixx application follows this directory structure:

```
my-app/
├── kixx-config.json          # Application configuration
├── virtual-hosts.json        # Virtual host definitions
├── routes/                   # Route configuration files
│   ├── main.json            # Main application routes
│   ├── api.json             # API routes
│   └── admin.json           # Admin routes
├── pages/                    # Page templates and data
│   ├── index.html           # Home page template
│   ├── index.json           # Home page data
│   └── about/
│       ├── index.html       # About page template
│       └── index.json       # About page data
├── templates/                # Base templates
│   ├── templates/
│   │   └── base.html        # Base template
│   ├── partials/            # Template partials
│   └── helpers/             # Template helpers
├── public/                   # Static assets
└── plugins/                  # Custom handlers and middleware
```

## Best Practices

### Route Organization

1. **Group Related Routes**: Use nested routes to group related functionality
2. **Middleware Inheritance**: Apply common middleware at parent route level
3. **Error Handling**: Provide error handlers at appropriate levels (target → route → router)
4. **Pattern Design**: Use descriptive patterns that match your URL structure

### Middleware Design

1. **Single Responsibility**: Each middleware should have one clear purpose
2. **Composability**: Design middleware to work with options for flexibility
3. **Error Handling**: Always handle errors gracefully
4. **Performance**: Minimize blocking operations and database queries

### Security Considerations

1. **Input Validation**: Validate and sanitize all request data
2. **Authentication**: Use middleware for authentication checks
3. **Authorization**: Implement proper authorization at route level
4. **HTTPS**: Use secure cookies and headers in production

### Performance Optimization

1. **Caching**: Implement appropriate caching strategies
2. **Database Queries**: Optimize database queries and use connection pooling
3. **Static Assets**: Serve static assets efficiently
4. **Response Streaming**: Use streaming for large responses

## Real-World Examples

### E-commerce Application

```json
// routes/main.json
[
    {
        "name": "Public",
        "pattern": "/",
        "targets": [
            {
                "name": "HomePage",
                "methods": ["GET"],
                "handlers": [["HomePageHandler"]]
            }
        ]
    },
    {
        "name": "Products",
        "pattern": "/products",
        "routes": [
            {
                "name": "ProductList",
                "pattern": "/",
                "targets": [
                    {
                        "name": "ListProducts",
                        "methods": ["GET"],
                        "handlers": [["ProductListHandler"]]
                    }
                ]
            },
            {
                "name": "ProductDetail",
                "pattern": "/:id",
                "targets": [
                    {
                        "name": "GetProduct",
                        "methods": ["GET"],
                        "handlers": [["ProductDetailHandler"]]
                    }
                ]
            }
        ]
    },
    {
        "name": "Admin",
        "pattern": "/admin",
        "inboundMiddleware": [["AdminAuth"]],
        "routes": [
            {
                "name": "Dashboard",
                "pattern": "/",
                "targets": [
                    {
                        "name": "AdminDashboard",
                        "methods": ["GET"],
                        "handlers": [["AdminDashboardHandler"]]
                    }
                ]
            }
        ]
    }
]
```

### API Application

```json
// routes/api.json
[
    {
        "name": "API",
        "pattern": "/api/v1",
        "inboundMiddleware": [
            ["ApiAuth"],
            ["RateLimiting", { "requests": 100, "window": "1m" }]
        ],
        "errorHandlers": [["ApiErrorHandler"]],
        "routes": [
            {
                "name": "Users",
                "pattern": "/users",
                "targets": [
                    {
                        "name": "ListUsers",
                        "methods": ["GET"],
                        "handlers": [["UserListHandler"]]
                    },
                    {
                        "name": "CreateUser",
                        "methods": ["POST"],
                        "handlers": [["UserCreateHandler"]]
                    }
                ]
            }
        ]
    }
]
```
