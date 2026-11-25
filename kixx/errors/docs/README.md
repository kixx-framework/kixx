# kixx-server-errors

Error classes that extend the native `Error` with stable metadata for HTTP handlers and error serialization. All classes extend [`WrappedError`](./wrapped-error.md).

## Error classes

### Base and operational

| Class | Default `httpStatusCode` | Default `expected` | Purpose |
|-------|--------------------------|--------------------|---------|
| [`WrappedError`](./wrapped-error.md) | — | `false` | Base class. Throw directly for unexpected failures. |
| [`OperationalError`](./operational-error.md) | — | `true` | Expected runtime failures (I/O, integrations) with no HTTP meaning. |
| [`AssertionError`](./assertion-error.md) | — | `false` | Invariant/assertion violations in application code or tests. |

### HTTP

| Class | Status | Purpose |
|-------|--------|---------|
| [`BadRequestError`](./bad-request-error.md) | 400 | Request is malformed or fails request-shape validation. |
| [`UnauthenticatedError`](./unauthenticated-error.md) | 401 | Request lacks valid authentication credentials. |
| [`UnauthorizedError`](./unauthorized-error.md) | 401 | Credentials were provided but not accepted. |
| [`ForbiddenError`](./forbidden-error.md) | 403 | Authenticated, but not permitted to perform the action. |
| [`NotFoundError`](./not-found-error.md) | 404 | Requested resource does not exist. |
| [`MethodNotAllowedError`](./method-not-allowed-error.md) | 405 | HTTP method not supported by the resource. Carries `allowedMethods`. |
| [`NotAcceptableError`](./not-acceptable-error.md) | 406 | Response cannot match the client's `Accept*` headers. Carries negotiation values. |
| [`ConflictError`](./conflict-error.md) | 409 | Request conflicts with the current resource state. |
| [`PreconditionFailedError`](./precondition-failed-error.md) | 412 | A conditional request header evaluated to false. |
| [`PayloadTooLargeError`](./payload-too-large-error.md) | 413 | Request payload exceeds the size the server accepts. |
| [`UnsupportedMediaTypeError`](./unsupported-media-type-error.md) | 415 | Request payload is in an unsupported format. Carries negotiation values. |
| [`ValidationError`](./validation-error.md) | 422 | Aggregates one or more validation failures. |
| [`TooManyRequestsError`](./too-many-requests-error.md) | 429 | The client has sent too many requests and is rate limited. Carries `retryAfterSeconds`. |
| [`NotImplementedError`](./not-implemented-error.md) | 501 | Requested feature or method is not implemented. |
| [`ServiceUnavailableError`](./service-unavailable-error.md) | 503 | A backing service is temporarily unavailable. Carries `retryAfterSeconds`. |

`UnauthenticatedError` vs `UnauthorizedError`: both are HTTP 401. Use `UnauthenticatedError` when no credentials were presented; use `UnauthorizedError` when credentials were presented but rejected. Use [`ForbiddenError`](./forbidden-error.md) (403) when the caller is authenticated but not permitted.

## Usage

```javascript
import { BadRequestError, OperationalError, WrappedError } from 'kixx-server-errors';

throw new BadRequestError('Invalid JSON payload');

async function safelyReadTextFile(filepath) {
    try {
        return await fsp.readFile(filepath, { encoding: 'utf8' });
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            // Expected: file may legitimately be missing.
            throw new OperationalError(
                `File does not exist at ${ filepath }`,
                { code: 'FILE_NOT_FOUND', cause }
            );
        }
        // Unexpected: surface with full context so upstream can decide to crash.
        throw new WrappedError(
            `Unexpected error reading file from ${ filepath }`,
            { cause }
        );
    }
}
```

## Shared behavior

All classes share this constructor signature and property model, inherited from `WrappedError`:

```javascript
new SomeError(message, options?, sourceFunction?)
```

### Instance properties

| Property | Type | Notes |
|----------|------|-------|
| `name` | string | Defaults to the class name. Override via `options.name`. |
| `code` | string\|number | `options.code` when it is a non-empty string or a number (including `0`); otherwise the class's static `CODE`. Never taken from `options.cause.code`. |
| `message` | string | Passed to `Error`. |
| `cause` | Error? | Standard [`Error: cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause). |
| `expected` | boolean | `true` marks an operational/expected error. Default `false` on `WrappedError`; `true` on `OperationalError` and every HTTP error. |
| `httpError` | boolean | `true` iff `httpStatusCode` is defined. |
| `httpStatusCode` | number? | Set from `options.httpStatusCode` or the class's static `HTTP_STATUS_CODE`. |

Name, code, httpStatusCode, expected, and httpError are defined as non-writable, enumerable properties so they survive `JSON.stringify` and cannot be reassigned.

### Options

| Option | Type | Description |
|--------|------|-------------|
| `cause` | Error | Underlying cause. |
| `code` | string\|number | Overrides the class's static `CODE` when it is a non-empty string or a number (including `0`). |
| `name` | string | Overrides the class name. |
| `expected` | boolean | Overrides the class's default `expected`. |
| `httpStatusCode` | number | Overrides the class's static `HTTP_STATUS_CODE`. |

Individual classes may add further options (e.g. `allowedMethods`, `accept`) documented on their own pages.

### `sourceFunction`

If provided, `Error.captureStackTrace(this, sourceFunction)` is invoked so the stack trace omits `sourceFunction` and everything above it. Useful for factories that construct errors on behalf of a caller.

### Expected vs unexpected

The library treats these as distinct failure modes:

- **Expected** (`expected: true`) — operational problems a correct program can hit: bad input, network timeouts, missing files, remote 500s. Handle these by wrapping with context and rethrowing, or by responding to the client.
- **Unexpected** (`expected: false`) — programmer errors: wrong types, undefined property access, broken invariants. The recommended response is to crash the process under a restarter rather than attempt recovery.

See the root [`README.md`](../README.md) for the full rationale.
