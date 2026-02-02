import path from 'node:path';
import { AssertionError, NotFoundError, BadRequestError } from '../errors/mod.js';
import { isBoolean, isNonEmptyString } from '../assertions/mod.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';


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
 * @param {string} [options.contentType] - Override content type for responses
 * @param {string} [options.indexFileName] - Index filename for directory paths (default: 'index.html')
 * @param {string} [options.cacheControl] - Cache-Control header value (default: 'no-cache')
 * @param {boolean} [options.useEtag] - Enable ETag generation for conditional requests
 * @returns {Function} Async request handler function (context, request, response) => Response
 */
export default function RequestHandler(options) {
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

        // Load page template function, markdown content, and base template in parallel
        const [ pageTemplate, content, baseTemplate ] = await Promise.all([
            service.getPageTemplate(pathname, { useCache }),
            service.getPageMarkdown(pathname, page, { useCache }),
            service.getBaseTemplate(baseTemplateId, { useCache }),
        ]);

        if (!pageTemplate) {
            throw new AssertionError(
                `The page template was not found (pathname:${ pathname })`
            );
        }
        if (!baseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`
            );
        }

        logger.info('responding with templated page', { pathname });

        let contentType = options.contentType || page.contentType;

        if (!contentType) {
            // First, try to get the content type from the base template filename.
            contentType = getContentTypeFromFilepath(baseTemplateId);
        }
        if (!contentType) {
            // If the base template file name does not yield a content type, then
            // fall back to the URL pathname.
            contentType = getContentTypeFromFilepath(request.url.pathname);
        }
        if (!contentType) {
            // Finally, use the default.
            contentType = 'text/html';
        }

        // Render page template with content to generate `page.body`. Create templateContext with
        // markdown content (`content`) added, then render page template function. The page
        // object is already cloned by getPageData(), so mutating page.body is safe
        const templateContext = Object.assign({}, page, { content });
        page.body = pageTemplate(templateContext);

        // Render base template with full page object (including page.body) to produce final HTML
        const hypertext = baseTemplate(page);

        return response.respondWithUtf8(200, hypertext, { contentType });
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

        // Set cache-related headers for conditional requests (304 Not Modified responses)
        let etag;
        if (useEtag) {
            etag = await file.computeEtag();
            response.headers.set('etag', `"${ etag }"`);
        }

        response.headers.set('last-modified', file.modifiedDate.toUTCString());

        if (cacheControl) {
            response.headers.set('cache-control', cacheControl);
        }

        const { ifNoneMatch, ifModifiedSince } = request;

        // Check the etag first, and return a 304 if it matches.
        if (useEtag && ifNoneMatch) {
            if (ifNoneMatch === etag) {
                logger.debug('resource not modified; etag match', { etag });
                return response.respondNotModified();
            }
        }

        // Next, check If-Modified-Since and return a 304 if the resource hasn't been modified.
        if (ifModifiedSince && file.modifiedDate <= ifModifiedSince) {
            logger.debug('resource not modified; not modified since', { ifModifiedSince });
            return response.respondNotModified();
        }

        logger.info('stream static file', { pathname, sizeBytes: file.sizeBytes });

        const contentType = file.contentType || 'application/octet-stream';

        response.headers.set('content-type', contentType);

        let readStream = null;
        if (!request.isHeadRequest()) {
            readStream = file.createReadStream();
        }

        return response.respondWithStream(200, file.sizeBytes, readStream);
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

    function getContentTypeFromFilepath(filepath) {
        const extname = path.extname(filepath);
        if (extname) {
            // Slice the "." off of the extension so ".jpeg" becomes "jpeg"
            return getContentTypeForFileExtension(extname.slice(1));
        }
        return null;
    }

    return hyperviewHandler;
}
