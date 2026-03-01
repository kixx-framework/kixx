import { AssertionError, assertNonEmptyString, assertFunction } from '../assertions.js';
import RequestContext from './request-context.js';


/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */


/**
 * Central registry and dependency injection container for application components.
 *
 * Provides access to registered services and collections throughout the application
 * lifecycle. Passed into middleware, request handlers, and command handlers to give
 * them access to configuration, logging, and data models.
 *
 * @public
 */
export default class ApplicationContext {

    /**
     * Map of registered services keyed by identifier
     * @type {Map<string, Object>}
     */
    #services = new Map();

    /**
     * Map of registered collections keyed by identifier
     * @type {Map<string, Collection>}
     */
    #collections = new Map();

    /**
     * Map of registered middleware functions keyed by identifier
     * @public
     * @type {Map<string, Function>}
     */
    middleware = new Map();

    /**
     * Map of registered request handler functions keyed by identifier
     * @public
     * @type {Map<string, Function>}
     */
    requestHandlers = new Map();

    /**
     * Map of registered error handler functions keyed by identifier
     * @public
     * @type {Map<string, Function>}
     */
    errorHandlers = new Map();

    /**
     * Creates an application context with runtime configuration and core services
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Runtime mode (CLI command or server)
     * @param {Config} options.config - Configuration manager with environment-specific settings
     * @param {Logger} options.logger - Application logger instance
     */
    constructor({ runtime, config, logger }) {
        Object.defineProperties(this, {
            /**
             * Application logger instance. Use directly or create child loggers with createChild(name)
             * @name logger
             * @public
             * @type {Logger}
             */
            logger: { value: logger },
            /**
             * Configuration manager containing namespaced environment-specific settings
             * @name config
             * @public
             * @type {Config}
             */
            config: { value: config },
            /**
             * Runtime mode indicating CLI command or server execution
             * @name runtime
             * @public
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
        });
    }

    /**
     * Retrieves a registered collection instance by identifier
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection} The registered collection instance
     * @throws {AssertionError} When the collection is not registered in the context
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
     * Retrieves a registered service instance by identifier
     * @public
     * @param {string} name - Service identifier (e.g., 'kixx.Datastore')
     * @returns {Object} The registered service instance
     * @throws {AssertionError} When the service is not registered in the context
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
     * Registers a service instance for later retrieval via getService()
     *
     * Services must be registered during application initialization in plugin files.
     * Typically registered in the plugin's register() function and initialized in initialize().
     *
     * @public
     * @param {string} name - Service identifier for lookup (e.g., 'myapp.EmailService')
     * @param {Object} service - Service instance to register
     * @throws {AssertionError} When name is not a non-empty string
     * @returns {ApplicationContext} This context instance for method chaining
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
        return this;
    }

    /**
     * Registers a collection instance for later retrieval via getCollection()
     *
     * Collections are automatically discovered during initialization, so manual registration
     * is only needed when customizing the app or plugin initialization process.
     *
     * @public
     * @param {string} name - Collection identifier for lookup (e.g., 'app.User')
     * @param {Collection} collection - Collection instance to register
     * @throws {AssertionError} When name is not a non-empty string
     * @returns {ApplicationContext} This context instance for method chaining
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
        return this;
    }

    /**
     * Registers a middleware function for use by the HttpRouter.
     *
     * @public
     * @param {string} name - Middleware identifier for lookup (e.g., 'myapp.AuthMiddleware')
     * @param {Function} fn - Middleware function to register
     * @throws {AssertionError} When name is not a non-empty string or fn is not a function
     * @returns {ApplicationContext} This context instance for method chaining
     */
    registerMiddleware(name, fn) {
        assertNonEmptyString(name, 'Middleware name must be a non-empty string');
        assertFunction(fn, 'Middleware must be a function');
        this.middleware.set(name, fn);
        return this;
    }

    /**
     * Registers a request handler function for use by the HttpRouter.
     *
     * @public
     * @param {string} name - Request handler identifier for lookup (e.g., 'myapp.UserHandler')
     * @param {Function} fn - Request handler function to register
     * @throws {AssertionError} When name is not a non-empty string or fn is not a function
     * @returns {ApplicationContext} This context instance for method chaining
     */
    registerRequestHandler(name, fn) {
        assertNonEmptyString(name, 'Request handler name must be a non-empty string');
        assertFunction(fn, 'Request handler must be a function');
        this.requestHandlers.set(name, fn);
        return this;
    }

    /**
     * Registers an error handler function for use by the HttpRouter.
     *
     * @public
     * @param {string} name - Error handler identifier for lookup (e.g., 'myapp.NotFoundHandler')
     * @param {Function} fn - Error handler function to register
     * @throws {AssertionError} When name is not a non-empty string or fn is not a function
     * @returns {ApplicationContext} This context instance for method chaining
     */
    registerErrorHandler(name, fn) {
        assertNonEmptyString(name, 'Error handler name must be a non-empty string');
        assertFunction(fn, 'Error handler must be a function');
        this.errorHandlers.set(name, fn);
        return this;
    }

    /**
     * Creates a read-only RequestContext for use within a single request
     *
     * The returned RequestContext provides access to logger, config, runtime,
     * and registered services/collections without exposing registration methods.
     *
     * @public
     * @param {Array<HttpRoute>} routes - Routes from the matched VirtualHost for this request
     * @returns {RequestContext} A new read-only request context wrapping this application context
     */
    cloneToRequestContext(routes) {
        return new RequestContext(this, routes);
    }
}
