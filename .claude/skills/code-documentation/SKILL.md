---
name: code-documentation
description: Documentation conventions for JavaScript code in this project. JSDoc section covers tag ordering (@param, @returns, @throws, @typedef, @emits, @public, @see), when to skip JSDoc, class documentation patterns including @name with Object.defineProperties, and async/Promise documentation. Inline comments section covers explaining why not what, guide comments, state transitions, workarounds, and coordinated change warnings. Apply when writing, refactoring, or reviewing JavaScript code — especially when adding or updating any kind of comment.
---

This skill covers two distinct documentation layers:

- **JSDoc block comments** — the formal API contract: types, parameters, return values, errors, and events. Consumed by editors, documentation generators, and future readers of the public interface.
- **Inline comments** — the narrative layer explaining *why*, constraints, workarounds, and non-obvious decisions. Cannot be expressed by types or names alone.

JSDoc answers "what does this do and how do I call it?" Inline comments answer "why does it work this way?"

---

## JSDoc Block Comments

JSDoc blocks reduce cognitive load by answering three questions without reading the implementation: "What does this do?", "How do I use it?", and "What can go wrong?"

## Add Value Beyond the Name
Write concise descriptions that add value beyond the name of the thing you are documenting. Keeping it concise will help your documentation remain relevant longer too.

**Bad:**
```javascript
/**
 * This function takes a user ID parameter and returns user data
 */
function getUserById() {}
```

**Good:**
```javascript
/**
 * Retrieves user data from the database with role information populated
 */
function getUserById() {}
```

## Document the Contract, Not the Implementation
Focus on *what* your function does and *how* to use it, not *how* it works internally. Your JSDoc should serve as a contract between your code and its consumers.

```javascript
/**
 * Calculates the total price including tax and discounts
 * @param {number} basePrice - The original price before adjustments
 * @param {number} taxRate - Tax rate as a decimal (e.g., 0.08 for 8%)
 * @param {number} [discount=0] - Discount amount to subtract
 * @returns {number} The final price after tax and discount
 */
function calculateTotal(basePrice, taxRate, discount = 0) {
    // Implementation details don't belong in JSDoc
}
```

## Order Tags Consistently
Within a JSDoc block, always put the free-text description first. Follow it with tags in this order:

1. Description (free text, always first)
2. `@name` (when needed)
3. `@public`
4. `@async`
5. `@param`
6. `@returns`
7. `@throws`
8. `@emits`
9. `@type`
10. `@see`

When documenting callback or function-typed parameters, specify the full signature:

```javascript
/**
 * Watches for changes and invokes the handler when they occur.
 * @param {string} pattern - Glob pattern to match files
 * @param {function(Error, FileChangeEvent): void} handler - Called on each change or error
 * @returns {void}
 */
function watch(pattern, handler) {
}
```

## Specify Types Precisely
JavaScript development often involves complex data structures. Be specific about object shapes, array contents, and union types. Use `@typedef` blocks to document complex data structures:

```javascript
/**
 * @typedef {Object} UserProfile
 * @property {string} id - Unique user identifier
 * @property {string} email - User's email address
 * @property {string[]} roles - Array of role names
 * @property {function(String): Boolean} hasPermission - Check to see if the user has the given permission
 */

/**
 * @param {UserProfile|null} user - User object or null if not found
 * @returns {Promise<boolean>} True if user has admin privileges
 */
function userHasAdminPrivileges(user) {
}
```

Use the dotted `@param` notation for method options objects instead of a `@typedef`:

```javascript
/**
 * @param {Object} options - Context initialization options
 * @param {AppRuntime} options.runtime - Runtime configuration
 * @param {Config} options.config - Application configuration manager instance
 * @param {Logger} options.logger - Logger instance for application logging
 */
constructor({ runtime, config, logger }) {}
```

## Document Error Conditions and Edge Cases
Documentation for error conditions and edge cases is crucial for Node.js applications where error handling is paramount:

```javascript
/**
 * Reads and parses a JSON configuration file
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<Object>} Parsed configuration object
 * @throws {Error} When file doesn't exist or contains invalid JSON
 * @throws {TypeError} When filePath is not a string
 */
```

## Know When to Skip JSDoc
A well-named private function with obvious parameters sometimes needs no JSDoc at all. If the function is *not* public and the JSDoc would just restate the function name and parameter names, leave it out — the code is the documentation.

