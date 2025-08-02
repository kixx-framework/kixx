import { NotFoundError } from '../../errors/mod.js';


/**
 * PageHandler
 * ===========
 *
 * Returns a request handler function that renders a page using the application's view service.
 *
 * @function PageHandler
 * @param {Object} spec - Specification for the page handler.
 * @param {string} [spec.pathname] - Optional pathname to use instead of the request URL pathname.
 * @returns {Function} An async request handler function for rendering pages.
 */
export default function PageHandler(spec) {
    /**
     * Returns an async request handler function that renders a page using the application's view service.
     *
     * @function pageHandler
     * @async
     * @param {Object} context - The application context, containing services and configuration.
     * @param {Object} request - The HTTP request object.
     * @param {Object} response - The HTTP response object.
     * @returns {Promise<Object>} The HTTP response with rendered HTML or JSON.
     * @throws {NotFoundError} If the page body or base template is not found.
     */
    return async function pageHandler(context, request, response) {
        const pathname = spec.pathname || request.url.pathname;

        const viewService = context.getService('kixx.AppViewService');

        const pageData = await viewService.getPageData(pathname, response.props);

        if (request.isJSONRequest()) {
            return response.respondWithJSON(200, pageData, { whiteSpace: 4 });
        }

        const [ body, template ] = await Promise.all([
            viewService.getPageMarkup(pathname, pageData),
            viewService.getBaseTemplate(pageData.baseTemplateId),
        ]);

        if (!body) {
            throw new NotFoundError(`no page body found for ${ pathname }`);
        }
        if (!template) {
            throw new NotFoundError(`no base template found for ${ pathname }`);
        }

        const ctx = Object.assign({}, pageData, { body });
        const html = template(ctx);

        return response.respondWithHTML(200, html);
    };
}
