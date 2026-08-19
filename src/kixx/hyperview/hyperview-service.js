import { NotFoundError } from '../errors/mod.js';
import HyperviewPage from './hyperview-page.js';
import * as templating from '../templating/mod.js';
import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';
import {
    assert,
    assertArray,
    assertFunction,
    assertNonEmptyString,
    isFunction,
    isNonEmptyString,
} from '../assertions/mod.js';

// NOTE: There are private methods on HyperviewService marked with the @private
//       tag instead of prefixed by "#". This is intentional, to allow unit
//       testing coverage to be more thorough.

/**
 * Builds a partials lookup that checks `primary` before falling back to
 * `secondary`. Unlike a merged copy, this delegates every lookup to the
 * live Maps at render time, so mutating either Map in place (as the
 * template caches do on refresh) is visible to every template already
 * compiled against the delegator, with no recompilation required.
 * @param {Map<string, Function>} primary - Consulted first; wins on a shared id
 * @param {Map<string, Function>} secondary - Consulted when `primary` has no entry
 * @returns {{ has: Function, get: Function }} A partials-lookup view usable by the template renderer
 */
function layerPartials(primary, secondary) {
    return {
        has(id) {
            return primary.has(id) || secondary.has(id);
        },
        get(id) {
            return primary.has(id) ? primary.get(id) : secondary.get(id);
        },
    };
}

export default class HyperviewService {

    #logger;
    #store;
    #kvStore;
    #useTemplateCache;
    #usePageCache;
    #pageCacheReadTtlSeconds;
    #pageCacheExpirationSeconds;
    #allowJsonResponse;

