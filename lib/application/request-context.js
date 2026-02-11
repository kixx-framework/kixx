/**
 * Read-only view of application context for use within a single request.
 *
 * Provides access to logger, config, runtime, paths, and registered services/collections
 * without exposing registration methods. Prevents request handlers and middleware from
 * mutating the application's service or collection registry.
 *
 * @public
 */
export default class RequestContext {

    /**
     * Application context instance for delegating read operations
     * @type {import('./application-context.js').default}
     */
    #appContext;

    /**
     * Creates a read-only request context wrapping an application context
     * @param {import('./application-context.js').default} appContext - Application context to wrap as read-only
     */
    constructor(appContext) {
        this.#appContext = appContext;

        // Expose read-only properties from the application context
        // These cannot be modified by request handlers or middleware
        Object.defineProperties(this, {
            /**
             * @name logger
             * Application logger instance. Use directly or create child loggers with createChild(name)
             * @public
             * @type {Logger}
             */
            logger: { value: appContext.logger },
            /**
             * @name config
             * Configuration manager containing namespaced environment-specific settings
             * @public
             * @type {Config}
             */
            config: { value: appContext.config },
            /**
             * @name runtime
             * Runtime mode indicating CLI command or server execution
             * @public
             * @type {AppRuntime}
             */
            runtime: { value: appContext.runtime },
            /**
             * @name paths
             * Path manager providing directory paths for routes, templates, plugins, etc.
             * @public
             * @type {Paths}
             */
            paths: { value: appContext.paths },
        });
    }

    /**
     * Retrieves a registered collection instance by identifier
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection} The registered collection instance
     * @throws {AssertionError} When the collection is not registered
     */
    getCollection(name) {
        // Delegate to wrapped application context
        return this.#appContext.getCollection(name);
    }

    /**
     * Retrieves a registered service instance by identifier
     * @public
     * @param {string} name - Service identifier (e.g., 'kixx.Datastore')
     * @returns {Object} The registered service instance
     * @throws {AssertionError} When the service is not registered
     */
    getService(name) {
        // Delegate to wrapped application context
        return this.#appContext.getService(name);
    }
}
