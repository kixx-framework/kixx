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

        // Use HTTP status code as pathname (e.g., 404 → "404", generic error → "error")
        const pathname = error.httpStatusCode ? error.httpStatusCode.toString() : 'error';
        const pageData = await viewService.getPageData(pathname);

        let pageBody = await viewService.getPageMarkup(pathname, pageData);

        if (!pageBody) {
            pageBody = error.httpStatusCode
                ? `HTTP Status Code: ${ error.httpStatusCode }`
                : 'An error occurred.';
        }

        const template = await viewService.getBaseTemplate(pageData.baseTemplateId);

        let html;
        if (template) {
            const ctx = Object.assign({}, pageData || {}, { body: pageBody });
            html = template(ctx);
        } else {
            logger.warn('no base template found for error page', { pathname });
            html = `<html><body><p>${ pageBody }</p></body></html>\n`;
        }

        const statusCode = error.httpStatusCode || 500;

        if (statusCode === 405 && error.allowedMethods.length) {
            response.setHeader('Allow', error.allowedMethods.join(', '));
        }

        return response.respondWithHTML(statusCode, html);
    };
}
