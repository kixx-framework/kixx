import EventEmitter from '../utils/event-emitter.js';
import { MethodNotAllowedError, NotFoundError } from '../errors/mod.js';
import VirtualHost from './virtual-host.js';
import {
    assert,
    assertArray,
    assertGreaterThan,
} from '../assertions/mod.js';

/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('./server-request-interface.js').ServerRequestInterface} ServerRequest
 */

/**
 * @typedef {import('./server-response.js').default} ServerResponse
 */

/**
 * @typedef {import('./http-route.js').default} HttpRoute
 */

/**
 * @typedef {import('./http-target.js').default} HttpTarget
 */

/**
 * @typedef {Object} HttpRouterErrorEvent
 * @property {Error} error - Error raised while handling the request.
 * @property {string} requestId - Request identifier associated with the error.
 */

/**
 * @typedef {Object} JsonApiError
 * @property {string} status - HTTP status code represented by the error.
 * @property {string} code - Stable application error code.
 * @property {string} title - Public error title.
 * @property {string} detail - Public error detail message.
 * @property {string} [source] - Request input location or subsystem associated with the error.
 */


/**
 * Dispatches requests to virtual hosts, routes, and method-specific targets.
 * @emits HttpRouter#error - Emits a HttpRouterErrorEvent before the error cascade handles a request failure.
 */
export default class HttpRouter {

    #virtualHosts = null;
    #emitter = new EventEmitter();

    /**
     * @param {Array<Object>} virtualHostsConfig - Virtual host specification objects to build routing from.
     * @throws {AssertionError} When virtualHostsConfig is not a non-empty array.
     * @throws {ValidationError} When a virtual host specification is invalid.
     */
    constructor(virtualHostsConfig) {
        assertArray(virtualHostsConfig, 'virtualHostsConfig must be an Array');
        assertGreaterThan(0, virtualHostsConfig.length, 'virtualHostsConfig must not be empty');

        this.#virtualHosts = virtualHostsConfig.map((spec) => {
            return VirtualHost.fromSpecification(spec);
        });
    }

    /**
     * Registers an event listener for router events.
     * @param {string} event - Event name to observe.
     * @param {Function} listener - Callback invoked with the event payload.
     * @returns {HttpRouter} This router instance for chaining.
     */
    on(event, listener) {
        this.#emitter.on(event, listener);
        return this;
    }

    /**
     * Routes an HTTP request and returns the middleware or error-handler response.
     * @param {RequestContext} requestContext - Request context for the current request.
     * @param {ServerRequest} request - HTTP request to route.
     * @param {ServerResponse} response - HTTP response to populate.
     * @returns {Promise<ServerResponse>} Response returned by middleware or the error cascade.
     * @throws {Error} When no target, route, or router handler can convert the error to a response.
     */
    async handleRequest(requestContext, request, response) {
        let target = null;
        let route = null;

        try {
            const { hostname } = request.url;

            let vhost = null;
            let hostnameParams = {};
            for (const v of this.#virtualHosts) {
                const params = v.matchHostname(hostname);
                if (params) {
                    vhost = v;
                    hostnameParams = params;
                    break;
                }
            }
            if (!vhost) {
                vhost = this.#virtualHosts[0];
            }

            assert(vhost, 'There must always be a matching VirtualHost');

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

            // Route params are attached before target resolution so every
            // downstream middleware sees the same request state.
            request
                .setHostnameParams(hostnameParams)
                .setPathnameParams(pathnameParams);

            target = this.#findTargetForRequest(request, route);

            // Inject the matched VirtualHost's routes so getHttpTarget* methods resolve
            // against the correct route set for this request.
            requestContext.useRoutes(vhost.routes);

            return await target.invokeMiddleware(requestContext, request, response);
        } catch (error) {

            // Emit the error for external observers.
            this.#emitter.emit('error', { error, requestId: request.id });

            let updatedResponse = null;

            if (target) {
                updatedResponse = await target.handleError(requestContext, request, response, error);
            }

            if (!updatedResponse && route) {
                updatedResponse = await route.handleError(requestContext, request, response, error);
            }

            if (!updatedResponse) {
                updatedResponse = this.handleError(requestContext, request, response, error);
            }

            if (updatedResponse) {
                return updatedResponse;
            }

            // Unexpected errors intentionally escape so the platform-level server
            // can apply its fatal-error policy.
            throw error;
        }
    }

    /**
     * Converts expected HTTP errors to JSON:API error responses.
     * @param {RequestContext} context - Request context active when the error was raised.
     * @param {ServerRequest} request - Request that raised the error.
     * @param {ServerResponse} response - Response to populate.
     * @param {Error} error - Error to handle.
     * @returns {ServerResponse|false} Populated response, or false when the error should keep propagating.
     */
    handleError(_context, _request, response, error) {
        if (!error.httpError && !error.expected) {
            return false;
        }

        const statusCode = error.httpStatusCode || 500;

        let errors = Array.isArray(error.errors)
            ? error.errors.map((childError) => applyParentErrorMetadata(childError, error))
            : [ error ];
        errors = errors.map(HttpRouter.mapErrorToJsonError);

        if (statusCode === 405 && Array.isArray(error.allowedMethods)) {
            response.setHeader('allow', error.allowedMethods.join(', '));
        }

        return response.respondWithJSON(statusCode, { errors }, { whiteSpace: 4 });
    }

    #findTargetForRequest(request, route) {
        const target = route.findTargetForRequest(request);

        if (!target) {
            // The router-level handler reads this metadata to set the RFC-required
            // Allow header on 405 responses.
            throw new MethodNotAllowedError(
                `HTTP method ${ request.method } not allowed on ${ request.url.pathname }`,
                { allowedMethods: route.allowedMethods },
            );
        }

        return target;
    }

    /**
     * Converts a single error to a JSON:API error object.
     * @param {Error|Object} error - Error metadata to serialize.
     * @returns {JsonApiError} JSON:API error object safe to expose in an HTTP response.
     */
    static mapErrorToJsonError(error) {
        return {
            status: String(error.httpStatusCode || 500),
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

function applyParentErrorMetadata(childError, parentError) {
    return Object.assign({}, childError, {
        httpStatusCode: parentError.httpStatusCode,
        httpError: parentError.httpError,
        expected: parentError.expected,
        code: parentError.code,
        name: parentError.name,
    });
}
