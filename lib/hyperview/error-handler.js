import { AssertionError } from '../errors.js';
import { isBoolean, isUndefined, isNonEmptyString } from '../assertions.js';
import PageRenderer from './page-renderer.js';


/**
 * Creates an error handler for rendering Hyperview error pages.
 *
 * Renders error responses using Hyperview templates based on HTTP status codes (e.g., "404", "500")
 * or a generic "error" template as fallback. Returns JSON for JSON requests or when no template
 * is found. Can be configured to handle only expected errors or all errors, and to expose error
 * details in the response.
 *
 * @param {Object} [options] - Handler configuration options
 * @param {boolean} [options.handleUnexpectedErrors=true] - Handle unexpected errors; if false, returns false to defer to next handler
 * @param {boolean} [options.exposeErrorDetails=false] - Include error name, code, message, and stack in response props
 * @param {boolean} [options.useCache] - Cache page data and templates
 * @param {string} [options.pathname] - Override error page pathname (default: HTTP status code or "error")
 * @param {string} [options.baseTemplate] - Default base template ID for error page rendering
 * @param {string} [options.contentType] - Override content type for responses
 * @returns {Function} Async error handler function (context, request, response, error) => Response|false
 */
export default function HyperviewErrorHandler(options) {
    options = options || {};

    return async function errorHandler(context, request, response, error) {
        const logger = context.logger.createChild('HyperviewErrorHandler');
        const hyperviewConfig = context.config.getNamespace('hyperview');
        const config = hyperviewConfig.errorHandler || {};
        const pageConfig = hyperviewConfig.pages || {};

        let handleUnexpectedErrors = true;
        if (isBoolean(options.handleUnexpectedErrors)) {
            handleUnexpectedErrors = options.handleUnexpectedErrors;
        } else if (isBoolean(config.handleUnexpectedErrors)) {
            handleUnexpectedErrors = config.handleUnexpectedErrors;
        }

        let exposeErrorDetails = false;
        if (isBoolean(options.exposeErrorDetails)) {
            exposeErrorDetails = options.exposeErrorDetails;
        } else if (isBoolean(config.exposeErrorDetails)) {
            exposeErrorDetails = config.exposeErrorDetails;
        }

        let useCache = false;
        if (isBoolean(options.useCache)) {
            useCache = options.useCache;
        } else if (isBoolean(pageConfig.useCache)) {
            useCache = pageConfig.useCache;
        }

        logger.debug('handle error', { handleUnexpectedErrors, exposeErrorDetails, useCache });

        if (!isErrorExpected(error) && !handleUnexpectedErrors) {
            // Returning false will defer to the next error handler if there is one.
            logger.info('will not handle unexpected error');
            return false;
        }

        const formattedError = {
            name: error.name,
            code: error.code,
            message: error.message,
            expected: Boolean(error.expected),
            httpStatusCode: error.httpStatusCode || 500,
            stack: error.stack,
        };

        // Only add the error details to the response props if the exposeErrorDetails flag is set.
        if (exposeErrorDetails) {
            response.updateProps({ error: formattedError });
        }

        // Special handling for the MethodNotAllowed error.
        if (error.httpStatusCode === 405 && error.allowedMethods?.length > 0) {
            response.headers.set('Allow', error.allowedMethods.join(', '));
        }

        let pathname = options.pathname;
        if (!isNonEmptyString(pathname)) {
            // Use HTTP status code as pathname (e.g., 404 → "404", generic error → "error")
            pathname = error.httpStatusCode ? error.httpStatusCode.toString() : 'error';
        }

        const hyperview = context.getService('Hyperview');
        const renderer = new PageRenderer(hyperview);

        let page = await hyperview.getPageData(request, response, pathname, { useCache });
        let pageTemplate = await hyperview.getPageTemplate(pathname, { useCache });

        // Default to the "error" pathname if there is not one registered for the
        // HTTP status code.
        if (pathname !== 'error' && !pageTemplate) {
            pathname = 'error';
            page = await hyperview.getPageData(request, response, pathname, { useCache });
            pageTemplate = await hyperview.getPageTemplate(pathname, { useCache });
        }

        // Use a copy when falling back to response.props so we don't mutate the response object
        page = page || Object.assign({}, response.props);

        // Return JSON representation of page data if client requested JSON or
        // no template could be found.
        if (request.isJSONRequest() || !pageTemplate) {
            if (pageTemplate) {
                logger.info('responding with JSON', { pathname });
            } else {
                logger.warn('could not find page template; responding with JSON', { pathname });
            }
            return response.respondWithJSON(formattedError.httpStatusCode, page, { whiteSpace: 4 });
        }

        const baseTemplateId = page.baseTemplate || options.baseTemplate || config.baseTemplate || pageConfig.baseTemplate;

        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided by the config, options, or page data (pathname:${ pathname })`
            );
        }

        logger.info('responding with templated page', { pathname });

        // pageTemplate was already fetched above (and possibly re-fetched on the "error"
        // fallback path), so we pass it directly to avoid a redundant load inside renderPage.
        // renderPage accepts null for pageTemplate and will load it itself — that path is used
        // by the request handler, which hasn't pre-loaded the template.
        const renderedPage = await renderer.renderPage({
            pathname,
            requestPathname: request.url.pathname,
            page,
            baseTemplateId,
            useCache,
            contentType: options.contentType || page.contentType,
            includeMarkdown: false,
            pageTemplate,
        });

        return response.respondWithUtf8(formattedError.httpStatusCode, renderedPage.hypertext, {
            contentType: renderedPage.contentType,
        });
    };
}

function isErrorExpected(error) {
    // The error is considered "expected" if the #expected boolean flag is set or
    // the #httpStatusCode is set.
    return error.expected || !isUndefined(error.httpStatusCode);
}
