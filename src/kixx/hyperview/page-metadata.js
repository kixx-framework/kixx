import deepMerge from '../utils/deep-merge.js';


export default class PageMetadata {

    #pathname = [];
    #filepaths = [];
    #sources = [];

    constructor(pathname) {
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

        // Always start with the root page metadata item.
        this.#filepaths.push('pages/page.json');
        this.#pathname = '';

        for (const part of parts) {
            // We can safely assume all pathnames have been validated and are
            // safe to use by the time they reach here.
            this.#pathname = `${ this.#pathname }/${ part }`;
            this.#filepaths.push(`pages/${ this.#pathname }/page.json`);
        }

        assertCanonicalIdentifier(
            this.#pathname,
            `PageMetadata pathname: ${ pathname }`,
        );
    }

    get pathname() {
        return this.#pathname;
    }

    getFilepaths() {
        return this.#filepaths;
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

        Object.assign(this, props);

        // We expect that metadata.includes has been validated on input as an
        // object, null, or undefined. So, this check makes sense instead
        // of failing loudly with a programmer error.
        if (!isPlainObject(this.includes)) {
            this.includes = {};
        }
        // We expect that metadata.partials has been validated on input as an
        // array, null, or undefined. So, this check makes sense instead
        // of failing loudly with a programmer error.
        if (!Array.isArray(this.partials)) {
            this.partials = [];
        }

        return this;
    }

    getIncludesList() {
        const filepathPrefix = `pages/${ this.#pathname }`;

        return Object.keys(this.includes).map((name) => {
            const { filename, template } = this.includes[name];
            return {
                name,
                filename,
                template: Boolean(template),
                filepath: `${ filepathPrefix }/${ filename }`,
            };
        });
    }

    getPartialsList() {
        const filepathPrefix = `pages/${ this.#pathname }`;

        return this.partials.map((filename) => {
            return {
                filename,
                filepath: `${ filepathPrefix }/${ filename }`,
            };
        });
    }

    getDependenciesList() {
        // Add the page leaf node to the sources, which will include
        // the page.json, page.html, includes, and partials.
        return this.#sources.concat([ `pages/${ this.#pathname }` ]);
    }
}
