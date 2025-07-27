/**
 * @fileoverview HTTP request routing and middleware management
 * 
 * This module provides the core HttpRouter class for handling HTTP request routing
 * in Node.js applications. It supports virtual host matching, route resolution,
 * middleware execution, and comprehensive error handling with proper HTTP status codes.
 */

import {
    MethodNotAllowedError,
    NotFoundError
} from '../errors/mod.js';

import {
    isFunction,
    assert,
    assertNumberNotNaN
} from '../assertions/mod.js';

/**
 * @typedef {Object} VirtualHost
 * @property {Function} matchHostname - Matches hostname and returns parameters
 * @property {Function} matchRequest - Matches request and returns route with parameters
 */

/**
 * @typedef {Object} HttpRequest
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {Object} url - Parsed URL object with hostname and pathname
 * @property {Function} setHostnameParams - Sets hostname parameters on request
 * @property {Function} setPathnameParams - Sets pathname parameters on request
 */

/**
 * @typedef {Object} HttpResponse
 * @property {number} status - HTTP status code
 * @property {Object} headers - Response headers object with get() and entries() methods
 * @property {Function} setHeader - Sets a response header
 * @property {Function} respondWithJSON - Sends JSON response with given status and data
 */

/**
 * @typedef {Object} HttpRoute
 * @property {Function} findTargetForRequest - Finds target handler for request
 * @property {Function} handleError - Handles errors at route level
 * @property {string[]} allowedMethods - Array of supported HTTP methods
 */

/**
 * @typedef {Object} HttpTarget
 * @property {Function} invokeMiddleware - Executes middleware chain
 * @property {Function} handleError - Handles errors at target level
 */

/**
 * Routes HTTP requests to appropriate virtual hosts and handlers
 * 
 * Manages virtual host matching, route resolution, middleware execution,
 * and error handling with proper HTTP status codes (404, 405, 500).
 * 
 * @example
 * const router = new HttpRouter(virtualHosts);
 * const handler = router.getHttpRequestHandler();
 * server.on('request', handler);
 */
export default class HttpRouter {

    #virtualHosts = [];

    /**
     * Creates a new HTTP router instance
     * 
     * @param {VirtualHost[]} [virtualHosts=[]] - Virtual hosts to manage
     */
    constructor(virtualHosts) {
        if (Array.isArray(virtualHosts)) {
            this.#virtualHosts = virtualHosts;
        }
    }

    /**
     * Replaces all virtual hosts managed by this router
     * 
     * @param {VirtualHost[]} virtualHosts - New virtual hosts to manage
     */
    resetVirtualHosts(virtualHosts) {
        this.#virtualHosts = virtualHosts;
    }

    /**
     * Returns bound request handler for use with HTTP server
     * 
     * @returns {Function} Request handler function (context, request, response) => Promise<HttpResponse>
     * 
     * @example
     * const handler = router.getHttpRequestHandler();
     * server.on('request', handler);
     */
    getHttpRequestHandler() {
        return this.handleHttpRequest.bind(this);
    }

    /**
     * Processes HTTP request through routing pipeline
     * 
     * Executes four-phase processing: route resolution, method resolution,
     * middleware execution, and response validation. Implements error handling
     * cascade from target to route to router level.
     * 
     * @async
     * @param {Object} context - Request context object
     * @param {HttpRequest} request - HTTP request to process
     * @param {HttpResponse} response - HTTP response to populate
     * @returns {Promise<HttpResponse>} Final response after processing
     * @throws {NotFoundError} When no route matches the request path
     * @throws {MethodNotAllowedError} When route exists but method not supported
     * @throws {AssertionError} When middleware returns invalid response
     * @throws {Error} For unexpected system errors that bubble up
     */
    async handleHttpRequest(context, request, response) {
        let target = null;
        let route = null;

        try {
            // Phase 1: Route resolution - find matching vhost and route
            // This populates request with hostname and pathname parameters
            const result = this.matchRequest(request); // Throws NotFoundError if no route matches

            route = result[0];
            const hostnameParams = result[1];
            const pathnameParams = result[2];

            // Mutate request object to include resolved parameters
            // These params are available to all downstream middleware
            request
                .setHostnameParams(hostnameParams)
                .setPathnameParams(pathnameParams);

            // Phase 2: Method resolution - find target handler for HTTP method
            target = this.#findTargetForRequest(request, route); // Throws MethodNotAllowedError if method not supported

            // Phase 3: Middleware execution - invoke the target's middleware chain
            // Middleware can modify request/response and may throw any error
            const updatedResponse = await target.invokeMiddleware(context, request, response);

            // Phase 4: Response validation - ensure middleware returned valid response
            HttpRouter.validateResponse(updatedResponse); // Throws AssertionError if response is invalid

            return updatedResponse;
        } catch (error) {
            // Error handling cascade: target -> route -> router
            // Each level gets a chance to handle the error before bubbling up
            let updatedResponse = null;

            if (target) {
                // Target-level error handling (most specific)
                // Allows individual endpoints to customize error responses
                updatedResponse = await target.handleError(context, request, response, error);
            } else if (route) {
                // Route-level error handling (method not found, but route exists)
                // Handles cases where route matched but method was not allowed
                updatedResponse = await route.handleError(context, request, response, error);
            }

            if (updatedResponse) {
                return updatedResponse;
            }

            if (error.isHttpError) {
                // Router-level error handling for HTTP errors (404, 405, etc.)
                // Provides consistent error format across the application
                return this.handleError(context, request, response, error);
            }

            // Unexpected errors (programming errors, system failures) bubble up
            // These should be caught by higher-level error handlers or crash the process
            throw error;
        }
    }

