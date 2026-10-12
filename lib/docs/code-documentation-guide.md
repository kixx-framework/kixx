Code Documentation Guidelines
=============================

Our primary method of code documentation is JSDoc comments.

Code documentation should answer two questions without requiring the reader to inspect the implementation: "What does this do?" and "How do I use it?"

JSDoc block comments are the formal API contract: types, parameters, return values, errors, and events.

## Supported JSDoc Tags

- **@async**: mark a function or method as asynchronous when it returns a Promise but does not use the `async` keyword.
- **@readonly**: mark a symbol as readonly, meaning that it cannot be overwritten.
- **@module**: define a top-level file comment instead of documenting the subsequent symbol. A value can be specified to identify the module.
- **@see**: define an external reference related to the symbol.
- **@callback**: define a callback.
- **@property**: define a property on a symbol.
- **@typedef**: define a type.
- **@param**: define a parameter on a function.
- **@emits**: denote an event which an object or class emits.
- **@returns**: define the return type and/or comment of a function.
- **@throws**: define what a function throws when called.
- **@enum**: define an object to be an enum.
- **@extends**: define a type that a function extends.
- **@implements**: define an interface or type that a class or object implements.
- **@name**: explicitly define the name of a symbol which may otherwise be difficult to discern.
- **@public**: mark public members when a surrounding class or module already uses explicit visibility tags.
- **@type**: define the type of a symbol.
- **@default**: define the default value for a variable, property, or field.


## Document the Contract

Call out observable behavior that a caller must preserve:

- mutation of arguments or instance state
- return values used for control flow, such as `false`, `null`, or `this`
- ordering requirements, one-shot consumption, immutability, or lifecycle timing
- defaults that affect security, protocol behavior, persistence, or caching

```javascript
/**
 * Calculates the total price including tax and discounts.
 * @param {number} basePrice - The original price before adjustments
 * @param {number} taxRate - Tax rate as a decimal, such as 0.08 for 8%
 * @param {number} [discount=0] - Discount amount to subtract
 * @returns {number} The final price after tax and discount
 */
function calculateTotal(basePrice, taxRate, discount = 0) {}
```

For chainable methods, mutating methods, and cascade-style handlers, make the return contract explicit:

```javascript
/**
 * Attempts to handle an error using registered handlers in order.
 * @param {Error} error - Error to handle
 * @returns {ServerResponse|false} Response when handled, or false to continue the cascade
 */
function handleError(error) {}
```

Be specific about object shapes, array contents, and union types. Use `@typedef` blocks for complex data structures:

```javascript
/**
 * @typedef {Object} UserProfile
 * @property {string} id - Unique user identifier
 * @property {string} email - User's email address
 * @property {string[]} roles - Array of role names
 */

/**
 * @param {string} id - The UUID for the user
 * @returns {UserProfile} The full UserProfile object
 */
function getUser(id) {}
```

Show the relative JSDoc import path to external type definitions when they exist:

```javascript
/**
 * @typedef {import('../config/config.js').default} Config
 */
```

Only include an import path like `import('../config/config.js').default` when the file path can be positively located. If the file path cannot be verified, use only the type name, such as `Config`.

Use dotted `@param` notation for function and method arguments/options. Do not introduce a `@typedef` just to describe an `options` argument shape; document it inline with dotted params instead:

```javascript
/**
 * @param {Object} options - Context initialization options
 * @param {AppRuntime} options.runtime - Runtime configuration
 * @param {Config} options.config - Application configuration manager instance
 * @param {Logger} options.logger - Logger instance for application logging
 */
createContext({ runtime, config, logger }) {}
```

**Do Not Use JSDoc for Module-Private Functions**

JSDoc documents a module's public contract — the exported functions, classes, and types that other modules call. Functions that are private to a module (those that are not exported) do not get JSDoc block comments. They have no external callers, and a JSDoc block above an internal helper only adds ceremony that drifts out of sync with the code.

When a private helper needs explanation — a non-obvious decision, a constraint, or a surprising return value — use a short inline comment instead. Place it where the reasoning lives, not as a header block.

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

A well-named helper whose behavior is obvious from its name and body needs neither JSDoc nor an inline comment:

```javascript
function isEven(n) {
    return n % 2 === 0;
}
```

This rule is about module-private *functions*. Class members declared with `#private` syntax are covered separately under "Document Classes" below.

## Document Events

Document events using the `@emits` tag. Use `@typedef` blocks to document event object structures:

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
- Do not add the `@private` tag to private members; JavaScript's `#private` syntax already communicates visibility.
- Keep documentation sparse for private methods and members. A brief description is sufficient when documentation is needed.
- Do not include a description for `constructor` JSDoc blocks. Only document `@param` tags and `@throws` when relevant.
