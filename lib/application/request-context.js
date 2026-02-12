import { AssertionError } from '../assertions/mod.js';

/**
 * Read-only view of application context for use within a single request.
 *
 * Provides access to logger, config, runtime, paths, and registered services/collections
 * without exposing registration methods. Prevents request handlers and middleware from
 * mutating the application's service or collection registry.
 *
 * Also provides access to HTTP routes and targets from the matched VirtualHost,
 * enabling middleware to discover and interact with other endpoints.
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
     * Routes from the matched VirtualHost for this request
     * @type {Array<import('../http-server/http-route.js').default>}
     */
    #routes;

    /**
     * Creates a read-only request context wrapping an application context
     * @param {import('./application-context.js').default} appContext - Application context to wrap as read-only
     * @param {Array<import('../http-server/http-route.js').default>} routes - Routes from the matched VirtualHost
     */
    constructor(appContext, routes) {
        this.#appContext = appContext;
        this.#routes = routes || [];

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

    /**
     * Returns all HttpTarget instances from all routes in the current VirtualHost
     *
     * Useful for discovering available endpoints, generating navigation menus,
     * or creating sitemaps.
     *
     * @public
     * @returns {Array<import('../http-server/http-target.js').default>} All targets from all routes
     */
    getAllHttpTargets() {
        const targets = [];

        for (const route of this.#routes) {
            for (const target of route.targets) {
                targets.push(target);
            }
        }

        return targets;
    }

    /**
     * Returns a single HttpTarget by name from a named route in the current VirtualHost
     *
     * Target names follow the pattern "VirtualHostName:RouteName:MethodList" where MethodList
     * is the HTTP methods joined by colons (e.g., "Main:/users/:id:GET:HEAD").
     *
     * @public
     * @param {string} routeName - Name of the route containing the target
     * @param {string} targetName - Name of the target to retrieve
     * @returns {import('../http-server/http-target.js').default} The matching HttpTarget instance
     * @throws {AssertionError} When the route is not found
     * @throws {AssertionError} When the target is not found on the route
     */
    getHttpTarget(routeName, targetName) {
        const route = this.#routes.find((r) => r.name === routeName);

        if (!route) {
            throw new AssertionError(
                `Route "${ routeName }" not found in current VirtualHost`,
                null,
                this.getHttpTarget
            );
        }

        const target = route.targets.find((t) => t.name === targetName);

        if (!target) {
            throw new AssertionError(
                `Target "${ targetName }" not found on route "${ routeName }"`,
                null,
                this.getHttpTarget
            );
        }

        return target;
    }

    /**
     * Returns a filtered list of HttpTarget instances which include the given tag
     *
     * Useful for finding groups of related endpoints, such as all public endpoints,
     * all API endpoints, or all endpoints that require authentication.
     *
     * @public
     * @param {string} tag - Tag to filter targets by
     * @returns {Array<import('../http-server/http-target.js').default>} Targets that have the specified tag (empty array if none match)
     */
    getHttpTargetsByTag(tag) {
        const targets = [];

        for (const route of this.#routes) {
            for (const target of route.targets) {
                if (target.hasTag(tag)) {
                    targets.push(target);
                }
            }
        }

        return targets;
    }
}
