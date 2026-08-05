
export default class HyperviewService {

    async respondWithPage(context, request, response, options) {
        const { url } = request;

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
        const hash = await page.getDigest(this.#store, context, {
            includeProps: includePropsInDigest,
            propsHashFunction,
        });

        // If the caller does not provide a custom cache key, we use the
        // URL pathname + query params as the default.
        const pageCacheKey = isNonEmptyString(cacheKey)
            ? cacheKey
            : (url.pathname + url.search);

        // Add the namespace prefix and digest hash for the complete KV key.
        const key = `hyperview_page_cache#${ url.pathname }#${ hash }`;

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

        if (isNonEmptyString(page.baseTemplateId)) {
            baseTemplateId = page.baseTemplateId;
        }
        if (!isNonEmptyString(baseTemplateId)) {
            throw new AssertionError(
                `A baseTemplate ID must be provided in HyperviewService#respondWithPage options or page data (pathname:${ pathname })`,
            );
        }

        const pageTemplateId = `${ pathname }/page.html`;

        const [ baseTemplate, pageTemplate ] = await Promise.all([
            this.getBaseTemplate(context, baseTemplateId, { useCache: useTemplateCache }),
            this.getPageTemplate(context, pageTemplateId, { useCache: useTemplateCache }),
        ]);
    }

    async getPage(context, url, pathname, responseProps) {
        const page = new HyperviewPage(url, pathname, responseProps);

        // Attempting to fetch items which may not exist is cheap, because
        // getBatchByFilepaths checks for existance in the index before
        // attempting fetch the key. Items which do not exist are
        // `null` in the returned array.
        //
        // IMPORTANT: Page data items must be returned from getBatchByFilepaths in the
        // same order as the filepaths Array we passed in. Otherwise, the
        // grandparent <- parent <- grandchild merge would be incorrect.
        const allItems = await this.#store.getBatchByFilepaths(context, page.filepaths, {
            type: 'json',
            cacheTtl: this.#resolvePageMetadataTtl(options, 'HyperviewService#getPageMetadata():'),
        });

        // Parent page.json files are optional, but the leaf node must exist for the
        // page to be considered to be present in strict mode.
        const leafNode = allItems[allItems.length - 1];
        if (!leafNode) {
            return null;
        }

        // Filter out page data entries which do not exist.
        const sources = allItems.filter(entry => entry);

        // Fold all the source metadata objects into the page context.
        page.mergeSources(sources);

        // Compile the title template, if it exists.
        if (isNonEmptyString(page.title?.template)) {
            page.setMetadataTemplate('page.title', this.createMiniTemplate(
                `${ pathname }/page.title`,
                page.title.template,
            ));
        }
        // Compile the description template, if it exists.
        if (isNonEmptyString(page.description?.template)) {
            page.setMetadataTemplate('page.description', this.createMiniTemplate(
                `${ pathname }/page.description`,
                page.description.template
            ));
        }

        return page;
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
}
