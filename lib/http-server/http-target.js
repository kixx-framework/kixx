import { AssertionError } from '../assertions/mod.js';
import { PathToRegexp } from '../vendor/mod.js';


/**
 * @callback MiddlewareFunction
 * @param {Object} context - Application context with services and configuration
 * @param {HttpServerRequest} request - Incoming HTTP request
 * @param {HttpServerResponse} response - HTTP response to populate
 * @param {Function} skip - Call to skip remaining middleware in the chain
 * @returns {Promise<HttpServerResponse>|HttpServerResponse} Updated response object
 */

/**
 * @callback ErrorHandlerFunction
 * @param {Object} context - Application context with services and configuration
 * @param {HttpServerRequest} request - Incoming HTTP request
 * @param {HttpServerResponse} response - HTTP response to populate
 * @param {Error} error - The error to handle
 * @returns {Promise<HttpServerResponse|false>|HttpServerResponse|false} Response if handled, false to pass to next handler
 */

/**
 * HTTP endpoint handler with chained middleware and cascading error handling.
 *
 * Targets are the leaf nodes in the routing hierarchy (Router -> VirtualHost -> Route -> Target).
 * Each target handles specific HTTP methods and executes a middleware chain to process requests.
 * Error handling cascades from target to route to router level, allowing specific error responses
 * at each layer.
 */
export default class HttpTarget {
    /**
     * The URL pathname pattern string from the parent route
     * @type {string|null}
     */
    #pattern = null;

    /**
     * Middleware functions executed in order for each request
     * @type {Array<MiddlewareFunction>}
     */
    #middleware = [];

    /**
     * Error handlers tried in order until one returns a response
     * @type {Array<ErrorHandlerFunction>}
     */
    #errorHandlers = [];

    /**
     * Creates an HTTP target with specified configuration
     * @param {Object} options - Target configuration
     * @param {string} options.name - Target identifier used for debugging and logging
     * @param {string} [options.pattern] - URL pathname pattern from the parent route (e.g., '/users/:id')
     * @param {Array<string>} options.allowedMethods - HTTP methods this target handles (e.g., ['GET', 'POST'])
     * @param {Array<string>} [options.tags=[]] - Tags for categorizing and filtering targets
     * @param {Array<MiddlewareFunction>} options.middleware - Middleware functions executed in order
     * @param {Array<ErrorHandlerFunction>} options.errorHandlers - Error handlers tried in order until one succeeds
     */
    constructor({ name, pattern, allowedMethods, tags, middleware, errorHandlers }) {
        this.#pattern = pattern || null;
        this.#middleware = middleware;
        this.#errorHandlers = errorHandlers;

        Object.defineProperties(this, {
            /**
             * @name name
             * Target identifier used for debugging and logging
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * @name allowedMethods
             * HTTP methods this target can handle, frozen to prevent modification
             * @type {ReadonlyArray<string>}
             */
            allowedMethods: {
                enumerable: true,
                value: Object.freeze(allowedMethods.slice()),
            },
            /**
             * @name tags
             * Tags for categorizing and filtering targets, frozen to prevent modification
             * @type {ReadonlyArray<string>}
             */
            tags: {
                enumerable: true,
                value: Object.freeze((tags || []).slice()),
            },
        });
    }

    /**
     * Checks if this target has the given tag
     * @param {string} tag - Tag name to check for
     * @returns {boolean} True if the tag is in the tags list
     */
    hasTag(tag) {
        return this.tags.includes(tag);
    }

    /**
     * Checks if this target handles the given HTTP method
     * @param {string} method - HTTP method name (e.g., 'GET', 'POST')
     * @returns {boolean} True if method is in the allowedMethods list
     */
    isMethodAllowed(method) {
        return this.allowedMethods.includes(method);
    }

    /**
     * Executes the middleware chain for this target
     *
     * Middleware functions are invoked sequentially. Each receives a `skip` callback
     * that, when called, stops the chain and returns the current response immediately.
     *
     * @async
     * @param {Object} context - Application context with services and configuration
     * @param {HttpServerRequest} request - Incoming HTTP request with resolved route parameters
     * @param {HttpServerResponse} response - HTTP response to populate
     * @returns {Promise<HttpServerResponse>} Response from the last executed middleware
     */
    async invokeMiddleware(context, request, response) {
        let newResponse;
        let done = false;

        function skip() {
            done = true;
        }

        // Execute middleware chain sequentially
        // Each middleware can call skip() to short-circuit the chain
        for (const func of this.#middleware) {
            // Sequential execution required to maintain middleware order
            // eslint-disable-next-line no-await-in-loop
            newResponse = await func(context, request, response, skip);

            if (done) {
                return newResponse;
            }
        }

        return newResponse;
    }

    /**
     * Attempts to handle an error using this target's error handlers
     *
     * Error handlers are tried in order until one returns a truthy response.
     * This is the first level in the error handling cascade (target -> route -> router).
     *
     * @async
     * @param {Object} context - Application context with services and configuration
     * @param {HttpServerRequest} request - Incoming HTTP request
     * @param {HttpServerResponse} response - HTTP response to populate
     * @param {Error} error - The error to handle
     * @returns {Promise<HttpServerResponse|false>} Response if handled, false to propagate to route-level handlers
     */
    async handleError(context, request, response, error) {
        // Try handlers in order until one successfully handles the error
        for (const func of this.#errorHandlers) {
            // Sequential execution required for error handler precedence
            // eslint-disable-next-line no-await-in-loop
            const newResponse = await func(context, request, response, error);

            if (newResponse) {
                // Handler successfully processed the error
                return newResponse;
            }
            // Falsy return means "I can't handle this, try next handler"
        }

        // No target-level handler could process this error
        // Propagate to route-level handlers
        return false;
    }

    /**
     * Reverse constructs the pathname and preferred HTTP method for this target.
     *
     * Takes pathname parameters and compiles them into a concrete pathname using
     * the route pattern, then selects the preferred HTTP method for this target.
     *
     * @param {Object} params - Pathname parameters to substitute into the pattern
     * @returns {{method: string, pathname: string}} The preferred method and compiled pathname
     * @throws {AssertionError} When target has no pattern set
     * @throws {AssertionError} When target uses wildcard pattern (cannot be reversed)
     */
    compilePathname(params) {
        if (!this.#pattern) {
            throw new AssertionError(
                'Cannot compile pathname for target without a route pattern'
            );
        }

        if (this.#pattern === '*') {
            throw new AssertionError(
                'Cannot compile pathname for wildcard route pattern'
            );
        }

        // Compile the pathname using path-to-regexp
        const compilePath = PathToRegexp.compile(this.#pattern);
        const pathname = compilePath(params || {});

        // Select the preferred HTTP method for this target
        // Priority order: GET (read) > POST (create/action) > PUT > PATCH > DELETE > HEAD > OPTIONS
        const methodPriority = [ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS' ];
        let method = this.allowedMethods[0];

        for (const preferredMethod of methodPriority) {
            if (this.allowedMethods.includes(preferredMethod)) {
                method = preferredMethod;
                break;
            }
        }

        return { method, pathname };
    }
}
