import { EventEmitter } from 'node:events';
import { MethodNotAllowedError, NotFoundError } from '../errors.js';
import { assert, isMap } from '../assertions.js';
import VirtualHost from './virtual-host.js';


/**
 * @typedef {Object} HttpRouterErrorEvent
 * @property {Error} error - The error that was caught during request handling
 * @property {string} requestId - The ID of the request that triggered the error
 */

/**
 * @typedef {Object} VirtualHostSpec
 * @property {string} name - Display name for the virtual host
 * @property {string} [hostname] - Exact hostname in reversed format, or '*' for catch-all
 * @property {string} [pattern] - Pattern for dynamic hostname matching
 * @property {Array<Object>} routes - Route specifications (see HttpRoute.fromSpecification)
 */

/**
 * @typedef {import('../ports/http-routes-store.js').HttpRoutesStore} HttpRoutesStore
 */

/**
 * HTTP request router that matches requests by hostname and pathname, then delegates
 * to target handlers. Manages virtual hosts, route resolution, and a three-level
 * error handling cascade (target -> route -> router).
 *
 * @emits HttpRouter#error - Emits an HttpRouterErrorEvent when handleRequest catches an error
 */
export default class HttpRouter {

    /**
     * Virtual hosts managed by this router, matched in order.
     * Null until routes are loaded via loadRoutes().
     * @type {Array<VirtualHost>|null}
     */
    #virtualHosts = null;

    /**
     * Event emitter for router events (e.g., 'error')
     * @type {EventEmitter}
     */
    #emitter = new EventEmitter();

    /**
     * Store interface for loading virtual host specifications
     * @type {HttpRoutesStore|null}
     */
    #store = null;

    /**
     * Middleware registry for loading middleware specifications
     * @type {Map<string, Function>}
     */
    #middleware = new Map();

    /**
     * Handlers registry for loading handler specifications
     * @type {Map<string, Function>}
     */
    #handlers = new Map();

    /**
     * Error handlers registry for loading error handler specifications
     * @type {Map<string, Function>}
     */
    #errorHandlers = new Map();

    /**
     * @param {Object} options - Options for the router
     * @param {HttpRoutesStore} options.store - Interface for loading route specifications
     * @param {Map<string, Function>} options.middleware - Middleware registry
     * @param {Map<string, Function>} options.handlers - Request Handlers registry
     * @param {Map<string, Function>} options.errorHandlers - Error Handlers registry
     */
    constructor({ store, middleware, handlers, errorHandlers }) {
        assert(store, 'store is required');
        assert(isMap(middleware), 'middleware must be a Map');
        assert(isMap(handlers), 'handlers must be a Map');
        assert(isMap(errorHandlers), 'errorHandlers must be a Map');

        this.#store = store;
        this.#middleware = middleware;
        this.#handlers = handlers;
        this.#errorHandlers = errorHandlers;
    }

    /**
     * Registers a listener for router events (e.g., 'error' with { error, requestId } payload).
     * @public
     * @param {string} event - Event name
     * @param {function({error: Error, requestId: string}): void} listener - Called when the event fires
     */
    on(event, listener) {
        this.#emitter.on(event, listener);
    }

