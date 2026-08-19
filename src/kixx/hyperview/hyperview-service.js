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

const MAX_PAGE_TEMPLATE_CACHE_ENTRIES = 1000;

// Methods used only by the rendering workflow remain callable so their cache
// behavior can be unit tested directly. They are not external service APIs.
function layerPartials(primary, secondary) {
    // Delegate to the live Maps so cached templates observe in-place partial
    // refreshes. Page partials take precedence over global partials.
    return {
        has(id) {
            return primary.has(id) || secondary.has(id);
        },
        get(id) {
            return primary.has(id) ? primary.get(id) : secondary.get(id);
        },
    };
}

/**
 * Assembles Hyperview page context and renders JSON, fragments, or full pages
 * from content-addressed application data and templates.
 */
export default class HyperviewService {

    #logger;
    #store;
    #kvStore;
    #useTemplateCache;
    #usePageCache;
    #pageCacheReadTtlSeconds;
    #pageCacheExpirationSeconds;
    #includePropsInCacheKey;
    #allowJsonResponse;

    #customHelpers = new Map([
        [ 'formatDate', formatDate ],
        [ 'markup', markup ],
        [ 'truncate', truncate ],
    ]);

    // The base templates cache, indexed by template id.
    #baseTemplates = new Map();

    // The global partials cache, indexed by template id.
    #globalPartials = new Map();

    // The active global partials load shared by concurrent requests.
    #globalPartialsLoadPromise = null;

    // The page templates cache, indexed by normalized template filepath.
    #pageTemplates = new Map();

    // The page partial templates cache, indexed by page pathname.
    #pagePartials = new Map();

    // Tracks the LRU order and template filepath for each cached page pathname.
    #pageTemplateCacheEntries = new Map();

    /**
     * @param {Object} options
     * @param {import('../logger/logger.js').default} options.logger - Root logger used to create a HyperviewService child logger
     * @param {boolean} [options.useTemplateCache=false] - Reuse compiled templates until their content etags change; fixed for the lifetime of the service
     * @param {boolean} [options.usePageCache=false] - Default rendered-page cache policy; overridable per render
     * @param {number} [options.pageCacheReadTtlSeconds=86400] - Default cache TTL for rendered-page reads, in seconds
     * @param {number} [options.pageCacheExpirationSeconds=86400] - Default expiration for rendered-page writes, in seconds
     * @param {boolean} [options.includePropsInCacheKey=false] - Include response props in rendered-page cache identity by default; enable when props vary by request or user
     * @param {boolean} [options.allowJsonResponse=false] - Allow explicit JSON requests to receive assembled page context by default
     */
    constructor(options) {
        const {
            logger,
            useTemplateCache = false,
            usePageCache = false,
            pageCacheReadTtlSeconds = 60 * 60 * 24,
            pageCacheExpirationSeconds = 60 * 60 * 24,
            includePropsInCacheKey = false,
            allowJsonResponse = false,
        } = options ?? {};
        assert(logger, 'HyperviewService requires a logger');
        this.#logger = logger.createChild('HyperviewService');
        this.#useTemplateCache = useTemplateCache;
        this.#usePageCache = usePageCache;
        this.#pageCacheReadTtlSeconds = pageCacheReadTtlSeconds;
        this.#pageCacheExpirationSeconds = pageCacheExpirationSeconds;
        this.#includePropsInCacheKey = includePropsInCacheKey;
        this.#allowJsonResponse = allowJsonResponse;
    }

    /**
     * Connects the stores required for content loading and rendered-page caching.
     * @param {Object} args - Store dependencies
     * @param {KeyValueStoreInterface} args.kvStore - Key-value store for rendered hypertext
     * @param {ContentAddressableStore} args.contentAddressableStore - Content-addressable store for page metadata, includes, and templates
     * @returns {void}
     */
    initialize(args) {
        const { contentAddressableStore, kvStore } = args ?? {};
        assert(kvStore, 'HyperviewService#initialize() requires a kvStore');
        assert(contentAddressableStore, 'HyperviewService#initialize() requires a contentAddressableStore');

        this.#store = contentAddressableStore;
        this.#kvStore = kvStore;
    }

    /**
     * Validates a non-empty identifier against the content store's canonical pathname rules.
     * @param {*} value - Value to assert
     * @param {string} messagePrefix - Caller context included in assertion messages
     * @returns {void}
     */
    assertCanonicalIdentifier(value, messagePrefix) {
        // isValidPathname() accepts an empty string, so check for content here.
        // This method exists to validate identifiers which may not have been
        // checked by any earlier layer, so it must enforce the whole contract.
        assert(
            isNonEmptyString(value) && this.#store.isValidPathname(value),
            `${ messagePrefix } must be a valid pathname`,
        );
    }

    /**
     * Reports whether a URL or logical pathname satisfies the content store's pathname rules.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(pathname) {
        return this.#store.isValidPathname(pathname);
    }

    /**
     * Compiles template source with built-in and caller-provided helpers.
     * @param {string} templateId - Unique identifier used in error reporting
     * @param {string} source - Template source code
     * @param {Map<string, Function>} customHelpers - Helper functions that override built-in helpers
     * @param {Map<string, Function>|{has: Function, get: Function}} partials - Map-like lookup of compiled partials
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
     * Loads global partials, reusing compiled functions while their bundle etag is current.
     * @param {Object} context - Request context for template-store access
     * @returns {Promise<Map<string, Function>>} Live compiled-partials Map shared by cached templates
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
        // Skip the stat() round-trip entirely when template caching is disabled;
        // its result would only ever feed the cache-hit check below.
        if (this.#useTemplateCache) {
            const stats = await this.#store.statTemplatePartials(context);

            // Use the etag from the content-addressable storage as
            // the cache invalidation key. The etag is kept as a property on the
            // Map instance, rather than an entry in it, so it can never collide
            // with a partial id (e.g. a partial literally named "_etag").
            if (stats?.etag && this.#globalPartials.etag === stats.etag) {
                return this.#globalPartials;
            }
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
     * Compiles a loaded page's partials with page definitions taking precedence over global definitions.
     * @param {Object} context - Request context for template-store access
     * @param {HyperviewPage} page - Loaded page that owns the partial definitions
     * @param {Map<string, Function>} [globalPartials] - Already refreshed global partials, when available
     * @returns {Promise<Map<string, Function>>} Live compiled-partials Map for the page pathname
     */
    async getPagePartials(context, page, globalPartials) {

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
                pagePartials.etag = null;
                if (this.#useTemplateCache) {
                    this.#pagePartials.set(page.pathname, pagePartials);
                }
            }
            if (this.#useTemplateCache) {
                this.#cachePagePathname(page.pathname, null);
            }
            return pagePartials;
        }

        assertNonEmptyString(
            page.partials?.etag,
            `HyperviewService#getPagePartials() expects page.partials.etag to be present`,
        );
        assertArray(
            page.partials?.partials,
            `HyperviewService#getPagePartials() expects page.partials.partials to be defined`,
        );

        // Refresh global partials before returning a cached page-partials Map.
        // Compiled page partials resolve global partials through a live lookup.
        globalPartials = globalPartials ?? await this.loadGlobalPartials(context);

        if (this.#useTemplateCache && pagePartials?.etag === page.partials.etag) {
            this.#cachePagePathname(page.pathname, null);
            return pagePartials;
        }

        if (!pagePartials) {
            pagePartials = new Map();
            if (this.#useTemplateCache) {
                this.#pagePartials.set(page.pathname, pagePartials);
                this.#cachePagePathname(page.pathname, null);
            }
        }

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

    #cachePagePathname(pathname, filepath) {
        const previousFilepath = this.#pageTemplateCacheEntries.get(pathname);
        filepath = filepath ?? previousFilepath ?? null;
        if (previousFilepath && previousFilepath !== filepath) {
            this.#pageTemplates.delete(previousFilepath);
        }
        this.#pageTemplateCacheEntries.delete(pathname);
        this.#pageTemplateCacheEntries.set(pathname, filepath);

        while (this.#pageTemplateCacheEntries.size > MAX_PAGE_TEMPLATE_CACHE_ENTRIES) {
            const [ evictedPathname, evictedFilepath ] = this.#pageTemplateCacheEntries.entries().next().value;
            this.#pageTemplateCacheEntries.delete(evictedPathname);
            this.#pagePartials.delete(evictedPathname);
            if (evictedFilepath) {
                this.#pageTemplates.delete(evictedFilepath);
            }
        }
    }

    // A rendered result must never be empty; an empty string means a template
    // (or the store data it read) is broken, not that there is nothing to cache
    // or return. Checked before hypertext reaches the cache or the response.
    #assertRenderedHypertext(hypertext, renderMode, pathname) {
        assertNonEmptyString(
            hypertext,
            `HyperviewService rendered empty hypertext for the ${ renderMode } render of page "${ pathname }"`,
        );
    }

    /**
     * Loads a base template, reusing its compiled function while the base-template bundle etag is current.
     * @param {Object} context - Request context for template-store access
     * @param {string} templateId - Canonical base template identifier
     * @returns {Promise<Function|null|undefined>} Compiled template, null when no bundle exists, or undefined when the id is absent
     */
    async getBaseTemplate(context, templateId) {
        // Cached templates use this live Map for partial lookups, so refresh it
        // before the base-template cache can return.
        const partials = await this.loadGlobalPartials(context);

        // Skip the stat() round-trip entirely when template caching is disabled;
        // its result would only ever feed the cache-hit check below.
        if (this.#useTemplateCache) {
            const stats = await this.#store.statBaseTemplates(context);

            // Use the etag from the content-addressable storage as the cache
            // invalidation key. The etag is kept as a property on the Map
            // instance, rather than an entry in it, so it can never collide
            // with a template id (e.g. a base template literally named "_etag").
            if (stats?.etag && this.#baseTemplates.etag === stats.etag) {
                return this.#baseTemplates.get(templateId);
            }
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
     * Loads the template selected by a page, reusing its compiled function while its etag is current.
     * @param {Object} context - Request context for template-store access
     * @param {HyperviewPage} page - Loaded page which names the template file
     * @returns {Promise<Function>} Compiled page-template function
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

        // Cached templates capture these live Maps for partial lookups, so they
        // must be refreshed before the page-template cache can return.
        const globalPartials = await this.loadGlobalPartials(context);
        const pagePartials = await this.getPagePartials(context, page, globalPartials);

        let template;

        // Skip the stat() round-trip entirely when template caching is disabled;
        // its result would only ever feed the cache-hit check below.
        if (this.#useTemplateCache) {
            // Use the etag from the content-addressable storage as
            // the cache invalidation key.
            const stats = await this.#store.statPageTemplate(context, filepath);

            if (stats?.etag && this.#pageTemplates.has(filepath)) {
                template = this.#pageTemplates.get(filepath);
                // Check this template version by comparing the latest etag. Also
                // compare the page-partials etag: a concurrent request can replace
                // the #pagePartials entry for this pathname with a new Map instance
                // (see getPagePartials()), orphaning the one this cached template
                // closed over. The template file's own etag alone would not catch
                // that, since the file itself never changed.
                if (template.etag === stats.etag && template.partialsEtag === pagePartials.etag) {
                    this.#cachePagePathname(pathname, filepath);
                    return template;
                }
            }
        }

        this.#pageTemplates.delete(filepath);

        const pageTemplate = await this.#store.getPageTemplate(context, filepath);

        // The page metadata named this template file, so a missing blob means the
        // build index and the blob store disagree. Assert it here, where the page
        // pathname and filename are still in scope to name in the message, rather
        // than letting text() below fail with an unlabeled TypeError.
        assert(
            pageTemplate,
            `Page template "${ pageTemplateFilename }" does not exist in pages/${ pathname }`,
        );

        // Ensure the global and page partials are loaded and current. Compile
        // against a live delegator over both persistent Maps rather than a
        // merged snapshot copy, so partial content updates are picked up at
        // render time without recompiling this page template.
        const partials = layerPartials(pagePartials, globalPartials);

        template = this.compileTemplate(
            filepath,
            pageTemplate.text(),
            this.#customHelpers,
            partials,
        );

        template.etag = pageTemplate.etag;
        template.partialsEtag = pagePartials.etag;

        if (this.#useTemplateCache) {
            this.#pageTemplates.set(filepath, template);
            this.#cachePagePathname(pathname, filepath);
        }

        return template;
    }

    /**
     * Loads a page and merges its ordered metadata cascade with runtime response props.
     * @param {Object} context - Request context for page-store access
     * @param {URL} url - Request URL used to derive canonical page metadata
     * @param {string} pathname - Canonical page pathname
     * @param {Object} responseProps - Response props merged into the page context
     * @returns {Promise<HyperviewPage|null>} The loaded page, or null when no page exists at that
     *   pathname, or when its metadata declares no page template
     */
    async getPage(context, url, pathname, responseProps) {
        const pageContent = await this.#store.getPage(context, pathname);

        // A page directory can carry metadata with no template of its own -- an
        // ancestor directory published only to supply inherited defaults for its
        // descendants, for example. Requesting that pathname directly is a
        // missing resource from the caller's perspective, the same as no page
        // metadata at all, not a build invariant violation.
        if (!pageContent || !isNonEmptyString(pageContent.pageTemplateFilename)) {
            return null;
        }

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

        // Merge precedence depends on the store returning page data from the
        // broadest ancestor through the requested leaf page.
        const sources = pageContent.pageDataFiles.map((file) => file.json());
        page.mergeSources(sources);

        return page;
    }

    /**
     * Reports whether the pathname has a case-insensitive `.json` suffix or the
     * Accept header explicitly includes `application/json`.
     * @param {import('../http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request
     * @returns {boolean} True when the request explicitly asks for JSON
     */
    isJsonRequest(request) {
        if (request.url.pathname.toLowerCase().endsWith('.json')) {
            return true;
        }

        if (request.headers.get('accept')?.includes('application/json')) {
            return true;
        }

        return false;
    }

    /**
     * Configures a response with assembled page-context JSON, a page partial,
     * a page template, or a page template wrapped by a base template.
     *
     * @param {import('../context/request-context.js').default} context - Context for storage and cache operations
     * @param {import('../http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request used to select the page and response format
     * @param {import('../http-router/server-response.js').default} response - Mutable response carrying the status and page props
     * @param {Object} [options]
     * @param {string} [options.pathname] - Canonical page identifier; defaults to the normalized request pathname
     * @param {string} [options.baseTemplateId] - Canonical base template identifier required for full-page rendering
     * @param {string} [options.partial] - Canonical page-partial identifier to render instead of the page and base templates
     * @param {boolean} [options.skipBaseRender=false] - Render the page template without its base template
     * @param {boolean} [options.usePageCache] - Enable rendered-page cache preparation, reads, and writes; defaults to the constructor value
     * @param {string} [options.cacheKey] - Cache identity component used only when page caching is enabled; defaults to request origin, pathname, and query string, then becomes part of an opaque hashed KV key
     * @param {boolean} [options.includePropsInCacheKey] - Include response props in cache identity; required with page caching when props vary by request or user to prevent reuse of another request's rendered output
     * @param {Function} [options.propsHashFunction] - Returns the response-props hash from the page pathname, merged page context, and response props; used only when page caching and props-sensitive keys are enabled
     * @param {number} [options.pageCacheReadTtlSeconds] - Cache TTL passed to enabled page-cache reads; defaults to the constructor value
     * @param {number} [options.pageCacheExpirationSeconds] - Expiration passed to enabled page-cache writes; defaults to the constructor value
     * @param {boolean} [options.allowJsonResponse] - Serve assembled page context for explicit JSON requests and treat `.json` as a representation suffix; defaults to the constructor value
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
        const includePropsInCacheKey = options.includePropsInCacheKey ?? this.#includePropsInCacheKey;
        const allowJsonResponse = options.allowJsonResponse ?? this.#allowJsonResponse;
        // Gate the ".json" extension on allowJsonResponse here, and not only on the
        // response below, because this flag also decides whether the extension is
        // stripped from the pathname. Ungated, a ".json" request would resolve the
        // page at the extensionless pathname and render it as HTML whenever JSON
        // responses are disabled, exposing every page under a second,
        // non-canonical URL instead of reporting it as not found.
        // Matched case-insensitively so ".JSON" is recognized too; the requested
        // URL keeps its original case everywhere else, since it is intentionally
        // part of the page context and the default page-cache identity.
        const isJsonPathRequest = allowJsonResponse && request.url.pathname.toLowerCase().endsWith('.json');

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            let requestPathname = request.url.pathname;
            if (isJsonPathRequest) {
                // Slicing by length rather than matching on ".json" literally, so
                // this strips whichever case of the extension isJsonPathRequest matched.
                requestPathname = requestPathname.slice(0, -'.json'.length);
                // "index" names a directory page at every depth, not a page called
                // "index", so drop the segment and let normalizePathname() fold the
                // trailing slash. Matching only "/index" would leave the ".json"
                // affordance broken for every directory page below the root.
                if (requestPathname.endsWith('/index')) {
                    requestPathname = requestPathname.slice(0, -'index'.length);
                }
            }
            pathname = this.#store.normalizePathname(requestPathname);
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
        } else if (!options.skipBaseRender) {
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

        // Serve JSON only when the deployment allows it and the client asked for
        // it, by the ".json" path extension or an explicit Accept header. Applying
        // the policy flag here, at its single decision point, keeps it out of the
        // request-shape checks above, which describe the request alone.
        if (allowJsonResponse && (isJsonPathRequest || this.isJsonRequest(request))) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.getPageContext(),
                { whiteSpace: 4 },
            );
        }

        let pageCacheKey;
        let hypertext;

        // Disabling the rendered-page cache also skips its storage stats and
        // hashing; compiled-template cache validation remains in the loaders.
        if (usePageCache) {
            const partials = await this.#store.statTemplatePartials(context);
            let etag = await this.#store.hashValue(`${ page.etag }#${ partials?.etag ?? '' }`);

            // Optionally add the hash of the canonicalized props object.
            if (includePropsInCacheKey) {
                let propsHash;
                if (isFunction(options.propsHashFunction)) {
                    propsHash = await options.propsHashFunction(
                        page.pathname,
                        page.getPageContext(),
                        response.props,
                    );
                } else {
                    propsHash = await this.#store.hashValue(response.props);
                }
                etag = await this.#store.hashValue(`${ etag }#${ propsHash }`);
            }

            // If the caller does not provide a custom cache key, we use the URL
            // origin + pathname + query params as the default. The origin must be
            // included because HyperviewPage#getPageContext() derives page.canonical_url
            // and page.href from the request origin when page data does not provide
            // them, so rendered output for the same path differs across hosts.
            const pageCacheIdentity = isNonEmptyString(options.cacheKey)
                ? options.cacheKey
                : (url.origin + url.pathname + url.search);

            let renderModeIdentity;

            if (options.partial) {
                renderModeIdentity = `PARTIAL#${ options.partial }`;
            } else if (options.skipBaseRender) {
                renderModeIdentity = 'PAGE_TEMPLATE_ONLY';
            } else {
                const baseTemplates = await this.#store.statBaseTemplates(context);
                etag = await this.#store.hashValue(`${ etag }#${ baseTemplates?.etag ?? '' }`);
                // The base templates etag covers the whole bundle, not the selected
                // templateId, so options.baseTemplateId must be in the identity too.
                // Otherwise requests for the same page rendered with different base
                // templates (e.g. distinct layouts per host or user state) would collide.
                renderModeIdentity = `FULL_PAGE#${ options.baseTemplateId }`;
            }

            // The logical identity can be arbitrarily large (full URL, query string,
            // custom cache key) and may contain sensitive query-string values, so it
            // is never used as the KV key or logged directly. Hashing it into a short,
            // opaque, fixed-length key also keeps every key within the portable
            // 512-byte KV key limit regardless of the input size.
            const logicalCacheIdentity = `${ pageCacheIdentity }#${ renderModeIdentity }#${ etag }`;
            pageCacheKey = `hyperview_page_cache#${ await this.#store.hashValue(logicalCacheIdentity) }`;

            hypertext = await this.#kvStore.get(context, pageCacheKey, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { pathname, key: pageCacheKey });
                return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
            }
            this.#logger.debug('cached page miss', { pathname, key: pageCacheKey });
        }

        if (options.partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            this.#logger.debug('render partial for page', { pathname, partial: options.partial });

            const pagePartials = await this.getPagePartials(context, page);
            const template = pagePartials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext());
            this.#assertRenderedHypertext(hypertext, `partial "${ options.partial }"`, pathname);

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
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

            hypertext = template(page.getPageContext());
            this.#assertRenderedHypertext(hypertext, 'page template', pathname);

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
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

        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.getPageContext();

        pageContext.body = pageTemplate(pageContext);
        hypertext = baseTemplate(pageContext);
        this.#assertRenderedHypertext(hypertext, 'full page', pathname);

        if (usePageCache) {
            await this.#kvStore.put(context, pageCacheKey, hypertext, {
                type: 'text',
                ttlSeconds: pageCacheExpirationSeconds,
            });
        }

        return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
    }
}
