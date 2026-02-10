import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * The application Context provides access to common application components as a central registry
 * and injection container. You can think of the application Context as a global singleton which
 * is passed into your middleware, request handlers, and command handlers. This allows you to
 * have access to global services, configs, logging, and collections directly from your
 * application or plugin.
 *
 * @public
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
             * The top level Logger instance. Use it directly, or create a named child logger
             * with Logger#createChild(name)
             * @name logger
             * @readonly
             * @public
             * @type {Logger}
             */
            logger: { value: logger },
            /**
             * Application configuration manager containing namespaced environment-specific settings.
             * @name config
             * @readonly
             * @public
             * @type {Config}
             */
            config: { value: config },
            /**
             * AppRuntime configuration indicating whether the application is running as a CLI
             * command or server. This can be helpful to conditionally execute different
             * logic in your custom plugin based on the runtime being a server or
             * a command line invocation.
             * @name runtime
             * @readonly
             * @public
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
            /**
             * Path configuration providing directory paths for routes, templates, plugins, etc.
             * @name paths
             * @readonly
             * @public
             * @type {Paths}
             */
            paths: { value: paths },
        });
    }

    /**
     * Get Collection instances registered by the application or plugins.
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection}
     * @throws {AssertionError} When the collection has not been registered
     */
    getCollection(name) {
        if (!this.#collections.has(name)) {
            throw new AssertionError(
                `The collection "${ name }" is not registered`,
                null,
                this.getCollection
            );
        }
        return this.#collections.get(name);
    }

    /**
     * Get a service registered by the application or plugins.
     * @public
     * @param {string} name - Service identifier (e.g., 'kixx.Datastore')
     * @returns {Object} The registered service API
     * @throws {AssertionError} When the service has not been registered
     */
    getService(name) {
        if (!this.#services.has(name)) {
            throw new AssertionError(
                `The service "${ name }" is not registered`,
                null,
                this.getService
            );
        }
        return this.#services.get(name);
    }

    /**
     * Registers a service instance for later retrieval by other coponents. Services must be
     * registered during the [application initialization](./kixx-application-initialization)
     * process in your plugin file. Typically services should be registered in the app or
     * pluginl register() function and then initialized in the initialize() function.
     * @public
     * @param {string} name - Service identifier used for lookup via getService()
     * @param {Object} service - Service API to register
     * @throws {AssertionError} When name is not a non-empty string
     * @returns {Context} This context instance
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
        return this;
    }

    /**
     * Registers a Collection for later access from middleware and handlers. Since Collections
     * are automatically discovered during application initialization, there should be
     * no reason to manually register a Collection unless you are customizing the app or
     * plugin initialization process.
     * @public
     * @param {string} name - Collection identifier used for lookup via getCollection()
     * @param {Collection} collection
     * @throws {AssertionError} When name is not a non-empty string
     * @returns {Context} This context instance
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
        return this;
    }
}