    /**
     * Loads virtual host specifications from the store and builds VirtualHost instances.
     * @public
     * @returns {Promise<Array<VirtualHost>>} The loaded virtual host instances
     */
    async loadRoutes() {
        const specs = await this.#store.loadVirtualHosts();

        const middleware = this.#middleware;
        const handlers = this.#handlers;
        const errorHandlers = this.#errorHandlers;

        this.#virtualHosts = specs.map((spec) => {
            return VirtualHost.fromSpecification(spec, middleware, handlers, errorHandlers);
        });

        return this.#virtualHosts;
    }

    /**
     * Reloads routes and handles the request.
     * This is useful for hot-reloading routes in a development environment without
     * restarting the server.
     * @public
     * @async
     * @param {ApplicationContext} appContext - Application context object
     * @param {HttpServerRequest} request - HTTP request to process
     * @param {HttpServerResponse} response - HTTP response to populate
     * @returns {Promise<HttpServerResponse>} Final response after processing
     */
    async reloadRoutesAndHandleRequest(appContext, request, response) {
        await this.loadRoutes();
        return this.handleRequest(appContext, request, response);
    }

    /**
     * Processes HTTP request through routing pipeline.
     * @public
     * @async
     * @param {ApplicationContext} appContext - Application context object
     * @param {HttpServerRequest} request - HTTP request to process
     * @param {HttpServerResponse} response - HTTP response to populate
     * @returns {Promise<HttpServerResponse>} Final response after processing
     */
    async handleRequest(appContext, request, response) {
        let target = null;
        let route = null;
        let requestContext = null;

        let virtualHosts = this.#virtualHosts;
        if (!virtualHosts) {
            virtualHosts = await this.loadRoutes();
        }

        try {
            // Phase 1: Route resolution - find matching vhost and route
            // This populates request with hostname and pathname parameters
            const { hostname } = request.url;

            // Find virtual host that matches the hostname
            // Uses first virtual host as fallback when no exact match found
            // to prevent 404 errors for unexpected Host headers
            let vhost = null;
            let hostnameParams = {};
            for (const v of virtualHosts) {
                const params = v.matchHostname(hostname);
                if (params) {
                    vhost = v;
                    hostnameParams = params;
                    break;
                }
            }
            if (!vhost) {
                vhost = virtualHosts[0];
            }

            assert(vhost, 'There must always be a matching VirtualHost');

            // Find the first route that matches the request pathname
            // Routes are matched in registration order; first match wins
            const { pathname } = request.url;
            let matchedRoute = null;
            let pathnameParams = null;
            for (const r of vhost.routes) {
                const params = r.matchPathname(pathname);
                if (params) {
                    matchedRoute = r;
                    pathnameParams = params;
                    break;
                }
            }

            if (!matchedRoute || !pathnameParams) {
                throw new NotFoundError(`No route found for pathname ${ request.url.pathname }`);
            }

            route = matchedRoute;

            // Mutate request object to include resolved parameters
            // These params are available to all downstream middleware
            request
                .setHostnameParams(hostnameParams)
                .setPathnameParams(pathnameParams);

            // Phase 2: Method resolution - find target handler for HTTP method
            target = this.#findTargetForRequest(request, route);

            // Create a RequestContext from the ApplicationContext with the matched VirtualHost's routes
            // This provides middleware with access to route information for the current request
            requestContext = appContext.cloneToRequestContext(vhost.routes);

            // Phase 3: Middleware execution - invoke the target's middleware chain
            // Middleware can modify request/response and may throw any error
            await target.invokeMiddleware(requestContext, request, response);

            return response;
        } catch (error) {

            // Emit the error for external observers.
            this.#emitter.emit('error', { error, requestId: request.id });

            // Error handling cascade: target -> route -> router
            // Each level gets a chance to handle the error before bubbling up
            // Use requestContext if available, otherwise fall back to appContext
            const context = requestContext || appContext;
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
     * Generates standardized error response for HTTP errors.
     *
     * Only handles errors with `httpError` or `expected` flags set. Unexpected errors will
     * continue propagating through the error handling chain.
     *
     * Converts errors to JSON:API compliant format and sets appropriate headers like Allow for
     * 405 Method Not Allowed responses per RFC 7231.
     *
     * @public
     * @param {ApplicationContext} context - Application context
     * @param {HttpServerRequest} request - Original request
     * @param {HttpServerResponse} response - Response to populate
     * @param {Error} error - Error to handle
     * @returns {HttpServerResponse|false} JSON response if error was handled, false to propagate
     */
    handleError(context, request, response, error) {
        if (!error.httpError && !error.expected) {
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
     * Locates target handler for request method within matched route.
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
     * Converts a single error to a JSON:API compliant error object.
     *
     * Sanitizes internal error messages for security, only exposing
     * HttpError messages which are safe for public consumption.
     *
     * @public
     * @static
     * @param {Error} error - Error to convert
     * @returns {Object} Single JSON:API error object with status, code, title, detail, source
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
}
