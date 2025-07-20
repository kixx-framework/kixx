## Overview
This library provides a set of error classes that extend the native `Error` class, with additional properties and standardized behavior for HTTP error responses. All error classes inherit from `WrappedError`, which provides common functionality for error handling.

## Error Classes
See the documentation files in this directory for more information.

### Special Error Classes

| Error Class | Description |
|-------------|-------------|
| `AssertionError` | Used for assertion failures in application code or tests |
| `OperationalError` | Base class for operational errors (expected errors) |
| `ValidationError` | Used for data validation failures |
| `WrappedError` | Base class for all error classes in this library |

### HTTP Error Classes

| Error Class | HTTP Status | Description |
|-------------|-------------|-------------|
| `BadRequestError` | 400 | The server cannot process the request due to client error |
| `UnauthenticatedError` | 401 | Authentication is required to access the resource |
| `UnauthorizedError` | 401 | The client lacks valid authentication credentials |
| `ForbiddenError` | 403 | The server understood the request but refuses to authorize it |
| `NotFoundError` | 404 | The requested resource could not be found |
| `MethodNotAllowedError` | 405 | The HTTP method is not supported for the requested resource |
| `NotAcceptableError` | 406 | The server cannot produce a response matching the list of acceptable values |
| `ConflictError` | 409 | The request conflicts with the current state of the server |
| `UnsupportedMediaTypeError` | 415 | The server refuses to accept the request because the payload format is unsupported |
| `NotImplementedError` | 501 | The server does not support the functionality required to fulfill the request |

## Usage

```javascript
import { WrappedError, BadRequestError, OperationalError } from './mod.js';

throw new BadRequestError('Invalid JSON payload');

async function safelyReadTextFile(filepath) {
    let utf8;
    try {
        utf8 = await fsp.readFile(filepath, { encoding: utf8 });
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            // The file does not exist.
            // The default .expected property is true for an OperationalError.
            throw new OperationalError(
                `File does not exist at ${ filepath }`,
                { code: 'FILE_NOT_FOUND', cause }
            );
        } else {
            // We don't know what happened in this case.
            // The default .expected property is false for a WrappedError.
            throw new WrappedError(
                `Unexpected error reading file from ${ filepath }`,
                { cause }
            );
        }
    }
}
```

## Common Properties

All error classes inherit the following properties from `WrappedError`, but usually override some or all of them:

- `name`: The name of the error class
- `code`: A unique error code string
- `message`: The error message
- `expected`: Boolean indicating if the error was expected (default: false)
- `httpStatusCode`: The HTTP status code (for HTTP errors)
- `httpError`: Boolean indicating if this is an HTTP error (default: true for HTTP errors)
