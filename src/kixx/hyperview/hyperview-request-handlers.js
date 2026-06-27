import { NotFoundError } from '../errors/mod.js';
import {
    AssertionError,
    isNonEmptyString,
    isBoolean,
    isPlainObject,
} from '../assertions/mod.js';
import deepMerge from '../utils/deep-merge.js';

import validatePathname from '../utils/validate-pathname.js';


const INDEX_FILE_PATTERN = /(?:^|\/)index\.(html|json|xml|md)$/;
// Strip format extensions used for content negotiation (e.g. /platform.json → /platform)
const FORMAT_EXTENSION_PATTERN = /\.json$/;

/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../http-router/server-request-interface.js').ServerRequestInterface} ServerRequestInterface
 */

/**
 * @typedef {import('../http-router/server-response.js').default} ServerResponse
 */


/**
 * Creates a request handler that fetches and renders static pages.
 *
 * This is useful when an endpoint target will not be hydrated by dynamic data
 * and the full page response can be cached.
 *
 * Option values take precedence over configuration. When a boolean option is
 * omitted, the handler falls back to the corresponding `config.env.HYPERVIEW`
 * setting.
 *
 * The page cache (rendered HTML) and the template cache (compiled base, page,
 * partial, and include render functions) are controlled independently.
 *
 * @param {Object} [options]
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames
 *   to strip from the URL pathname. Defaults to matching an `index.html`,
 *   `index.json`, `index.xml`, or `index.md` path segment at the end of the path.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format
 *   extensions to strip from the URL pathname last segment for content negotiation.
 *   Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them.
 *   Falls back to `config.env.HYPERVIEW.ALLOW_JSON_RESPONSE`.
 * @param {boolean} [options.usePageCache] - Enable full page (rendered HTML) caching.
 *   Falls back to `config.env.HYPERVIEW.USE_PAGE_CACHE`.
 * @param {boolean} [options.useTemplateCache] - Reuse compiled templates, partials, and includes.
 *   Falls back to `config.env.HYPERVIEW.USE_TEMPLATE_CACHE`.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden
 *   per-page via `metadata.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `[pathname]/page.html`.
 *   Can be overridden per-page via `metadata.pageTemplate`.
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse): Promise<ServerResponse>}
 *   Async request handler for the router pipeline.
 */
