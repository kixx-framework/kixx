/**
 * Represents a single HTTP target (handler) for a route, including its allowed HTTP methods,
 * middleware stack, and error handlers.
 *
 * @class
 * @classdesc
 * The HttpTarget class encapsulates the logic for handling a specific HTTP endpoint,
 * including which HTTP methods are allowed, the middleware functions to execute,
 * and error handling for this target.
 */
export default class HttpTarget {
    /**
     * @type {Array<Function>}
     * @private
     * @description
     * List of middleware functions to be executed for this target.
     */
    #middleware = [];

    /**
     * @type {Array<Function>}
     * @private
     * @description
     * List of error handler functions for this target.
     */
    #errorHandlers = [];

    /**
     * Constructs a new HttpTarget instance.
     *
     * @param {Object} options
     * @param {string} options.name - The name of the target.
     * @param {Array<string>} options.allowedMethods - Array of allowed HTTP methods for this target.
     * @param {Array<Function>} options.middleware - Array of middleware functions.
     * @param {Array<Function>} options.errorHandlers - Array of error handler functions.
     */
    constructor({ name, allowedMethods, middleware, errorHandlers }) {
        this.#middleware = middleware;
        this.#errorHandlers = errorHandlers;

        Object.defineProperties(this, {
            /**
             * The name of this target.
             * @memberof HttpTarget#
             * @type {string}
             * @readonly
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * The list of allowed HTTP methods for this target.
             * @memberof HttpTarget#
             * @type {ReadonlyArray<string>}
             * @readonly
             */
            allowedMethods: {
                enumerable: true,
                // Make a copy of the original Array before freezing it.
                value: Object.freeze(allowedMethods.slice()),
            },
        });
    }

    /**
     * Checks if the given HTTP method is allowed for this target.
     *
     * @param  {string} method - HTTP method name (e.g., 'GET', 'POST').
     * @return {boolean} True if the method is allowed, false otherwise.
     */
    isMethodAllowed(method) {
        return this.allowedMethods.includes(method);
    }

    /**
     * Invokes the middleware stack for this target with the given context, request, and response.
     * Middleware functions are executed in series and may short-circuit the chain by calling the `skip` callback.
     *
     * Each middleware function is awaited, allowing for asynchronous operations.
     *
     * @param  {ApplicationContext} context - The application context.
     * @param  {HttpRequest} request - The HTTP request object.
     * @param  {HttpResponse} response - The HTTP response object.
     * @return {Promise<HttpResponse>} The (possibly modified) response object.
     */
    async invokeMiddleware(context, request, response) {
        let newResponse;
        let done = false;

        /**
         * Short-circuit callback to exit the middleware loop early.
         */
        function skip() {
            done = true;
        }

        for (const func of this.#middleware) {
            // Middleware needs to be run in serial, so we use await in a loop
            // eslint-disable-next-line no-await-in-loop
            newResponse = await func(context, request, response, skip);

            // If the short circuit callback was called then stop
            // here and return the response.
            if (done) {
                return newResponse;
            }
        }

        return newResponse;
    }

    /**
     * Handles an error for this target by invoking each error handler in order until one returns a truthy value.
     * Error handlers are expected to execute synchronously.
     *
     * @param  {ApplicationContext} context - The application context.
     * @param  {HttpRequest} request - The HTTP request object.
     * @param  {HttpResponse} response - The HTTP response object.
     * @param  {Error} error - The error to handle.
     * @return {HttpResponse|boolean} The response returned by an error handler, or false if none handled the error.
     */
    handleError(context, request, response, error) {
        for (const func of this.#errorHandlers) {
            const newResponse = func(context, request, response, error);

            if (newResponse) {
                return newResponse;
            }
        }

        return false;
    }
}
