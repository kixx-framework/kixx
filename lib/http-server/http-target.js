/**
 * @typedef {Object} ApplicationContext
 * @property {Object} config - Application configuration
 * @property {Object} logger - Application logger instance
 */

/**
 * @typedef {Object} HttpRequest
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {string} url - Request URL
 * @property {Object} headers - Request headers
 * @property {*} body - Request body
 */

/**
 * @typedef {Object} HttpResponse
 * @property {number} statusCode - HTTP status code
 * @property {Object} headers - Response headers
 * @property {*} body - Response body
 */

/**
 * @typedef {Function} MiddlewareFunction
 * @param {ApplicationContext} context - Application context
 * @param {HttpRequest} request - HTTP request object
 * @param {HttpResponse} response - HTTP response object
 * @param {Function} skip - Call to short-circuit middleware chain
 * @returns {Promise<HttpResponse>} Modified response object
 */

/**
 * @typedef {Function} ErrorHandlerFunction
 * @param {ApplicationContext} context - Application context
 * @param {HttpRequest} request - HTTP request object
 * @param {HttpResponse} response - HTTP response object
 * @param {Error} error - Error to handle
 * @returns {Promise<HttpResponse|null>} Response if handled, null otherwise
 */

/**
 * Represents an HTTP endpoint handler with middleware and error handling capabilities
 * @class
 */
export default class HttpTarget {
    /**
     * @type {Array<MiddlewareFunction>}
     * @private
     */
    #middleware = [];

    /**
     * @type {Array<ErrorHandlerFunction>}
     * @private
     */
    #errorHandlers = [];

    /**
     * Creates an HTTP target with specified configuration
     * @param {Object} options - Target configuration
     * @param {string} options.name - Target identifier
     * @param {Array<string>} options.allowedMethods - Permitted HTTP methods
     * @param {Array<MiddlewareFunction>} options.middleware - Middleware functions to execute
     * @param {Array<ErrorHandlerFunction>} options.errorHandlers - Error handling functions
     * @throws {TypeError} When required options are missing or invalid
     */
    constructor({ name, allowedMethods, middleware, errorHandlers }) {
        this.#middleware = middleware;
        this.#errorHandlers = errorHandlers;

        Object.defineProperties(this, {
            /**
             * Target identifier
             * @memberof HttpTarget#
             * @type {string}
             * @readonly
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * HTTP methods permitted for this target
             * @memberof HttpTarget#
             * @type {ReadonlyArray<string>}
             * @readonly
             */
            allowedMethods: {
                enumerable: true,
                value: Object.freeze(allowedMethods.slice()),
            },
        });
    }

    /**
     * Validates if HTTP method is permitted for this target
     * @param {string} method - HTTP method name (e.g., 'GET', 'POST')
     * @returns {boolean} True if method is allowed
     */
    isMethodAllowed(method) {
        return this.allowedMethods.includes(method);
    }

    /**
     * Executes middleware chain for this target
     * @async
     * @param {ApplicationContext} context - Application context
     * @param {HttpRequest} request - HTTP request object
     * @param {HttpResponse} response - HTTP response object
     * @returns {Promise<HttpResponse>} Response after middleware processing
     * @example
     * // Basic middleware execution
     * const response = await target.invokeMiddleware(context, request, response);
     *
     * @example
     * // Middleware can short-circuit by calling skip()
     * const authMiddleware = async (context, request, response, skip) => {
     *   if (!request.headers.authorization) {
     *     skip(); // Stops middleware chain
     *     return { statusCode: 401, body: 'Unauthorized' };
     *   }
     *   return response;
     * };
     */
    async invokeMiddleware(context, request, response) {
        let newResponse;
        let done = false;

        function skip() {
            done = true;
        }

        for (const func of this.#middleware) {
            // eslint-disable-next-line no-await-in-loop
            newResponse = await func(context, request, response, skip);

            if (done) {
                return newResponse;
            }
        }

        return newResponse;
    }

    /**
     * Processes error through registered error handlers
     * @async
     * @param {ApplicationContext} context - Application context
     * @param {HttpRequest} request - HTTP request object
     * @param {HttpResponse} response - HTTP response object
     * @param {Error} error - Error to handle
     * @returns {Promise<HttpResponse|boolean>} Response from handler or false if unhandled
     * @example
     * // Error handler that handles specific error types
     * const validationErrorHandler = async (context, request, response, error) => {
     *   if (error instanceof ValidationError) {
     *     return { statusCode: 400, body: error.message };
     *   }
     *   return null; // Let other handlers try
     * };
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
