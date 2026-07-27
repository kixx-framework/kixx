import { mapErrorToJsonApiErrors } from '../../../kixx/http-router/json-api-errors.js';
import { JSON_API_CONTENT_TYPE } from '../lib/json-api.js';


/**
 * Serializes an error as a JSON:API error document.
 *
 * Only errors the application raised deliberately are serialized. An unexpected
 * error (a programmer bug) is declined so the cascade can reach a handler that
 * reports a generic 500, keeping internal failure detail out of the response.
 *
 * @param {import('../../../kixx/context/request-context.js').default} _context - Current request context; unused.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} _request - Current request; unused.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Mutable server response.
 * @param {Error} error - Error being handled by the router cascade.
 * @returns {import('../../../kixx/http-router/server-response.js').default|false} Response when handled, or false to continue the cascade.
 */
export default function jsonApiErrorHandler(_context, _request, response, error) {
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
