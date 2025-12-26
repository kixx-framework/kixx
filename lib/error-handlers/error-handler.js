import { isUndefined, isBoolean, isNonEmptyString } from '../assertions/mod.js';

/**
 * Returns a request handler function that renders a page using the application's view service.
 *
 * @param {Object} options - Options for the page handler.
 * @param {boolean} [options.handleUnexpectedErrors=false] - If set to true then handle unexpected and non-HTTP errors.
 * @param {boolean} [options.exposeErrorDetails=false] - If set to true then expose error details as response props.
 * @param {string} [options.pathname] - Optional pathname to use instead of the request URL pathname.
 * @param {string} [options.baseTemplate] - Optional base template ID
 * @param {string} [options.contentType] - Optional content type to use instead of the page data's contentType.
 * @returns {Function} An async request handler function for rendering pages.
 */
export default function ErrorHandler(options) {
    options = options || {};

    return async function errorHandler(context, request, response, error) {
        // The error is considered "expected" if the #expected boolean flag is set or
        // the #httpStatusCode is set.
        if (!isErrorExpected(error) && !options.handleUnexpectedErrors) {
            // Returning false will defer to the next error handler if there is one.
            return false;
        }

        const viewService = context.getService('kixx.AppViewService');
        const config = context.config.getNamespace('errorHandler');

        const formattedError = {
            name: error.name,
            code: error.code,
            message: error.message,
            expected: Boolean(error.expected),
            httpStatusCode: error.httpStatusCode || 500,
            stack: error.stack,
        };

        // Only add the error details to the response props if the exposeErrorDetails flag is set.
        const exposeErrorDetails = isBoolean(options.exposeErrorDetails)
            ? options.exposeErrorDetails
            : config.exposeErrorDetails;

        if (exposeErrorDetails) {
            response.updateProps({ error: formattedError });
        }

        if (error.httpStatusCode === 405 && error.allowedMethods?.length > 0) {
            response.setHeader('Allow', error.allowedMethods.join(', '));
        }

        let pathname = options.pathname;
        if (!isNonEmptyString(pathname)) {
            // Use HTTP status code as pathname (e.g., 404 → "404", generic error → "error")
            pathname = error.httpStatusCode ? error.httpStatusCode.toString() : 'error';
        }

        // Default to the "error" pathname if there is not one registered for the
        // HTTP status code.
        if (pathname !== 'error') {
            const errorPageExists = await viewService.doesPageExist(pathname);
            if (!errorPageExists) {
                pathname = 'error';
            }
        }

        const props = await viewService.getPageData(pathname, response.props);

        viewService.hydratePageData(request.url, props);

        if (request.isJSONRequest()) {
            return response.respondWithJSON(200, props, { whiteSpace: 4 });
        }

        let contentType = options.contentType || props.contentType;

        let body = await viewService.getPageMarkup(pathname, props);

        if (body) {
            if (!contentType) {
                // If the content-type has not been defined and the markup exists then
                // assume the content-type is text/html.
                contentType = 'text/html';
            }
        } else {
            body = error.httpStatusCode
                ? `HTTP Status Code: ${ error.httpStatusCode }`
                : 'An error occurred.';

            if (!contentType) {
                // If the content-type has not been defined and the markup does NOT exist
                // then assume the content-type is text/plain.
                contentType = 'text/plain';
            }
        }

        const baseTemplateId = props.baseTemplate || options.baseTemplate;
        const template = await viewService.getBaseTemplate(baseTemplateId);

        const ctx = Object.assign({}, props, { body });
        const output = template ? template(ctx) : body;

        const { httpStatusCode } = formattedError;

        return response.respondWithUTF8(httpStatusCode, output, { contentType });
    };
}

function isErrorExpected(error) {
    // The error is considered "expected" if the #expected boolean flag is set or
    // the #httpStatusCode is set.
    return error.expected || !isUndefined(error.httpStatusCode);
}
