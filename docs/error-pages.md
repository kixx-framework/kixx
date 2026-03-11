# Error Pages

Kixx renders error responses using the same page and template system as regular pages. This lets you create custom HTML error pages that match your site's design.

## How Error Pages Work

When an error occurs (e.g., a 404 Not Found or 500 Internal Server Error), the `HyperviewErrorHandler` looks for an error page using this lookup order:

1. Try `pages/{statusCode}/` — status-code-specific page (e.g., `pages/404/`)
2. Try `pages/error/` — generic fallback page
3. Return a JSON error response — last resort when no templates are found

## Wiring Up the Error Handler

The error handler is registered on the `ApplicationContext` inside the Hyperview plugin, and referenced by name in route definitions:

```javascript
// plugins/hyperview/plugin.js
import HyperviewErrorHandler from '../../kixx/hyperview/error-handler.js';

export function register(applicationContext) {
    applicationContext.registerErrorHandler('HyperviewErrorHandler', HyperviewErrorHandler);
}
```

```javascript
// routes/main.js
export default [
    {
        name: 'AllPages',
        pattern: '*',
        errorHandlers: [
            ['HyperviewErrorHandler'],
        ],
        targets: [ ... ],
    },
];
```

## Creating Error Pages

### 404 Not Found

**`pages/404/page.jsonc`**
```jsonc
{
    "title": "Page Not Found",
    "description": "The page you're looking for could not be found."
}
```

**`pages/404/page.html`**
```html
<main class="error-page">
    <h1>Page Not Found</h1>
    <p>Sorry, we couldn't find what you're looking for.</p>
    <p><a href="/">Return to the home page</a></p>
</main>
```

### 500 Internal Server Error

**`pages/500/page.jsonc`**
```jsonc
{
    "title": "Server Error",
    "description": "An unexpected error occurred."
}
```

**`pages/500/page.html`**
```html
<main class="error-page">
    <h1>Server Error</h1>
    <p>Something went wrong. Please try again later.</p>
</main>
```

### Generic Fallback Page

The generic error page at `pages/error/` is used when there's no page for the specific status code:

**`pages/error/page.jsonc`**
```jsonc
{
    "title": "Error",
    "description": "An error occurred."
}
```

**`pages/error/page.html`**
```html
<main class="error-page">
    <h1>Error</h1>
    <p>Something went wrong. Please try again.</p>
    <p><a href="/">Return to the home page</a></p>
</main>
```

## Error Page Lookup Order

For a 404 error:

1. Load `pages/404/` → render with the registered base template
2. If not found, load `pages/error/` → render as generic fallback
3. If not found, return a JSON error object

## Displaying Error Details

In development you can expose error details in error pages. Enable this in your configuration:

**`kixx-config.jsonc`**
```jsonc
{
    "environments": {
        "development": {
            "hyperview": {
                "errorHandler": {
                    "exposeErrorDetails": true
                }
            }
        },
        "production": {
            "hyperview": {
                "errorHandler": {
                    "exposeErrorDetails": false
                }
            }
        }
    }
}
```

Or enable it per-route:

```javascript
errorHandlers: [
    ['HyperviewErrorHandler', { exposeErrorDetails: true }],
],
```

**Warning:** Always keep `exposeErrorDetails` set to `false` in production to avoid exposing internal implementation details.

### The `error` Object

When `exposeErrorDetails` is enabled, an `error` object is added to the page data:

| Property | Description |
|---|---|
| `error.name` | Error class name (e.g., `"NotFoundError"`) |
| `error.code` | Error code string (e.g., `"NOT_FOUND"`) |
| `error.message` | Human-readable error message |
| `error.expected` | `true` for expected HTTP errors (404, 403, etc.), `false` for unexpected errors |
| `error.httpStatusCode` | HTTP status code (e.g., `404`, `500`) |
| `error.stack` | Stack trace string |

Use it in your error page template:

```html
<main class="error-page">
    <h1>{{ error.httpStatusCode }} — {{ error.name }}</h1>
    <p>{{ error.message }}</p>
    {{#if error.stack}}
        <details>
            <summary>Stack Trace</summary>
            <pre>{{ error.stack }}</pre>
        </details>
    {{/if}}
</main>
```

## Error Handler Options

The `HyperviewErrorHandler` accepts these options in the route definition:

| Option | Type | Default | Description |
|---|---|---|---|
| `handleUnexpectedErrors` | boolean | `true` | Handle errors that do not have an HTTP status code |
| `exposeErrorDetails` | boolean | `false` | Include error details in the page data |
| `useCache` | boolean | `false` | Cache error page templates |
| `pathname` | string | (auto) | Override error page pathname (default: HTTP status code) |
| `baseTemplate` | string | — | Override base template for error pages |
| `contentType` | string | (auto) | Override response `Content-Type` |

```javascript
errorHandlers: [
    ['HyperviewErrorHandler', {
        handleUnexpectedErrors: true,
        exposeErrorDetails: false,
        baseTemplate: 'base.html',
    }],
],
```

## Configuration Priority

Error handler options follow this priority (highest to lowest):

1. Page data (`page.jsonc`) in the error page
2. Handler options in the route definition
3. `kixx-config.jsonc` under `hyperview.errorHandler`

## Available Error Classes

These error classes are available from `lib/errors.js`:

| Class | HTTP Status | Description |
|---|---|---|
| `NotFoundError` | 404 | Resource not found |
| `BadRequestError` | 400 | Malformed or invalid request |
| `ValidationError` | 400 | Validation failure (supports multiple errors) |
| `UnauthorizedError` | 401 | Authentication required |
| `UnauthenticatedError` | 401 | User not authenticated |
| `ForbiddenError` | 403 | Access denied |
| `MethodNotAllowedError` | 405 | HTTP method not supported |
| `ConflictError` | 409 | Resource conflict |
| `NotAcceptableError` | 406 | Cannot produce acceptable response |
| `UnsupportedMediaTypeError` | 415 | Unsupported media type |
| `NotImplementedError` | 501 | Feature not implemented |
| `OperationalError` | 500 | Expected operational error |
| `WrappedError` | — | Wraps another error with additional context |
| `AssertionError` | — | Invariant violation (unexpected programmer error) |

Throw HTTP errors from handlers to trigger the error page system:

```javascript
import { NotFoundError, ForbiddenError } from './kixx/errors.js';

async function myHandler(context, request, response) {
    const user = await getUser(request.pathnameParams.id);

    if (!user) {
        throw new NotFoundError(`User not found: ${request.pathnameParams.id}`);
    }

    if (!user.isActive) {
        throw new ForbiddenError('This account has been deactivated');
    }

    // ...
}
```
