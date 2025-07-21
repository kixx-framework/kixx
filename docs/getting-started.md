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
Routing in Kixx applications defines how HTTP requests are mapped to specific handlers and determines the flow of data through your application.

Kixx provides static page routing functionality out of the box, as well as a way for you to define custom dynamic routes and handlers. See [HTTP Request Routing and Processing](./http-request-routing-and-processing.md) for more information.

### Virtual Hosts
Routing starts in the `virtual-hosts.json` config from **Step 1.2** above.

### Route References
- **app://** - Application-specific routes (from `routes/` directory)
- **kixx://** - Kixx framework default routes

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

## Step 3: Page Structure
Pages in Kixx applications are the core content units that define what users see and interact with. Each page consists of an HTML template and optional JSON data file. The page structure follows a file-based approach where the directory structure mirrors the URL structure, making it intuitive and easy to manage.

See [HTTP Request Routing and Processing](./http-request-routing-and-processing.md) and [Templating with Kixx](./templating-with-kixx.md) for more information.

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

## Step 5: Data Management
Default data management in Kixx applications is handled through the Datastore service, which provides a file-backed, document-oriented storage system with in-memory caching, optimistic concurrency control, and powerful querying capabilities.

```javascript
// Core datastore components
const datastore = context.getService('kixx.Datastore');
```

See the [Datastore docs](./datastore.md) for more information.