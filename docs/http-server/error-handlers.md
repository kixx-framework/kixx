# Error Handlers
Error handlers will be used by the Kixx HTTP server to handle errors on specific routes or targets in increasing specificity. Error handlers can be defined on both routes and targets and more than one error handler can be defined on each route and target.

## Define and register error handlers
Each error handler should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/error-handlers/`.

To define and automatically register an error handler, create an `error-handlers` directory in your plugin if it does not exist already, and place your error handler source file there. There should only be one error handler factory function defined and exported per file. The error handler name will be registered in the Kixx Application Server as the name of the exported default factory function.

Example: In `plugins/app/error-handlers/custom-error-handler.js` we define "CustomErrorHandler":

```javascript
export default function CustomErrorHandler({ verbose }) {
    return function customErrorHandler(context, request, response, error) {
        const { logger } = context;

        const statusCode = error.httpStatusCode || 500;

        if (statusCode > 499 && verbose) {
            // Log out 5xx errors.
            logger.error('page handling error', { requestId: request.id }, error);
        }

        // Handle MethodNotAllowed errors separately.
        if (statusCode === 405 && error.allowedMethods.length) {
            response.setHeader('Allow', error.allowedMethods.join(', '));
        }

        const html = `<p>${ error.name }</p>`;

        return response.respondWithHTML(statusCode, html);
    };
}
```

The error handler can be referenced in route definition files by the exported default name of the factory function. In this example it is "CustomErrorHandler". The options defined in the route or target will be passed into the factory function. The factory function is expected to return the actual handler function which can expect the following call signature:

| Param   | Type    | Description |
|---------|---------|-------------|
| context | Context | The [Kixx Application Context](../../application/context.js) |
| request | HttpServerRequest | A [Kixx HttpServerRequest](../../http-server/http-server-request.js) instance |
| response | HttpServerResponse | A [Kixx HttpServerResponse](../../http-server/http-server-response.js) instance |
| error | Error | A JavaScript Error or [Kixx WrappedError](../../errors/docs/README.md) |

If the error returns a falsy value then the router will move on to try the next error handler in the chain until one of them returns the HttpServerResponse object. If there are no error handlers in the target or route, the Kixx HTTP server will use an internal default error handler.

## Using error handlers in HTTP routes and targets
Error handlers can be defined on both routes and targets using the registered name for the Factory function and passing in options from the JSON route configuration document.

See [Configuring Routing](./configuring-routing.md) for more information.

Example route configuration using error handlers in the route and target:

```json
[
    {
        "name": "ViewProduct",
        "pattern": "/products/:product_id/view",
        "errorHandlers": [
            [ "CustomErrorHandler", { "verbose": true }]
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
