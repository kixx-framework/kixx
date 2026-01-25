## JSDoc Guidelines
Here are some examples and guidelines to follow for writing effective JSDoc comments in the Kixx project.

The key insight we've gained over the years is that good code documentation reduces the cognitive load for developers (including your future self). JSDoc blocks should answer the questions: "What does this do?", "How do I use it?", and "What can go wrong?"

## Examples
Some examples of good JSDoc comments for this project.

### Documenting a class

- When possible, write @typedef blocks to document complex data structures, but do not document method options objects using @typedef blocks.
- For method option objects, use the `@param {Object} options` and `@param {TYPE} options.param1 - description` notation to document the options properties.
- Attempt to determine if a class member is used as part of the public Kixx framework API, and if so, mark it as @public
- Do not add the @private tag to private members.
- Be sure to add JSDoc blocks to members defined by `Object.defineProperties()` and use the @name tag to explicitly provide a name.
- Be sure to add JSDoc blocks to members defined by `Object.defineProperty()` and use the @name tag to explicitly provide a name.

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
     * Internal map of registered forms
     * @type {Map}
     */
    #forms = new Map();

    /**
     * Internal map of registered views
     * @type {Map}
     */
    #views = new Map();

    /**
     * Internal map of registered user roles
     * @type {Map}
     */
    #userRoles = new Map();

    /**
     * @name rootUser
     * The root user with permission to perform any operation in the app.
     * @type {User}
     */

    /**
     * Creates a new application context instance with runtime configuration and core services.
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
     * @param  {string} filepath
     * @return {Collection}
     */
    #loadCollection(filepath) {
    }
}
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

## Be Precise with Types
JavaScript development often involves complex data structures. Be specific about object shapes, array contents, and union types. When possible, write @typedef blocks to document these structures:

```javascript
/**
 * @typedef {Object} UserProfile
 * @property {string} id - Unique user identifier
 * @property {string} email - User's email address
 * @property {string[]} roles - Array of role names
 * @property {Date} createdAt - Account creation timestamp
 */

/**
 * @param {UserProfile|null} user - User object or null if not found
 * @returns {Promise<boolean>} True if user has admin privileges
 */
function userHasAdminPrivileges(user) {
}
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

## Add value beyond the name of the thing you are documenting
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

## Document Async Behavior Clearly
In JavaScript, async patterns are everywhere. Mark async functions and methods with the @async tag and be explicit about what your Promises resolve to:

```javascript
/**
 * @async
 * @param {string} userId 
 * @returns {Promise<UserProfile|null>} Resolves to user profile or null if not found
 * @throws {DatabaseError} When database connection fails
 */
async function getUser(userId) {
}
```
