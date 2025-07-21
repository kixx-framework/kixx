# Getting started with Kixx
Steps to get started with your Kixx web application.

## Step 1: Setting up configuration files
The first step in building a Kixx application is setting up the configuration files that define how your application behaves. Kixx uses a file-based configuration system that's simple, versionable, and environment-aware.

### Step 1.1: Create a `kixx-config.json`
The `kixx-config.json` file must be created in the root of your project directory. The `kixx-config.json` file is the main application configuration file that defines your application's name, environment-specific settings, and custom configuration options. The format is:

```json
{
    "name": "MyApp",
    "procName": "myapp",
    "environments": {
        "development": {
            "logger": {
                "level": "debug",
                "mode": "console"
            },
            "server": {
                "port": 3000
            }
        },
        "production": {
            "logger": {
                "level": "info",
                "mode": "stdout"
            },
            "server": {
                "port": 3001
            }
        }
    },
    // Custom value used in all environments.
    "app": {
        "timezone": "America/New_York"
    }
}
```

#### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Human-readable application name |
| `procName` | string | Process name for system services |
| `environments` | object | Environment-specific configurations |
| `customConfig` | object | Application-specific configuration |

#### Environment Configuration

Each environment can have its own settings:

- **logger.level**: Logging level (`debug`, `info`, `warn`, `error`)
- **logger.mode**: Logging output (`console`, `stdout`, `file`)
- **server.port**: HTTP server port number

> **⚠️ Warning:**  
> **Do not put secrets (such as API keys, passwords, or private tokens) in `kixx-config.json`.**  
> Instead, store all sensitive information in a separate `.secrets.json` file, which is loaded automatically by the framework.  
> This keeps your secrets out of version control and reduces the risk of accidental exposure.

#### Accessing configuration values from your app

Configuration values can be accessed from your application code:

```js
const serverConfig = context.config.getNamespace('server');
const appConfig = context.config.getNamespace('app');
console.log(serverConfig.port) // 3000
console.log(appConfig.timezone) // America/New_York
```

