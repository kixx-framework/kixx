export default function PageErrorHandler() {
    /**
     * This handler logs server errors (status 500+) and renders an error page using the
     * application's view service. For HTTP 405 errors, it sets the 'Allow' header with
     * the permitted methods.
     *
     * @function pageErrorHandler
     * @async
     * @param {Object} context - The application context, containing logger and services.
     * @param {Object} request - The HTTP request object.
     * @param {Object} response - The HTTP response object.
     * @param {Error} error - The error that occurred during request handling.
     * @returns {Promise<Object>} The HTTP response with rendered error HTML.
     */
    return async function pageErrorHandler(context, request, response, error) {
        const { logger } = context;
        const viewService = context.getService('kixx.AppViewService');
        const html = await viewService.renderMarkupForError(error);

        const statusCode = error.httpStatusCode || 500;

        if (statusCode > 499) {
            logger.error('page handling error', { requestId: request.id }, error);
        }

        if (statusCode === 405 && error.allowedMethods.length) {
            response.setHeader('Allow', error.allowedMethods.join(', '));
        }

        return response.respondWithHTML(statusCode, html);
    };
}
