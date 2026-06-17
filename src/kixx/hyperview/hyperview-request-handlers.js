import { NotFoundError, BadRequestError } from '../errors/mod.js';
import { AssertionError, isNonEmptyString, isBoolean } from '../assertions/mod.js';
import deepMerge from '../utils/deep-merge.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;
const INDEX_FILE_PATTERN = /index\.(html|json|xml|md)$/;
// Strip format extensions used for content negotiation (e.g. /platform.json → /platform)
const FORMAT_EXTENSION_PATTERN = /\.json$/;


/**
 * Creates a request handler that fetches and renders static pages.
 *
 * This is useful when an endpoint target will not by hydrated by dynamic data
 * and the full page response can be cached.
 *
 * Option values take precedence over environment variables. When an option is
 * omitted, the handler falls back to the corresponding env var.
 *
 * @param {Object} [options]
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames
 *   to strip from the URL pathname. Defaults to `index.(html|json|xml|md)`.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format
 *   extensions to strip from the URL pathname last segment for content negotiation.
 *   Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them.
 *   Falls back to the `HYPERVIEW_ALLOW_JSON_RESPONSE` env var.
 * @param {boolean} [options.useCache] - Enable full page caching.
 *   Falls back to the `HYPERVIEW_USE_CACHE` env var.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden
 *   per-page via `metadata.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `[pathname]/page.html`.
 *   Can be overridden per-page via `metadata.pageTemplate`.
 * @returns {Function} Async request handler `(context, request, response) => Promise<Response>`
 */
export function HyperviewStaticPageHandler(options) {
    options = options ?? {};

    // Compile patterns and resolve option flags once at factory time.
    const indexFilePattern = isNonEmptyString(options.indexFilePattern)
        ? new RegExp(options.indexFilePattern)
        : INDEX_FILE_PATTERN;

    const formatExtensionPattern = isNonEmptyString(options.formatExtensionPattern)
        ? new RegExp(options.formatExtensionPattern)
        : FORMAT_EXTENSION_PATTERN;

    return async function hyperviewStaticPageHandler(context, request, response) {
        // Fall back to env vars when options did not provide explicit booleans.
        const allowJSON = isBoolean(options.allowJSON)
            ? options.allowJSON
            : context.getEnvBoolean('HYPERVIEW_ALLOW_JSON_RESPONSE');

        let useCache = isBoolean(options.useCache)
            ? options.useCache
            : context.getEnvBoolean('HYPERVIEW_USE_CACHE');

        if (useCache === true && request.isJSONRequest() && allowJSON) {
            // If this is a JSON request, implicitly asking for the most recent page metadata,
            // then turn page caching off for this request.
            useCache = false;
        }

        const { url } = request;

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            // Remove index files like /foo/bar/index.html to /foo/bar/.
            // This normalizes paths so /blog/index.html and /blog/ both map to the same page.
            pathname = url.pathname.replace(indexFilePattern, '');
            // Strip format extension from the last path segment so content negotiation
            // extensions like .json don't change which page data is loaded.
            // /platform.json and /platform both load from pages/platform/page.json.
            pathname = pathname.replace(formatExtensionPattern, '');
        }

        pathname = validatePathname(pathname);

        const service = context.getService('Hyperview');
        const contentCacheKey = await service.getContentCacheKey(context);

        let hypertext;

        if (useCache) {
            hypertext = await service.getCachedPage(context, pathname, contentCacheKey);
            if (hypertext) {
                return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
            }
        }

        // If the full page was not cached, we do not use cached resources to build it. Instead
        // we use fresh resources and then cache the resulting page.

        const contentData = await service.getPageMetadata(context, contentCacheKey, pathname);

        if (!contentData) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        const metadata = deepMerge(structuredClone(contentData), response.props);

        const page = metadata.page ?? {};
        // Merge in standard open graph metadata.
        metadata.page = service.mergePageMetadata(url, page);

        // Return JSON representation of page data if client requested JSON and JSON is allowed
        if (allowJSON && request.isJSONRequest()) {
            return response.respondWithJSON(200, metadata, { whiteSpace: 4 });
        }

        let baseTemplateId = options.baseTemplate;
        if (isNonEmptyString(metadata.baseTemplate)) {
            baseTemplateId = metadata.baseTemplate;
        }
        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided by the HyperviewStaticPageHandler options, or page data (pathname:${ pathname })`,
            );
        }

        let pageTemplateId = `${ pathname.replace(/\/$/, '') }/page.html`;
        if (isNonEmptyString(metadata.pageTemplate)) {
            pageTemplateId = metadata.pageTemplate;
        } else if (isNonEmptyString(options.pageTemplate)) {
            pageTemplateId = options.pageTemplate;
        }

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            service.getBaseTemplate(context, baseTemplateId, { useCache }),
            service.getPageTemplate(context, pathname, pageTemplateId, { useCache }),
        ]);

        if (!baseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`,
            );
        }

        if (metadata.includes && Object.keys(metadata.includes).length > 0) {
            metadata.includes = await service.getIncludes(context, contentCacheKey, pathname, metadata.includes);
        }

        metadata.body = pageTemplate(metadata);
        hypertext = baseTemplate(metadata);

        if (useCache) {
            await service.setCachedPage(context, pathname, contentCacheKey, hypertext);
        }

        return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
    };
}