```javascript
// No JSDoc needed — the name and signature say it all
function isEven(n) {
    return n % 2 === 0;
}

class CustomNumber {
    // No JSDoc needed — private member with simple interface.
    #isEven(n) {
        return n % 2 === 0;
    }
}
```

## Document Async Behavior
In JavaScript, async patterns are everywhere. Be explicit about what your Promises resolve to. Use `Promise<void>` (not `Promise<undefined>`) for functions that don't resolve to a meaningful value.

If the `async` keyword is used, then the `@async` tag is redundant.

```javascript
/**
 * @param {string} userId
 * @returns {Promise<UserProfile|null>} Resolves to user profile or null if not found
 * @throws {DatabaseError} When database connection fails
 */
async function getUser(userId) {
}

/**
 * @async
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
```

## Document Events
Document events using the `@emits` tag (an alias for `@fires`). Use `@typedef` blocks to document event object structures instead of the `@event` tag:

```javascript
import { EventEmitter } from 'node:events';
import { WrappedError } from '../errors/mod.js';

/**
 * @typedef {Object} FileChangeEvent
 * @property {string} filepath - Absolute path to the changed file
 * @property {string} eventType - Type of change ('rename' or 'change')
 */

/**
 * Monitors a directory for file changes using glob patterns to filter events.
 * @extends EventEmitter
 * @emits FileWatcher#change - Emits a FileChangeEvent when a matching file changes
 * @emits FileWatcher#error - Emits a WrappedError when the underlying fs.watch fails
 */
export default class FileWatcher extends EventEmitter {
}
```

## Document Classes

- Use `@name` on members defined via `Object.defineProperties()` or `Object.defineProperty()` to give them an explicit name.
- Attempt to determine if a class member is part of the public Kixx framework API, and if so, mark it as `@public`.
- Do *not* add the `@private` tag to private members. JavaScript's `#private` syntax already communicates visibility.
- Sparse documentation is acceptable for private methods and members — a brief description is sufficient without full `@param`/`@returns`/`@throws` detail.
- Document events using `@emits` — see the Document Events section above.
- **Do not include a description for `constructor` JSDoc blocks.** It is self-evident that a constructor creates an instance of the class. Only document the `@param` tags (and `@throws` if relevant).

### Using @name with Object.defineProperties

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
        /**
         * Application configuration manager instance with environment-specific settings.
         * @name config
         * @type {Config}
         */
        config: { value: config },
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
     * @throws {TypeError} When rootUser has already been set (operation cannot be repeated)
     */
    setRootUser(user) {
        Object.defineProperty(this, 'rootUser', {
            value: user,
        });
    }
}
```

### Full class example

```javascript
/**
 * @typedef {Object} AppRuntime
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * Central registry and dependency injection container for application components.
 *
 * Provides access to registered services, collections, forms, views, and user roles
 * throughout the application lifecycle. Use the getter methods (getCollection, getView,
 * etc.) to retrieve registered instances by name. Components are registered during
 * application initialization and plugin loading.
 */
export default class Context {

    /**
     * Internal map of registered services
     * @type {Map}
     */
    #services = new Map();

    /**
     * Internal map of registered collections
     * @type {Map}
     */
    #collections = new Map();

    /**
     * The root user with permission to perform any operation in the app.
     * @name rootUser
     * @type {User}
     */

    /**
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Runtime configuration indicating whether the application
     *   is running as a CLI command or server
     * @param {Config} options.config - Application configuration manager instance with environment-specific settings
     * @param {Paths} options.paths - Path manager instance providing directory paths for routes, templates, plugins, etc.
     * @param {Logger} options.logger - Logger instance for application logging
     */
    constructor({ runtime, config, paths, logger }) {
        Object.defineProperties(this, {
            /**
             * Runtime configuration indicating whether the application is running as a CLI command or server.
             * @name runtime
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
            /**
             * Application configuration manager instance with environment-specific settings.
             * @name config
             * @type {Config}
             */
            config: { value: config },
            /**
             * Path manager instance providing directory paths for routes, templates, plugins, etc.
             * @name paths
             * @type {Paths}
             */
            paths: { value: paths },
            /**
             * Logger instance for application logging.
             * @name logger
             * @type {Logger}
             */
            logger: { value: logger },
        });
    }

    /**
     * Retrieves a registered collection instance by name.
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection} The registered collection instance
     * @throws {AssertionError} When the collection is not registered in the context
     */
    getCollection(name) {
    }

