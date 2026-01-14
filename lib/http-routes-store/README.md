# HTTP Routes Configuration

This guide explains how to configure HTTP routes for your Kixx application. Routes define how incoming HTTP requests are matched and handled.

## Overview
Kixx uses a hierarchical routing system:

```
Router -> VirtualHost -> Route -> Target
```

- **Router**: Top-level request handler that manages virtual hosts
- **VirtualHost**: Matches requests by hostname (domain)
- **Route**: Matches requests by URL pathname pattern
- **Target**: Handles specific HTTP methods with middleware chains

## File Structure
Routes are defined using JSON or JSON-C files. Your application needs two types of route configuration files:

```
my-app/
├── virtual-hosts.jsonc    # Main routing configuration
└── routes/
    ├── api.jsonc          # API routes
    ├── pages.jsonc        # Page routes
    └── admin.jsonc        # Admin routes
```

The main point of entry is the `virtual-hosts.jsonc` file which defines the virtual hosts your app answers to, and contains references to the rest of the route config files. The routes for each virtual host are defined in the `routes/` directory. You can have as many route config files as you need. A virtual host can use more than one route config file, and virtual hosts can even share route config files.

## Virtual Hosts Configuration

The `virtual-hosts.jsonc` file defines hostname-based routing. It must be an array of virtual host objects.

### Basic Example

```jsonc
[
    {
        "name": "Main Site",
        "hostname": "com.example.www",
        "routes": [
            "app://pages.jsonc",
            "app://api.jsonc"
        ]
    }
]
```

### Virtual Host Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | No | Display name for debugging (defaults to hostname/pattern) |
| `hostname` | string | Yes* | Exact hostname to match (reversed format) |
| `pattern` | string | Yes* | Dynamic hostname pattern using PathToRegexp syntax |
| `routes` | array | Yes | URNs referencing route configuration files |

*Must provide either `hostname` OR `pattern`, but not both.

### Hostname Format

Hostnames are written in **reversed format** for matching from most generic (TLD) to most specific (subdomain):

| Actual Hostname | Configuration Value |
|-----------------|---------------------|
| `www.example.com` | `com.example.www` |
| `api.example.com` | `com.example.api` |
| `localhost` | `localhost` |

### Wildcard Hostname

Use `*` to match any hostname:

```jsonc
{
    "hostname": "*",
    "routes": ["app://default.jsonc"]
}
```

### Dynamic Hostname Pattern

Use PathToRegexp syntax for dynamic hostname matching:

```jsonc
{
    "pattern": "com.example.:subdomain",
    "routes": ["app://tenant.jsonc"]
}
```

This captures the subdomain as a parameter (e.g., `api.example.com` -> `{ subdomain: "api" }`).

### Route URNs

Routes are referenced using URN strings:

- `app://path/to/routes.jsonc` - Your application's routes directory
- `kixx://defaults.json` - Built-in Kixx default routes

## Route Configuration Files

Route files define URL patterns and their handlers. Each file must be an array of route objects.

### Basic Route Example

```jsonc
[
    {
        "pattern": "/users",
        "targets": [
            {
                "methods": ["GET"],
                "handlers": [["listUsers"]]
            },
            {
                "methods": ["POST"],
                "handlers": [["createUser"]]
            }
        ]
    },
    {
        "pattern": "/users/:id",
        "targets": [
            {
                "methods": ["GET"],
                "handlers": [["getUser"]]
            },
            {
                "methods": ["PUT"],
                "handlers": [["updateUser"]]
            },
            {
                "methods": ["DELETE"],
                "handlers": [["deleteUser"]]
            }
        ]
    }
]
```

### Route Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | No | Route identifier (defaults to pattern) |
| `pattern` | string | Yes | URL pattern using PathToRegexp syntax or `*` wildcard |
| `inboundMiddleware` | array | No | Middleware executed before handlers |
| `outboundMiddleware` | array | No | Middleware executed after handlers |
| `errorHandlers` | array | No | Error handlers for this route |
| `targets` | array | Yes* | Endpoint handlers (leaf nodes) |
| `routes` | array | Yes* | Nested routes (branch nodes) |