export function HyperviewStaticPageHandler(options) {
    options = options ?? {};

    // Compile caller-provided regex strings once at factory time.
    const indexFilePattern = isNonEmptyString(options.indexFilePattern)
        ? new RegExp(options.indexFilePattern)
        : INDEX_FILE_PATTERN;

    const formatExtensionPattern = isNonEmptyString(options.formatExtensionPattern)
        ? new RegExp(options.formatExtensionPattern)
        : FORMAT_EXTENSION_PATTERN;

    return async function hyperviewStaticPageHandler(context, request, response) {
        // Fall back to config when options did not provide explicit booleans.
        const allowJSON = isBoolean(options.allowJSON)
            ? options.allowJSON
            : getHyperviewConfigBoolean(context, 'ALLOW_JSON_RESPONSE');

        let usePageCache = isBoolean(options.usePageCache)
            ? options.usePageCache
            : getHyperviewConfigBoolean(context, 'USE_PAGE_CACHE');

        const useTemplateCache = isBoolean(options.useTemplateCache)
            ? options.useTemplateCache
            : getHyperviewConfigBoolean(context, 'USE_TEMPLATE_CACHE');

        if (request.isJSONRequest() && allowJSON) {
            // A JSON request implicitly asks for the most recent page metadata,
            // so never serve or store a cached full page for it.
            usePageCache = false;
        }

        const { url } = request;

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            pathname = stripIndexFile(url.pathname, indexFilePattern);
            // Strip format extension from the last path segment so content negotiation
            // extensions like .json don't change which page data is loaded.
            // /platform.json and /platform both load from pages/platform/page.json.
            pathname = pathname.replace(formatExtensionPattern, '');
        }

        pathname = validatePathname(pathname);

        const service = context.getService('Hyperview');

        const pageContent = await service.getPageMetadata(context, pathname);

        if (!pageContent) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        let hypertext;

        if (usePageCache) {
            hypertext = await service.getCachedPage(context, pathname, pageContent.version);
            if (hypertext) {
                return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
            }
        }

        // On a page-cache miss we build the page from compiled resources. Template
        // caching is independent of page caching, so reuse compiled templates only
        // when useTemplateCache is enabled, then cache the resulting page.

        const metadata = deepMerge(structuredClone(pageContent.metadata), response.props);

        // Merge in standard open graph metadata.
        metadata.page = service.mergePageMetadata(url, metadata);

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
            service.getBaseTemplate(context, baseTemplateId, { useCache: useTemplateCache }),
            service.getPageTemplate(context, pageTemplateId, { useCache: useTemplateCache }),
        ]);

        if (!baseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`,
            );
        }

        if (metadata.includes && Object.keys(metadata.includes).length > 0) {
            metadata.includes = await service.getIncludes(
                context,
                pathname,
                metadata.includes,
                { useCache: useTemplateCache, version: pageContent.version, metadata },
            );
        }

        if (pageTemplate) {
            metadata.body = pageTemplate(metadata);
        }

        hypertext = baseTemplate(metadata);

        if (usePageCache) {
            await service.setCachedPage(context, pathname, pageContent.version, hypertext);
        }

        return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
    };
}


/**
 * Creates a request handler that fetches and renders dynamic pages.
 *
 * Used when the response will be hydrated by dynamic data from the response
 * props from handlers which run before this.
 *
 * Option values take precedence over configuration. When a boolean option is
 * omitted, the handler falls back to the corresponding `config.env.HYPERVIEW`
 * setting.
 *
 * Dynamic full-page responses are never cached because they are rendered per
 * request from response props, so this handler has no page cache — only the
 * template cache (compiled base, page, partial, and include render functions).
 *
 * @param {Object} [options]
 * @param {string} [options.indexFilePattern] - Regex pattern string matching index filenames
 *   to strip from the URL pathname. Defaults to matching an `index.html`,
 *   `index.json`, `index.xml`, or `index.md` path segment at the end of the path.
 * @param {string} [options.formatExtensionPattern] - Regex pattern string matching format
 *   extensions to strip from the URL pathname last segment for content negotiation.
 *   Defaults to `\.json$`, so `/platform.json` resolves page data from `/platform`.
 * @param {boolean} [options.allowJSON] - Allow JSON responses when the client requests them.
 *   Falls back to `config.env.HYPERVIEW.ALLOW_JSON_RESPONSE`.
 * @param {boolean} [options.useTemplateCache] - Reuse compiled templates, partials, and includes.
 *   Falls back to `config.env.HYPERVIEW.USE_TEMPLATE_CACHE`.
 * @param {string} [options.pathname] - Override the pathname derived from the request URL.
 * @param {string} [options.baseTemplate] - Default base template ID. Can be overridden
 *   per-page via `metadata.baseTemplate`.
 * @param {string} [options.pageTemplate] - Default page template ID. Defaults to `[pathname]/page.html`.
 *   Can be overridden per-page via `metadata.pageTemplate`.
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse): Promise<ServerResponse>}
 *   Async request handler for the router pipeline.
 */
export function HyperviewDynamicPageHandler(options) {
    options = options ?? {};

    // Compile caller-provided regex strings once at factory time.
    const indexFilePattern = isNonEmptyString(options.indexFilePattern)
        ? new RegExp(options.indexFilePattern)
        : INDEX_FILE_PATTERN;

    const formatExtensionPattern = isNonEmptyString(options.formatExtensionPattern)
        ? new RegExp(options.formatExtensionPattern)
        : FORMAT_EXTENSION_PATTERN;

    return async function hyperviewDynamicPageHandler(context, request, response) {
        // Fall back to config when options did not provide explicit booleans.
        const allowJSON = isBoolean(options.allowJSON)
            ? options.allowJSON
            : getHyperviewConfigBoolean(context, 'ALLOW_JSON_RESPONSE');

        const useTemplateCache = isBoolean(options.useTemplateCache)
            ? options.useTemplateCache
            : getHyperviewConfigBoolean(context, 'USE_TEMPLATE_CACHE');

        const { url } = request;

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            pathname = stripIndexFile(url.pathname, indexFilePattern);
            // Strip format extension from the last path segment so content negotiation
            // extensions like .json don't change which page data is loaded.
            // /platform.json and /platform both load from pages/platform/page.json.
            pathname = pathname.replace(formatExtensionPattern, '');
        }

        pathname = validatePathname(pathname);
        const service = context.getService('Hyperview');

        const pageContent = await service.getPageMetadata(context, pathname);

        if (!pageContent) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        // Dynamic pages are rendered per request; the template cache only reuses
        // compiled template resources, never the final HTML.

        const metadata = deepMerge(structuredClone(pageContent.metadata), response.props);

        // Merge in standard open graph metadata.
        metadata.page = service.mergePageMetadata(url, metadata);

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
            service.getBaseTemplate(context, baseTemplateId, { useCache: useTemplateCache }),
            service.getPageTemplate(context, pageTemplateId, { useCache: useTemplateCache }),
        ]);

        if (!baseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`,
            );
        }

        if (metadata.includes && Object.keys(metadata.includes).length > 0) {
            metadata.includes = await service.getIncludes(
                context,
                pathname,
                metadata.includes,
                { useCache: useTemplateCache, version: pageContent.version, metadata },
            );
        }

        if (pageTemplate) {
            metadata.body = pageTemplate(metadata);
        }

        const hypertext = baseTemplate(metadata);

        return response.respondWithUtf8(response.status, hypertext, { contentType: 'text/html' });
    };
}


function stripIndexFile(pathname, indexFilePattern) {
    return pathname.replace(indexFilePattern, (match) => {
        // Preserve the parent slash when the pattern consumes `/index.html`.
        return match.startsWith('/') ? '/' : '';
    });
}

// Hyperview settings live under the HYPERVIEW section of the resolved
// environment bundle, which readConfig exposes as config.env. Values are
// normally authored as JSON booleans, but also accept the string/number
// vocabulary used elsewhere for environment values so hand-edited configs
// behave consistently. A missing section or key resolves to false.
function getHyperviewConfigBoolean(context, key) {
    const hyperviewConfig = context.config?.env?.HYPERVIEW;

    if (!isPlainObject(hyperviewConfig)) {
        return false;
    }

    switch (hyperviewConfig[key]) {
        case true:
        case 1:
        case 'true':
        case '1':
            return true;
        default:
            return false;
    }
}
