# Creating custom routes and handlers

## Step 1: Create the middleware and handlers your route will need
The first step in the process of creating a custom route is to create the request handlers, middleware, and error handlers that your new route will need. You may not need all three. In fact, you may already have all the middleware and handlers that you need. If that's the case, then move on to [Step 2: Create the default page data and template](#step-2-create-the-default-page-data-and-template).

If you need to create some new handlers, you can just create some placeholders for now and finish the implementation once your route is up and running. Or, a different strategy is to completely implement your handlers now, test them, and then finish hooking up your route. It's up to you.

In any case, there are 3 types of middleware and handlers you can define:

- [Request Handlers](./http-server/request-handlers.md)
- [Middleware](./http-server/middleware.md)
- [Error Handlers](./http-server/error-handlers.md)

### Request Handlers
Request handlers should handle HTTP requests to specific route targets by HTTP method. More than one request handler can be defined on each target. Request handlers cannot be defined on routes.

Each request handler should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/request-handlers/`. Example: `plugins/my-plugin/request-handlers/home-page-handler.js`.

For more information see the documentation at [Request Handlers](./http-server/request-handlers.md).

### Middleware
Inbound and outbound middleware will process HTTP requests and responses for the routes you add them to. More than one inboundMiddleware or outboundMiddleware can be added to each route. The HTTP targets do not accept middleware. Targets only use request handlers and error handlers.

Each middleware factory should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/middleware/`. Example: `plugins/my-plugin/middleware/authentication.js`.

For more information see the documentation at [Middleware](./http-server/middleware.md).

### Error Handlers
Error handlers will be used by the Kixx HTTP server to handle errors on specific routes or targets. Error handlers can be defined on both routes and targets and more than one error handler can be defined on each route and target.

Each error handler should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/error-handlers/`. Example: `plugins/my-plugin/error-handlers/custom-error-handler.js`.

For more information see the documentation at [Error Handlers](./http-server/error-handlers.md).

## Step 2: Create the default page data and template
Before creating your page data and template you'll need to determine if your route is going to be dynamic or static. The difference is that a dynamic route has pathname parameters while a static route does not:

| Route Type    | Example |
|---------------|---------|
| Static Route  | `"/products/"` |
| Dynamic Route | `"/products/:product_type/view/:product_id"` |

If your route is static you can follow the normal flow for page routing. Simply create your `page.html` and `page.json` files at the `pages/` path which matches the URL pathname that will be declared on the route.

So, for your `"/products/"` route example you'll create the files:

- `pages/products/page.json`
- `pages/products/page.html`

For your dynamic routes you'll need to be creative about the file path you use. The most important thing is to find a convention that works for your project, and when that convention changes, be sure you refactor your page paths to be consistent with the new pattern. One common pattern is:

| Request Type | HTTP Method | Pathname Example | Pattern Example | Description |
|--------------|-------------|------------------|-----------------|-------------|
| List Items | GET | `pages/products/page.html` | `"/products/"` | When using an HTTP GET request to query a list of things. |
| View Item | GET | `pages/products/id/view/page.html` | `"/products/:product_id/view"` | When using an HTTP GET request to view a single item. |
| Update Item | GET | `pages/products/id/update/page.html` | `"/products/:product_id/update"` | When using an HTTP GET request to render an HTML form to update an item. |

Whatever file path you choose for your page, it will need to be passed into the Kixx PageHandler in your route definition. For the view and update product examples, your route definitions might look like this:

```json
[
    {
        "name": "ViewProduct",
        "pattern": "/products/:product_id/view",
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
        "pattern": "/products/:product_id/edit",
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
    }
]
```

### What goes in the page.json file?
The `page.json` file, also known as the "page data" file, should contain the static data you'd like your page to have access to. Typically this would be things like title, description, and [Open Graph](https://ogp.me/) metadata. But you could put anything in there like URLs for images or stylesheets, or full page content. You can go so far as to implement your own content management system from your page data files.

For every request made to your application which uses the "kixx.PageHandler" the template context will be the result of:

1. Global page data defined in `site-page-data.json`.
2. Local page data defined in the matched `page.json` file.
3. Dynamic props set on the `HttpServerResponse` with the `updateProps()` method.

The merge order to create a template context goes like this:

The __global page data__ is overridden by __local page data__ which is then overridden by the __dynamic props__.

When creating custom routes, there will be many cases when you will not know the page title, description, or other metadata for the `page.json` file ahead of time. In that case, create sensible defaults in the `page.json` file as a fallback, then override these values in your custom handler:

```javascript
export default function MyHandler() {
    return async function myHandler(context, request, response) {
        const { product_id } = request.pathnameParams;
        const productCollection = context.getService('ProductCollection');
        const product = await productCollection.getProductById(product_id);

        const props = {
            title: `${ product.name } - My Site`,
            description: product.description,
            product,
        };

        // Make the props available to your template by updating the HttpServerResponse.
        return response.updateProps(props);
    };
}
```

### What goes in the page.html file?
The `page.html` file is the template for your new page. It will be interpreted as a Kixx Mustache template, but it can be just plain HTML if that suits your needs. In either case the rendered contents of the `page.html` file will become the template context `body` attribute and will get passed into your base template.

See [Templating with Kixx](./templating-with-kixx.md) for more information about authoring your templates.

## Step 3: Create the route definitions
Using the middleware and handlers you created in Step 1 and the pages you created in Step 2, it's time to define your routes.

First you'll need to make sure your routes file is referenced in your `virtual-hosts.json` config file. See [Configuring Routing](./http-server/configuring-routing.md) for more information on setting up your `virtual-hosts.json` and defining routes. For this example we'll assume you have a `routes/main.json` file which is referenced in your `virtual-hosts.json` as "app://main.json".

So, in your `routes/main.json` the new custom route definitions might look like this:

```json
[
    {
        "name": "ViewProduct",
        "pattern": "/products/:product_id/view",
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
        "pattern": "/products/:product_id/edit",
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
    }
]
```

## Next Steps
Here are some recommended next steps after creating new routes:

### Testing Your Route
1. Start your Kixx application server
2. Navigate to your new route in a browser to verify it loads correctly
3. Test both the HTML and JSON responses (add `.json` to your URL)
4. Verify that any middleware (authentication, logging, etc.) is working as expected

### Development Best Practices
- **Error Handling**: Ensure your request handlers properly handle errors and edge cases
- **Validation**: Validate any user input or pathname parameters in your handlers
- **Security**: Apply appropriate authentication and authorization middleware to sensitive routes
- **Documentation**: Document your custom routes and their expected behavior

### Common Issues to Watch For
- **Missing Templates**: Ensure your `page.html` and `page.json` files exist at the correct paths
- **Handler Registration**: Verify that your handlers are properly exported and discoverable by the plugin system
- **Route Conflicts**: Check that your route patterns don't conflict with existing routes
- **Middleware Order**: Remember that middleware runs in the order specified: inbound → handlers → outbound

### Further Reading
For more advanced routing scenarios and configuration options, see:
- [HTTP Request Routing and Processing](./http-server/http-request-routing-and-processing.md)
- [Templating with Kixx](./templating-with-kixx.md)
- [Configuring Routing](./http-server/configuring-routing.md)

Your custom routes are now ready to handle traffic and provide dynamic content to your users!