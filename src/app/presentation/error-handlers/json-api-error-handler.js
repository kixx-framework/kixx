import { mapErrorToJsonApiErrors } from '../../../kixx/http-router/json-api-errors.js';
import { JSON_API_CONTENT_TYPE } from '../lib/json-api.js';


export function jsonApiErrorHandler(_context, _request, response, error) {
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
