import path from 'node:path';
import { AssertionError, NotFoundError, BadRequestError } from '../errors/mod.js';
import { isBoolean, isNonEmptyString } from '../assertions/mod.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;
const INDEX_FILE_PATTERN = /index.(html|json)$/;


export function HyperviewHandler(options) {
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

        const config = context.config.getNamespace('Hyperview-Pages');

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

        const service = context.getService('Hyperview');

        let { pathname } = request.url;
        // Remove index files like /foo/bar/index.html to /foo/bar/.
        pathname = pathname.replace(indexFilePattern, '');

        const page = await service.getPageData(request, response, pathname, { useCache });

        if (!page) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        if (allowJSON && request.isJSONRequest()) {
            return response.respondWithJSON(200, page, { whiteSpace: 4 });
        }

        const baseTemplateId = page.baseTemplate || options.baseTemplate || config.baseTemplate;

        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(`A baseTemplate ID must be provided by the config, options, or page data (pathname:${ pathname })`);
        }

        const [ pageTemplate, content, baseTemplate ] = await Promise.all([
            service.getPageTemplate(pathname, { useCache }),
            service.getPageMarkdown(pathname, page, { useCache }),
            service.getBaseTemplate(baseTemplateId, { useCache }),
        ]);

        if (!pageTemplate) {
            throw new AssertionError(`The page template was not found (pathname:${ pathname })`);
        }
        if (!baseTemplate) {
            throw new AssertionError(`The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`);
        }

        let contentType = options.contentType || page.contentType;

        if (!contentType) {
            // First, try to get the content type from the base template filename.
            contentType = getContentTypeFromFilepath(baseTemplateId);
        }
        if (!contentType) {
            // If the base template file name does not yield a content type, then
            // fall back to the URL pathname.
            contentType = getContentTypeFromFilepath(pathname);
        }
        if (!contentType) {
            // Finally, use the default.
            contentType = 'text/html';
        }

        const templateContext = Object.assign({}, page, { content });
        page.body = pageTemplate(templateContext);

        const hypertext = baseTemplate(page);

        return response.respondWithUTF8(200, hypertext, { contentType });
    }

    async function getStaticFile(context, request, response) {
        const config = context.config.getNamespace('Hyperview-StaticFiles');

        const indexFileName = options.indexFileName || config.indexFileName || 'index.html';
        const cacheControl = options.cacheControl || config.cacheControl || 'no-cache';

        let useEtag = false;
        if (isBoolean(options.useEtag)) {
            useEtag = options.useEtag;
        } else if (isBoolean(config.useEtag)) {
            useEtag = config.useEtag;
        }

        let { pathname } = request.url;

        if (pathname.endsWith('/')) {
            pathname += indexFileName;
        }

        // May throw a BadRequestError
        validatePathname(pathname);

        const service = context.getService('Hyperview');

        const file = await service.getStaticFile(pathname);

        if (!file) {
            return null;
        }

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
                return response.respondNotModified();
            }
        }

        // Next, check If-Modified-Since and return a 304 if the resource is still fresh.
        if (ifModifiedSince && file.modifiedDate > ifModifiedSince) {
            return response.respondNotModified();
        }

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
