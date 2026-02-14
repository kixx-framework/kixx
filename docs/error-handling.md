# Error Handling
Ethos and guidelines for handling errors in the Kixx framework.

## Expected operational errors vs. unexpected errors
It’s helpful to divide all errors into two broad categories:

### Expected Operational Errors
Expected errors represent run-time problems experienced by correctly-written programs. These are not bugs in the program. In fact, these are usually problems with something else: the system itself (e.g., out of memory or too many open files), the system’s configuration (e.g., no route to a remote host), the network (e.g., socket hang-up), or a remote service (e.g., a 500 error, failure to connect, or the like):

- failed to connect to server
- failed to resolve hostname
- invalid user input
- request timeout
- server returned a 500 response
- socket hang-up
- system is out of memory

For expected operational errors we want to handle them at several levels of the stack. This happens when lower levels can’t do anything useful except propagate the error to their caller, which propagates the error to its caller, and so on. Often, only the top-level caller has the context to know what to do next. But that means we need to pass up the error context through the layers. In the error library (`lib/errors/mod.js`) we do this by wrapping errors and including the thrown error as a `cause` option. See the [MDN docs on `Error:cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) for more information.

### Unexpected Errors
Unexpected errors are bugs in the program. These are things that can always be avoided by changing the code. They can never be handled properly (since by definition the code in question is broken).

- tried to read property of “undefined”
- called an asynchronous function without a callback
- passed a “string” where an object was expected
- passed an object where an IP address string was expected

*__The best way to recover from unexpected errors is to crash immediately.__* You should run your programs using a restarter that will automatically restart in the event of a crash. With a restarter in place, crashing is the fastest way to restore reliable service in the face of a transient programmer error.

Some people advocate attempting to recover from unexpected errors — that is, allow the current operation to fail, but keep handling requests. This is not recommended. Consider unexpected errors as cases that you didn’t think about when you wrote the original code. How can you be sure that the problem won’t affect other requests? If other requests share any common state (a server, a socket, a pool of database connections, etc.), it’s very possible that the other requests will do the wrong thing.

## Error Library Reference
The error library (`lib/errors/mod.js`) provides a set of error classes that extend the native `Error` class with standardized properties for error handling and HTTP responses.

```javascript
import { WrappedError, BadRequestError, OperationalError } from 'kixx';
```

These error classes exist to meet 3 objectives for better error handling in server-side JavaScript:

1. Make it easy to differentiate between unexpected errors and expected operational errors.
2. Provide a mechanism to augment error information as it is caught and rethrown with the added context from each layer.
3. Throw errors with specific HTTP application constructs which can help formulate an appropriate HTTP response to clients.

### Common Properties

All error classes inherit from `WrappedError` and share these instance properties (all read-only and enumerable):

| Property | Type | Description |
|---|---|---|
| `name` | string | Error class name (e.g. `"BadRequestError"`) |
| `code` | string | Error code string (e.g. `"BAD_REQUEST_ERROR"`) |
| `message` | string | The error message passed to the constructor |
| `expected` | boolean | Whether the error represents an expected operational condition |
| `httpError` | boolean | `true` when `httpStatusCode` is defined |
| `httpStatusCode` | number | HTTP status code (only present on HTTP error classes) |
| `cause` | Error | The underlying cause, if provided via options |

### Common Constructor Signature

All error classes share the same constructor signature:

```javascript
new ErrorClass(message, options, sourceFunction)
```

| Parameter | Type | Description |
|---|---|---|
| `message` | string | The error message |
| `options` | object | Optional configuration (see below) |
| `sourceFunction` | function | Optional function to exclude from stack trace via `Error.captureStackTrace()` |

### Options Object

| Property | Type | Description |
|---|---|---|
| `cause` | Error | The underlying [error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `code` | string | Override the default error code |
| `name` | string | Override the default error name |
| `expected` | boolean | Override the default expected flag |

If `code` is not provided in options, it falls back to `cause.code` if available, then to the class static `CODE`.

### WrappedError

The base class for all errors in this library. Use for unexpected errors that need to preserve the original cause.

| Default | Value |
|---|---|
| `code` | `"WRAPPED_ERROR"` |
| `expected` | `false` |
| `httpError` | `false` |

```javascript
try {
    await readFile(filepath);
} catch (cause) {
    throw new WrappedError(`Unexpected error reading ${filepath}`, { cause });
}
```

### OperationalError

For expected operational errors (network failures, missing files, etc.) that the application can handle gracefully.

| Default | Value |
|---|---|
| `code` | `"OPERATIONAL_ERROR"` |
| `expected` | `true` |
| `httpError` | `false` |

```javascript
if (cause.code === 'ENOENT') {
    throw new OperationalError(`File does not exist at ${filepath}`, {
        code: 'FILE_NOT_FOUND',
        cause,
    });
}
```

### AssertionError

For assertion failures indicating a violated internal invariant or contract.

| Default | Value |
|---|---|
| `code` | `"ASSERTION_ERROR"` |
| `expected` | `false` |
| `httpError` | `false` |

```javascript
if (!doc?.id) {
    throw new AssertionError('A document must have an "id"');
}
```

Note: The assertions library (`lib/assertions/mod.js`) defines its own `AssertionError` with an additional `operator` property. See the [Assertions Library](./assertions-library-reference.md) docs.

### ValidationError

For data validation failures. Provides an `errors` array to aggregate multiple validation issues. Sets HTTP status 422.

| Default | Value |
|---|---|
| `code` | `"VALIDATION_ERROR"` |
| `expected` | `true` |
| `httpStatusCode` | `422` |

Additional instance members:

| Member | Type | Description |
|---|---|---|
| `errors` | Array<{message, source}> | Array of validation failure details |
| `length` | number | Getter returning `errors.length` |
| `push(message, source)` | method | Adds a validation failure to the `errors` array |

```javascript
function validateForm(formData) {
    const error = new ValidationError('Invalid form data');

    if (!formData.email || typeof formData.email !== 'string') {
        error.push('Invalid email', 'form.email');
    }
    if (!formData.name || typeof formData.name !== 'string') {
        error.push('Invalid name', 'form.name');
    }

    if (error.length > 0) {
        throw error;
    }

    return formData;
}
```

### HTTP Error Classes

All HTTP error classes set `expected: true` and define an `httpStatusCode`. They share the common constructor signature with no additional options (except where noted).

| Class | HTTP Status | Code | Description |
|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST_ERROR` | Malformed or invalid request |
| `UnauthenticatedError` | 401 | `UNAUTHENTICATED_ERROR` | No authentication credentials provided (AuthN) |
| `UnauthorizedError` | 401 | `UNAUTHORIZED_ERROR` | Credentials provided but insufficient or invalid (AuthZ) |
| `ForbiddenError` | 403 | `FORBIDDEN_ERROR` | Server refuses to authorize the request |
| `NotFoundError` | 404 | `NOT_FOUND_ERROR` | Requested resource not found |
| `MethodNotAllowedError` | 405 | `METHOD_NOT_ALLOWED_ERROR` | HTTP method not supported for this resource |
| `NotAcceptableError` | 406 | `NOT_ACCEPTABLE_ERROR` | Cannot produce a response matching the Accept headers |
| `ConflictError` | 409 | `CONFLICT_ERROR` | Request conflicts with current resource state |
| `UnsupportedMediaTypeError` | 415 | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Request payload format not supported |
| `ValidationError` | 422 | `VALIDATION_ERROR` | Data validation failures (see [above](#validationerror)) |
| `NotImplementedError` | 501 | `NOT_IMPLEMENTED_ERROR` | Server does not support the requested functionality |

Note: Both `UnauthenticatedError` and `UnauthorizedError` use HTTP 401. The distinction is semantic -- `UnauthenticatedError` means no credentials were provided, while `UnauthorizedError` means the provided credentials are insufficient.

### MethodNotAllowedError

Accepts an additional `allowedMethods` option:

```javascript
throw new MethodNotAllowedError('PUT not allowed on /users', {
    allowedMethods: ['GET', 'HEAD', 'POST'],
});

// error.allowedMethods => ['GET', 'HEAD', 'POST'] (frozen)
```

The `allowedMethods` instance property is a frozen array used to construct the `Allow` response header.

### NotAcceptableError and UnsupportedMediaTypeError

Both accept additional content negotiation options:

| Option | Type | Description |
|---|---|---|
| `accept` | string[] | Acceptable mimetypes (e.g. `['application/json', 'text/html']`) |
| `acceptEncoding` | string[] | Acceptable encodings (e.g. `['gzip', 'deflate']`) |
| `acceptLanguage` | string[] | Acceptable languages (e.g. `['en-US', 'fr']`) |

These are exposed as frozen array instance properties on the error.

```javascript
throw new NotAcceptableError('Content type not supported', {
    accept: ['application/json', 'text/html'],
});

// error.accept => ['application/json', 'text/html'] (frozen)
```