    #customHelpers = new Map([
        [ 'formatDate', formatDate ],
        [ 'markup', markup ],
        [ 'truncate', truncate ],
    ]);

    // The base templates cache, indexed by template id
    #baseTemplates = new Map();

    // The global partials cache, indexed by template id
    #globalPartials = new Map();

    // The active global partials load shared by concurrent requests
    #globalPartialsLoadPromise = null;

    // The page templates cache, indexed by page pathname
    #pageTemplates = new Map();

    // The page partials templates cache, indexed by page pathname
    #pagePartials = new Map();

    /**
     * @param {Object} options
     * @param {import('../logger/logger.js').default} options.logger - Root logger used to create a HyperviewService child logger
     * @param {boolean} [options.useTemplateCache=false] - Reuse compiled templates while their content hashes remain current. Fixed for the lifetime of this instance so concurrent requests can never race each other into a mismatched cache state; respondWithHypertext() has no per-call override for this one.
     * @param {boolean} [options.usePageCache=false] - Default for respondWithHypertext()'s options.usePageCache; overridable per call.
     * @param {number} [options.pageCacheReadTtlSeconds=86400] - Default for respondWithHypertext()'s options.pageCacheReadTtlSeconds; overridable per call.
     * @param {number} [options.pageCacheExpirationSeconds=86400] - Default for respondWithHypertext()'s options.pageCacheExpirationSeconds; overridable per call.
     * @param {boolean} [options.allowJsonResponse=false] - Default for respondWithHypertext()'s options.allowJsonResponse; overridable per call.
     */
    constructor(options) {
        const {
            logger,
            useTemplateCache = false,
            usePageCache = false,
            pageCacheReadTtlSeconds = 60 * 60 * 24,
            pageCacheExpirationSeconds = 60 * 60 * 24,
            allowJsonResponse = false,
        } = options ?? {};
        assert(logger, 'HyperviewService requires a logger');
        this.#logger = logger.createChild('HyperviewService');
        this.#useTemplateCache = useTemplateCache;
        this.#usePageCache = usePageCache;
        this.#pageCacheReadTtlSeconds = pageCacheReadTtlSeconds;
        this.#pageCacheExpirationSeconds = pageCacheExpirationSeconds;
        this.#allowJsonResponse = allowJsonResponse;
    }

    /**
     * @param {Object} args
     * @param {KeyValueStoreInterface} args.kvStore - A KeyValueStore port for full-page caching.
     * @param {ContentAddressableStore} args.contentAddressableStore - A ContentAddressableStore port for page metedata, include files, and templates.
     */
    initialize(args) {
        const { contentAddressableStore, kvStore } = args ?? {};
        assert(kvStore, 'HyperviewService#initialize() requires a kvStore');
        assert(contentAddressableStore, 'HyperviewService#initialize() requires a contentAddressableStore');

        this.#store = contentAddressableStore;
        this.#kvStore = kvStore;
    }

    /**
     * Asserts that a value is a canonical ContentAddressableStore identifier.
     * Proxies to the underlying ContentAddressableStore.
     * @param {*} value - Value to assert
     * @param {string} messagePrefix - Caller context included in assertion messages
     * @returns {void}
     * @throws {AssertionError} When value is empty, invalid, or not lower case
     */
    assertCanonicalIdentifier(value, messagePrefix) {
        assert(
            this.#store.isValidPathname(value),
            `${ messagePrefix } must be a valid pathname`,
        );
    }

    /**
     * Reports whether a URL or logical pathname contains only safe path segments.
     * Proxies to the underlying ContentAddressableStore.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(value) {
        return this.#store.isValidPathname(value);
    }

    /**
     * Compiles template source into a render function. Custom helpers override built-ins
     * when they share the same key.
     * @param {string} templateId - Unique identifier used in error reporting
     * @param {string} source - Template source code
     * @param {Map<string, Function>} customHelpers - Helper functions that override built-in helpers
     * @param {Map<string, Function>} partials - Compiled partial templates keyed by partial name
     * @returns {Function} Render function: accepts a data object and returns a rendered string
     */
    compileTemplate(templateId, source, customHelpers, partials) {
        const helpers = new Map([...templating.helpers, ...customHelpers]);

        const tokens = templating.tokenize(null, templateId, source);
        const tree = templating.buildSyntaxTree(null, tokens);

        return templating.createRenderFunction(null, helpers, partials, tree);
    }

    /**
     * Compiles a template with helpers but no partials; useful for metadata fields
     * like title and description which contain template syntax that can be
     * rendered with the page context.
     * @param {string} templateId - Unique identifier used in error messages
     * @param {string} templateSource - Template source text which may contain template syntax
     * @returns {Function} Render function: accepts a data object and returns a rendered string
     */
    createMiniTemplate(templateId, templateSource) {
        const partials = new Map();
        return this.compileTemplate(templateId, templateSource, this.#customHelpers, partials);
    }

    /**
     * Loads the global partial templates from the ContentAddressableStore and
     * compiles them into template functions. If this service was constructed
     * with useTemplateCache enabled then partials will be cached in
     * application memory using the partials hash from the
     * ContentAddressableStore as a cache invalidation key.
     * @private
     * @return {Map} The private #globalPartials Map
     */
    async loadGlobalPartials(context) {
        if (this.#globalPartialsLoadPromise) {
            return this.#globalPartialsLoadPromise;
        }

        const loadPromise = this.#loadGlobalPartials(context);
        this.#globalPartialsLoadPromise = loadPromise;

        try {
            return await loadPromise;
        } finally {
            if (this.#globalPartialsLoadPromise === loadPromise) {
                this.#globalPartialsLoadPromise = null;
            }
        }
    }

    async #loadGlobalPartials(context) {
        const stats = await this.#store.statTemplatePartials(context);

        // Use the etag from the content-addressable storage as
        // the cache invalidation key. The etag is kept as a property on the
        // Map instance, rather than an entry in it, so it can never collide
        // with a partial id (e.g. a partial literally named "_etag").
        if (this.#useTemplateCache && stats?.etag && this.#globalPartials.etag === stats.etag) {
            return this.#globalPartials;
        }

        const partials = await this.#store.getTemplatePartials(context);

        // Clear old partials, but do not replace the Map:
        // Existing compiled templates depend on it.
        this.#globalPartials.clear();

        if (!partials) {
            // No template partials defined for this application.
            this.#globalPartials.etag = null;
            return this.#globalPartials;
        }

        // Reset the etag as the cache invalidation key.
        this.#globalPartials.etag = partials.etag;

        for (const { id, source } of partials.json()) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from global template partials`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from global template partials`,
            );
            const template = this.compileTemplate(id, source, this.#customHelpers, this.#globalPartials);
            this.#globalPartials.set(id, template);
        }

        return this.#globalPartials;
    }

    /**
     * Extracts page level partial templates from a HyperviewPage which has already
     * been loaded. Also loads the global partials to be used when compiling the
     * page partials. If this service was constructed with useTemplateCache
     * enabled and the page partials hash from the ContentAddressableStore
     * still matches, the cached Map is returned as-is.
     * @private
     * @return {Map} The page-specific partial template Map for the given page.pathname
     */
    async getPagePartials(context, page) {

        // Keep the same Map instance for this pathname across rebuilds, rather
        // than replacing it, so that page and base templates already compiled
        // against it (via layerPartials()) keep seeing current content after
        // an in-place refresh instead of needing to be recompiled.
        let pagePartials = this.#pagePartials.get(page.pathname);

        if (!page.partials) {
            if (pagePartials) {
                pagePartials.clear();
                pagePartials.etag = null;
            } else {
                pagePartials = new Map();
                this.#pagePartials.set(page.pathname, pagePartials);
            }
            return pagePartials;
        }

        assertNonEmptyString(
            page.partials?.etag,
            `HyperviewService#getPagePartialTemplate() expects page.partials.etag to be present`,
        );
        assertArray(
            page.partials?.partials,
            `HyperviewService#getPagePartialTemplate() expects page.partials.partials to be defined`,
        );

        if (this.#useTemplateCache && pagePartials?.etag === page.partials.etag) {
            return pagePartials;
        }

        if (!pagePartials) {
            pagePartials = new Map();
            this.#pagePartials.set(page.pathname, pagePartials);
        }

        // Ensure the global partials are loaded; page partials may reference them.
        const globalPartials = await this.loadGlobalPartials(context);

        // Page-specific partials can reference global partials and each other.
        // Page partials shadow a global partial that shares the same id.
        const partials = layerPartials(pagePartials, globalPartials);

        pagePartials.clear();
        // Keep the etag as a property on the Map instance, rather than an
        // entry in it, so it can never collide with a partial id.
        pagePartials.etag = page.partials.etag;

        for (const { id, source } of page.partials.partials) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from page partials in page ${ page.pathname }`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from page partials in page ${ page.pathname }`,
            );

            const template = this.compileTemplate(id, source, this.#customHelpers, partials);
            pagePartials.set(id, template);
        }

        return pagePartials;
    }

    /**
     * Load the a base template by id, directly from the ContentAddressableStore.
     * If global partials are not loaded yet, they will be loaded here. If
     * this service was constructed with useTemplateCache enabled then the
     * template will be returned from the runtime memory cache if the cache
     * has not been invalidated by the base templates hash.
     * @private
     * @return {Function} A Kixx template function.
     */
    async getBaseTemplate(context, templateId) {
        const stats = await this.#store.statBaseTemplates(context);

        // Use the etag from the content-addressable storage as the cache
        // invalidation key. The etag is kept as a property on the Map
        // instance, rather than an entry in it, so it can never collide
        // with a template id (e.g. a base template literally named "_etag").
        if (this.#useTemplateCache && stats?.etag && this.#baseTemplates.etag === stats.etag) {
            return this.#baseTemplates.get(templateId);
        }

        // Base templates are stored in a single bundle file, which
        // we fetch here.
        const templates = await this.#store.getBaseTemplates(context);

        // Clear old templates to ensure the map does not grow unbounded.
        this.#baseTemplates.clear();

        if (!templates) {
            // No base templates defined for this application.
            this.#baseTemplates.etag = null;
            return null;
        }

        // Ensure the global partials are loaded before compiling the templates.
        const partials = await this.loadGlobalPartials(context);

        // Reset the etag to use as a cache invalidation key.
        this.#baseTemplates.etag = templates.etag;

        for (const { id, source } of templates.json()) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from base templates`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from base templates`,
            );
            const template = this.compileTemplate(id, source, this.#customHelpers, partials);
            this.#baseTemplates.set(id, template);
        }

        return this.#baseTemplates.get(templateId);
    }

    /**
     * Get page template from a HyperviewPage which has already been loaded. Uses
     * the page.pageTemplateFilename to compile the template function. If this
     * service was constructed with useTemplateCache enabled then the template
     * will be returned from the runtime memory cache, using the pageTemplate
     * hash as the cache invalidation key.
     * @private
     * @return {Function} A Kixx template function.
     */
    async getPageTemplate(context, page) {
        assertNonEmptyString(
            page.pathname,
            `HyperviewService#getPageTemplate() expects page.pathname to be present`,
        );
        assertNonEmptyString(
            page.pageTemplateFilename,
            `HyperviewService#getPageTemplate() expects page.pageTemplateFilename to be present in ${ page.pathname }`,
        );

        const { pathname, pageTemplateFilename } = page;

        const filepath = this.#store.normalizePathname(`${ pathname }/${ pageTemplateFilename }`);
        const stats = await this.#store.statPageTemplate(context, filepath);

        let template;

        // Use the etag from the content-addressable storage as
        // the cache invalidation key.
        if (this.#useTemplateCache && stats?.etag && this.#pageTemplates.has(filepath)) {
            template = this.#pageTemplates.get(filepath);
            // Check this template version by comparing the latest etag.
            if (template.etag === stats.etag) {
                return template;
            }
        }

        this.#pageTemplates.delete(filepath);

        const pageTemplate = await this.#store.getPageTemplate(context, filepath);

        // Ensure the global and page partials are loaded and current. Compile
        // against a live delegator over both persistent Maps rather than a
        // merged snapshot copy, so partial content updates are picked up at
        // render time without recompiling this page template.
        const globalPartials = await this.loadGlobalPartials(context);
        const pagePartials = await this.getPagePartials(context, page);
        const partials = layerPartials(pagePartials, globalPartials);

        template = this.compileTemplate(
            filepath,
            pageTemplate.text(),
            this.#customHelpers,
            partials,
        );

        template.etag = pageTemplate.etag;

        if (this.#useTemplateCache) {
            this.#pageTemplates.set(filepath, template);
        }

        return template;
    }

    /**
     * Loads a HyperviewPage from the ContentAddressable store. It merges the source
     * data cascade and hydrates the title and description mini templates if they
     * are defined.
     * @private
     * @return {HyperviewPage}
     */
    async getPage(context, url, pathname, responseProps) {
        const pageContent = await this.#store.getPage(context, pathname);

        if (!pageContent) {
            return null;
        }

        assertNonEmptyString(
            pageContent.pageTemplateFilename,
            `Missing page template in ${ pathname }`,
        );

        const page = new HyperviewPage({
            url,
            pathname,
            responseProps,
            pageTemplateFilename: pageContent.pageTemplateFilename,
            partials: pageContent.partials,
            includes: pageContent.includes,
            etag: pageContent.etag,
            createMiniTemplate: this.createMiniTemplate.bind(this),
        });

        // Fold all the source metadata objects into the page context.
        // IMPORTANT: Page data files must be returned from the Content-Addressable
        // Store getPage in  the grandparent -> parent -> grandchild order,
        // otherwise this merge would be incorrect.
        const sources = pageContent.pageDataFiles.map((file) => file.json());
        page.mergeSources(sources);

        return page;
    }

    /**
     * Returns `true` when the client explicitly requests JSON with a ".json"
     * request path extension or an Accept header which includes
     * "application/json" explicitly, without a wildcard.
     *
     * @returns {boolean} `true` when the client explicitly requests JSON
     */
    isJsonRequest(request) {
        if (request.url.pathname.endsWith('.json')) {
            return true;
        }

        if (request.headers.get('accept')?.includes('application/json')) {
            return true;
        }

        return false;
    }

    /**
     * Renders a Hyperview page, page template, or named partial and configures
     * the response. Explicit JSON requests receive the merged page context.
     *
     * @param {import('../context/request-context.js').default} context - Context for storage and cache operations
     * @param {import('../http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request used to select the page and response format
     * @param {import('../http-router/server-response.js').default} response - Mutable response carrying the status and page props
     * @param {Object} [options]
     * @param {string} [options.pathname] - Canonical page identifier; defaults to the normalized request pathname
     * @param {string} [options.baseTemplateId] - Canonical base template identifier required for full-page rendering
     * @param {string} [options.partial] - Canonical partial identifier to render instead of the page and base templates
     * @param {boolean} [options.skipBaseRender=false] - Render the page template without its base template
     * @param {boolean} [options.usePageCache] - Read and write rendered hypertext in the page cache; defaults to the value passed to the constructor
     * @param {string} [options.cacheKey] - Page-cache key component; defaults to the request pathname and query string
     * @param {boolean} [options.includePropsInCacheKey=false] - Include a hash derived from response props in the page-cache key
     * @param {Function} [options.propsHashFunction] - Returns the response-props hash from the page pathname, merged page context, and response props
     * @param {number} [options.pageCacheReadTtlSeconds] - Cache TTL passed to page-cache reads; defaults to the value passed to the constructor
     * @param {number} [options.pageCacheExpirationSeconds] - Expiration TTL passed to page-cache writes; defaults to the value passed to the constructor
     * @param {boolean} [options.allowJsonResponse] - Serve the merged page context as JSON to explicit JSON requests; defaults to the value passed to the constructor
     * @param {Object} [options.responseOptions] - Options forwarded to the UTF-8 response method
     * @param {string} [options.responseOptions.contentType='text/plain'] - Response MIME type; a UTF-8 charset is appended
     * @param {Object|Headers|Array<[string,string]>} [options.responseOptions.headers] - Additional response headers
     * @returns {Promise<import('../http-router/server-response.js').default>} Resolves to the configured response
     * @throws {NotFoundError} When no page exists for the resolved pathname
     */
    async respondWithHypertext(context, request, response, options) {
        options = options ?? {};

        // Each caller may override the constructor-level default for its own call.
        const usePageCache = options.usePageCache ?? this.#usePageCache;
        const pageCacheReadTtlSeconds = options.pageCacheReadTtlSeconds ?? this.#pageCacheReadTtlSeconds;
        const pageCacheExpirationSeconds = options.pageCacheExpirationSeconds ?? this.#pageCacheExpirationSeconds;
        const allowJsonResponse = options.allowJsonResponse ?? this.#allowJsonResponse;

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            pathname = this.#store.normalizePathname(request.url.pathname);
        }

        this.assertCanonicalIdentifier(
            pathname,
            'HyperviewService#respondWithHypertext: pathname',
        );

        const { url } = request;

        // We need to assert these identifiers are correct and safe here, because they
        // may not have been checked prior to reaching this routine.
        if (options.partial) {
            this.assertCanonicalIdentifier(
                options.partial,
                'HyperviewService#respondWithHypertext: options.partial',
            );
        } else {
            this.assertCanonicalIdentifier(
                options.baseTemplateId,
                'HyperviewService#respondWithHypertext options.baseTemplateId',
            );
        }

        const page = await this.getPage(context, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        if (allowJsonResponse && this.isJsonRequest(request)) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.getPageContext(),
                { whiteSpace: 4 },
            );
        }

        let etag = page.etag;

        // Optionally add the hash of the canonicalized props object.
        if (options.includePropsInCacheKey) {
            let propsHash;
            if (isFunction(options.propsHashFunction)) {
                propsHash = options.propsHashFunction(
                    page.pathname,
                    page.getPageContext(),
                    response.props,
                );
            } else {
                propsHash = this.#store.hashValue(response.props);
            }
            etag = this.#store.hashValue(page.etag + propsHash);
        }

        // If the caller does not provide a custom cache key, we use the
        // URL pathname + query params as the default.
        const pageCacheKey = isNonEmptyString(options.cacheKey)
            ? options.cacheKey
            : (url.pathname + url.search);

        // Add the namespace prefix and hash for the complete KV key.
        let key = `hyperview_page_cache#${ pageCacheKey }#${ etag }`;

        if (options.partial) {
            key = `${ key }#${ options.partial }`;
        }
        if (options.skipBaseRender) {
            key = `${ key }#_PAGE_TEMPLATE_ONLY`;
        }

        let hypertext;

        if (usePageCache) {
            hypertext = await this.#kvStore.get(context, key, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { pathname, key });
                return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
            }
            this.#logger.debug('cached page miss', { pathname, key });
        }

        if (options.partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            this.#logger.debug('render partial for page', { pathname, partial: options.partial });

            const pagePartials = await this.getPagePartials(context, page);
            const template = pagePartials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext());

            if (usePageCache) {
                await this.#kvStore.put(context, key, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        if (options.skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            this.#logger.debug('skip base template render for page', { pathname });

            const template = await this.getPageTemplate(context, page);
            assertFunction(template, `Page template "${ page.pageTemplateFilename }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext());

            if (usePageCache) {
                await this.#kvStore.put(context, key, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            this.getBaseTemplate(context, options.baseTemplateId),
            this.getPageTemplate(context, page),
        ]);

        assertFunction(pageTemplate, `Page template "${ page.pageTemplateFilename }" does not exist in pages/${ pathname }`);
        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.getPageContext();

        pageContext.body = pageTemplate(pageContext);
        hypertext = baseTemplate(pageContext);

        if (usePageCache) {
            await this.#kvStore.put(context, key, hypertext, {
                type: 'text',
                ttlSeconds: pageCacheExpirationSeconds,
            });
        }

        return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
    }
}
