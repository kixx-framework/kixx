
export default class HyperviewService {

    async respondWithPage(context, request, response, options) {
        const { url } = request;

        if (!partial) {
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

        // Get a digest hash of this page from the content-addressable store,
        // optionally including a hash of the canonicalized response props.
        const hash = await page.getDigest(this.#store, {
            includeProps: includePropsInDigest,
            propsHashFunction,
        });

        let hash = page.digest;

        // Optionally add the hash of the canonicalized props object.
        if (includePropsInCacheKey) {
            let propsHash;
            if (isFunction(propsHashFunction)) {
                propsHash = propsHashFunction(page.pathname, page.getPageContext(), response.props);
            } else {
                propsHash = this.#store.canonicalObjectDigest(responseProps);
            }
            hash = this.#store.hashString(page.digest + propsDigest);
        }

        // If the caller does not provide a custom cache key, we use the
        // URL pathname + query params as the default.
        const pageCacheKey = isNonEmptyString(cacheKey)
            ? cacheKey
            : (url.pathname + url.search);

        // Add the namespace prefix and digest hash for the complete KV key.
        const key = `hyperview_page_cache#${ pageCacheKey }#${ hash }`;

        let hypertext;

        if (usePageCache) {
            hypertext = await this.#kvStore.get(context, key, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { pathname, key });
                return response.respondWithUtf8(response.status, hypertext, responseOptions);
            }
            this.#logger.debug('cached page miss', { pathname, key });
        }

        if (partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            const template = await getPagePartialTemplate(page, partial, { useCache: useTemplateCache });
            assertFunction(template, `Partial template "${ partial }" does not exist in pages/${ pathname }`);
            hypertext = template(page.getPageContext());
            return response.respondWithUtf8(response.status, hypertext, responseOptions);
        }

        if (skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            const template = await this.getPageTemplate(context, page, { useCache: useTemplateCache });
            assertFunction(template, `Page template "${ page.pageTemplate.id }" does not exist in pages/${ pathname }`);
            hypertext = template(page.getPageContext());
            return response.respondWithUtf8(response.status, hypertext, responseOptions);
        }

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            this.getBaseTemplate(context, baseTemplateId, { useCache: useTemplateCache }),
            this.getPageTemplate(context, page, { useCache: useTemplateCache }),
        ]);

        assertFunction(pageTemplate, `Page template "${ page.pageTemplate.id }" does not exist in pages/${ pathname }`);
        assertFunction(baseTemplate, `Base template "${ baseTemplateId }" does not exist`);

        const pageContext = page.getPageContext();

        pageContext.body = pageTemplate(pageContext);
        hypertext = baseTemplate(pageContext);

        return response.respondWithUtf8(response.status, hypertext, responseOptions);
    }

    async getPage(context, url, pathname, responseProps) {
        const pageContent = await this.#store.getPage(pathname);

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
                page.description.template
            ));
        }

        return page;
    }

    async getBaseTemplate(context, templateId, options) {
        // TODO: getBaseTemplate
    }

    async getPageTemplate(context, page, options) {
        // TODO: getPageTemplate
    }

    async getPagePartialTemplate(page, partialId, options) {
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
                return pagePartials.get(partialId);
            }
        }

        // Ensure the global partials are loaded; we're going to copy and extend them.
        const globalPartials = await loadGlobalPartials(options);

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

        return pagePartials.get(partialId);
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
        return compileTemplate(templateId, templateSource, this.#customHelpers, partials);
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
