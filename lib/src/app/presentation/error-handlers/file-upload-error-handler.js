/** Returns a machine-readable upload failure without disguising HTML as success. */
export default function fileUploadErrorHandler(_context, _request, response, error) {
    if (!error.expected && !error.httpError) {
        return false;
    }
    const status = error.httpStatusCode || 500;
    return response.respondWithJSON(status, {
        error: {
            code: error.code || 'FileUploadError',
            message: error.message,
        },
    });
}
