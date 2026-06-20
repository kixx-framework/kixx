# Error Handling

When you write or refactor server-side JavaScript code in this project, apply these error handling patterns.

## Two Categories of Errors

Every error is either **expected (operational)** or **unexpected (programmer)**. The two categories are handled in completely different ways — do not blur them.

### 1. Expected Operational Errors

Run-time problems that a correctly-written program will eventually encounter. They are *not* bugs. They come from the outside world:

- Network failure, socket hang-up, DNS resolution failure.
- Remote service returned 5xx, 4xx, or timed out.
- Cloudflare binding, KV, D1, R2, cache, or upstream `fetch()` failure.
- Invalid user input, invalid configuration.
- A requested resource does not exist.

**Rule:** Throw expected errors with the most specific project error class. Catch
an expected error only when the current layer can handle it or add useful
context. If you catch an error and do not recognize it as one you know how to
handle, rethrow it as an `AssertionError`.

Use the error classes in `kixx/errors/mod.js` to represent expected errors:

| Error class | Status | Use when |
|---|---:|---|
| `BadRequestError` | 400 | The request shape is malformed, such as invalid JSON, missing required request structure, or unsupported query syntax. |
| `UnauthenticatedError` | 401 | The action requires authentication and none was provided. |
| `UnauthorizedError` | 401 | Authentication was attempted but the credentials were not accepted. |
| `ForbiddenError` | 403 | The user is authenticated but not permitted to perform the action. |
| `NotFoundError` | 404 | A required route, resource, or referenced entity does not exist. |
| `MethodNotAllowedError` | 405 | The route exists but does not support the request method. Include `allowedMethods` when constructing it manually. |
| `NotAcceptableError` | 406 | The request's response negotiation headers cannot be satisfied. |
| `ConflictError` | 409 | The request conflicts with current resource state, such as duplicates or optimistic concurrency failures. |
| `PreconditionFailedError` | 412 | A conditional request precondition failed, such as `If-None-Match: *` requiring create-only behavior when the resource already exists. |
| `UnsupportedMediaTypeError` | 415 | The request payload media type or content metadata is unsupported. |
| `ValidationError` | 422 | Parsed input is syntactically valid but fails field, form, or business validation. |
| `NotImplementedError` | 501 | The requested behavior is intentionally not implemented. |
| `OperationalError` | 500 fallback | An expected non-HTTP infrastructure, integration, or storage failure has no more specific class. |

`WrappedError` is the base class. It defaults `expected` to `false`; the concrete
operational and HTTP error classes above set `expected: true` by default. HTTP
classes expose `httpStatusCode`, `code`, `name`, and `httpError`.

`AssertionError` is for unexpected conditions or broken assumptions.

Messages on HTTP errors are serialized by the router fallback, so they must be
safe to show to clients. Do not put secrets, raw upstream payloads, stack
details, KV keys, or internal identifiers in an HTTP error message. Use a
custom `code` when callers or templates need to distinguish a domain-specific
outcome while keeping the HTTP status generic:

```js
throw new ConflictError('This username is already registered.', {
    code: 'NewUserConflictError',
});
```

Every one of these classes accepts `cause` in its options object. **Always pass
the original error as `cause`** when wrapping or translating an error, so the
context chain is preserved:

```js
import { OperationalError } from '../../kixx/errors/mod.js';

try {
    return await fetch(upstreamUrl);
} catch (cause) {
    throw new OperationalError(`Failed to fetch upstream URL ${ upstreamUrl }`, { cause });
}
```

### 2. Unexpected Errors (Programmer Errors / Bugs)

Cases the author did not think about. These cannot be "handled" because, by definition, the code is broken. Examples:

- Reading a property of `undefined`.
- Passing a string where an object was expected.
- Calling a method on a value that should have been a Date.
- An invariant that the surrounding code depends on is violated.

**Rule:** *Crash immediately.* Do not try to recover. A restarter, Worker
isolate restart, or platform-level fatal-error policy is the correct response.
Continuing to serve requests from a broken state risks corrupting shared state
and returning wrong answers.

Do not catch-and-swallow. Do not convert a programmer error into an operational error. Let it propagate until the process crashes (or is logged and crashed at the top level).

There may also be times when the right thing to do is to convert an operational error into an unexpected assertion error. This happens when you believe the system is in a bad state or unexpected state which leads to the operational error. One common example of this is a record concurrency error from the data store when you believe that it should not be possible to visit the code path which caused it.

## Assumptions To Assertions

The way we protect against unexpected errors is to write down our assumptions as **assertions** at the boundaries of our code. An assertion that fails is a loud, immediate crash with a precise message — exactly what you want for a bug.

Use `kixx/assertions/mod.js` for this. Pick the relative import path from the
file you are editing.

There are two `AssertionError` sources:

- Assertion helpers from `kixx/assertions/mod.js` throw the assertion
  library's `AssertionError`. Use these helpers for normal invariant checks.
- `AssertionError` from `kixx/errors/mod.js` is a `WrappedError` subclass
  for explicitly rethrowing an impossible internal condition while preserving
  `cause`, usually at a domain boundary. It is unexpected by default.

### When to Assert

Assert every non-obvious assumption the function body depends on:

