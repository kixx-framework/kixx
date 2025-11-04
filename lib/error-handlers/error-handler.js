import path from 'node:path';
import { isUndefined, isBoolean, isNonEmptyString } from '../assertions/mod.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';

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
        const expected = error.expected || !isUndefined(error.httpStatusCode);
        if (!expected && !options.handleUnexpectedErrors) {
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

        const props = await viewService.getPageData(pathname, response.props);

        viewService.hydratePageData(request.url, props);

        if (request.isJSONRequest()) {
            return response.respondWithJSON(200, props, { whiteSpace: 4 });
        }

        const baseTemplateId = props.baseTemplate || options.baseTemplate;

        let body = await viewService.getPageMarkup(pathname, props);

        if (!body) {
            body = error.httpStatusCode
                ? `HTTP Status Code: ${ error.httpStatusCode }`
                : 'An error occurred.';
        }

        const template = await viewService.getBaseTemplate(baseTemplateId);

        const ctx = Object.assign({}, props, { body });
        const output = template ? template(ctx) : body;

        let contentType = options.contentType || props.contentType;

        if (!contentType && isNonEmptyString(baseTemplateId)) {
            const extname = path.extname(baseTemplateId);
            if (extname) {
                contentType = getContentTypeForFileExtension(extname);
            }
        }
        if (!contentType) {
            const extname = path.extname(pathname);
            if (extname) {
                contentType = getContentTypeForFileExtension(extname);
            }
        }
        if (!contentType) {
            contentType = 'text/html';
        }

        const { httpStatusCode } = formattedError;

        return response.respondWithUTF8(httpStatusCode, output, { contentType });
    };
}
