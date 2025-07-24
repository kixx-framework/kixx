# Request Handlers
Request handlers should handle HTTP requests to specific route targets by HTTP method. More than one request handler can be defined on each target. Request handlers cannot be defined on routes.

## Define and register request handlers
Each request handler should be defined in a dedicated file placed in your plugin directory under `plugins/{plugin-name}/request-handlers/`.

To define and automatically register a request handler, create a `request-handlers` directory in your plugin if it does not exist already, and place your request handler source file there. There should only be one request handler factory function defined and exported per file. The request handler name will be registered in the Kixx Application Server as the name of the exported default factory function.

Example: In `plugins/app/request-handlers/home-page.js` we define "HomePage":

```javascript
export default function HomePage(options) {
    const themeId = options.theme;

    return async function homePageHandler(context, request, response) {
        const db = context.getService('kixx.Datastore');
        const theme = await db.getItem(`theme__${ themeId }`);

        // Make the theme available to the templates.
        response.updateProps({ theme });

        // We return the response with the expectation that the default kixx.PageHandler will
        // compose the context data and template, and render the response HTML.
        return response;
    };
}
```

The request handler can be referenced in route definition files by the exported default name of the factory function. In this example it is "HomePage". The options defined in the target will be passed into the factory function. The factory function is expected to return the actual handler function which can expect the following call signature:

| Param   | Type    | Description |
|---------|---------|-------------|
| context | Context | The [Kixx Application Context](../../application/context.js) |
| request | HttpServerRequest | A [Kixx HttpServerRequest](../../http-server/http-server-request.js) instance |
| response | HttpServerResponse | A [Kixx HttpServerResponse](../../http-server/http-server-response.js) instance |

It is most common to use request handlers with the default "kixx.PageHandler" as the last request handler in the list for a target. This way the Kixx PageHandler can format and return the response using best practices and common conventions.

## Using request handlers in HTTP targets
Request handlers can only be defined on targets. Define a request handler on a target by using the registered name for the Factory function and passing in options from the JSON route configuration document.

See [Configuring Routing](./configuring-routing.md) for more information.

Example route configuration using a custom request handler on the target:

```json
[
    {
        "name": "Home",
        "pattern": "/",
        "targets": [
            {
                "name": "Home",
                "methods": [ "GET", "HEAD" ],
                "handlers": [
                    [ "HomePage", { "theme": "dark-secondary" }],
                    [ "kixx.PageHandler" ]
                ]
            }
        ]
    }
]
```
