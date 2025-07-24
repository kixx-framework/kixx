# Configuring Routing

## Step 1: Configuring Virtual Hosts
All HTTP routing starts with your virtual hosts config at `virtual-hosts.json`. This file tells the Kixx HTTP server what hostnames it should expect to serve and what routes are available for those hosts.

An example `virtual-hosts.json` config which defines 3 virtual hosts:

```jsonc
[
    {
        // Matches our main WWW home site
        "name": "Main",
        "hostname": "com.myamazingsite.www",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    },
    {
        // Microsites for our customers or special product lines.
        "name": "MicroSites",
        // The ":subname" will create a hostname parameter we can reference from HttpServerRequest.
        "pattern": "com.myamazingsite.:subname",
        "routes": [
            "app://sub-sites.json",
            "kixx://defaults.json"
        ]
    },
    {
        // Permanently redirect our old site to our new one.
        "name": "RedirectOldSite",
        "pattern": "com.myoldsite.:subname",
        "routes": [
            "app://redirect-old-site.json"
        ]
    }
]
```

Each virtual host object specifies:

- __"name"__ *string* - A unique identifying name for the virtual host block.
- __"hostname"__ *string* - A reverse match of the URL hostname from least to most specific part. See [hostname matching](#hostname-matching) below.
- __"pattern"__ *string* - A pattern matching string which follows the [path-to-regexp](https://github.com/pillarjs/path-to-regexp) matching algorithm.
- __"routes"__ *string[]* - An array of strings which identify route configuration files located elsewhere.

A virtual host block specification must have either a hostname or pattern, but *must not* have both.

### Hostname Matching
For both `"hostname"` and `"pattern"` matching the domain name is reversed to move from left to right in order of domain specificity in the [domain name space](https://en.wikipedia.org/wiki/Domain_name#Domain_name_space). This reversing makes it easier to write pattern matching strings which capture the subdomains, which is typically what we want to accomplish in virtual host routing.

Using "www.google.com" as an example:

| Left to right order | Type | Example | Definition |
|---------------------|------|---------|------------|
| 1 | Top Level Domain | .com | Top-level domains form the DNS root zone of the hierarchical Domain Name System. |
| 2 | Second Level Domain | .google | Below the top-level domains in the domain name hierarchy are the second-level domain (SLD) names. These are the names directly to the left of .com, .net, and the other top-level domains. |
| 3 | Subdomain | www | In general, subdomains are domains subordinate to their parent domain. |

- As a "hostname": "com.google.www"
- As a "pattern": "com.google.:subdomain"


## Step 2: Configure Routes
Let's use the "app://main.json" routes from the "Main" virtual host above as an example. This file must be located at `routes/main.json` and might contain route definitions which look something like this:

```jsonc
[
    {
        "name": "ListProducts",
        "pattern": "/products{.json}",
        "targets": [
            {
                "name": "ListProducts",
                "methods": [ "GET", "HEAD" ],
                "handlers": [
                    [ "ListProducts" ],
                    [ "kixx.PageHandler", { "pathname": "/products/" } ]
                ]
            }
        ]
    },
    {
        "name": "ViewProduct",
        "pattern": "/products/:product_id/view{.json}",
        "targets": [
            {
                "name": "ViewProduct",
                "methods": [ "GET", "HEAD" ],
                "handlers": [
                    [ "ViewProduct" ],
                    [ "kixx.PageHandler", { "pathname": "/products/id/view" } ]
                ]
            }
        ]
    },
    {
        "name": "EditProduct",
        "pattern": "/products/:product_id/edit{.json}",
        "inboundMiddleware": [
            ["Authenticate", {"role": "product-admin"}]
        ],
        "outboundMiddleware": [
            ["SetSessionCookie"]
        ],
        "targets": [
            {
                "name": "EditProductForm",
                "methods": [ "GET", "HEAD" ],
                "handlers": [
                    [ "EditProductForm" ],
                    [ "kixx.PageHandler", { "pathname": "/products/id/edit" } ]
                ]
            },
            {
                "name": "UpdateProduct",
                "methods": [ "POST" ],
                "handlers": [
                    [ "UpdateProduct" ],
                    [ "kixx.PageHandler", { "pathname": "/products/id/edit" } ]
                ]
            }
        ]
    },
    {
        "name": "AdminBackend",
        "pattern": "/admin",
        "inboundMiddleware": [
            ["Authenticate", {"role": "general-admin"}]
        ],
        "outboundMiddleware": [
            ["SetSessionCookie"]
        ],
        "routes": [
            {
                "name": "AdminHome",
                "pattern": "/{index.json}",
                "targets": [
                    {
                        "name": "AdminHome",
                        "methods": [ "GET", "HEAD" ],
                        "handlers": [
                            // Will route to the page at pages/admin/
                            [ "kixx.PageHandler" ]
                        ]
                    }
                ]
            },
            {
                "name": "AdminListProducts",
                "pattern": "/products{.json}",
                "targets": [
                    {
                        "name": "AdminListProducts",
                        "methods": [ "GET", "HEAD" ],
                        "handlers": [
                            [ "AdminListProducts" ],
                            // Will route to the page at pages/admin/products/
                            [ "kixx.PageHandler" ]
                        ]
                    }
                ]
            },
            {
                "name": "AdminViewProduct",
                "pattern": "/products/:product_id/view{.json}",
                "targets": [
                    {
                        "name": "AdminViewProduct",
                        "methods": [ "GET", "HEAD" ],
                        "handlers": [
                            [ "AdminViewProduct" ],
                            [ "kixx.PageHandler", { "pathname": "/admin/products/id/view" } ]
                        ]
                    }
                ]
            }
        ]
    }
]
```

### Specifying routes
Each route object specifies:

- __"name"__ *string* - A unique identifying name for the route block.
- __"pattern"__ *string* - A pattern matching string which follows the [path-to-regexp](https://github.com/pillarjs/path-to-regexp) matching algorithm.
- __"inboundMiddleware"__ *array[]* - An array of tuples which define middleware to use and options to pass middleware factory functions.
- __"outboundMiddleware"__ *array[]* - An array of tuples which define middleware to use and options to pass middleware factory functions.
- __"errorHandlers"__ *array[]* - An array of error handlers which define error handlers to use and options to pass the factory functions.
- __"routes"__ *object[]* - An array of child route specification objects.
- __"targets"__ *object[]* - An array of child target specification objects.

- A route must have child routes or targets, but cannot have both.
- Routes do not specify HTTP methods (targets do).
- Routes do not have request handlers (targets do).

#### Inbound middleware
Inbound middleware is run on an HTTP request before it reaches the target. Middleware functions are executed in the order in which the middleware is defined in the "inboundMiddleware" Array.

See [Middleware](./middleware.md) for more information.

#### Outbound middleware
Outbound middleware is run on an HTTP request after it is handled by the target. Middleware functions are executed in the order in which the middleware is defined in the "outboundMiddleware" Array.

See [Middleware](./middleware.md) for more information.

#### Error handlers
See [Error Handlers](./error-handlers.md) for more information.

### Specifying targets
Each target object specifies:

- __"name"__ *string* - A unique identifying name for the target block.
- __"methods"__ *string[]* - The HTTP methods this target will answer to.
- __"errorHandlers"__ *array[]* - An array of error handlers which define error handlers to use and options to pass the factory functions.
- __"handlers"__ *array[]* - An array of request handlers which define request handlers to use and options to pass the factory functions.

- Targets do not have middleware (routes do).
- Targets do not have children (routes do).

## Default Routing
If our first set of routes defined in a virtual host is not matched (from "app://main.json" or "app://sub-sites.json" in our example above) we can set a fallback to use the default Kixx routes ("kixx://defaults.json"). Using "kixx://defaults.json" as a fallback is considered best practice for most virtual hosts. This way the request will use the default Kixx routing behavior if there is no custom route match, which is almost always what you want.

See [Default Request Routing](../default-request-routing.md) for more information.

__Note:__ There will be rare cases where it does not make sense to have fallbacks, like the "RedirectOldSite" definition in the example above.
