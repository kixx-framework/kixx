import deepMerge from '../utils/deep-merge.js';
import {
    isFunction,
    isUndefined,
    isObjectNotNull,
    isNonEmptyString,
} from '../assertions/mod.js';

export default class HyperviewPage {

    #createMiniTemplate;

    constructor(spec) {
        const {
            url,
            pathname,
            responseProps,
            pageDataSources,
            template,
            partials,
            includes,
            hash,
            createMiniTemplate,
        } = spec;

        this.#createMiniTemplate = createMiniTemplate;

        this.url = url;
        this.pathname = pathname;
        this.template = template;
        this.partials = partials;
        this.hash = hash;

        this.context = this.#formatPageContext(this.#mergeSources(
            pageDataSources,
            includes,
            responseProps,
        ));
    }

    #mergeSources(originalSources, includes, responseProps) {
        const pageContext = {};

        // Create a structured clone so that we can safely mutate the sources.
        const sources = structuredClone(originalSources);

        // Merge the pages together, with the more specific page data objects overriding
        // their parents. For the merge to work correctly, sources must be sorted
        // from grandparent -> grandchild
        for (const json of sources) {
            deepMerge(pageContext, json);
        }

        pageContext.includes = includes;

        // Clone the response.props so we don't mutate the nested data structures
        // as part of the page context hydration process.
        deepMerge(pageContext, structuredClone(responseProps));

        // Compile the title template, if it exists.
        if (isNonEmptyString(pageContext.page?.title?.template)) {
            pageContext.page.title = this.#createMiniTemplate(
                `${ this.pathname }/page.title`,
                pageContext.page.title.template,
            );
        }
        // Compile the description template, if it exists.
        if (isNonEmptyString(pageContext.page?.description?.template)) {
            pageContext.page.description = this.#createMiniTemplate(
                `${ this.pathname }/page.description`,
                pageContext.page.description.template,
            );
        }

        return pageContext;
    }

    #formatPageContext(pageContext) {
        if (isUndefined(pageContext.pathname)) {
            pageContext.pathname = this.pathname;
        }
        if (isUndefined(pageContext.url_pathname)) {
            pageContext.url_pathname = this.url.pathname;
        }

        if (!isObjectNotNull(pageContext.page)) {
            pageContext.page = {};
        }

        const { page } = pageContext;

        // Set canonical URL from request URL if not already defined in page data;
        // excludes query string and hash to provide a stable reference.
        if (isUndefined(page.canonical_url)) {
            page.canonical_url = `${ this.url.protocol }//${ this.url.host }${ this.url.pathname }`;
        }
        // The href records the fully qualified URL.
        if (isUndefined(page.href)) {
            page.href = this.url.href;
        }

        // Hydrate the title and description templates, if they exist.
        if (isFunction(page.title)) {
            page.title = page.title(pageContext);
        }
        if (isFunction(page.description)) {
            page.description = page.description(pageContext);
        }

        // Create the Open Graph object if it does not yet exist.
        if (!isObjectNotNull(page.open_graph)) {
            page.open_graph = {};
        }

        const { open_graph } = page;

        // Let existing open_graph values override the page values

        if (isUndefined(open_graph.url)) {
            open_graph.url = page.canonical_url;
        }
        if (isUndefined(open_graph.type)) {
            open_graph.type = 'website';
        }
        if (isUndefined(open_graph.title)) {
            open_graph.title = page.title;
        }
        if (isUndefined(open_graph.description)) {
            open_graph.description = page.description;
        }
        if (isUndefined(open_graph.locale)) {
            open_graph.locale = page.locale;
        }

        return pageContext;
    }
}
