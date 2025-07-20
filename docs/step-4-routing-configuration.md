# Step 4: Routing Configuration

## Overview

Routing in Kixx applications defines how HTTP requests are mapped to specific handlers and determines the flow of data through your application. The routing system is based on virtual hosts, routes, and targets, providing a flexible and powerful way to handle different types of requests.

## Routing Architecture

```
virtual-hosts.json     # Hostname routing
└── routes/
    ├── main.json      # Main application routes
    ├── api.json       # API routes
    └── admin.json     # Admin routes
```

## Virtual Hosts

### virtual-hosts.json

Virtual hosts define how different hostnames are routed to your application's route configurations.

```json
[
    {
        "name": "Main",
        "hostname": "com.myapp.www",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    },
    {
        "name": "API",
        "hostname": "api.myapp.com",
        "routes": [
            "app://api.json"
        ]
    },
    {
        "name": "Admin",
        "hostname": "admin.myapp.com",
        "routes": [
            "app://admin.json"
        ]
    }
]
```

#### Virtual Host Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Human-readable hostname identifier |
| `hostname` | string | Domain name pattern to match |
| `routes` | array | List of route configuration files |

#### Route References

- **app://** - Application-specific routes (from `routes/` directory)
- **kixx://** - Framework default routes

## Route Definitions

### routes/main.json

The main route configuration file defines how URLs are mapped to handlers.

```json
[
    {
        "name": "HomePage",
        "pattern": "/{index.json}",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "HomePageHandler",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["HomePageHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "StaticPages",
        "pattern": "/:page_id{.json}",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "StaticPageHandler",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "ProductPages",
        "pattern": "/products/:product_id{.json}",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "ProductPageHandler",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["ProductPageHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "ProductActions",
        "pattern": "/products/:product_id/:action",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "ProductActionHandler",
                "methods": ["GET", "POST"],
                "handlers": [
                    ["ProductActionHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "ContactForm",
        "pattern": "/contact",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "ContactFormGet",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["kixx.AppPageHandler"]
                ]
            },
            {
                "name": "ContactFormPost",
                "methods": ["POST"],
                "handlers": [
                    ["ContactFormHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    }
]
```

## Route Components

### Route Definition

Each route consists of several components:

```json
{
    "name": "RouteName",
    "pattern": "/path/:param{extension}",
    "errorHandlers": [["ErrorHandlerName"]],
    "targets": [
        {
            "name": "TargetName",
            "methods": ["GET", "POST"],
            "handlers": [["HandlerName"]]
        }
    ]
}
```

#### Route Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Unique route identifier |
| `pattern` | string | URL pattern with parameters |
| `errorHandlers` | array | Error handling middleware |
| `targets` | array | Request targets for different HTTP methods |

### URL Patterns

URL patterns support various parameter types and extensions:

#### Basic Patterns

```json
{
    "pattern": "/about"                    // Static path
}
```

#### Parameter Patterns

```json
{
    "pattern": "/products/:id"             // Required parameter
}
```

#### Optional Extensions

```json
{
    "pattern": "/products/:id{.json}"      // Optional .json extension
}
```

#### Multiple Parameters

```json
{
    "pattern": "/admin/users/:user_id/posts/:post_id"
}
```

#### Query Parameters

Query parameters are automatically available in request handlers:

```javascript
// URL: /products?category=electronics&page=2
const category = request.queryParams.category; // "electronics"
const page = request.queryParams.page;         // "2"
```

### Route Targets

Targets define how different HTTP methods are handled:

