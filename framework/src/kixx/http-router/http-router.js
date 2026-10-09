import EventEmitter from '../utils/event-emitter.js';
import { MethodNotAllowedError, NotFoundError } from '../errors/mod.js';
import VirtualHost from './virtual-host.js';
import {
    mapErrorToJsonApiError,
    mapErrorToJsonApiErrors,
} from './json-api-errors.js';
import {
    assert,
    assertArray,
    assertGreaterThan,
} from '../assertions/mod.js';


const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

// Directives which decide whether and how long a cache may store a response.
// Enforcing a restrictive policy replaces these and keeps the rest, such as
// no-transform, which a handler may rely on for an unrelated reason.
const STORAGE_DIRECTIVES = new Set([
    'public',
    'private',
    'no-store',
    'no-cache',
    'max-age',
    's-maxage',
    'must-revalidate',
    'proxy-revalidate',
    'immutable',
    'stale-while-revalidate',
    'stale-if-error',
]);


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
 *
 * The router enforces the response cache policy on the way out, so a route
 * which forgets to declare one can never be stored by a shared cache:
 * - A response without a Cache-Control header gets `no-store`.
 * - A response produced by the error cascade gets `no-store` and loses its ETag.
 * - A response to a request with an authenticated `context.user` gets `private, no-store`.
 * - A response a shared cache may still store gets `Vary: host`.
 *
 * @emits HttpRouter#error - Emits a HttpRouterErrorEvent before the error cascade handles a request failure.
 */
export default class HttpRouter {

    #virtualHosts = null;
    #emitter = new EventEmitter();

    /**
     * @param {Array<Object>} virtualHostsConfig - Virtual host specification
     *   objects to build routing from. Order is significant: the first entry is
     *   the default host, used to serve any request whose hostname matches no
     *   virtual host (see handleRequest). Hostname matching therefore never
     *   produces a 404.
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
     *
     * Mutates the returned response's Cache-Control, ETag, and Vary headers to
     * enforce the cache policy described on the class.
     *
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
            // No virtual host matched the request hostname. By design the first
            // configured host is the default, so an unknown host is served
            // rather than rejected. Callers order virtualHostsConfig with the
            // intended default first.
            if (!vhost) {
                vhost = this.#virtualHosts[0];
            }

            // Safety net: the constructor rejects an empty virtualHostsConfig,
            // so the default above is always defined.
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

            const middlewareResponse = await target.invokeMiddleware(requestContext, request, response);

            return applyCachePolicy(requestContext, middlewareResponse, false);
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
                return applyCachePolicy(requestContext, updatedResponse, true);
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

        const errors = mapErrorToJsonApiErrors(error);

        if (statusCode === 405 && Array.isArray(error.allowedMethods)) {
            response.setHeader('allow', error.allowedMethods.join(', '));
        }

        return response.respondWithJSON(statusCode, { errors }, {
            contentType: JSON_API_CONTENT_TYPE,
            whiteSpace: 4,
        });
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
        return mapErrorToJsonApiError(error);
    }
}

function applyCachePolicy(context, response, isErrorResponse) {
    const { headers } = response;

    if (context.user) {
        // A response rendered for an authenticated principal must never be
        // served to another client, whatever policy the handler declared.
        headers.set('cache-control', restrictCacheControl(headers.get('cache-control'), 'private, no-store'));
    } else if (isErrorResponse) {
        // A handler may have declared a cache policy and validator before it
        // threw; those describe the representation it failed to produce, not
        // this error document.
        headers.set('cache-control', restrictCacheControl(headers.get('cache-control'), 'no-store'));
    } else if (!headers.has('cache-control')) {
        // Without Cache-Control, caches apply heuristic freshness (Cloudflare
        // stores a 200 for two hours), so caching is opt-in per route.
        headers.set('cache-control', 'no-store');
    }

    if (isErrorResponse) {
        headers.delete('etag');
    }

    // Shared caches such as the Cloudflare Workers Cache key on path and query
    // only. Virtual hosts can serve different content at the same path, so a
    // storable response must vary on the hostname.
    if (isSharedCacheable(headers.get('cache-control'))) {
        response.addVary('host');
    }

    return response;
}

function restrictCacheControl(cacheControl, policy) {
    const keptDirectives = parseCacheControl(cacheControl).filter((directive) => {
        return !STORAGE_DIRECTIVES.has(getDirectiveName(directive));
    });

    return [ policy ].concat(keptDirectives).join(', ');
}

function isSharedCacheable(cacheControl) {
    const names = parseCacheControl(cacheControl).map(getDirectiveName);
    return !names.includes('no-store') && !names.includes('private');
}

function parseCacheControl(cacheControl) {
    if (!cacheControl) {
        return [];
    }

    return cacheControl.split(',').map((directive) => directive.trim()).filter(Boolean);
}

// A directive may carry an argument, as in max-age=60 or private="set-cookie".
function getDirectiveName(directive) {
    return directive.split('=')[0].trim().toLowerCase();
}
