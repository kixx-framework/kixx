export default class HyperviewPage {

    #pageContext = {};

    constructor(url, pathname) {
        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json
        //
        // All page data filepaths are prefixed with "pages" in content-addressable storage.

        const parts = pathname.split('/').filter((part) => part);
        const filepaths = [];
        let path = '';

        // Always start with the root page metadata item.
        filepaths.push('pages/page.json');

        for (const part of parts) {
            // We can safely assume all pathnames have been validated and are
            // safe to use by the time they reach here.
            path = `${ path }/${ part }`;
            filepaths.push(`pages/${ path }/page.json`);
        }

        assertCanonicalIdentifier(
            path,
            `PageMetadata pathname: ${ pathname }`,
        );

        this.url = url;
        this.pathname = path;
        this.filepaths = filepaths;
    }

    get title() {
        return this.#pageContext.page?.title;
    }

    get description() {
        return this.#pageContext.page?.description;
    }

    mergeSources(sources) {
        const props = {};

        const leafNode = sources[sources.length - 1];

        // Merge the pages together, with the more specific page data objects overriding
        // their parents. Includes and partials are page-relative, so only the leaf page
        // can declare files that should be loaded for the requested pathname.
        // For the merge to work correctly, sources must be sorted
        // from grandparent -> grandchild
        for (let i = 0; i < sources.length; i += 1) {
            const { filepath, json } = sources[i];

            // We only inherit the includes and partials from the leaf node.
            if (sources[i] !== leafNode) {
                this.#sources.push(filepath);
                delete json.includes;
                delete json.partials;
            }

            deepMerge(props, json);
        }

        Object.assign(this.#pageContext, props);

        // We expect that metadata.includes has been validated on input as an
        // object, null, or undefined. So, this check makes sense instead
        // of failing loudly with a programmer error.
        if (isPlainObject(props.includes)) {
            this.includes = props.includes;
        } else {
            this.includes = {};
        }
        // We expect that metadata.partials has been validated on input as an
        // array, null, or undefined. So, this check makes sense instead
        // of failing loudly with a programmer error.
        if (!Array.isArray(props.partials)) {
            this.partials = props.partials;
        } else {
            this.partials = [];
        }

        return this;
    }

    useTitleTemplate(template) {
        this.#ensurePageContext();
        this.#pageContext.page.title = template;
    }

    useDescriptionTemplate(template) {
        this.#ensurePageContext();
        this.#pageContext.page.description = template;
    }

    getPageContext() {
        this.#ensurePageContext();

        if (isUndefined(this.#pageContext.pathname)) {
            this.#pageContext.pathname = this.pathname;
        }
        if (isUndefined(this.#pageContext.url_pathname)) {
            this.#pageContext.url_pathname = this.url.pathname;
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

    #ensurePageContext() {
        if (!isObjectNotNull(this.#pageContext.page)) {
            this.#pageContext.page = {};
        }
    }
}
