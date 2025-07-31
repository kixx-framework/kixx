/**
 * Represents a single HTTP route, containing pattern matching logic,
 * associated targets (handlers), and error handlers.
 *
 * @class
 * @classdesc
 * The HttpRoute class encapsulates the logic for matching a URL pathname
 * against a pattern, determining which HTTP methods are allowed, finding
 * the appropriate target handler for a request, and handling errors at the
 * route level.
 */
export default class HttpRoute {
    /**
     * @type {Array}
     * @private
     * @description
     * List of HttpTarget instances associated with this route.
     */
    #targets = [];

    /**
     * @type {Function}
     * @private
     * @description
     * Function used to match a pathname and extract parameters.
     */
    #matchPattern = null;

    /**
     * @type {Array<Function>}
     * @private
     * @description
     * List of error handler functions for this route.
     */
    #errorHandlers = [];

    /**
     * Constructs a new HttpRoute instance.
     *
     * @param {Object} options
     * @param {string} options.name - The name of the route.
     * @param {Function} options.patternMatcher - Function that matches a pathname and returns match result.
     * @param {Array} options.targets - Array of HttpTarget instances for this route.
     * @param {Array<Function>} options.errorHandlers - Array of error handler functions.
     */
    constructor({ name, patternMatcher, targets, errorHandlers }) {
        this.#matchPattern = patternMatcher;
        this.#targets = targets;
        this.#errorHandlers = errorHandlers;

        // Make route name immutable to prevent accidental modification
        // that could break route lookup in parent collections
        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
        });
    }

    /**
     * Returns an array of unique HTTP methods allowed by this route.
     * Iterates through all child HttpTarget instances and collects their allowed methods.
     *
     * @returns {Array<string>} Array of allowed HTTP methods (e.g., ['GET', 'POST']).
     */
    get allowedMethods() {
        // Use Set for automatic de-duplication since multiple targets
        // might handle the same HTTP method (e.g., different middleware chains)
        const allowedMethods = new Set();

        // Aggregate methods from all targets - a route supports a method
        // if ANY of its targets can handle it
        for (const target of this.#targets) {
            for (const method of target.allowedMethods) {
                allowedMethods.add(method);
            }
        }

        // Convert back to Array for consistent API with other collections
        return Array.from(allowedMethods);
    }

    /**
     * Attempts to match the provided URL pathname against this route's pattern.
     * If a match is found, returns the extracted parameters; otherwise, returns null.
     *
     * @param {string} pathname - The URL pathname to match.
     * @returns {Object|null} The extracted parameters if matched, or null.
     */
    matchPathname(pathname) {
        const res = this.#matchPattern(pathname);

        if (res) {
            // Pattern matcher returns { params, ...otherData } but we only
            // expose params to maintain abstraction - consumers don't need
            // to know about the internal matching implementation details
            return res.params;
        }

        return null;
    }

    /**
     * Finds the first HttpTarget associated with this route that allows the HTTP method of the request.
     *
     * @param {HttpRequest} request - The HTTP request object.
     * @returns {Object|null} The matching HttpTarget instance, or null if none found.
     */
    findTargetForRequest(request) {
        const { method } = request;

        // Return first matching target - order matters here as targets
        // are expected to be sorted by specificity during route construction
        // (e.g., authenticated endpoints before public ones)
        for (const target of this.#targets) {
            if (target.isMethodAllowed(method)) {
                return target;
            }
        }

        return null;
    }

    /**
     * Handles an error at the route level by invoking each error handler in order.
     * Returns the first non-falsy response returned by a handler, or false if none handle the error.
     *
     * @param {ApplicationContext} context - The application context.
     * @param {HttpRequest} request - The HTTP request object.
     * @param {HttpResponse} response - The HTTP response object.
     * @param {Error} error - The error to handle.
     * @returns {HttpResponse|boolean} The new response if handled, or false.
     */
    async handleError(context, request, response, error) {
        // Try error handlers in order until one successfully handles the error
        // This allows for cascading error handling strategies (specific to generic)
        for (const func of this.#errorHandlers) {
            // Sequential execution required - handlers may modify shared state
            // or expect previous handlers to have completed
            // eslint-disable-next-line no-await-in-loop
            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                // Handler successfully processed the error by returning a response
                // Stop processing and let this handler's response take precedence
                return newResponse;
            }
            // Falsy return means "I can't handle this error, try next handler"
        }

        // No handler could process this error - propagate to parent error handling
        return false;
    }
}
