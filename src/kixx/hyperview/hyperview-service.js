
export default class HyperviewService {

    async respondWithPage(context, request, response, options) {
        const { url } = request;

        assertCanonicalIdentifier(
            baseTemplateId,
            `A valid baseTemplate ID must be provided in HyperviewService#respondWithPage options or page data (pathname:${ pathname })`,
        );

        const page = await this.getPage(context, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        if (isJsonRequest(request)) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.getPageContext(),
                { whiteSpace: 4 },
            );
        }

        let hypertext;

        // Get a digest hash of this page from the content-addressable store,
        // optionally including a hash of the canonicalized response props.
        const hash = await page.getDigest(this.#store, {
            includeProps: includePropsInDigest,
            propsHashFunction,
        });

        // If the caller does not provide a custom cache key, we use the
        // URL pathname + query params as the default.
        const pageCacheKey = isNonEmptyString(cacheKey)
            ? cacheKey
            : (url.pathname + url.search);

        // Add the namespace prefix and digest hash for the complete KV key.
        const key = `hyperview_page_cache#${ cacheKey }#${ hash }`;

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

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            this.getBaseTemplate(context, baseTemplateId, { useCache: useTemplateCache }),
            this.getPageTemplate(context, page, { useCache: useTemplateCache }),
        ]);
    }

    async getPage(context, url, pathname, responseProps) {
        const pageContent = await this.#store.getPage(pathname);

        if (!pageContent) {
            return null;
        }

        const page = new HyperviewPage({
            url,
            pathname,
            responseProps,
            partials: pageContent.partials,
            includes: pageContent.includes,
            pageDigest: pageContent.digest,
            propsDigest: this.#store.canonicalObjectDigest(responseProps),
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
    }

    async getPageTemplate(context, page, options) {
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
