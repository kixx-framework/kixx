Code Documentation Guidelines
=============================

JSDoc block comments are the formal API contract: types, parameters, return values, errors, and events. They should answer "What does this do?" and "How do I use it?" without the reader inspecting the implementation.

## Supported JSDoc Tags

`@async` (returns a Promise without the `async` keyword), `@readonly`, `@module` (top-level file comment), `@see`, `@callback`, `@property`, `@typedef`, `@param`, `@emits`, `@returns`, `@throws`, `@enum`, `@extends`, `@implements`, `@name`, `@public` (only where the surrounding class or module already uses explicit visibility tags), `@type`, `@default`, `@static` (static class members), `@example`, `@template` (generic type parameters), and inline `{@link Symbol}` (usually inside `@see`).

## Document the Contract

Call out observable behavior that a caller must preserve:

- mutation of arguments or instance state
- return values used for control flow, such as `false`, `null`, or `this`
- ordering requirements, one-shot consumption, immutability, or lifecycle timing
- defaults that affect security, protocol behavior, persistence, or caching

```javascript
/**
 * Attempts to handle an error using registered handlers in order.
 * @param {Error} error - Error to handle
 * @returns {ServerResponse|false} Response when handled, or false to continue the cascade
 */
function handleError(error) {}
```

- **Be specific** about object shapes, array contents, and union types. Use `@typedef` blocks for complex data structures.
- **Import external types by relative path**, but only when the file can be positively located; otherwise use the bare type name (`Logger`).
- **Document options inline with dotted `@param`s.** Do not introduce a `@typedef` just for an `options` argument.

```javascript
/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @param {Object} options - Context initialization options
 * @param {AppRuntime} options.runtime - Runtime configuration
 * @param {Logger} options.logger - Logger instance for application logging
 */
createContext(options) {}
```

## Module-Private Functions Get No JSDoc

JSDoc documents a module's public contract. Non-exported functions have no external callers, and a JSDoc block above one only drifts out of sync. When a private helper needs explanation, use a short inline comment where the reasoning lives; an obvious helper needs none.

```javascript
function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    // A null prototype (e.g. Object.create(null) dictionaries) also counts as
    // plain, alongside ordinary object literals.
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
```

Class members declared with `#private` syntax are covered under "Document Classes" below.

## Document Events

Use `@emits`, with a `@typedef` for the event object:

```javascript
/**
 * @typedef {Object} FileChangeEvent
 * @property {string} filepath - Absolute path to the changed file
 * @property {string} eventType - Type of change, either 'rename' or 'change'
 */

/**
 * Monitors a directory for file changes using glob patterns to filter events.
 * @extends EventEmitter
 * @emits FileWatcher#change - Emits a FileChangeEvent when a matching file changes
 * @emits FileWatcher#error - Emits a WrappedError when the underlying fs.watch fails
 */
export default class FileWatcher extends EventEmitter {}
```

## Document Classes

- Use `@name` on members defined via `Object.defineProperties()` or `Object.defineProperty()` to give them an explicit name.
- Do not add `@private`; `#private` syntax already communicates visibility. Keep any private-member docs to a brief description.
- Do not include a description in `constructor` JSDoc blocks. Only document `@param` tags and `@throws` when relevant.