    /**
     * Sets the root user instance for the context, creating a read-only rootUser property.
     * @param {User} user - Root user instance with elevated privileges
     * @throws {TypeError} When rootUser has already been set (operation cannot be repeated)
     */
    setRootUser(user) {
        Object.defineProperty(this, 'rootUser', {
            value: user,
        });
    }

    /**
     * Registers a collection instance in the context registry for later retrieval.
     * @param {string} name - Collection identifier used for lookup via getCollection()
     * @param {Object} collection - Collection instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerCollection(name, collection) {
    }

    /**
     * Load a collection instance from the module at the given filepath.
     */
    #loadCollection(filepath) {
    }
}
```

## Use @see for Cross-References
Use `@see` to link related classes, methods, or documentation when understanding one piece of code requires context from another:

```javascript
/**
 * Validates and normalizes user input before persisting.
 * @param {UserProfile} profile - Raw user profile data
 * @returns {UserProfile} Normalized profile ready for storage
 * @see Context#registerCollection for how collections are registered
 * @see https://example.com/docs/validation for validation rules
 */
function normalizeProfile(profile) {
}
```

---

## Inline Code Comments

JSDoc describes the *what* and *how* at the public API level. Inline comments fill the gap by explaining *why* — intent, constraints, and context that the code itself cannot express.

## Explain the "Why," Not Just the "What"
Focus on documenting why some code exists, and why it is doing what it does rather than what it is doing. This is especially true when the code does something that seems counterintuitive or requires domain knowledge:

```javascript
// Increment DB counter BEFORE processing to ensure we don't
// get stuck on the same database if we hit the time limit
currentDb = (currentDb + 1) % totalDatabases;
const db = databases[currentDb];
await processExpiredKeys(db);
```

## Avoid Trivial Comments
Don't state what's obvious from the code:

```javascript
// Bad
user.name = 'John'; // Set the user name to John

// Good
user.name = sanitizeInput(rawName); // Remove potential XSS vectors
```

## Use Guide Comments to Break Up Complex Logic
Help readers follow the flow of complex functions:

```javascript
async function processPayment(order, paymentMethod) {
    // Validate payment details and customer eligibility
    await validatePaymentMethod(paymentMethod);
    await checkCustomerCredit(order.customerId);

    // Calculate final amounts including taxes and fees
    const taxAmount = calculateTax(order);
    const finalAmount = order.total + taxAmount + calculateFee(paymentMethod, order.total);

    // Process payment and update order status
    const transaction = await chargePayment(paymentMethod, finalAmount);
    await updateOrderStatus(order.id, 'paid', transaction.id);

    return transaction;
}
```

## Document State Transitions and Side Effects
Particularly important in Node.js applications with complex state management:

```javascript
// After this call, the connection state changes to 'authenticating'
// and subsequent messages will be queued until auth completes
await connection.startAuthentication(credentials);

// sendCommand will queue rather than send directly while authenticating
const result = await sendCommand('GET_STATUS');
```

## Use "Teacher Comments" for Domain Knowledge
When your code involves concepts that might be outside typical JavaScript/Node.js knowledge:

```javascript
// JWT exp claim uses NumericDate format (seconds since epoch)
// JavaScript Date.now() returns milliseconds, so we divide by 1000
const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24); // 24 hours
```

## Document Workarounds and Hacks
When you have to do something non-obvious due to external constraints:

```javascript
// Workaround: Some legacy clients send timestamps as strings
// TODO: Remove this once all clients upgrade to v2.0+
const timestamp = typeof data.timestamp === 'string'
    ? parseInt(data.timestamp, 10)
    : data.timestamp;
```

## Explain Performance or Memory Considerations
Especially important in Node.js applications:

```javascript
// Pre-allocate buffer to avoid multiple reallocations
// during high-frequency writes (saves ~40% memory churn)
const buffer = Buffer.allocUnsafe(expectedSize);

// Process in chunks to avoid blocking the event loop
for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await processChunk(chunk);

    // Yield control back to event loop between chunks
    await setImmediate();
}
```

## Flag Coordinated Change Points
When modifying one piece of code requires changes elsewhere:

```javascript
const EVENT_TYPES = {
    USER_LOGIN: 'user:login',
    USER_LOGOUT: 'user:logout',
    // WARNING: When adding event types here, also update:
    // - src/analytics/event-handlers.js
    // - tests/fixtures/events.json
    // - docs/api/events.md
};
```

**Priority order:** Prefer "why" comments over "what" comments. When both are obvious, don't comment at all.
