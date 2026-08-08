import * as templating from '../templating/mod.js';
import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';

// TODO: We interchangeably use "digest" and "hash" to refer to the
//       same thing. We should probably pick one for consistency.

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

    // The page templates cache, indexed by page pathname
    #pageTemplates = new Map();

    // The page partials templates cache, indexed by page pathname
    #pagePartials = new Map();

    initialize(args) {
        const { logger, contentAddressableStore, kvStore } = args ?? {};

        this.#logger = logger;
        this.#store = contentAddressableStore;
        this.#kvStore = kvStore;
    }

    async respondWithPage(context, request, response, options) {
        options = options ?? {};

        const { url } = request;

        if (!options.partial) {
            // We need to assert the base template ID is correct and safe here, because it
            // may not have been checked prior to reaching this routine.
            assertCanonicalIdentifier(
                baseTemplateId,
                `A valid baseTemplate ID must be provided in HyperviewService#respondWithPage options (pathname:${ url.pathname })`,
            );
        }

        const page = await this.getPage(context, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        if (isJsonRequest(request)) {
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
            this.getBaseTemplate(context, baseTemplateId, { useCache: options.useTemplateCache }),
            this.getPageTemplate(context, page, { useCache: options.useTemplateCache }),
        ]);

        assertFunction(pageTemplate, `Page template "${ page.pageTemplate.id }" does not exist in pages/${ pathname }`);
        assertFunction(baseTemplate, `Base template "${ baseTemplateId }" does not exist`);

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

    async getBaseTemplate(context, templateId, options) {
        const digest = await this.#store.getBaseTemplatesDigest(context);

        // Use the digest from the content-addressable storage as
        // the cache invalidation key.
        if (options.useTemplateCache && this.#baseTemplates.get('_digest') === digest) {
            return this.#baseTemplates.get(templateId);
        }

        const templates = await this.#store.getBaseTemplates(context);

        if (!templates) {
            // No template partials defined for this application.
            this.#baseTemplates.clear();
            return null;
        }

        // Ensure the global partials are loaded before compiling the templates.
        const partials = await this.loadGlobalPartials(context, options);

        // Reset the digest to use as a cache invalidation key.
        this.#baseTemplates.set('_digest', digest);

        for (const { id, source } of templates) {
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

        return this.#baseTemplates;
    }

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

    async loadGlobalPartials(context, options) {
        // TODO: We need to prevent loadGlobalPartials from being called more than once
        //       in quick succession without waiting for the first promise to resolve.

        const digest = await this.#store.getTemplatePartialsDigest(context);

        // Use the digest from the content-addressable storage as
        // the cache invalidation key.
        if (options.useTemplateCache && this.#globalPartials.get('_digest') === digest) {
            return this.#globalPartials;
        }

        const partials = await this.#store.getTemplatePartials(context);

        if (!partials) {
            // No template partials defined for this application.
            this.#globalPartials.clear();
            return this.#globalPartials;
        }

        // Reset the digest to use as a cache invalidation key.
        this.#globalPartials.set('_digest', digest);

        for (const { id, source } of partials) {
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
}
