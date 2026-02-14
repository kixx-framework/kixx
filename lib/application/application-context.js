import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';
import RequestContext from './request-context.js';

/**
 * Central registry and dependency injection container for application components.
 *
 * Provides access to registered services and collections throughout the application
 * lifecycle. Passed into middleware, request handlers, and command handlers to give
 * them access to configuration, logging, and data models.
 *
 * @public
 * @see Application~AppRuntime for the runtime configuration type definition
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
     * Creates an application context with runtime configuration and core services
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Runtime mode (CLI command or server)
     * @param {Config} options.config - Configuration manager with environment-specific settings
     * @param {Paths} options.paths - Path manager for routes, templates, plugins, etc.
     * @param {Logger} options.logger - Application logger instance
     */
    constructor({ runtime, config, paths, logger }) {
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
            /**
             * Path manager providing directory paths for routes, templates, plugins, etc.
             * @name paths
             * @public
             * @type {Paths}
             */
            paths: { value: paths },
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
     * Creates a read-only RequestContext for use within a single request
     *
     * The returned RequestContext provides access to logger, config, runtime, paths,
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
