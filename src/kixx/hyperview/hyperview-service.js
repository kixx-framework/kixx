
export default class HyperviewService {

    async renderHypertext(context, request, response, options) {
    }

    async getPage(url, pathname, options) {
        const { strict = false } = options ?? {};

        const page = new HyperviewPage(url, pathname);

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
        if (strict && !allItems[allItems.length - 1]) {
            return null;
        }

        // Filter out page data entries which do not exist.
        const sources = allItems.filter(entry => entry);

        return page.mergeSources(sources);
    }

    hydratePageMetadata(page) {
        const { title, description, pathname } = page;

        if (isNonEmptyString(title?.template)) {
            const template = this.createMiniTemplate(`${ pathname }/page.title`, title.template);
            page.useTitleTemplate(template);
        }
        if (isNonEmptyString(description?.template)) {
            const template = this.createMiniTemplate(`${ pathname }/page.description`, description.template);
            page.useDescriptionTemplate(template);
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
