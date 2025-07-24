# Middleware
Inbound and outbound middleware will process HTTP requests and responses for the routes you add them to. More than one inboundMiddleware or outboundMiddleware can be added to each route. The HTTP targets do not accept middleware. Targets only use request handlers and error handlers.

## Define and register middleware
Each middleware factory should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/middleware/`.

To define and automatically register middleware, create a `middleware` directory in your plugin if it does not exist already, and place your middleware source file there. There should only be one middleware factory function defined and exported per file. The middleware name will be registered in the Kixx Application Server as the name of the exported default factory function.

Example: In `plugins/app/middleware/authenticate.js` we define "Authenticate".

```javascript
export default function Authenticate({ sessionCookieKey }) {
    return async function authenticate(context, request, response) {
        const session_id = request.getCookie(sessionCookieKey);

        if (!session_id) {
            throw new UnauthenticatedError('No session id cookie');
        }

        const db = context.getService('kixx.Datastore');

        const session = await db.getItem(`session__${ session_id }`);

        if (!session || !session.user) {
            throw new UnauthenticatedError('Missing session or user');
        }

        // Make the session available to other middleware and request handlers by
        // binding it to the HttpServerRequest object.
        request.session = session;

        return response;
    };
}
```

The new middleware can be referenced in route definition files by the exported default name of the factory function. In this example it is "Authenticate". The options defined in the route will be passed into the factory function. The factory function is expected to return the actual middleware function which can expect the following call signature:

| Param   | Type    | Description |
|---------|---------|-------------|
| context | Context | The [Kixx Application Context](../../application/context.js) |
| request | HttpServerRequest | A [Kixx HttpServerRequest](../../http-server/http-server-request.js) instance |
| response | HttpServerResponse | A [Kixx HttpServerResponse](../../http-server/http-server-response.js) instance |

Although not required, it is conventional to return the HttpServerResponse object from the middleware function.

## Using middleware in HTTP routes
Middleware can only be defined on routes as "inboundMiddleware" and "outboundMiddleware". Middleware is defined on a route using the registered name for the Factory function and passing in options from the JSON route configuration document.

See [Configuring Routing](./configuring-routing.md) for more information.

Example route configuration using middleware in the route:

```json
[
    {
        "name": "ViewProduct",
        "pattern": "/products/:product_id/view",
        "inboundMiddleware": [
            [ "Authenticate", { "sessionCookieKey": "session_id" }]
        ],
        "outboundMiddleware": [
            [ "SetCookie", { "sessionCookieKey": "session_id" }]
        ],
        "targets": [
            {
                "name": "ViewProduct",
                "methods": [ "GET", "HEAD" ],
                "errorHandlers": [
                    [ "CustomErrorHandler", { "verbose": false }]
                ],
                "handlers": [
                    [ "ViewProduct" ],
                    [ "kixx.PageHandler", { "pathname": "/products/id/view" } ]
                ]
            }
        ]
    }
]
```
