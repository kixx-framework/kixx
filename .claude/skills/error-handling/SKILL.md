---
name: error-handling
description: This project makes use of a standard error types library to facilitate good error handling flows. This skill contains an overview of the library and guidelines for good error handling. Apply this error-handling skill when writing new code or refactoring existing code in the codebase.
---

## Overview
This project uses an error library (vendored at `lib/vendor/kixx-server-errors/`, re-exported via `lib/errors.js`) for typed, HTTP-aware errors. The library meets three goals:

1. **Differentiate** between unexpected errors (bugs) and expected operational errors (recoverable).
2. **Augment** error context as errors propagate—wrap and rethrow with added context using `cause`.
3. **Enable HTTP responses**—errors carry `httpStatusCode` and other metadata for response formatting.

To view the kixx-server-errors documentation directly, review the README at `lib/vendor/kixx-server-errors/README.md`.

All the source code for the kixx-server-errors classes is available in `lib/vendor/kixx-server-errors/lib/`.

See also: `runtime-assertions` — assertions are the first line of defense against programmer errors (wrong types, missing required options). When a caller violates a contract, an assertion throws immediately at the boundary. Only use the error classes below for errors that propagate through the call stack.

## Error Handling Principles: Expected vs. Unexpected Errors
When handling errors in the Kixx library, it is important to keep these error handling principles in mind:

**Expected Operational Errors** are run-time problems experienced by correctly-written programs. These are *not* bugs—they are usually problems with the system, config, network, or remote services:

- failed to connect to server
- invalid user input
- request timeout
- server returned 500
- socket hang-up
- resource not found

**Handle expected operational errors** by catching, optionally wrapping with context, and propagating. Often only the top-level caller (e.g. HTTP layer) knows what to do. Use `cause` when rethrowing to preserve the chain.

**Unexpected Errors** are bugs in the program. Things that can always be avoided by changing the code:

- read property of `undefined`
- passed wrong type to a function
- logic error

**The best way to recover from unexpected errors is to crash immediately.** Applications built with Kixx should be run with a restarter (e.g. PM2, systemd) so they restart on crash. Do not try to "recover" and keep handling other requests, since shared state (connections, sockets) may be corrupted.

## Import
example import code:

```javascript
import { WrappedError, NotFoundError, BadRequestError, OperationalError } from '../errors.js';
```

## Error Classes

### Base: WrappedError
All errors extend `WrappedError`. Use it directly to wrap a cause for an unexpected error.

```javascript
try {
    JSON.parse('<not JSON>');
} catch (cause) {
    throw new WrappedError('Invalid JSON file', { cause });
}
```

| Property | Description |
|----------|-------------|
| `name` | Error class name |
| `code` | Error code (e.g. `WRAPPED_ERROR`) |
| `expected` | `false` by default (unexpected) |
| `httpError` | `true` when `httpStatusCode` is set |
| `httpStatusCode` | Set on HTTP error classes |
| `cause` | Underlying error (from options) |

### OperationalError
For expected operational failures (network, filesystem, remote services). `expected: true` by default.

```javascript
try {
    await fetch('https://api.example.com/ping');
} catch (cause) {
    if (cause.httpStatus === 503) {
        throw new OperationalError('Service busy. Please retry again later', { code: 'SERVICE_BUSY', cause });
    } else {
        throw cause;
    }
}
```

### HTTP Error Classes
Use when the error maps to an HTTP response. All set `expected: true` and `httpStatusCode`.

| Class | Status | Use when |
|-------|--------|----------|
| BadRequestError | 400 | Malformed or invalid request |
| UnauthenticatedError | 401 | No credentials provided (AuthN) |
| UnauthorizedError | 401 | Credentials insufficient/invalid (AuthZ) |
| ForbiddenError | 403 | Server refuses request |
| NotFoundError | 404 | Resource not found |
| MethodNotAllowedError | 405 | Method not supported for resource |
| NotAcceptableError | 406 | Cannot satisfy Accept headers |
| ConflictError | 409 | Request conflicts with current state |
| UnsupportedMediaTypeError | 415 | Request payload format not supported |
| ValidationError | 422 | Data validation failures |
| NotImplementedError | 501 | Functionality not implemented |

### Special Options

**MethodNotAllowedError** — include allowed methods for the `Allow` header:
```javascript
throw new MethodNotAllowedError('PUT not allowed', { allowedMethods: ['GET', 'POST'] });
```

**ValidationError** — aggregate multiple validation failures:
```javascript
const err = new ValidationError('Invalid form data');
if (!formData.email) err.push('Email required', 'form.email');
if (!formData.name) err.push('Name required', 'form.name');
if (err.length > 0) throw err;
```

**NotAcceptableError / UnsupportedMediaTypeError** — content negotiation: `accept`, `acceptEncoding`, `acceptLanguage` arrays.

## Constructor Signature
```javascript
new ErrorClass(message, options, sourceFunction)
```

| Parameter | Description |
|-----------|-------------|
| `message` | Human-readable message |
| `options` | `{ cause, code, name, expected, ... }` |
| `sourceFunction` | Excluded from stack trace via `Error.captureStackTrace` |

## Best Practices

### 1. Wrap lower-level errors with context
When catching and rethrowing, add context and pass the original as `cause`:

```javascript
try {
    await readFile(filepath);
} catch (cause) {
    throw new WrappedError(`Unable to read config from ${ filepath }`, { cause });
}
```

### 2. Choose the right error type
- **HTTP error class** — when the failure directly maps to an HTTP response (e.g. 404, 400, 409).
- **OperationalError** — expected operational failure without a specific HTTP mapping.
- **WrappedError** — unexpected error you are propagating; preserves cause.

### 3. Check `error.expected` and `error.httpError` when handling
Top-level handlers (e.g. HTTP router) use these to decide: return a JSON error body with status code, or crash/log and return 500.

### 4. Prefer `error.name` or `error.code` over `instanceof`
Using `error.name === 'NotFoundError'` or `error.code === 'CONFLICT_ERROR'` avoids module reference mismatches and works across package boundaries.

### 5. Use meaningful messages
Include identifiers (pathname, id, resource name) so logs and responses are debuggable: `No page found for pathname "${ pathname }"`.
