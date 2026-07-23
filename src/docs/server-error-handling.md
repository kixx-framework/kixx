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

**Rule:** Throw expected errors with the most specific project error class. Catch an expected error only when the current layer can handle it or add useful context. If you catch an error and do not recognize it as one you know how to handle, rethrow it as an `AssertionError`.

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

`WrappedError` is the base class. It defaults `expected` to `false`; the concrete operational and HTTP error classes above set `expected: true` by default. HTTP classes expose `httpStatusCode`, `code`, `name`, and `httpError`.

`AssertionError` is for unexpected conditions or broken assumptions.

Messages on HTTP errors are serialized by the router fallback, so they must be safe to show to clients. Do not put secrets, raw upstream payloads, stack details, KV keys, or internal identifiers in an HTTP error message. Use a custom `code` when callers or templates need to distinguish a domain-specific outcome while keeping the HTTP status generic:

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

**Rule:** *Crash the process, not just the response.* Do not try to recover, retry, or let the application keep accepting *new* work as though the bug did not happen. A restarter, Worker isolate restart, or platform-level fatal-error policy must run. Continuing to serve requests from a broken state risks corrupting shared state and returning wrong answers.

Do not catch-and-swallow. Do not convert a programmer error into an operational error. Let it propagate out of your code so the router can log it and trigger the platform's fatal-error policy.

This does **not** mean the one in-flight request that hit the bug must receive a bare or unstyled response. The fatal-error/shutdown decision is driven by an `error` event the router emits for every failure, independently of whatever response is eventually produced for that request — see [Router Error Propagation and the Platform Fatal-Error Policy](#router-error-propagation-and-the-platform-fatal-error-policy) below. A route or target error handler may still catch an unexpected error and render a normal-looking error page for the person who hit it; the process shuts down behind the scenes regardless.

There may also be times when the right thing to do is to convert an operational error into an unexpected assertion error. This happens when you believe the system is in a bad state or unexpected state which leads to the operational error. One common example of this is a record concurrency error from the data store when you believe that it should not be possible to visit the code path which caused it.

## Assumptions To Assertions

The way we protect against unexpected errors is to write down our assumptions as **assertions** at the boundaries of our code. An assertion that fails is a loud, immediate crash with a precise message — exactly what you want for a bug.

Use `kixx/assertions/mod.js` for this.

There are two `AssertionError` sources:

- Assertion helpers from `kixx/assertions/mod.js` throw the assertion library's `AssertionError`. Use these helpers for normal invariant checks.
- `AssertionError` from `kixx/errors/mod.js` is a `WrappedError` subclass for explicitly rethrowing an impossible internal condition while preserving `cause`, usually at a domain boundary. It is unexpected by default.

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

Request handlers that can recover from validation failures should catch only the expected validation or domain codes they know how to render, update response props, and rethrow everything else:

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

When you catch an expected error at a layer that cannot handle it, wrap it with more context and rethrow. Preserve the chain with `cause`:

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

**Exception: cursor validation is translated at the presentation boundary, not the Transaction Script boundary.** `DocumentStore#scan()`/`query()` (`kixx/document-store/document-store.js`) issue and verify signed public pagination cursors. A cursor that is malformed, tampered with, foreign-signed, unsigned-legacy, or **replayed against a different query** (a different method, type, index, sort direction, or range bound than the one that issued it) raises `InvalidCursorError` from `kixx/document-store/invalid-cursor-error.js`. Every one of those cases is **expected** input: a stale bookmarked page link is the ordinary way the replay case arrives, not a sign of a bug. Because `InvalidCursorError` is not one of the `kixx/errors/mod.js` HTTP classes in the table above, list Transaction Scripts re-throw it unchanged — ahead of their usual catch-all `AssertionError` wrap — instead of translating it themselves:

```js
} catch (cause) {
    if (cause.name === 'InvalidCursorError') {
        throw cause;
    }
    throw new AssertionError('Unexpected error while listing admin invites', { cause });
}
```

The presentation layer's `rethrowInvalidCursorAsBadRequest()` (`app/presentation/lib/pagination.js`) is what finally converts it to a client-safe `BadRequestError` (400). This two-layer split matters: query-string *shape* (a non-empty `cursor`, well-formed `history` params) is an HTTP concern validated by `pagination.js`, while cursor *authenticity and scope* (the HMAC signature and the query it was issued for) are storage concerns validated by the facade — see the Collections guide's "Reading and Listing" section for the full contract, including that rotating the signing secret invalidates every cursor in flight.

Getting this classification right is what keeps a bad cursor from taking the process down. `InvalidCursorError` carries `expected`, so the router logs a warning and serves a 400. Were the same condition to surface as an `AssertionError` instead, the router's `error` event would classify it as a programmer error and **trigger the fatal-error policy** — a stale page link would shut the server down. This is why engines must not raise assertion failures for cursor scope: the facade owns that check and owns the expected-error classification with it.

## Router Error Propagation and the Platform Fatal-Error Policy

Two separate mechanisms run whenever a middleware or request handler throws. Keeping them separate in your head is the key to understanding this section: one produces the **response**, the other decides whether the **process** crashes. They share the same error object, but neither one waits on the other.

### 1. The error-handler cascade decides the response

`HttpRouter` (`kixx/http-router/http-router.js`) catches every error thrown during a request and runs it through a cascade, from most specific to least:

1. The matched **target**'s `errorHandlers`, in order.
2. The matched **route**'s `errorHandlers` (and its ancestor routes'), in order.
3. The router's own built-in fallback handler.