/**
 * Creates a request handler that fetches and renders dynamic pages.
 *
 * Used when the response will by hydrated by dynamic data from the response
 * props from handlers which run before this.
 *
 * Option values take precedence over environment variables. When an option is
 * omitted, the handler falls back to the corresponding env var.
 *
 * @param {Object} [options]
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames
 *   to strip from the URL pathname. Defaults to `index.(html|json|xml|md)`.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format
 *   extensions to strip from the URL pathname last segment for content negotiation.
 *   Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them.
 *   Falls back to the `HYPERVIEW_ALLOW_JSON_RESPONSE` env var.
 * @param {boolean} [options.useCache] - Enable full page caching.
 *   Falls back to the `HYPERVIEW_USE_CACHE` env var.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden
 *   per-page via `metadata.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `[pathname]/page.html`.
 *   Can be overridden per-page via `metadata.pageTemplate`.
 * @returns {Function} Async request handler `(context, request, response) => Promise<Response>`
 */
export function HyperviewDynamicPageHandler(options) {
    options = options ?? {};

    // Compile patterns and resolve option flags once at factory time.
    const indexFilePattern = isNonEmptyString(options.indexFilePattern)
        ? new RegExp(options.indexFilePattern)
        : INDEX_FILE_PATTERN;

    const formatExtensionPattern = isNonEmptyString(options.formatExtensionPattern)
        ? new RegExp(options.formatExtensionPattern)
        : FORMAT_EXTENSION_PATTERN;

    return async function hyperviewDynamicPageHandler(context, request, response) {
        // Fall back to env vars when options did not provide explicit booleans.
        const allowJSON = isBoolean(options.allowJSON)
            ? options.allowJSON
            : context.getEnvBoolean('HYPERVIEW_ALLOW_JSON_RESPONSE');

        const useCache = isBoolean(options.useCache)
            ? options.useCache
            : context.getEnvBoolean('HYPERVIEW_USE_CACHE');

        const { url } = request;

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            // Remove index files like /foo/bar/index.html to /foo/bar/.
            // This normalizes paths so /blog/index.html and /blog/ both map to the same page.
            pathname = url.pathname.replace(indexFilePattern, '');
            // Strip format extension from the last path segment so content negotiation
            // extensions like .json don't change which page data is loaded.
            // /platform.json and /platform both load from pages/platform/page.json.
            pathname = pathname.replace(formatExtensionPattern, '');
        }

        pathname = validatePathname(pathname);

        const service = context.getService('Hyperview');
        const contentCacheKey = await service.getContentCacheKey(context);

        const contentData = await service.getPageMetadata(
            context,
            contentCacheKey,
            pathname,
            { useCache },
        );

        if (!contentData) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        const metadata = deepMerge(structuredClone(contentData), response.props);

        const page = metadata.page ?? {};
        // Merge in standard open graph metadata.
        metadata.page = service.mergePageMetadata(url, page);

        // Return JSON representation of page data if client requested JSON and JSON is allowed
        if (allowJSON && request.isJSONRequest()) {
            return response.respondWithJSON(200, metadata, { whiteSpace: 4 });
        }

        let baseTemplateId = options.baseTemplate;
        if (isNonEmptyString(metadata.baseTemplate)) {
            baseTemplateId = metadata.baseTemplate;
        }
        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided by the HyperviewDynamicPageHandler options, or page data (pathname:${ pathname })`,
            );
        }

        let pageTemplateId = `${ pathname.replace(/\/$/, '') }/page.html`;
        if (isNonEmptyString(metadata.pageTemplate)) {
            pageTemplateId = metadata.pageTemplate;
        } else if (isNonEmptyString(options.pageTemplate)) {
            pageTemplateId = options.pageTemplate;
        }

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            service.getBaseTemplate(context, baseTemplateId, { useCache }),
            service.getPageTemplate(context, pathname, pageTemplateId, { useCache }),
        ]);

        if (!baseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`,
            );
        }

        if (metadata.includes && Object.keys(metadata.includes).length > 0) {
            metadata.includes = await service.getIncludes(
                context,
                contentCacheKey,
                pathname,
                metadata.includes,
                { useCache },
            );
        }

        metadata.body = pageTemplate(metadata);
        const hypertext = baseTemplate(metadata);

        return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
    };
}


/**
 * Validates a pathname against path traversal and disallowed characters.
 * @param {string} pathname
 * @returns {string} The validated pathname, unchanged
 * @throws {BadRequestError} When the pathname contains `..`, `//`, a leading dot on any
 *   path segment, or characters outside `[a-z0-9_.-]`.
 */
function validatePathname(pathname) {
    // Two dots or two slashes are always invalid
    if (pathname.includes('..') || pathname.includes('//')) {
        throw new BadRequestError(`Invalid pathname: ${ pathname }`);
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // In addition to the pattern list, a single dot at the start of
        // a path part is invalid.
        if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
            throw new BadRequestError(`Invalid pathname: ${ pathname }`);
        }
    }

    return pathname;
}
