import { EventEmitter } from 'node:events';
import { MethodNotAllowedError, NotFoundError } from '../errors/mod.js';
import { isFunction, assert, assertNumberNotNaN } from '../assertions/mod.js';

/**
 * @typedef {Object} JsonApiError
 * @property {number} status - HTTP status code
 * @property {string} code - Error code (e.g., 'NOT_FOUND', 'INTERNAL_SERVER_ERROR')
 * @property {string} title - Error name/title
 * @property {string} detail - Human-readable error message
 * @property {Object} [source] - Source of the error (e.g., pointer to field)
 */

/**
 * Top-level HTTP request router with virtual host support and error handling.
 *
 * HttpRouter is the entry point of the routing hierarchy (Router -> VirtualHost -> Route -> Target).
 * It processes requests through a four-phase pipeline: route resolution, method resolution,
 * middleware execution, and response validation. Errors cascade through target, route, and
 * router-level handlers before bubbling up.
 *
 * Emits 'error' events for external error monitoring with { error, requestId } payload.
 *
 * @class
 * @extends EventEmitter
 */
export default class HttpRouter extends EventEmitter {

    /**
     * Virtual hosts managed by this router, matched in order
     * @type {Array<VirtualHost>}
     */
    #virtualHosts = [];

    /**
     * Creates a new HTTP router instance
     * @param {Array<VirtualHost>} [virtualHosts] - Virtual hosts to manage
     */
    constructor(virtualHosts) {
        super();

        if (Array.isArray(virtualHosts)) {
            this.#virtualHosts = virtualHosts;
        }
    }

    /**
     * Replaces all virtual hosts managed by this router
     *
     * Used for hot-reloading routes without restarting the server.
     *
     * @param {Array<VirtualHost>} virtualHosts - New virtual hosts to manage
     */
    resetVirtualHosts(virtualHosts) {
        this.#virtualHosts = virtualHosts;
    }

    /**
     * Returns a bound request handler for use with HTTP server
     * @returns {Function} Bound handleHttpRequest method
     */
    getHttpRequestHandler() {
        return this.handleHttpRequest.bind(this);
    }

    /**
     * Processes HTTP request through routing pipeline
     *
     * @async
     * @param {Context} context - Application context object
     * @param {HttpServerRequest} request - HTTP request to process
     * @param {HttpServerResponse} response - HTTP response to populate
     * @returns {Promise<HttpServerResponse>} Final response after processing
     * @throws {NotFoundError} When no route matches the request path
     * @throws {MethodNotAllowedError} When route exists but method not supported
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

            // Emit the error for external observers.
            this.emit('error', { error, requestId: request.id });

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

            if (!updatedResponse) {
                updatedResponse = this.handleError(context, request, response, error);
            }

            if (updatedResponse) {
                return updatedResponse;
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
     * @param {HttpServerRequest} request - Request containing URL to match
     * @returns {[HttpRoute, Object, Object]} Route, hostname params, and pathname params
     * @throws {NotFoundError} When no route matches the request pathname
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
     * Only handles errors with `isHttpError` or `expected` flags set. Unexpected errors will
     * continue propagating through the error handling chain.
     *
     * Converts errors to JSON:API compliant format and sets appropriate headers like Allow for
     * 405 Method Not Allowed responses per RFC 7231.
     *
     * @param {Context} context - Application context
     * @param {HttpServerRequest} request - Original request
     * @param {HttpServerResponse} response - Response to populate
     * @param {Error} error - Error to handle
     * @returns {HttpServerResponse|false} JSON response if error was handled, false to propagate
     */
    handleError(context, request, response, error) {
        if (!error.isHttpError && !error.expected) {
            return false;
        }

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

        return response.respondWithJSON(statusCode, { errors }, { whiteSpace: 4 });
    }

    /**
     * Locates target handler for request method within matched route
     *
     * @param {HttpServerRequest} request - Request to find target for
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
     * @param {Error} error - Error to convert
     * @returns {{errors: Array<JsonApiError>}} JSON:API error envelope
     */
    static mapErrorToJsonError(error) {
        return {
            status: error.httpStatusCode || 500,
            // HttpError instances have structured codes, unexpected errors get generic code
            code: error.httpError ? error.code : 'INTERNAL_SERVER_ERROR',
            title: error.httpError ? error.name : 'InternalServerError',
            // Hide internal error messages from clients for security
            // Only expose HttpError messages which are safe for public consumption
            detail: error.httpError ? error.message : 'Internal server error',
            source: error.source,
        };
    }

    /**
     * Validates middleware response conforms to expected interface
     *
     * Checks that response exists, has a valid numeric status code,
     * and has headers with get() and entries() methods.
     *
     * @static
     * @param {HttpServerResponse} response - Response object to validate
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