Each handler either returns a populated `ServerResponse` (the cascade stops there) or returns `false` (the next level gets a turn):

```js
export function handleNotFoundHtml(context, request, response, error) {
    if (error.name !== 'NotFoundError') {
        return false;
    }
    return response.respondWithHTML(404, '<h1>Not found</h1>');
}
```

The router's built-in fallback only recognizes `error.httpError` and `error.expected` — it serializes those as a JSON:API error response and declines (`return false`) anything else. That means:

- `error.httpError === true` (a `NotFoundError`, `ValidationError`, etc.): the router's fallback can render it as JSON:API on its own, but a target/route handler earlier in the cascade may still render something more specific, such as an HTML page.
- `error.expected === true` without `httpError` (e.g. `OperationalError`): the router's fallback renders a generic 500 JSON:API response.
- Truly unexpected errors (`expected` is falsey and there is no `httpStatusCode`): the router's fallback always declines. **A target or route `errorHandlers` entry is the only way to render anything other than the platform's last-resort fallback (below) for these.** There is nothing wrong with doing so — see the next section.

Browser-facing routes that want styled HTML instead of JSON:API bodies attach their own `errorHandlers` at the route or target level (see the Presentation Layer Guide's "Middleware vs. Request Handlers vs. Error Handlers" section). A handler for HTML routes commonly wants to catch *everything* the more specific handlers upstream didn't — including unexpected errors — rather than declining and falling through to the platform's plain-text fallback:

```js
export function handleUnexpectedHtml(context, request, response, error) {
    if (error.httpError) {
        return false; // Let a more specific handler, or the JSON fallback, take it.
    }
    return response.respondWithHTML(500, '<h1>Something went wrong</h1>');
}
```

### 2. The router's `error` event decides whether the process crashes

Independent of the cascade above, `HttpRouter` emits an `error` event (`{ error, requestId }`) for **every** failure, before the cascade runs and regardless of whether any handler in it produces a response. The platform server (e.g. `node-server.js`) subscribes to this event and applies the fatal-error policy from `error.expected` / `error.httpError` alone:

```js
router.on('error', ({ error, requestId }) => {
    if (!error.httpError) {
        if (error.expected) {
            logger.warn('operational error while routing request', { requestId }, error);
        } else {
            logger.error('unexpected error while routing request', { requestId }, error);
            shutdown('fatal router error', { force: false, exitCode: 1 });
        }
    }
});
```

Because this listener fires before — and independently of — the cascade's outcome, **a target or route error handler rendering a friendly page for an unexpected error does not prevent or delay the shutdown.** The process still begins draining and exiting; the one in-flight request just gets a better response on its way out than the platform default would give it.

### 3. The platform-level last resort

If every cascade level returns `false` for a given error, `HttpRouter` re-throws it out of the request (see the `ErrorHandlerFunction` contract in `kixx/http-router/error-handler-interface.js`). This is a true last resort, not the normal path for unexpected errors — routes that care about their error presentation should add their own `errorHandlers` per the previous section. When nothing catches it, the platform server sends a minimal, unstyled response before shutting down. In `node-server.js`, that means a plain-text `500 Internal Server Error` body if headers were not yet sent, or destroying the connection outright if they were — followed by the same graceful shutdown described above.
