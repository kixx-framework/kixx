/**
 * @typedef {Object} JsonApiError
 * @property {string} status - HTTP status code represented by the error.
 * @property {string} code - Stable application error code.
 * @property {string} title - Public error title.
 * @property {string} detail - Public error detail message.
 * @property {string} [source] - Request input location or subsystem associated with the error.
 */


/**
 * Expands an expected application error into JSON:API error objects.
 * @param {Error} error - Error to serialize.
 * @returns {JsonApiError[]} JSON:API error objects safe to expose in an HTTP response.
 */
export function mapErrorToJsonApiErrors(error) {
    const errors = Array.isArray(error.errors)
        ? error.errors.map((childError) => applyParentErrorMetadata(childError, error))
        : [ error ];

    return errors.map(mapErrorToJsonApiError);
}

/**
 * Converts a single error to a JSON:API error object.
 * @param {Error|Object} error - Error metadata to serialize.
 * @returns {JsonApiError} JSON:API error object safe to expose in an HTTP response.
 */
export function mapErrorToJsonApiError(error) {
    return {
        status: String(error.httpStatusCode || 500),
        // HttpError instances have structured codes, unexpected errors get generic code
        code: error.httpError ? error.code : 'INTERNAL_SERVER_ERROR',
        title: error.httpError ? error.name : 'InternalServerError',
        // Hide internal error messages from clients for security. Only expose
        // HttpError messages, which application code treats as public-safe.
        detail: error.httpError ? error.message : 'Internal server error',
        source: error.source,
    };
}

// A multi-error parent (error.errors) carries the HTTP framing for the whole
// response, but each child is serialized as its own JSON:API error object. Copy
// the parent's framing onto every child so they all report the same status,
// code, and name when mapErrorToJsonApiError() runs.
function applyParentErrorMetadata(childError, parentError) {
    return Object.assign({}, childError, {
        httpStatusCode: parentError.httpStatusCode,
        httpError: parentError.httpError,
        expected: parentError.expected,
        code: parentError.code,
        name: parentError.name,
    });
}
