import { AssertionError, NotFoundError, BadRequestError } from '../errors.js';
import { isBoolean, isNonEmptyString } from '../assertions.js';
import PageRenderer from './page-renderer.js';
import { respondWithStaticFile } from './static-file-responder.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;
const INDEX_FILE_PATTERN = /index\.(html|json)$/;


/**
 * Creates a request handler for serving Hyperview pages and static files.
 *
 * The handler first attempts to serve a static file matching the request path. If no static
 * file exists, it loads and renders a Hyperview page using templates and optional markdown
 * content. Configuration can be provided via options or the application config under the
 * 'hyperview' namespace.
 *
 * @param {Object} [options] - Handler configuration options
 * @param {string} [options.pathname] - Override the URL pathname with this pathname
 * @param {boolean} [options.allowJSON] - Allow JSON responses when client requests JSON
 * @param {boolean} [options.useCache] - Cache page data and templates
 * @param {string} [options.indexFilePattern] - Regex pattern for index files to normalize (default: index.html|json)
 * @param {string} [options.baseTemplate] - Default base template ID for page rendering
 * @param {string} [options.templateFilename] - Explicit page template filename to load instead of page.html/page.xml
 * @param {string} [options.contentType] - Override content type for responses
 * @param {string} [options.indexFileName] - Index filename for directory paths (default: 'index.html')
 * @param {string} [options.cacheControl] - Cache-Control header value (default: 'no-cache')
 * @param {boolean} [options.useEtag] - Enable ETag generation for conditional requests
 * @returns {Function} Async request handler (context, request, response) => Promise<Response>
 */
export default function HyperviewRequestHandler(options) {
    options = options || {};

    async function hyperviewHandler(context, request, response) {
        // May throw a BadRequestError
        validatePathname(request.url.pathname);

        // Try the static file first.
        const staticFileResponse = await getStaticFile(context, request, response);
        if (staticFileResponse) {
            return staticFileResponse;
        }

        // If there is no static file for this path, then try using the page instead.

        const logger = context.logger.createChild('HyperviewPageHandler');
        const hyperviewConfig = context.config.getNamespace('hyperview');
        const config = hyperviewConfig.pages || {};

        let allowJSON = true;
        if (isBoolean(options.allowJSON)) {
            allowJSON = options.allowJSON;
        } else if (isBoolean(config.allowJSON)) {
            allowJSON = config.allowJSON;
        }

        let useCache = false;
        if (isBoolean(options.useCache)) {
            useCache = options.useCache;
        } else if (isBoolean(config.useCache)) {
            useCache = config.useCache;
        }

        let indexFilePattern = INDEX_FILE_PATTERN;
        if (options.indexFilePattern) {
            indexFilePattern = new RegExp(options.indexFilePattern);
        } else if (config.indexFilePattern) {
            indexFilePattern = new RegExp(config.indexFilePattern);
        }

        logger.debug('attempting page template', { allowJSON, useCache, indexFilePattern });

        const service = context.getService('Hyperview');
        const renderer = new PageRenderer(service);

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            pathname = request.url.pathname;
            // Remove index files like /foo/bar/index.html to /foo/bar/.
            // This normalizes paths so /blog/index.html and /blog/ both map to the same page
            pathname = pathname.replace(indexFilePattern, '');
        }

        // Load page data, merging response.props and hydrating metadata (canonical URL, Open Graph, etc.)
        // Returns null if page doesn't exist.
        const page = await service.getPageData(request, response, pathname, { useCache });

        if (!page) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        // Return JSON representation of page data if client requested JSON and JSON is allowed
        if (allowJSON && request.isJSONRequest()) {
            return response.respondWithJSON(200, page, { whiteSpace: 4 });
        }

        const baseTemplateId = page.baseTemplate || options.baseTemplate || config.baseTemplate;

        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided by the config, options, or page data (pathname:${ pathname })`
            );
        }

        const templateFilename = options.templateFilename || page.templateFilename;
        logger.info('responding with templated page', { pathname });

        const renderedPage = await renderer.renderPage({
            pathname,
            requestPathname: request.url.pathname,
            page,
            baseTemplateId,
            useCache,
            templateFilename,
            contentType: options.contentType || page.contentType,
            includeMarkdown: true,
        });

        return response.respondWithUtf8(200, renderedPage.hypertext, {
            contentType: renderedPage.contentType,
        });
    }

    async function getStaticFile(context, request, response) {
        const logger = context.logger.createChild('HyperviewStaticFile');
        const hyperviewConfig = context.config.getNamespace('hyperview');
        const config = hyperviewConfig.staticFiles || {};

        const indexFileName = options.indexFileName || config.indexFileName || 'index.html';
        const cacheControl = options.cacheControl || config.cacheControl || 'no-cache';

        let useEtag = false;
        if (isBoolean(options.useEtag)) {
            useEtag = options.useEtag;
        } else if (isBoolean(config.useEtag)) {
            useEtag = config.useEtag;
        }

        let { pathname } = request.url;

        // Append index file name to directory paths (e.g., /static/ -> /static/index.html)
        // This allows serving index files from directories without requiring the filename in the URL
        if (pathname.endsWith('/')) {
            pathname += indexFileName;
        }

        logger.debug('attempt serving static file', { pathname, useEtag });

        // May throw a BadRequestError if pathname contains invalid characters or path traversal attempts
        validatePathname(pathname);

        const service = context.getService('Hyperview');

        const file = await service.getStaticFile(pathname);

        if (!file) {
            logger.debug('no static file found', { pathname });
            return null;
        }

        return respondWithStaticFile({
            file,
            request,
            response,
            logger,
            useEtag,
            cacheControl,
            pathname,
        });
    }

    function validatePathname(pathname) {
        // Two dots or two slashes are always invalid
        if (pathname.includes('..') || pathname.includes('//')) {
            throw new BadRequestError(`Invalid static file path: ${ pathname }`);
        }

        const parts = pathname.split('/');

        for (const part of parts) {
            // In addition to the pattern list, a single dot at the start of
            // a path part is invalid.
            if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
                throw new BadRequestError(`Invalid static file path: ${ pathname }`);
            }
        }

        return pathname;
    }
    return hyperviewHandler;
}
