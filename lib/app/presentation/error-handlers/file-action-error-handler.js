/**
 * Returns a machine-readable failure for a JavaScript row action.
 *
 * The admin file listing, detail, and batch upload pages enhance their
 * metadata/publish/unpublish/delete forms with a `kixx-partial` fetch so one
 * row's failure — including an expired CSRF session — never navigates away
 * from other in-progress uploads on the same page. A plain HTML submission
 * (no `kixx-partial` header) falls through to the normal admin error page.
 */
export default function fileActionErrorHandler(_context, request, response, error) {
    if (!request.headers.get('kixx-partial')) {
        return false;
    }
    if (!error.expected && !error.httpError) {
        return false;
    }
    const status = error.httpStatusCode || 500;
    return response.respondWithJSON(status, {
        error: {
            code: error.code || 'FileActionError',
            message: error.message,
        },
    });
}
