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

// TODO: We interchangeably use "digest" and "hash" to refer to the
//       same thing. We should probably pick one for consistency.

// NOTE: There are private methods on HyperviewService marked with the @private
//       tag instead of prefixed by "#". This is intentional, to allow unit
//       testing coverage to be more thorough.

export default class HyperviewService {

    #logger;
    #store;
    #kvStore;

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
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'HyperviewService requires a logger');
        this.#logger = logger.createChild('HyperviewService');
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
     * @param {*} value - Value to assert
     * @param {string} messagePrefix - Caller context included in assertion messages
     * @returns {void}
     * @throws {AssertionError} When value is empty, invalid, or not lower case
     */
    assertCanonicalIdentifier(value, messagePrefix) {
        assertNonEmptyString(value, messagePrefix);
        assert(
            this.#store.isValidIdentifier(value),
            `${ messagePrefix } must be a valid pathname`,
        );
        assert(
            value === value.toLowerCase(),
            `${ messagePrefix } must be lower case`,
        );
    }

    /**
     * Reports whether a URL or logical pathname contains only safe path segments.
     * Proxies to the underlying ContentAddressableStore.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidIdentifier(value) {
        return this.#store.isValidIdentifier(value);
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
     * compiles them into template functions. If useTemplateCache is toggled
     * on then partials will be cached in application memory using the
     * partials digest hash from the ContentAddressableStore as a
     * cache invalidation key.
     * @private
     * @return {Map} The private #globalPartials Map
     */
    async loadGlobalPartials(context, options) {
        if (this.#globalPartialsLoadPromise) {
            return this.#globalPartialsLoadPromise;
        }

        const loadPromise = this.#loadGlobalPartials(context, options);
        this.#globalPartialsLoadPromise = loadPromise;

        try {
            return await loadPromise;
        } finally {
            if (this.#globalPartialsLoadPromise === loadPromise) {
                this.#globalPartialsLoadPromise = null;
            }
        }
    }

    async #loadGlobalPartials(context, options) {
        const digest = await this.#store.getTemplatePartialsDigest(context);

        // Use the digest from the content-addressable storage as
        // the cache invalidation key.
        if (options.useTemplateCache && digest && this.#globalPartials.get('_digest') === digest) {
            return this.#globalPartials;
        }

        const partials = await this.#store.getTemplatePartials(context);

        if (!partials) {
            // No template partials defined for this application.
            this.#globalPartials.clear();
            return this.#globalPartials;
        }

        // Reset the digest to use as a cache invalidation key.
        this.#globalPartials.set('_digest', partials.hash);

        for (const { id, source } of partials.json) {
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
     * page partials. If useTemplateCache has been toggled on, the page partials
     * will be cached in runtime memory using the page partials digest hash from
     * the ContentAddressableStore as the cache invalidation key.
     * @private
     * @return {Map} The partial template Map for the given page.pathname
     */
    async getPagePartials(context, page, options) {
        assertNonEmptyString(
            page.partials?.hash,
            `HyperviewService#getPagePartialTemplate() expects page.partials.hash to be present`,
        );
        assertArray(
            page.partials?.partials,
            `HyperviewService#getPagePartialTemplate() expects page.partials.partials to be defined`,
        );

        let pagePartials;

        // Try the partials cache first, if the cache is enabled.
        if (options.useTemplateCache && this.#pagePartials.has(page.pathname)) {
            pagePartials = this.#pagePartials.get(page.pathname);
            // Check this set of page partials version by comparing the latest page digest.
            if (pagePartials.get('_digest') === page.digest) {
                return pagePartials;
            }
        }

        // Ensure the global partials are loaded; we're going to copy and extend them.
        const globalPartials = await this.loadGlobalPartials(context, options);

        // Make a copy of the global partials so that we can safely mutate the Map
        // without impacting the global partials Map. This is the partials Map
        // we're going to pass to the template factory.
        const partials = new Map(globalPartials);

        // Cache the page partials seperately.
        if (pagePartials) {
            pagePartials.clear();
        }
        pagePartials = new Map();
        // Set the special _digest key to version this set of page partials.
        pagePartials.set('_digest', page.digest);

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
            partials.set(id, template);
            pagePartials.set(id, template);
        }

        if (options.useTemplateCache) {
            this.#pagePartials.set(page.pathname, pagePartials);
        }

        return pagePartials;
    }

    /**
     * Load the a base template by id, directly from the ContentAddressableStore.
     * If global partials are not loaded yet, they will be loaded here. If
     * useTemplateCache is toggled on then the template will be returned
     * from the runtime memory cache if the cache has not been
     * invalidated by the base templates digest hash.
     * @private
     * @return {Function} A Kixx template function.
     */
    async getBaseTemplate(context, templateId, options) {
        const digest = await this.#store.getBaseTemplatesDigest(context);

        // Use the digest from the content-addressable storage as
        // the cache invalidation key.
        if (options.useTemplateCache && digest && this.#baseTemplates.get('_digest') === digest) {
            return this.#baseTemplates.get(templateId);
        }

        // Base templates are stored in a single bundle file, which
        // we fetch here.
        const templates = await this.#store.getBaseTemplates(context);

        if (!templates) {
            // No base templates defined for this application.
            this.#baseTemplates.clear();
            return null;
        }

        // Ensure the global partials are loaded before compiling the templates.
        const partials = await this.loadGlobalPartials(context, options);

        // Reset the digest to use as a cache invalidation key.
        this.#baseTemplates.set('_digest', templates.digest);

        for (const { id, source } of templates.json) {
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
     * the page.pageTemplate to compile the template function. If useTemplateCache
     * is toggled on then the template will be returned from the runtime memory
     * cache, using the pageTemplate digest hash as the cache invalidation key.
     * @private
     * @return {Function} A Kixx template function.
     */
    async getPageTemplate(context, page, options) {
        assertNonEmptyString(
            page.pageTemplate?.hash,
            `HyperviewService#getPageTemplate() expects page.pageTemplate.hash to be present in ${ page.pathname }`,
        );
        assertNonEmptyString(
            page.pageTemplate?.id,
            `HyperviewService#getPageTemplate() expects page.pageTemplate.id to be present in ${ page.pathname }`,
        );
        assertNonEmptyString(
            page.pageTemplate?.text,
            `HyperviewService#getPageTemplate() expects page.pageTemplate.text to be present in ${ page.pathname }`,
        );

        let template;

        // Try the cache first, if the cache is enabled.
        if (options.useTemplateCache && this.#pageTemplates.has(page.pathname)) {
            template = this.#pageTemplates.get(page.pathname);
            // Check this template version by comparing the latest hash digest.
            if (template.hash === page.pageTemplate.hash) {
                return template;
            }
        }

        this.#pageTemplates.delete(page.pathname);

        // Ensure the global partials are loaded; we're going to copy and extend them.
        const globalPartials = await this.loadGlobalPartials(context, options);

        const pagePartials = await this.getPagePartials(context, page, options);

        // Make a copy of the global partials and page partials so that we can
        // safely merge them. This is the partials Map we're going
        // to pass to the template factory.
        const partials = new Map([...globalPartials, ...pagePartials]);

        template = this.compileTemplate(
            page.pageTemplate.id,
            page.pageTemplate.text,
            this.#customHelpers,
            partials,
        );

        template.hash = page.pageTemplate.hash;

        if (options.useTemplateCache) {
            this.#pageTemplates.set(page.pageTemplate.id, template);
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

        assert(pageContent.pageTemplate, `Missing page template in ${ pathname }`);

        const page = new HyperviewPage({
            url,
            pathname,
            responseProps,
            pageTemplate: pageContent.pageTemplate,
            partials: pageContent.partials,
            includes: pageContent.includes,
            digest: pageContent.digest,
        });

        // Fold all the source metadata objects into the page context.
        // IMPORTANT: Page data files must be returned from the Content-Addressable
        // Store getPage in  the grandparent -> parent -> grandchild order,
        // otherwise this merge would be incorrect.
        page.mergeSources(pageContent.pageDataFiles);

        // Compile the title template, if it exists.
        if (isNonEmptyString(page.rawPageTitle?.template)) {
            page.setMetadataTemplate('page.title', this.createMiniTemplate(
                `${ pathname }/page.title`,
                page.title.template,
            ));
        }
        // Compile the description template, if it exists.
        if (isNonEmptyString(page.rawPageDescription?.template)) {
            page.setMetadataTemplate('page.description', this.createMiniTemplate(
                `${ pathname }/page.description`,
                page.description.template,
            ));
        }

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
     * @param {boolean} [options.useTemplateCache=false] - Reuse compiled templates while their content digests remain current
     * @param {boolean} [options.usePageCache=false] - Read and write rendered hypertext in the page cache
     * @param {string} [options.cacheKey] - Page-cache key component; defaults to the request pathname and query string
     * @param {boolean} [options.includePropsInCacheKey=false] - Include a digest derived from response props in the page-cache key
     * @param {Function} [options.propsHashFunction] - Returns the response-props digest from the page pathname, merged page context, and response props
     * @param {number} [options.pageCacheReadTtlSeconds] - Cache TTL passed to page-cache reads
     * @param {number} [options.pageCacheExpirationSeconds] - Expiration TTL passed to page-cache writes
     * @param {Object} [options.responseOptions] - Options forwarded to the UTF-8 response method
     * @param {string} [options.responseOptions.contentType='text/plain'] - Response MIME type; a UTF-8 charset is appended
     * @param {Object|Headers|Array<[string,string]>} [options.responseOptions.headers] - Additional response headers
     * @returns {Promise<import('../http-router/server-response.js').default>} Resolves to the configured response
     * @throws {NotFoundError} When no page exists for the resolved pathname
     */
    async respondWithHypertext(context, request, response, options) {
        options = options ?? {};

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            pathname = this.#store.normalizeIdentifier(request.pathname);
        }

        this.assertCanonicalIdentifier(
            pathname,
            'HyperviewService#respondWithHypertext: pathname',
        );

        const { url } = request;

        // We need to assert these identifiers are correct and safe here, because they
        // may not have been checked prior to reaching this routine.
        if (options.partial) {
            assertCanonicalIdentifier(
                options.partial,
                `A partial ID must be valid when provided in HyperviewService#respondWithHypertext options (pathname:${ url.pathname })`,
            );
        } else {
            assertCanonicalIdentifier(
                options.baseTemplateId,
                `A valid baseTemplate ID must be provided in HyperviewService#respondWithHypertext options (pathname:${ url.pathname })`,
            );
        }

        const page = await this.getPage(context, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        if (this.isJsonRequest(request)) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.getPageContext(),
                { whiteSpace: 4 },
            );
        }

        let hash = page.digest;

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
                propsHash = this.#store.canonicalObjectDigest(response.props);
            }
            hash = this.#store.hashString(page.digest + propsHash);
        }

        // If the caller does not provide a custom cache key, we use the
        // URL pathname + query params as the default.
        const pageCacheKey = isNonEmptyString(options.cacheKey)
            ? options.cacheKey
            : (url.pathname + url.search);

        // Add the namespace prefix and digest hash for the complete KV key.
        let key = `hyperview_page_cache#${ pageCacheKey }#${ hash }`;

        if (options.partial) {
            key = `${ key }#${ options.partial }`;
        }
        if (options.skipBaseRender) {
            key = `${ key }#_PAGE_TEMPLATE_ONLY`;
        }

        let hypertext;

        if (options.usePageCache) {
            hypertext = await this.#kvStore.get(context, key, {
                type: 'text',
                cacheTtl: options.pageCacheReadTtlSeconds,
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

            const pagePartials = await this.getPagePartials(context, page, { useCache: options.useTemplateCache });
            const template = pagePartials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext());

            if (options.usePageCache) {
                await this.#kvStore.put(context, key, hypertext, {
                    type: 'text',
                    ttlSeconds: options.pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        if (options.skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            this.#logger.debug('skip base template render for page', { pathname });

            const template = await this.getPageTemplate(context, page, { useCache: options.useTemplateCache });
            assertFunction(template, `Page template "${ page.pageTemplate.id }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext());

            if (options.usePageCache) {
                await this.#kvStore.put(context, key, hypertext, {
                    type: 'text',
                    ttlSeconds: options.pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            this.getBaseTemplate(context, options.baseTemplateId, { useCache: options.useTemplateCache }),
            this.getPageTemplate(context, page, { useCache: options.useTemplateCache }),
        ]);

        assertFunction(pageTemplate, `Page template "${ page.pageTemplate.id }" does not exist in pages/${ pathname }`);
        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.getPageContext();

        pageContext.body = pageTemplate(pageContext);
        hypertext = baseTemplate(pageContext);

        if (options.usePageCache) {
            await this.#kvStore.put(context, key, hypertext, {
                type: 'text',
                ttlSeconds: options.pageCacheExpirationSeconds,
            });
        }

        return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
    }
}