### Step 1.2: Create a `virtual-hosts.json` config
The `virtual-hosts.json` config must be created in the root of your project directory. It defines how different hostnames are routed to your application's routes. See more in [Routing Configuration](./routing-configuration.md).

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
    }
]
```

#### Virtual Host Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Human-readable hostname identifier |
| `hostname` | string | Domain name pattern to match |
| `routes` | array | List of route specifications or references to route configuration files |

#### Route References

- **app://** - Application-specific routes (from `routes/` directory)
- **kixx://** - Framework default routes. See [Routing Configuration](./step-4-routing-configuration.md) for the Kixx default routes.

### Step 1.3: Create a `site-page-data.json` config.
The `site-page-data.json` config file must be created in the root of your project directory. The `site-page-data.json` file contains site-wide data that's available on every page, such as navigation menus, contact information, and global settings. This file will be used as the basis for the template context in each page by the `ViewService`.

```json
{
    "page": {
        "title": "My Application",
        "description": "A hypermedia-driven web application"
    },
    "nav_menu_sections": [
        {
            "label": "Main",
            "pages": [
                {
                    "label": "Home",
                    "url": "/"
                },
                {
                    "label": "About",
                    "url": "/about"
                }
            ]
        },
        {
            "label": "Services",
            "pages": [
                {
                    "label": "Products",
                    "url": "/products"
                },
                {
                    "label": "Contact",
                    "url": "/contact"
                }
            ]
        }
    ],
    "contactInfo": {
        "phone": {
            "raw": "555-123-4567",
            "formatted": "(555) 123-4567"
        },
        "email": "info@myapp.com",
        "address": {
            "street": "123 Main St",
            "city": "Anytown",
            "state": "NY",
            "zip": "12345"
        }
    },
    "social": {
        "twitter": "https://twitter.com/myapp",
        "facebook": "https://facebook.com/myapp",
        "linkedin": "https://linkedin.com/company/myapp"
    }
}
```

### Step 1.4: Create a `.secrets.json` config.
The `.secrets.json` file must be created in the root directory of your project. The `secrets.json` file contains sensitive configuration data that shouldn't be committed to version control.

```json
{
    "database": {
        "password": "your-db-password"
    },
    "api": {
        "secretKey": "your-api-secret"
    },
    "email": {
        "smtpPassword": "your-email-password"
    }
}
```

#### Security Best Practices for .secrets.json

1. **Never commit secrets** - Add `.secrets.json` to `.gitignore`
2. **Rotate secrets regularly** - Change passwords and keys periodically

#### Accessing secrets from your app

Secrets can be accessed from your application code:

```js
const apiSecrets = context.config.getSecrets('api');
console.log(apiSecrets.secretKey);
```

## Step 2: Routing Configuration
Routing in Kixx applications defines how HTTP requests are mapped to specific handlers and determines the flow of data through your application. The routing system is based on virtual hosts, routes, and targets.

### Virtual Hosts
Routing starts in the `virtual-hosts.json` config from **Step 1.2** above.

### Route References
- **app://** - Application-specific routes (from `routes/` directory)
- **kixx://** - Kixx framework default routes

### Route Definitions
A route definition file in the `routes/` directory contains route specifcations in a JSON Array. Example:

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
                    ["kixx.AppPageHandler", {"pathname": "/products/id"}]
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

Each route consists of several components:

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Unique route identifier |
| `pattern` | string | URL pattern with parameters |
| `errorHandlers` | array | Error handling middleware |
| `targets` | array | Request targets for different HTTP methods |
| `routes` | array | Nested routes |

A route must have a nested `targets` array or `routes` array, but *must NOT* have both.

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

Each Target consists of several components.

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Target identifier |
| `methods` | array | HTTP methods to handle |
| `handlers` | array | Handler middleware chain |

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
                ["kixx.AppPageHandler", {"pathname": "/products/id"}]
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

### Middleware
Middleware in Kixx routes allows you to process requests and responses before and after your main handler logic. There are two types of middleware arrays you can define on a route:

- **inboundMiddleware**: Runs before the target handlers. Use this for tasks like authentication, logging, or request transformation.
- **outboundMiddleware**: Runs after the target handlers, before the response is sent. Use this for response formatting, adding headers, or cleanup.

**Inbound and outbound middleware example:** 

```json
{
    "name": "AdminPanel",
    "pattern": "/admin",
    "inboundMiddleware": [
        ["AuthenticateAdmin"]
    ],
    "outboundMiddleware": [
        ["SetAdminSession"]
    ],
    "targets": [
        {
            "name": "AdminHome",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["kixx.AppPageHandler"]
            ]
        }
    ]
}
```

### Error Handlers
Error handlers process exceptions and generate appropriate responses. The `errorhandlers` can be defined on the route and the target.

```json
{
    "errorHandlers": [
        ["kixx.AppPageErrorHandler"],
        ["CustomErrorHandler"]
    ]
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

### Route Best Practices

#### 1. RESTful URLs
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

#### 2. Error Handling
Always include error handlers:

```json
{
    "errorHandlers": [
        ["kixx.AppPageErrorHandler"]  // Handle common errors
    ]
}
```

#### 3. Method Separation
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

## Step 3: Page Structure
Pages in Kixx applications are the core content units that define what users see and interact with. Each page consists of an HTML template and optional JSON data file. The page structure follows a file-based approach where the directory structure mirrors the URL structure, making it intuitive and easy to manage.

The `pages/` directory should be placed in the root directory for your project. An example page structure might be:
```
pages/
├── page.html              # Home page (/)
├── page.json              # Home page data
├── about/
│   ├── page.html          # About page (/about)
│   └── page.json          # About page data
└── products/
    ├── page.html          # Products listing (/products)
    ├── page.json          # Products page data
    └── product-name/
        ├── page.html      # Product detail (/products/product-name)
        └── page.json      # Product data
```

### Naming Conventions

- Use lowercase with hyphens for directories
- Use descriptive names that reflect the content
- Keep URLs short and memorable
- Use consistent patterns across similar pages

### Page Types

| Page Type | Description |
|-----------|-------------|
| Static Routing | The URL pathname maps directly to the page filepath |
| Dynamic Routing | The page pathname must be defined in the PageHandler options |

#### Examples of static routing pages:
Page from the example above which will be invoked by URL pathname "/"

- pages/page.html
- pages/page.json

Page from the example above which will be invoked by URL pathname "/about"

- pages/about/page.html
- pages/about/json.html

#### An example of dynamic routing pages:
Page from the example above which will be invoked by URL pathname pattern "/products/:name":

- pages/products/product-name/page.html
- pages/products/product-name/page.json

When the route is defined with the PageHandler pathname like:

```json
{
    "name": "ProductDetail",
    "pattern": "/products/:name",
    "targets": [
        {
            "name": "ProductDetail",
            "methods": ["GET", "HEAD"],
            "handlers": [
                ["ProductDetailHandler"],
                ["kixx.AppPageHandler", {"pathname": "/products/product-name"}]
            ]
        }
    ]
}
```