*Must provide either `targets` OR `routes`, but not both.

## URL Patterns

Patterns use [PathToRegexp](https://github.com/pillarjs/path-to-regexp) syntax:

### Static Paths
```jsonc
{ "pattern": "/users" }
{ "pattern": "/api/v1/products" }
```

### Named Parameters
```jsonc
{ "pattern": "/users/:id" }           // Matches /users/123
{ "pattern": "/posts/:year/:month" }  // Matches /posts/2024/01
```

### Optional Parameters
```jsonc
{ "pattern": "/files/:path*" }        // Matches /files or /files/a/b/c
{ "pattern": "/users/:id?" }          // Matches /users or /users/123
```

### Wildcard
```jsonc
{ "pattern": "*" }                    // Matches any path
```

## Targets

Targets define which HTTP methods a route handles and what middleware processes the request.

### Target Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `methods` | array or `*` | Yes | HTTP methods to handle |
| `handlers` | array | Yes | Handler middleware chain |
| `errorHandlers` | array | No | Target-specific error handlers |

### Supported HTTP Methods

- `GET`
- `HEAD`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Use `"*"` to handle all methods:

```jsonc
{
    "methods": "*",
    "handlers": [["handleAll"]]
}
```

### Multiple Methods

```jsonc
{
    "methods": ["GET", "HEAD"],
    "handlers": [["serveFile"]]
}
```

## Middleware and Handlers

Middleware and handlers are specified as `[name, options]` tuples, where:
- `name` is a string referencing a registered middleware/handler factory
- `options` is an optional configuration object passed to the factory

### Handler Definition Format

```jsonc
// Simple handler (no options)
["myHandler"]

// Handler with options
["myHandler", { "option1": "value1" }]
```

### Example with Middleware

```jsonc
{
    "pattern": "/api/users",
    "inboundMiddleware": [
        ["authenticate"],
        ["rateLimit", { "maxRequests": 100, "windowMs": 60000 }]
    ],
    "targets": [
        {
            "methods": ["GET"],
            "handlers": [["listUsers"]]
        }
    ],
    "outboundMiddleware": [
        ["addCorsHeaders"]
    ]
}
```

### Middleware Execution Order

1. **Inbound middleware** (parent -> child, outside-in)
2. **Target handlers**
3. **Outbound middleware** (child -> parent, inside-out)

## Error Handlers

Error handlers catch and process errors thrown during request handling. They follow a cascade pattern: target -> route -> router.

```jsonc
{
    "pattern": "/api",
    "errorHandlers": [
        ["apiErrorHandler"]
    ],
    "routes": [...]
}
```

Target-specific error handlers run first, allowing fine-grained error responses:

```jsonc
{
    "methods": ["POST"],
    "handlers": [["createUser"]],
    "errorHandlers": [
        ["validationErrorHandler"]
    ]
}
```

## Nested Routes

Routes can be nested to share common patterns and middleware. Parent properties are merged onto children.

### Basic Nesting

```jsonc
[
    {
        "pattern": "/api",
        "inboundMiddleware": [["authenticate"]],
        "routes": [
            {
                "pattern": "/users",
                "targets": [
                    {
                        "methods": ["GET"],
                        "handlers": [["listUsers"]]
                    }
                ]
            },
            {
                "pattern": "/posts",
                "targets": [
                    {
                        "methods": ["GET"],
                        "handlers": [["listPosts"]]
                    }
                ]
            }
        ]
    }
]
```

This creates routes:
- `GET /api/users` - with `authenticate` middleware
- `GET /api/posts` - with `authenticate` middleware

### Deep Nesting

```jsonc
[
    {
        "pattern": "/api/v1",
        "inboundMiddleware": [["apiVersionCheck", { "version": "1" }]],
        "routes": [
            {
                "pattern": "/admin",
                "inboundMiddleware": [["requireAdmin"]],
                "routes": [
                    {
                        "pattern": "/users",
                        "targets": [
                            {
                                "methods": ["GET"],
                                "handlers": [["adminListUsers"]]
                            }
                        ]
                    }
                ]
            }
        ]
    }
]
```

This creates:
- `GET /api/v1/admin/users` - with `apiVersionCheck` AND `requireAdmin` middleware

### Middleware Inheritance

When routes are nested:
- **Inbound middleware**: Parent runs before child (outside-in)
- **Outbound middleware**: Child runs before parent (inside-out)
- **Error handlers**: Child runs before parent (most specific first)

## Complete Example

### virtual-hosts.jsonc

```jsonc
[
    {
        "name": "Production",
        "hostname": "com.myapp.www",
        "routes": [
            "app://web.jsonc",
            "app://api.jsonc",
            "kixx://defaults.json"
        ]
    },
    {
        "name": "Development",
        "hostname": "localhost",
        "routes": [
            "app://web.jsonc",
            "app://api.jsonc",
            "kixx://defaults.json"
        ]
    }
]
```

### routes/api.jsonc

```jsonc
[
    {
        "pattern": "/api/v1",
        "inboundMiddleware": [
            ["parseJsonBody"],
            ["authenticate"]
        ],
        "outboundMiddleware": [
            ["addCorsHeaders"]
        ],
        "errorHandlers": [
            ["apiErrorHandler"]
        ],
        "routes": [
            {
                "pattern": "/users",
                "targets": [
                    {
                        "methods": ["GET"],
                        "handlers": [["listUsers"]]
                    },
                    {
                        "methods": ["POST"],
                        "handlers": [
                            ["validateUserInput"],
                            ["createUser"]
                        ],
                        "errorHandlers": [
                            ["validationErrorHandler"]
                        ]
                    }
                ]
            },
            {
                "pattern": "/users/:id",
                "targets": [
                    {
                        "methods": ["GET"],
                        "handlers": [["getUser"]]
                    },
                    {
                        "methods": ["PUT"],
                        "handlers": [
                            ["validateUserInput"],
                            ["updateUser"]
                        ]
                    },
                    {
                        "methods": ["DELETE"],
                        "handlers": [
                            ["requireAdmin"],
                            ["deleteUser"]
                        ]
                    }
                ]
            }
        ]
    }
]
```

### routes/web.jsonc

```jsonc
[
    {
        "pattern": "/",
        "targets": [
            {
                "methods": ["GET"],
                "handlers": [["renderHomePage"]]
            }
        ]
    },
    {
        "pattern": "/about",
        "targets": [
            {
                "methods": ["GET"],
                "handlers": [["renderAboutPage"]]
            }
        ]
    },
    {
        "pattern": "/dashboard",
        "inboundMiddleware": [
            ["requireAuthentication"]
        ],
        "targets": [
            {
                "methods": ["GET"],
                "handlers": [["renderDashboard"]]
            }
        ]
    }
]
```

## Validation Errors

Common validation errors you may encounter:

| Error | Cause |
|-------|-------|
| `vhost.pattern or vhost.hostname must be provided` | Virtual host missing both hostname and pattern |
| `Must define one of vhost.pattern OR vhost.hostname but NOT both` | Virtual host has both hostname and pattern |
| `Invalid route pattern` | Pattern syntax is invalid for PathToRegexp |
| `route.routes or route.targets are required` | Route has neither targets nor nested routes |
| `Cannot define both route.routes AND route.targets` | Route has both targets and nested routes |
| `Invalid HTTP method` | Method not in supported list |
| `Unknown handler` | Handler name not registered in application |
| `Unknown middleware` | Middleware name not registered in application |
