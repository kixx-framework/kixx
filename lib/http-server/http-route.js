import { PathToRegexp } from '../vendor/mod.js';


/**
 * Pattern-based pathname routing with middleware targets and error handling.
 *
 * Routes sit between VirtualHost and HttpTarget in the routing hierarchy
 * (Router -> VirtualHost -> Route -> Target). Each route matches URL pathnames
 * using patterns and delegates to targets based on HTTP method. Provides
 * route-level error handling that cascades between target and router levels.
 */
export default class HttpRoute {

    /**
     * Pattern matcher function that extracts URL parameters from pathname
     * @type {Function}
     */
    #matchPattern = null;

    /**
     * Error handlers tried in order until one returns a response
     * @type {Array<Function>}
     */
    #errorHandlers = [];

    /**
     * Creates an HTTP route with pattern matching and targets
     * @param {Object} options - Route configuration
     * @param {string} options.name - Route identifier for debugging and logging
     * @param {string} options.pattern - URL pathname pattern (e.g., '/users/:id') or '*' for catch-all
     * @param {Array<HttpTarget>} options.targets - Targets that handle requests matching this route
     * @param {Array<Function>} options.errorHandlers - Error handlers tried in order until one succeeds
     */
    constructor({ name, pattern, targets, errorHandlers }) {
        this.#errorHandlers = errorHandlers;

        if (pattern === '*') {
            // Wildcard matches everything without regex overhead
            // Simple function returns empty params object for all pathnames
            this.#matchPattern = function match() {
                return { params: {} };
            };
        } else {
            this.#matchPattern = PathToRegexp.match(pattern);
        }

        Object.defineProperties(this, {
            /**
             * Route identifier for debugging and logging
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * Targets that handle requests matching this route
             * @name targets
             * @type {Array<HttpTarget>}
             */
            targets: {
                enumerable: true,
                value: targets,
            },
        });
    }

    /**
     * Aggregates unique HTTP methods supported by all targets on this route
     * @returns {Array<string>} Unique HTTP methods (e.g., ['GET', 'POST'])
     */
    get allowedMethods() {
        const allowedMethods = new Set();

        // Collect methods from all targets
        // A route supports a method if ANY target can handle it
        for (const target of this.targets) {
            for (const method of target.allowedMethods) {
                allowedMethods.add(method);
            }
        }

        return Array.from(allowedMethods);
    }

    /**
     * Tests if a pathname matches this route's pattern and extracts parameters
     * @param {string} pathname - URL pathname to match against route pattern
     * @returns {Object|null} Extracted URL parameters if matched, null otherwise
     */
    matchPathname(pathname) {
        const res = this.#matchPattern(pathname);

        if (res) {
            // Only expose params to maintain abstraction
            // Internal matcher details stay hidden from consumers
            return res.params;
        }

        return null;
    }

    /**
     * Finds the first target that handles the request's HTTP method
     * @param {HttpServerRequest} request - HTTP request with method property
     * @returns {HttpTarget|null} Matching target or null if no target handles this method
     */
    findTargetForRequest(request) {
        const { method } = request;

        // First match wins - target order matters
        // Targets should be ordered by specificity (authenticated before public)
        for (const target of this.targets) {
            if (target.isMethodAllowed(method)) {
                return target;
            }
        }

        return null;
    }

    /**
     * Attempts to handle an error using route-level error handlers
     *
     * Error handlers are tried in order until one returns a truthy response.
     * This is the second level in the error handling cascade (target -> route -> router).
     *
     * @async
     * @param {Object} context - Application context with services and configuration
     * @param {HttpServerRequest} request - HTTP request that triggered the error
     * @param {HttpServerResponse} response - HTTP response to populate
     * @param {Error} error - The error to handle
     * @returns {Promise<HttpServerResponse|false>} Response if handled, false to propagate to router-level handlers
     */
    async handleError(context, request, response, error) {
        // Try handlers in order until one successfully handles the error
        // Allows cascading error handling strategies (specific to generic)
        for (const func of this.#errorHandlers) {
            // Sequential execution required - handlers may depend on previous ones

            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                // Handler successfully processed the error
                // Stop cascade and return this response
                return newResponse;
            }
            // Falsy return means "I can't handle this, try next handler"
        }

        // No handler could process this error - propagate to router level
        return false;
    }

}
