# Code Documentation Guide

JSDoc block comments are the formal API contract: types, parameters, return values, errors, and events. They are consumed by editors, documentation generators, and future readers of the public interface.

Use JSDoc to answer "what does this do and how do I call it?"

Use JSDoc blocks to reduce cognitive load by answering two questions without requiring the reader to inspect the implementation: "What does this do?" and "How do I use it?"

## Supported JSDoc Tags

Use these tags when they accurately describe the documented symbol:

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

## Add Value Beyond the Name

Write concise descriptions that add information the symbol name does not already provide. Concision helps documentation remain accurate longer.

Good:

```javascript
/**
 * Retrieves user data from the database with role information populated.
 */
function getUserById() {}
```

Bad:

```javascript
/**
 * This function takes a user ID parameter and returns user data.
 */
function getUserById() {}
```

## Document the Contract

Document what the function does and how callers use it. Do not describe internal implementation details unless they are part of the public contract.

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

## Specify Types Precisely

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

## Document Error Conditions and Edge Cases

Use `@throws` for meaningful caller-visible failure modes.

```javascript
/**
 * Reads and parses a JSON configuration file.
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<Object>} Parsed configuration object
 * @throws {Error} When the file does not exist or contains invalid JSON
 * @throws {TypeError} When filePath is not a string
 */
```

Prefer the error class that callers can reasonably catch or that the framework
will translate. Do not document every assertion in a deeply private helper
unless it changes how the public API is used.

## Do Not Use JSDoc for Module-Private Functions

JSDoc documents a module's public contract — the exported functions, classes, and types that other modules call. Functions that are private to a module (those that are not exported) must not have JSDoc block comments. They have no external callers, and a JSDoc block above an internal helper only adds ceremony that drifts out of sync with the code.

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

## Document Async Behavior

Be explicit about what Promises resolve to. Use `Promise<void>`, not `Promise<undefined>`, for functions that do not resolve to a meaningful value.

Use `@async` on methods and functions that return a Promise but do not use the `async` keyword. If the `async` keyword is present, omit `@async` because it is redundant.

```javascript
/**
 * @async
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * @param {string} userId
 * @returns {Promise<UserProfile|null>} Resolves to user profile or null if not found
 * @throws {DatabaseError} When database connection fails
 */
async function getUser(userId) {}
```

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

## Document Interfaces and Invariants

For interface modules or adapter contracts, use a short top-level block to state invariants that implementations must preserve. Keep this to stable requirements such as immutability, platform-provided objects, body-consumption rules, error translation, or request/response lifecycle timing. Then use a `@typedef` or class JSDoc block for the concrete property and method types.

## Document Classes

- Use `@name` on members defined via `Object.defineProperties()` or `Object.defineProperty()` to give them an explicit name.
- Do not add the `@private` tag to private members; JavaScript's `#private` syntax already communicates visibility.
- Keep documentation sparse for private methods and members. A brief description is sufficient when documentation is needed.
- Do not include a description for `constructor` JSDoc blocks. Only document `@param` tags and `@throws` when relevant.

## Use @name with Object.defineProperties

When properties are defined via `Object.defineProperties()` or `Object.defineProperty()`, add a JSDoc block with `@name` so the property is discoverable. Put the description first, then `@name`, then `@type`:

```javascript
constructor({ runtime, config, paths, logger }) {
    Object.defineProperties(this, {
        /**
         * Runtime configuration indicating whether the application is running as a CLI command or server.
         * @name runtime
         * @type {AppRuntime}
         */
        runtime: { value: runtime },
    });
}
```

For properties created dynamically by a setter method, place a standalone JSDoc block near the top of the class:

```javascript
export default class Context {

    /**
     * The root user with permission to perform any operation in the app.
     * @name rootUser
     * @type {User}
     */

    /**
     * Sets the root user instance for the context, creating a read-only rootUser property.
     * @param {User} user - Root user instance with elevated privileges
     * @throws {TypeError} When rootUser has already been set
     */
    setRootUser(user) {
        Object.defineProperty(this, 'rootUser', { value: user });
    }
}
```

## Use @see for Cross-References

Use `@see` when another symbol materially helps the reader understand the contract or expected usage.

```javascript
/**
 * Validates and normalizes user input before persisting.
 * @param {UserProfile} profile - Raw user profile data
 * @returns {UserProfile} Normalized profile ready for storage
 * @see import('../context/application-context.js').default#registerCollection for how collections are registered
 */
function normalizeProfile(profile) {}
```
