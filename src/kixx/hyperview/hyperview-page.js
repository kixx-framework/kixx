export default class HyperviewPage {

    #pageContext = {};
    #responseProps = null;
    #metadataTemplates = new Map();

    constructor(url, pathname, responseProps) {
        const {
            url,
            pathname,
            responseProps,
            pageTemplate,
            partials,
            includes,
            digest,
        } = spec;

        this.#responseProps = responseProps;
        this.#pageDigest = pageDigest;

        this.url = url;
        this.pathname = pathname;
        this.pageTemplate = {
            id: pageTemplate.basename,
            text: pageTemplate.text,
        };
        this.includes = null;
        this.partials = null;
        this.digest = digest;

        if (includes) {
            this.includes = {
                hash: includes.hash,
                includes: includes.json,
            };
        }
        if (partials) {
            this.partials = {
                hash: partials.hash,
                partials: partials.json,
            };
        }
    }

    get rawPageTitle() {
        return this.#pageContext.page?.title;
    }

    get rawPageDescription() {
        return this.#pageContext.page?.description;
    }

    mergeSources(sources) {
        const pageContext = {};

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

        // Clone the response.props so we don't mutate the nested data structures
        // as part of the page context hydration process.
        deepMerge(this.#pageContext, structuredClone(this.#responseProps));

        return this;
    }

    setMetadataTemplate(name, template) {
        this.#metadataTemplates.set(name, template);
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
            page.canonical_url = urlToCanonicalURLString(this.url);
        }
        // The href records the fully qualified URL.
        if (isUndefined(page.href)) {
            page.href = url.href;
        }

        // Hydrate the title and description templates, if they exist.
        if (this.#metadataTemplates.has('page.title')) {
            page.title = this.#metadataTemplates.get('page.title')(this.#pageContext);
        }
        if (this.#metadataTemplates.has('page.description')) {
            page.description = this.#metadataTemplates.get('page.description')(this.#pageContext);
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
