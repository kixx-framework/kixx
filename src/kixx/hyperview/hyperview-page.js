export default class HyperviewPage {

    #pageContext = {};
    #responseProps = null;
    #metadataTemplates = new Map();
    #dependencies = null;
    #includes = {};
    #partials = [];

    constructor(url, pathname, responseProps) {
        assertCanonicalIdentifier(
            pathname,
            `PageMetadata pathname: ${ pathname }`,
        );

        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json
        const parts = pathname.split('/').filter((part) => part);
        const filepaths = [];
        let path = '';

        // Always start with the root page metadata item.
        filepaths.push('pages/page.json');

        for (const part of parts) {
            // All page data filepaths are prefixed with "pages"
            // in content-addressable storage.
            path = `${ path }/${ part }`;
            filepaths.push(`pages/${ path }/page.json`);
        }

        this.#responseProps = responseProps;
        // Include the page leaf directory in the dependencies list.
        this.#dependencies = filepaths.concat([ `pages/${ pathname }` ]);

        this.url = url;
        this.pathname = path;
        this.filepaths = filepaths;
    }

    get baseTemplateId() {
        return this.#pageContext.baseTemplate;
    }

    get pageTitle() {
        return this.#pageContext.page?.title;
    }

    get pageDescription() {
        return this.#pageContext.page?.description;
    }

    mergeSources(sources) {
        const pageContext = {};

        const leafNode = sources[sources.length - 1];

        // Merge the pages together, with the more specific page data objects overriding
        // their parents. For the merge to work correctly, sources must be sorted
        // from grandparent -> grandchild
        for (let i = 0; i < sources.length; i += 1) {
            const { filepath, json } = sources[i];

            // Includes and partials are page-relative, so only the leaf node can declare
            // files that should be loaded for the requested pathname.
            if (sources[i] !== leafNode) {
                this.#sources.push(filepath);
                delete json.includes;
                delete json.partials;
            }

            deepMerge(pageContext, json);
        }

        Object.assign(this.#pageContext, pageContext);

        // We expect that metadata.includes has been validated on input as an object,
        // null, or undefined. So, this check makes sense instead of
        // failing loudly with a programmer error.
        if (isPlainObject(pageContext.includes)) {
            this.#includes = pageContext.includes;
        }
        // We expect that partials have been validated on input as an array, null, or
        // undefined. So, this check makes sense instead of
        // failing loudly with a programmer error.
        if (!Array.isArray(pageContext.partials)) {
            this.#partials = pageContext.partials;
        }

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
        if (isFunction(page.description)) {
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

    getIncludesList() {
        const filepathPrefix = `pages/${ this.pathname }`;

        return Object.keys(this.#pageContext.includes).map((name) => {
            const { filename, template } = this.includes[name];
            return {
                name,
                filename,
                template: Boolean(template),
                filepath: `${ filepathPrefix }/${ filename }`,
            };
        });
    }

    async getDigest(store, context, options) {
        const {
            includeProps,
            propsHashFunction,
        } = options ?? {};

        // Build a list of dependencies we know exist in the content-addressable tree.
        const provenDependencies = [];
        for (const filepath of this.#dependencies) {
            // The call to statFilepath is much cheaper than it might appear.
            // The stat information can be extracted from the index, which
            // should be preloaded after this instance is warm.
            const stat = await store.statFilepath(context, filepath);
            if (stat) {
                provenDependencies.push(stat);
            }
        }

        // The content-addressable store will get us the digest of all the
        // dependencies from the tree.
        const dependenciesHash = await store.digest(context, provenDependencies);

        // Optionally add the hash of the canonicalized props object.
        let propsHash;
        if (includeProps) {
            if (isFunction(propsHashFunction)) {
                propsHash = propsHashFunction(this.pathname, this.#pageContext, this.#responseProps);
            } else {
                propsHash = store.objectDigest(this.#responseProps);
            }
        }

        if (propsHash) {
            return store.hashString(dependenciesHash + propsHash);
        }

        return dependenciesHash;
    }
}
