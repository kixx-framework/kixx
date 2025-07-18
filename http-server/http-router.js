import {
    MethodNotAllowedError,
    NotFoundError
} from '../errors/mod.js';

import {
    isFunction,
    assert,
    assertNumberNotNaN
} from '../assertions/mod.js';


export default class HttpRouter {

    #virtualHosts = [];

    constructor(virtualHosts) {
        if (Array.isArray(virtualHosts)) {
            this.#virtualHosts = virtualHosts;
        }
    }

    resetVirtualHosts(virtualHosts) {
        this.#virtualHosts = virtualHosts;
    }

    getHttpRequestHandler() {
        return this.handleHttpRequest.bind(this);
    }

    /**
     * @param  {HttpRequest} request
     * @param  {HttpResponse} response
     * @return {HttpResponse}
     */
    async handleHttpRequest(context, request, response) {
        let target = null;
        let route = null;

        try {
            // Will throw a NotFoundError
            const result = this.matchRequest(request);

            route = result[0];
            const hostnameParams = result[1];
            const pathnameParams = result[2];

            request
                .setHostnameParams(hostnameParams)
                .setPathnameParams(pathnameParams);

            // Will throw a MethodNotAllowedError
            target = this.#findTargetForRequest(request, route);

            // Could throw anything.
            const updatedResponse = await target.invokeMiddleware(context, request, response);

            // Will throw an AssertionError if the response is not valid.
            HttpRouter.validateResponse(updatedResponse);

            return updatedResponse;
        } catch (error) {
            let updatedResponse = null;

            if (target) {
                // Give the target a chance to handle the error first.
                updatedResponse = target.handleError(context, request, response, error);
            } else if (route) {
                // The route gets the second crack at it if the target
                // was not found.
                updatedResponse = route.handleError(context, request, response, error);
            }

            if (updatedResponse) {
                return updatedResponse;
            }

            if (error.isHttpError) {
                // If the target does not handle the error, and the error
                // is an HTTP error, then handle it here.
                return this.handleError(context, request, response, error);
            }

            // Otherwise assume it is unexpected and throw.
            throw error;
        }
    }

    matchHostname(hostname) {
        const virtualHosts = this.#virtualHosts;

        for (const vhost of virtualHosts) {
            const params = vhost.matchHostname(hostname);

            if (params) {
                return [ vhost, params ];
            }
        }

        // Use the first defined VirtualHost as the default.
        return [ virtualHosts[0], {}];
    }

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

    handleError(context, request, response, error) {
        const statusCode = error.httpStatusCode || 500;

        // Is this a ValidationError with an Array of child errors?
        let errors = Array.isArray(error.errors) ? error.errors : [ error ];
        errors = errors.map(HttpRouter.mapErrorToJsonError);

        if (statusCode === 405 && Array.isArray(error.allowedMethods)) {
            response.setHeader('allow', error.allowedMethods.join(', '));
        }

        // TODO: The default error response should be in HTML instead of JSON.
        return response.respondWithJSON(statusCode, { errors }, { whiteSpace: 4 });
    }

    #findTargetForRequest(request, route) {
        const target = route.findTargetForRequest(request);

        if (!target) {
            throw new MethodNotAllowedError(
                `HTTP method ${ request.method } not allowed on ${ request.url.pathname }`,
                { allowedMethods: route.allowedMethods }
            );
        }

        return target;
    }

    static mapErrorToJsonError(error) {
        const jsonError = {
            status: error.httpStatusCode || 500,
            code: error.isHttpError ? error.code : 'INTERNAL_SERVER_ERROR',
            title: error.isHttpError ? error.name : 'InternalServerError',
            detail: error.isHttpError ? error.message : 'Internal server error',
            source: error.source,
        };

        return { errors: [ jsonError ] };
    }

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
