import { respondWithJsonApi, toJsonApiErrorObjects } from '../lib/json-api.js';


/**
 * Renders expected Administrative Data API errors as complete JSON:API error documents.
 *
 * Outbound middleware does not run for error responses, so every protocol
 * header an error needs is set here: the Bearer challenge on 401 and Allow on
 * 405. Unexpected errors are left to the router so they still reach the
 * platform's fatal-error policy.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Request that failed.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response to populate.
 * @param {Error} error - Error raised while handling the request.
 * @returns {import('../../../kixx/http-router/server-response.js').default|false} Error response, or false to continue the cascade.
 */
export default function adminDataApiErrorHandler(context, request, response, error) {
    // Log before classifying the error so authentication failures and unexpected
    // errors are included, even when this handler passes the error onward.
    const action = { POST: 'create', PATCH: 'update', DELETE: 'delete' }[request.method];
    const { type, id } = request.pathnameParams;

    if (action && type) {
        context.logger.warn('admin data mutation failed', {
            principal: context.user?.id ?? null,
            requestId: context.requestId,
            action,
            type,
            id,
            outcome: 'failed',
            status: error.httpStatusCode ?? 500,
            code: error.code ?? error.name,
        });
    }

    if (!error.expected || !error.httpError) {
        return false;
    }

    const status = error.httpStatusCode;

    if (status === 401) {
        // RFC 6750: name the error only when a bearer token was presented;
        // a request without credentials just gets the challenge.
        const challenge = request.getAuthorizationBearer()
            ? 'Bearer realm="admin-data-api", error="invalid_token"'
            : 'Bearer realm="admin-data-api"';
        response.setHeader('www-authenticate', challenge);
    }

    if (status === 405 && Array.isArray(error.allowedMethods)) {
        response.setHeader('allow', error.allowedMethods.join(', '));
    }

    return respondWithJsonApi(response, status, { errors: toJsonApiErrorObjects(error) });
}
