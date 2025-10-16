import path from 'node:path';
import { isNonEmptyString } from '../assertions/mod.js';
import { NotFoundError } from '../errors/mod.js';
import { getContentTypeForFileExtension } from '../http-utils.js';


/**
 * PageHandler
 * ===========
 *
 * Returns a request handler function that renders a page using the application's view service.
 *
 * @function PageHandler
 * @param {Object} options - Options for the page handler.
 * @param {string} [options.pathname] - Optional pathname to use instead of the request URL pathname.
 * @param {string} [options.contentType] - Optional content type to use instead of the page data's contentType.
 * @returns {Function} An async request handler function for rendering pages.
 */
export default function PageHandler(options) {

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
        const pathname = options.pathname || request.url.pathname;

        const viewService = context.getService('kixx.AppViewService');

        const pageExists = await viewService.doesPageExist(pathname);
        if (!pageExists) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        const props = await viewService.getPageData(pathname, response.props);

        props.title = await viewService.hydrateMetadataTemplate('title', props.title, props);
        props.description = await viewService.hydrateMetadataTemplate('description', props.description, props);

        if (!isNonEmptyString(props.canonicalURL)) {
            props.canonicalURL = urlToCanonicalURLString(request.url);
        }

        const openGraph = props.openGraph || {};

        if (!isNonEmptyString(openGraph.type)) {
            openGraph.type = 'website';
        }

        openGraph.title = props.title;

        props.openGraph = openGraph;

        if (request.isJSONRequest()) {
            return response.respondWithJSON(200, props, { whiteSpace: 4 });
        }

        const baseTemplateId = props.baseTemplateId || options.baseTemplateId;

        const [ body, template ] = await Promise.all([
            viewService.getPageMarkup(pathname, props),
            viewService.getBaseTemplate(baseTemplateId),
        ]);

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

        const ctx = Object.assign({}, props, { body });
        const output = template ? template(ctx) : body;

        return response.respondWithUTF8(200, output, { contentType });
    };
}

function urlToCanonicalURLString(url) {
    const { protocol, host, pathname } = url;
    return `${ protocol }//${ host }${ pathname }`;
}
