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
        // Use a Set to ensure uniqueness (de-duplicate).
        const allowedMethods = new Set();

        for (const target of this.#targets) {
            for (const method of target.allowedMethods) {
                allowedMethods.add(method);
            }
        }

        // Return an Array.
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
        for (const func of this.#errorHandlers) {
            // eslint-disable-next-line no-await-in-loop
            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                return newResponse;
            }
        }

        return false;
    }
}