```json
{
    "targets": [
        {
            "name": "GetHandler",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["CustomHandler"],
                ["kixx.AppPageHandler"]
            ]
        },
        {
            "name": "PostHandler", 
            "methods": ["POST"],
            "handlers": [
                ["FormHandler"],
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

#### Target Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Target identifier |
| `methods` | array | HTTP methods to handle |
| `handlers` | array | Handler middleware chain |

### Handler Chains

Handlers are executed in order, with each handler able to modify the request/response:

```json
{
    "handlers": [
        ["AuthenticationHandler"],     // Check authentication
        ["AuthorizationHandler"],      // Check permissions
        ["CustomPageHandler"],         // Custom logic
        ["kixx.AppPageHandler"]        // Render page
    ]
}
```

## Route Types

### Static Routes

Routes for fixed content pages:

```json
{
    "name": "AboutPage",
    "pattern": "/about",
    "targets": [
        {
            "name": "AboutPageHandler",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

### Dynamic Routes

Routes with parameters for dynamic content:

```json
{
    "name": "ProductDetail",
    "pattern": "/products/:slug",
    "targets": [
        {
            "name": "ProductDetailHandler",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["ProductDetailHandler"],
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

### API Routes

Routes for JSON API endpoints:

```json
{
    "name": "ProductsAPI",
    "pattern": "/api/products",
    "targets": [
        {
            "name": "ProductsList",
            "methods": ["GET"],
            "handlers": [
                ["ProductsAPIHandler"]
            ]
        },
        {
            "name": "ProductsCreate",
            "methods": ["POST"],
            "handlers": [
                ["ProductsAPIHandler"]
            ]
        }
    ]
}
```

### Form Handling Routes

Routes that handle form submissions:

```json
{
    "name": "ContactForm",
    "pattern": "/contact",
    "targets": [
        {
            "name": "ContactFormDisplay",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["kixx.AppPageHandler"]
            ]
        },
        {
            "name": "ContactFormSubmit",
            "methods": ["POST"],
            "handlers": [
                ["ContactFormHandler"],
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

## Error Handling

### Error Handlers

Error handlers process exceptions and generate appropriate responses:

```json
{
    "errorHandlers": [
        ["kixx.AppPageErrorHandler"],
        ["CustomErrorHandler"]
    ]
}
```

### Built-in Error Handlers

| Handler | Purpose | Usage |
|---------|---------|-------|
| `kixx.AppPageErrorHandler` | Page rendering errors | 404, 500 errors |
| `kixx.APIErrorHandler` | API error responses | JSON error responses |

### Custom Error Handlers

Create custom error handlers for specific error types:

```javascript
// plugins/my-app/error-handlers/custom-error-handler.js
export default function CustomErrorHandler() {
    return async function customErrorHandler(context, request, response, error) {
        if (error.name === 'ValidationError') {
            response.statusCode = 400;
            response.updateProps({ 
                error: error.message,
                validationErrors: error.details 
            });
            return response;
        }
        
        // Let other handlers process the error
        throw error;
    };
}
```

### Route Loading Order

Routes are loaded in the order specified in virtual-hosts.json:

```json
{
    "routes": [
        "app://main.json",      // Loaded first
        "app://api.json",       // Loaded second
        "kixx://defaults.json"  // Loaded last (fallback)
    ]
}
```

## URL Pathname Parameter Access

### In Request Handlers

Access URL parameters in your request handlers:

```javascript
// Route: /products/:id
export default function ProductHandler() {
    return async function productHandler(context, request, response) {
        const { id } = request.pathnameParams;
        const product = await getProduct(id);
        
        response.updateProps({ product });
        return response;
    };
}
```

## URL Query Parameter Access

### In Request Handlers

Access query parameters:

```javascript
export default function SearchHandler() {
    return async function searchHandler(context, request, response) {
        const query = request.queryParams.q;
        const page = parseInt(request.queryParams.page) || 1;
        const category = request.queryParams.category;
        
        const results = await searchProducts({ query, page, category });
        
        response.updateProps({ 
            results,
            query,
            page,
            category
        });
        return response;
    };
}
```

## Route Best Practices

### 1. RESTful URLs

Use RESTful URL patterns:

```json
[
    {
        "name": "ProductsList",
        "pattern": "/products"
    },
    {
        "name": "ProductDetail", 
        "pattern": "/products/:id"
    },
    {
        "name": "ProductCreate",
        "pattern": "/products/new"
    },
    {
        "name": "ProductEdit",
        "pattern": "/products/:id/edit"
    }
]
```

### 2. Consistent Naming

Use consistent naming conventions:

```json
{
    "name": "ProductDetailPage",     // Descriptive names
    "pattern": "/products/:slug",    // URL-friendly parameters
    "targets": [
        {
            "name": "ProductDetailHandler",  // Handler-specific names
            "methods": ["GET", "HEAD"]
        }
    ]
}
```

### 3. Error Handling

Always include error handlers:

```json
{
    "errorHandlers": [
        ["kixx.AppPageErrorHandler"]  // Handle common errors
    ]
}
```

### 4. Method Separation

Separate different HTTP methods:

```json
{
    "targets": [
        {
            "name": "GetHandler",
            "methods": ["GET", "HEAD"],
            "handlers": [["kixx.AppPageHandler"]]
        },
        {
            "name": "PostHandler",
            "methods": ["POST"],
            "handlers": [["FormHandler"], ["kixx.AppPageHandler"]]
        }
    ]
}
```

### 5. Security Considerations

Include authentication/authorization where needed:

```json
{
    "name": "AdminPage",
    "pattern": "/admin",
    "targets": [
        {
            "name": "AdminHandler",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["AdminAuthHandler"],      // Check authentication
                ["AdminAuthzHandler"],     // Check authorization
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

## Route Testing

### Test Route Patterns

Test your route patterns to ensure they match correctly:

```javascript
// Test route matching
const pattern = "/products/:id";
const url = "/products/123";

// Should match and extract id=123
```

### Common Issues

1. **Pattern conflicts** - Ensure patterns don't overlap
2. **Parameter extraction** - Verify parameters are extracted correctly
3. **Method handling** - Check that methods are handled properly
4. **Error handling** - Test error scenarios

## Next Steps

After configuring routing, proceed to:

- [Step 5: Custom Plugins](../step-5-custom-plugins.md)
- [Step 6: Application Entry Point](../step-6-application-entry-point.md)
- [Step 7: Progressive Enhancement](../step-7-progressive-enhancement.md) 