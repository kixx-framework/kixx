
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
            const template = getPartialTemplate(page, partial, { useCache: useTemplateCache });
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
        const body = pageTemplate(pageContext);

        // TODO: We need a better way to detect renderPageTemplateOnly
        if (renderPageTemplateOnly) {
            return response.respondWithUtf8(response.status, body, responseOptions);
        }

        pageContext.body = body;
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

    getPartialTemplate(page, templateId, options) {
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
}
