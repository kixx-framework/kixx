# HTTP Request Routing and Processing

## Overview
Kixx provides a comprehensive request handling system with default routes and handlers to address the most common web application use cases. The system is designed to work seamlessly with the [page structure and templating system](./templating-with-kixx.md).

### Key Components

- **Virtual Hosts**: Configure different domains and their routing.
- **Routes**: Define URL patterns and associate them with middleware, targets, and error handlers.
- **Targets**: Define request and error handlers for specific HTTP methods.
- **Request Handlers**: Process HTTP requests and generate responses.
- **Inbound Middleware**: Process requests before target handlers.
- **Outbound Middleware**: Process requests after target handlers.
- **Error Handlers**: Handle errors and render appropriate error pages.

### Request Handler Architecture
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

**HTTP Request** arrives at the server
    ↓
**Application Server** creates framework request/response objects
    ↓
**Virtual Host** configuration is loaded
    ↓
**Router** matches the request to a pathname route and target method.
    ↓
**Inbound Middleware** processes the request (if any)
    ↓
**Request Handlers** process the request in sequence
    ↓
**Outbound Middleware** processes the request (if any)
    ↓
**Error Handlers** handle any errors that occur
    ↓
**Response** is sent back to the client

## Default Routing and Request Handling
Using only the default routing and request handling provided by Kixx you can serve many common use cases with no custom code.

### Directory Structure
A typical Kixx app should look like this:

```
my-app/
├── kixx-config.json           # Main app config
├── virtual-hosts.json         # Virtual host and route config
├── site-page-data.json        # Site-wide data for templates
├── pages/                     # Page templates and data (mirrors URL structure)
│   ├── page.html              # Home page (/)
│   ├── about/
│   │   ├── page.html          # /about
│   │   └── page.json          # Data for /about
│   └── ...
├── public/                    # Static assets (CSS, JS, images)
│   └── ...
├── templates/
│   ├── templates/
│   │   └── base.html          # Base HTML template
│   ├── partials/              # Template partials
│   └── helpers/               # Template helpers
└── routes/ (optional)         # Only needed for custom routes
```

## Default Routing

### Static Files
- **URL:** `/assets.css`, `/logo.png`, etc.
- **Handler:** `StaticFileServer`
- **Behavior:**
  - If the request matches a file in `public/`, it is served directly.
  - Security checks prevent directory traversal and invalid paths.
  - Caching headers and content-type are set automatically.

### Pages (Catch-All)
- **URL:** Any other path (e.g., `/`, `/about`, `/products/item`)
- **Handler Chain:** `StaticFileServer` → `PageHandler`
- **Behavior:**
  1. **StaticFileServer** tries to serve a file from `public/`.
     - If found, serves the file and ends the request.
     - If not found, continues to next handler.
  2. **PageHandler** attempts to render a page:
     - Maps the URL to a file in `pages/` (e.g., `/about` → `pages/about/page.html`)
     - Loads optional `page.json` for data, merges with `site-page-data.json`
     - Renders using the base template and partials
     - Returns HTML (or JSON if requested)

### Error Handling
- **Handler:** `PageErrorHandler`
- **Behavior:**
  - If a page or file is not found, or an error occurs, renders an error page using the templating system.
  - Looks for `pages/{statusCode}/page.html` (e.g., `pages/404/page.html`), or falls back to a default error page.

### Structure
- Each URL path maps directly to a folder in `pages/`.
  - `/` → `pages/page.html`
  - `/about` → `pages/about/page.html`
  - `/products/item` → `pages/products/item/page.html`
- Optional `page.json` files provide data for each page.
- The `site-page-data.json` file provides global data (navigation, contact info, etc.).
- The base template (`templates/templates/base.html`) and partials are used for consistent layout and components.

### What You Need to Do (No Custom Code Required)

To use only the default routing and request handling:

1. **Place your static assets** in `public/`.
2. **Create your pages** in `pages/`, following the URL structure.
3. **Add optional data** in `page.json` files for each page.
4. **Set up your base template and partials** in `templates/`.
5. **Configure your app** with `kixx-config.json`, `virtual-hosts.json`, and `site-page-data.json`.
6. **Start your app**—Kixx will handle all routing, page rendering, and error handling automatically.

No custom JavaScript is needed unless you want to add custom routes, handlers, or middleware.

### Default Routes and Handler Chains

| URL Pattern                | Handler Chain                        | Purpose                                 |
|----------------------------|--------------------------------------|-----------------------------------------|
| `/kixx/objects/:id`        | `ObjectStoreReader`                  | Serve objects from object store         |
| `*` (catch-all)            | `StaticFileServer` → `PageHandler`   | Serve static files or render pages      |
| Any error                  | `PageErrorHandler`                   | Render error pages                      |

## Creating Custom Routes and Handlers

Kixx makes it easy to extend your application with custom routes, handlers, and middleware. This allows you to add dynamic business logic, APIs, authentication, and more.

### Write Custom Handlers and Middleware

- **Request Handlers**: Place in `plugins/your-plugin/request-handlers/`.
  - Export a function that returns an async handler: `(context, request, response) => { ... }`
- **Middleware**: Place in `plugins/your-plugin/middleware/`.
  - Export a function that returns an async middleware: `(context, request, response, next) => { ... }`
- **Error Handlers**: Place in `plugins/your-plugin/error-handlers/`.
  - Export a function that returns a middleware: `(context, request, response, error) => { ... }`

