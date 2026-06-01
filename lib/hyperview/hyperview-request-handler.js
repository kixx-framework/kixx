import { NotFoundError, BadRequestError } from '../errors/mod.js';
import { AssertionError, isNonEmptyString, isBoolean } from '../assertions/mod.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;
const INDEX_FILE_PATTERN = /index\.(html|json|xml|md)$/;
// Strip format extensions used for content negotiation (e.g. /platform.json → /platform)
const FORMAT_EXTENSION_PATTERN = /\.json$/;


/**
 * Creates a request handler that fetches and renders Hyperview pages as HTML.
 *
 * Option values take precedence over environment variables. When an option is
 * omitted, the handler falls back to the corresponding env var via `context`
 * on each request (allowing per-environment configuration without redeployment).
 *
 * @param {Object} [options]
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames
 *   to strip from the URL pathname. Defaults to `index.(html|json|xml|md)`.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format
 *   extensions to strip from the URL pathname last segment for content negotiation.
 *   Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them.
 *   Falls back to the `HYPERVIEW_ALLOW_JSON_RESPONSE` env var.
 * @param {boolean} [options.useCache] - Enable Hyperview service caching.
 *   Falls back to the `HYPERVIEW_USE_CACHE` env var.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 * @param {boolean} [options.isStatic] - When true, passes null props to the service
 *   (skips dynamic response props for static pages).
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden
 *   per-page via `pageData.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `page.html`.
 *   Can be overridden per-page via `pageData.pageTemplate`.
 * @returns {Function} Async request handler `(context, request, response) => Promise<Response>`
 */
export default function HyperviewRequestHandler(options) {
    options = options ?? {};

    // Compile patterns and resolve option flags once at factory time.
    const indexFilePattern = isNonEmptyString(options.indexFilePattern)
        ? new RegExp(options.indexFilePattern)
        : INDEX_FILE_PATTERN;

    const formatExtensionPattern = isNonEmptyString(options.formatExtensionPattern)
        ? new RegExp(options.formatExtensionPattern)
        : FORMAT_EXTENSION_PATTERN;

    const hasAllowJSONOption = isBoolean(options.allowJSON);
    const hasUseCacheOption = isBoolean(options.useCache);

    return async function hyperviewRequestHandler(context, request, response) {
        // Fall back to env vars when options did not provide explicit booleans.
        const allowJSON = hasAllowJSONOption
            ? options.allowJSON
            : context.getEnvBoolean('HYPERVIEW_ALLOW_JSON_RESPONSE');

        const useCache = hasUseCacheOption
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
        const props = options.isStatic ? null : response.props;
        const pageData = await service.getPageData(context, url, pathname, props, { useCache });

        if (!pageData) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        // Return JSON representation of page data if client requested JSON and JSON is allowed
        if (allowJSON && request.isJSONRequest()) {
            return response.respondWithJSON(200, pageData, { whiteSpace: 4 });
        }

        let baseTemplateId = options.baseTemplate;
        if (isNonEmptyString(pageData.baseTemplate)) {
            baseTemplateId = pageData.baseTemplate;
        }
        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided by the HyperviewRequestHandler options, or page data (pathname:${ pathname })`,
            );
        }

        let pageTemplateId = 'page.html';
        if (isNonEmptyString(pageData.pageTemplate)) {
            pageTemplateId = pageData.pageTemplate;
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
        if (!pageTemplate) {
            throw new AssertionError(
                `The page template was not found (pathname:${ pathname })`,
            );
        }

        pageData.body = pageTemplate(pageData);
        const hypertext = baseTemplate(pageData);

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