    /**
     * Finds virtual host that matches the given hostname
     * 
     * Uses first virtual host as fallback when no exact match found
     * to prevent 404 errors for unexpected Host headers.
     * 
     * @param {string} hostname - Hostname to match against virtual hosts
     * @returns {[VirtualHost, Object]} Matched virtual host and extracted parameters
     */
    matchHostname(hostname) {
        const virtualHosts = this.#virtualHosts;

        for (const vhost of virtualHosts) {
            const params = vhost.matchHostname(hostname);

            if (params) {
                return [ vhost, params ];
            }
        }

        // Fallback behavior: use first vhost as default for unmatched hostnames
        // This prevents 404s for requests to unexpected Host headers
        return [ virtualHosts[0], {}];
    }

    /**
     * Resolves request to matching route with extracted parameters
     * 
     * @param {HttpRequest} request - Request containing URL to match
     * @returns {[HttpRoute, Object, Object]} Route, hostname params, and pathname params
     * @throws {NotFoundError} When no route matches the request pathname
     * 
     * @example
     * // For request to https://api.example.com/users/123
     * const [route, hostParams, pathParams] = router.matchRequest(request);
     * // pathParams might contain { userId: '123' }
     */
    matchRequest(request) {
        const { hostname } = request.url;
        const [ vhost, hostnameParams ] = this.matchHostname(hostname);

        assert(vhost, 'There must always be a matching VirtualHost');

        const [ route, pathnameParams ] = vhost.matchRequest(request);

        if (route && pathnameParams) {
            return [ route, hostnameParams, pathnameParams ];
        }

        throw new NotFoundError(`No route found for pathname ${ request.url.pathname }`);
    }

    /**
     * Generates standardized error response for HTTP errors
     * 
     * Converts errors to JSON:API compliant format and sets appropriate
     * headers like Allow for 405 Method Not Allowed responses.
     * 
     * @param {Object} context - Request context
     * @param {HttpRequest} request - Original request
     * @param {HttpResponse} response - Response to populate
     * @param {Error & {httpStatusCode?: number, isHttpError?: boolean, allowedMethods?: string[]}} error - Error to handle
     * @returns {HttpResponse} JSON response with error details
     */
    handleError(context, request, response, error) {
        const statusCode = error.httpStatusCode || 500;

        // Handle ValidationError with multiple child errors vs single error
        // ValidationError.errors is an array, other errors are single instances
        let errors = Array.isArray(error.errors) ? error.errors : [ error ];
        errors = errors.map(HttpRouter.mapErrorToJsonError);

        // HTTP 405 Method Not Allowed requires Allow header per RFC 7231
        // This tells the client which methods are actually supported
        if (statusCode === 405 && Array.isArray(error.allowedMethods)) {
            response.setHeader('allow', error.allowedMethods.join(', '));
        }

        // TODO: The default error response should be in HTML instead of JSON.
        return response.respondWithJSON(statusCode, { errors }, { whiteSpace: 4 });
    }

    /**
     * Locates target handler for request method within matched route
     * 
     * @private
     * @param {HttpRequest} request - Request to find target for
     * @param {HttpRoute} route - Route containing potential targets
     * @returns {HttpTarget} Target handler for the request method
     * @throws {MethodNotAllowedError} When method not supported by route
     */
    #findTargetForRequest(request, route) {
        const target = route.findTargetForRequest(request);

        if (!target) {
            // Include allowed methods in error to help client and enable proper Allow header
            // This provides actionable information about what methods are actually supported
            throw new MethodNotAllowedError(
                `HTTP method ${ request.method } not allowed on ${ request.url.pathname }`,
                { allowedMethods: route.allowedMethods }
            );
        }

        return target;
    }

    /**
     * Converts error to JSON:API compliant error object
     * 
     * Sanitizes internal error messages for security, only exposing
     * HttpError messages which are safe for public consumption.
     * 
     * @static
     * @param {Error & {httpStatusCode?: number, isHttpError?: boolean, code?: string, name?: string, source?: any}} error - Error to convert
     * @returns {{errors: Array<{status: number, code: string, title: string, detail: string, source?: any}>}} JSON:API error format
     */
    static mapErrorToJsonError(error) {
        const jsonError = {
            status: error.httpStatusCode || 500,
            // HttpError instances have structured codes, unexpected errors get generic code
            code: error.isHttpError ? error.code : 'INTERNAL_SERVER_ERROR',
            title: error.isHttpError ? error.name : 'InternalServerError',
            // Hide internal error messages from clients for security
            // Only expose HttpError messages which are safe for public consumption
            detail: error.isHttpError ? error.message : 'Internal server error',
            source: error.source,
        };

        return { errors: [ jsonError ] };
    }

    /**
     * Validates middleware response conforms to expected interface
     * 
     * @static
     * @param {HttpResponse} response - Response object to validate
     * @throws {AssertionError} When response is null, missing status, or has invalid headers
     */
    static validateResponse(response) {
        assert(response, 'An HttpResponse object was not returned by middlware handlers');

        const { status, headers } = response;

        assertNumberNotNaN(status, 'The returned HttpResponse does not have a valid status');

        assert(
            headers && isFunction(headers.get) && isFunction(headers.entries),
            'The returned HttpResponse does not have valid headers'
        );
    }
}