**Example: Custom Request Handler**
```js
// plugins/my-plugin/request-handlers/hello-handler.js
export default function HelloHandler(options = {}) {
    return async function helloHandler(context, request, response) {
        response.props.greeting = 'Hello from custom handler!';
        return response;
    };
}
```

**Example: Custom Middleware**
```js
// plugins/my-plugin/middleware/auth-middleware.js
export default function AuthMiddleware(options = {}) {
    return async function authMiddleware(context, request, response, next) {
        if (!request.user) {
            return response.respondWithJSON(401, { error: 'Unauthorized' });
        }
        return next();
    };
}
```

**Example: Custom Error Handler**
```js
// plugins/my-plugin/error-handlers/authentication-error-handler.js
export default function AuthenticationErrorHandler(options = {}) {
    return async function authenticationErrorHandler(context, request, response, error) {
        if (error.name === 'AuthenticationError') {
            return response.respondWithJSON(401, { error: 'Unauthorized' });
        }
        return false;
    };
}
```

### Reference Custom Handlers in Route JSON
Define your custom routes in a JSON file (e.g., `routes/main.json`). Reference your handlers and middleware by their exported name:

```json
[
    {
        "name": "HelloPage",
        "pattern": "/hello",
        "inboundMiddleware": [ ["AuthMiddleware"] ],
        "outboundMiddleware": [ ["CookieMiddleware"] ],
        "errorHandlers": [ ["kixx.AppPageErrorHandler"] ],
        "targets": [
            {
                "name": "HelloTarget",
                "methods": ["GET"],
                "handlers": [
                    ["HelloHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    }
]
```

#### Route
A route defines the URL pathname to which it will apply as well as the targets to handle specific HTTP methods.

- **pattern**: URL path to match (e.g., `/hello`)
- **inboundMiddleware**: Runs before handlers (e.g., authentication). Middleware can only be defined on a route.
- **outboundMiddleware**: Runs after handlers (e.g., setting cookies). Middleware can only be defined on a route.

### Target
A target is defined on a route to define how specific HTTP methods are handled for the route.

- **handlers**: Run in the order they are defined. Request handlers can only be defined on a target.
- **errorHandlers**: Handle errors for this route. Error handlers can be defined on the route or the targets.

### Map Custom Routes to URLs

- The `pattern` field determines which URLs your custom logic will handle.
- Use parameters (e.g., `/products/:id`) for dynamic routes.
- Use `{.json}` or `{index.json}` to support both HTML and JSON endpoints.

### Practical Example: Custom Product Page

**Handler:**
```js
// plugins/shop/request-handlers/ProductHandler.js
export default function ProductHandler(options = {}) {
    return async function productHandler(context, request, response) {
        const { id } = request.pathnameParams;
        const product = await context.services.productService.getProductById(id);
        if (!product) {
            return response.respondWithStatus(404);
        }
        response.props.product = product;
        return response;
    };
}
```

**Route Config:**
```json
[
    {
        "name": "ProductDetail",
        "pattern": "/products/:id{.json}",
        "targets": [
            {
                "name": "ProductDetailTarget",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["ProductHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    }
]
```
- Visiting `/products/123` will run `ProductHandler`, attach the product data, and then render the page template.

### Nested Routes Example: Custom Admin Panel
Kixx supports nested routes, allowing you to apply middleware (like authentication) to a group of related routes. This is useful for admin panels or API namespaces.

**Example: Admin Panel with Nested Routes and Auth Middleware**

```json
[
  {
    "name": "AdminPanel",
    "pattern": "/admin",
    "inboundMiddleware": [ ["AdminAuthMiddleware"] ],
    "errorHandlers": [ ["kixx.AppPageErrorHandler"] ],
    "routes": [
      {
        "pattern": "/dashboard",
        "targets": [
          {
            "name": "AdminDashboard",
            "methods": ["GET"],
            "handlers": [
              ["AdminDashboardHandler"],
              ["kixx.AppPageHandler"]
            ]
          }
        ]
      },
      {
        "pattern": "/users",
        "targets": [
          {
            "name": "AdminUsers",
            "methods": ["GET"],
            "handlers": [
              ["AdminUsersHandler"],
              ["kixx.AppPageHandler"]
            ]
          }
        ]
      },
      {
        "pattern": "/users/:id/edit",
        "targets": [
          {
            "name": "AdminEditUser",
            "methods": ["GET", "POST"],
            "handlers": [
              ["AdminEditUserHandler"],
              ["kixx.AppPageHandler"]
            ]
          }
        ]
      }
    ]
  }
]
```

- The `/admin` route applies `AdminAuthMiddleware` to all nested admin routes.
- Each child route (e.g., `/admin/dashboard`, `/admin/users`, `/admin/users/:id/edit`) can have its own handlers and targets.
- This structure keeps your route config organized and ensures authentication is enforced for all admin pages.

**Tip:** You can nest routes as deeply as needed, and middleware/error handlers defined at a parent level apply to all children unless overridden.

### Best Practices for Custom Routing

- **Chain handlers**: Use your custom handler first, then `kixx.AppPageHandler` to render the page.
- **Use middleware for cross-cutting concerns**: Auth, logging, etc.
- **Use error handlers for robust error reporting**.
- **Keep handler logic focused**: One responsibility per handler.
- **Use parameters and patterns**: For dynamic routes, use `:param` in your pattern.

---

With these tools, you can build powerful, maintainable, and flexible web applications with Kixx, customizing routing and request handling to fit your needs.