- **Public function entry points**: validate the *shape* of arguments your function needs to use. If you expect a non-empty string, call `assertNonEmptyString(id, 'id')`. If you expect a plain object, assert it.
- **After destructuring from internal configuration or framework output**: assert that required fields are present and of the expected type.
- **Between layers in a pipeline**: when one module hands data to another, the receiving side can assert the contract.
- **Before operations where a wrong type would silently corrupt state**: assert before constructing URLs, storage keys, SQL strings, or outbound payloads.
- **On values returned from framework/library calls** where your code assumes a specific shape that is not enforced by the type system.

Do **not** assert as a substitute for user input validation. User input is an **expected operational error** (use `ValidationError` / `BadRequestError`), not a programmer error. Assertions are for internal invariants between your own code units — values that a correct program would never produce.

### How to Assert

```js
import {
    assertNonEmptyString,
    assertFunction,
    isPlainObject,
    assert,
} from '../../kixx/assertions/mod.js';

function registerHandler(args) {
    const { name, handler, options } = args ?? {};

    assertNonEmptyString(name, 'registerHandler: name');
    assertFunction(handler, 'registerHandler: handler');
    assert(isPlainObject(options), 'registerHandler: options must be a plain object');

    // ... from here on, the function body can rely on these facts.
}
```

The message prefix is important. It should name the function and the parameter so that when the assertion fires in production logs, a maintainer can find the call site immediately.

### Prefer `assert*` Helpers Over Hand-Written Checks

Do not write:

```js
if (typeof name !== 'string' || name.length === 0) {
    throw new Error('name is required');
}
```

Write:

```js
assertNonEmptyString(name, 'context: name');
```

## Validation Errors

Use `ValidationError` for parsed input that fails validation.

For one failure, throwing a `ValidationError` with a clear message is enough:

```js
import { ValidationError } from '../../kixx/errors/mod.js';

throw new ValidationError('Start date must be before end date');
```

For field-level validation, collect one entry per invalid field with
`error.push(message, source)`.

```js
import { ValidationError } from '../../kixx/errors/mod.js';

const error = new ValidationError('The form contains invalid fields');

if (!title) {
    error.push('Title is required', '/data/attributes/title');
}

if (error.length) {
    throw error;
}
```

The `source` should match the form field name because `BaseForm#getFormContext()` uses it to attach field-level messages.

Request handlers that can recover from validation failures should catch only
the expected validation or domain codes they know how to render, update response
props, and rethrow everything else:

```js
try {
    form.validate();
} catch (error) {
    if (error.name === 'ValidationError') {
        return response.updateProps({ form: form.getFormContext(context, error) });
    }
    throw error;
}
```

## Wrapping and Rethrowing

When you catch an expected error at a layer that cannot handle it, wrap it with
more context and rethrow. Preserve the chain with `cause`:

```js
try {
    await sessions.put(context, sessionId, session);
} catch (cause) {
    throw new OperationalError(
        `Failed to store session ${ sessionId }`,
        { cause },
    );
}
```

Rules for wrapping:

- **Always pass `cause`.** Losing the original error destroys the debugging trail.
- **Add information, do not repeat it.** The wrapper message should say what *this layer* was trying to do, not restate the inner message.
- **Do not wrap programmer errors.** If an assertion-library `AssertionError` or a native `TypeError` / `ReferenceError` flies past, let it propagate — it is a bug and should crash.
- **Pick the most specific class.** Use `NotFoundError` when something is missing, `ValidationError` when input fails validation, `BadRequestError` when a request is malformed. Fall back to `OperationalError` only when none fit.
- **Catch narrowly.** Prefer `if (error.name === 'ExpectedErrorClass')` and `if (error.code === 'EXPECTED_ERR_CODE')` instead of `instanceof` checks and rethrow everything else unchanged.

Storage-layer implementation details should be translated at the Transaction Script boundary.

- Translate **expected** storage outcomes into domain HTTP errors.
- Rethrow unknown or **unexpected** storage errors as unexpected `AssertionError` from `kixx/errors/mod.js`

```js
import { AssertionError, ConflictError } from '../../../kixx/errors/mod.js';

try {
    await tickets.update(context, record);
} catch (error) {
    if (error.name === 'VersionConflictError') {
        throw new ConflictError(
            'This ticket was modified by someone else. Reload and try again.',
            { cause: error },
        );
    }
    throw new AssertionError('Unexpected storage error while updating ticket', { cause: error });
}
```

## At the Top of the Stack

The top-level caller (HTTP handler, command entry point) is the one place that decides:

- If `error.httpError === true`: render an HTTP response using `error.httpStatusCode`, `error.code`, and a safe message.
- If `error.expected === true` without `httpError`: return a generic 500 response while preserving internal context for logs.
- If the error is unexpected: log the full chain, including `cause`, and let the error escape. Do not try to keep serving from the same broken execution path.

The HTTP router's fallback error handler serializes expected HTTP errors as
JSON:API error responses. Browser-facing routes that need HTML error pages
should use route or target `errorHandlers`; those handlers should return `false`
for errors they do not specifically handle.

Target error handlers run first, then route error handlers, then the router
fallback. An error handler should either return a populated `ServerResponse` or
return `false` to keep the cascade moving:

```js
export function handleNotFoundHtml(context, request, response, error) {
    if (error.name !== 'NotFoundError') {
        return false;
    }
    return response.respondWithHTML(404, '<h1>Not found</h1>');
}
```
