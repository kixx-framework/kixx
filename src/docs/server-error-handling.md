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

**Rule:** Throw expected errors with the most specific project error class. Catch an expected error only when the current layer can handle it or add useful context. If you catch an error and do not recognize it as one you know how to handle, or from a code path you do not handle, rethrow it as an `AssertionError`.

Use the error classes in `kixx/errors/mod.js` to represent expected errors:

- Use `OperationalError` for an expected infrastructure, integration, or storage failure which does not need a more specific class.
- Extend `WrappedError` when you need to define a custom error class.


Use a custom `code` when callers or templates need to distinguish a domain-specific outcome while keeping the HTTP status generic:

```js
throw new ConflictError('This username is already registered.', {
    code: 'NewUserConflictError',
});
```

Every Error class accepts `cause` in its options object. **Always pass the original error as `cause`** when wrapping or translating an error, so the context chain is preserved:

```js
import { OperationalError } from '../../kixx/errors/mod.js';

try {
    return await fetch(upstreamUrl);
} catch (cause) {
    throw new OperationalError(`Failed to fetch upstream URL ${ upstreamUrl }`, { cause });
}
```

### 2. Unexpected Errors (Programmer Errors / Bugs)

Cases the author did not think about or from unexpected code paths, or code paths which were assumed to be unreachable. These cannot be "handled" because, by definition, the code is broken. Examples:

- Reading a property of `undefined`.
- Passing a string where an object was expected.
- Calling a method on a value that should have been a Date.
- An invariant that the surrounding code depends on is violated.

**Rule:** *Crash the process, not just the response.* Do not try to recover, retry, or let the application keep accepting *new* work as though the bug did not happen. A restarter, Worker isolate restart, or platform-level fatal-error policy must run. Continuing to serve requests from a broken state risks corrupting shared state and returning wrong answers.

Do not catch-and-swallow. Do not convert a programmer error into an operational error. Let it propagate out of your code so the router can log it and trigger the platform's fatal-error policy.

This does **not** mean the one in-flight request that hit the bug must receive a bare or unstyled response. The fatal-error/shutdown decision is driven by an `error` event the router emits for every failure, independently of whatever response is eventually produced for that request.

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
- **Catch narrowly.** Prefer `if (error.name === 'ExpectedErrorClass')` and `if (error.code === 'EXPECTED_ERR_CODE')` instead of `instanceof` checks for code branching.
