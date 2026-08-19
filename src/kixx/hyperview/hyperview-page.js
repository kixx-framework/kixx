import deepMerge from '../utils/deep-merge.js';
import {
    isFunction,
    isUndefined,
    isObjectNotNull,
    isNonEmptyString,
} from '../assertions/mod.js';

export default class HyperviewPage {

    #pageContext = {};
    #responseProps = null;
    #createMiniTemplate;

    constructor(spec) {
        const {
            url,
            pathname,
            responseProps,
            pageTemplateFilename,
            partials,
            includes,
            etag,
            createMiniTemplate,
        } = spec;

        this.#responseProps = responseProps;
        this.#createMiniTemplate = createMiniTemplate;

        this.url = url;
        this.pathname = pathname;
        this.pageTemplateFilename = pageTemplateFilename;
        this.includes = null;
        this.partials = null;
        this.etag = etag;

        // includes and partials are ContentObject instances; json() decodes the
        // stored bytes and must be invoked, not read as a data property.
        if (includes) {
            this.includes = includes.json();
        }
        if (partials) {
            this.partials = {
                etag: partials.etag,
                partials: partials.json(),
            };
        }
    }

    mergeSources(originalSources) {
        const pageContext = {};

        // Create a structured clone so that we can safely mutate the sources.
        const sources = structuredClone(originalSources);
        const leafNode = sources[sources.length - 1];

        // Merge the pages together, with the more specific page data objects overriding
        // their parents. For the merge to work correctly, sources must be sorted
        // from grandparent -> grandchild
        for (const json of sources) {
            // Includes and partials are page-relative, so only the leaf node can declare
            // files that should be loaded for the requested pathname.
            if (json !== leafNode) {
                delete json.includes;
                delete json.partials;
            }

            deepMerge(pageContext, json);
        }

        Object.assign(this.#pageContext, pageContext);

        this.#pageContext.includes = this.includes;

        // Clone the response.props so we don't mutate the nested data structures
        // as part of the page context hydration process.
        deepMerge(this.#pageContext, structuredClone(this.#responseProps));

        // Compile the title template, if it exists.
        if (isNonEmptyString(this.#pageContext.page?.title?.template)) {
            this.#pageContext.page.title = this.#createMiniTemplate(
                `${ this.pathname }/page.title`,
                this.#pageContext.page.title.template,
            );
        }
        // Compile the description template, if it exists.
        if (isNonEmptyString(this.#pageContext.page?.description?.template)) {
            this.#pageContext.page.description = this.#createMiniTemplate(
                `${ this.pathname }/page.description`,
                this.#pageContext.page.description.template,
            );
        }

        return this;
    }

    getPageContext() {
        if (isUndefined(this.#pageContext.pathname)) {
            this.#pageContext.pathname = this.pathname;
        }
        if (isUndefined(this.#pageContext.url_pathname)) {
            this.#pageContext.url_pathname = this.url.pathname;
        }

        if (!isObjectNotNull(this.#pageContext.page)) {
            this.#pageContext.page = {};
        }

        const { page } = this.#pageContext;

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
            page.title = page.title(this.#pageContext);
        }
        if (isFunction(page.description)) {
            page.description = page.description(this.#pageContext);
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

        return this.#pageContext;
    }
}
