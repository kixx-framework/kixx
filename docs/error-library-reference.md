# Error Library Reference

The error library (`lib/errors/mod.js`) provides a set of error classes that extend the native `Error` class with standardized properties for error handling and HTTP responses.

```javascript
import { WrappedError, BadRequestError, OperationalError } from 'kixx';
```

## Common Properties

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

## Common Constructor Signature

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

## WrappedError

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

## OperationalError

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

## AssertionError

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

Note: The assertions library (`lib/assertions/mod.js`) defines its own `AssertionError` with an additional `operator` property. See the [Assertions Library](./assertions-library.md) docs.

## ValidationError

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

## HTTP Error Classes

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
