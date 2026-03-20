import { AssertionError } from '../assertions.js';

/**
 * Read-only view of application context for use within a single request.
 *
 * Provides access to logger, config, runtime, and registered services/collections
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
             * Platform-specific utility functions for common cross-cutting concerns such as
             * UUID generation. The shape is defined by the UUIDGenerator port so the same
             * application code works across Node.js, Cloudflare Workers, and other runtimes.
             * @name utils
             * @public
             * @type {import('../ports/uuid-generator.js').UUIDGenerator}
             */
            utils: { value: appContext.utils },
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
     * Returns a single HttpTarget by its fully-qualified name from the current VirtualHost
     *
     * Target names follow the pattern "RouteName/TargetName" where RouteName may be nested
     * (e.g., "Dashboard/Contexts/ViewContext" or "Home/View"). The method searches all routes
     * and returns the first matching target. If multiple targets have the same name, the first
     * match is returned.
     *
     * @public
     * @param {string} targetName - Fully-qualified target name (e.g., "Dashboard/Contexts/ViewContext")
     * @returns {import('../http-server/http-target.js').default} The matching HttpTarget instance
     * @throws {AssertionError} When the target is not found
     */
    getHttpTarget(targetName) {
        // Search all routes and their targets for a match
        for (const route of this.#routes) {
            for (const target of route.targets) {
                if (target.name === targetName) {
                    return target;
                }
            }
        }

        // Target not found in any route
        throw new AssertionError(
            `Target "${ targetName }" not found in current VirtualHost`,
            null,
            this.getHttpTarget
        );
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
