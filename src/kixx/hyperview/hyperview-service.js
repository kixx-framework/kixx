import * as templating from '../templating/mod.js';
import deepMerge from '../utils/deep-merge.js';
import {
    AssertionError,
    assert,
    isUndefined,
    isObjectNotNull,
    isNonEmptyString,
} from '../assertions/mod.js';

import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * Renders Hyperview pages by fetching, merging, and processing hierarchical page data.
 */
export default class HyperviewService {

    #logger = null;

    #customHelpers = new Map([
        [ 'formatDate', formatDate ],
        [ 'markup', markup ],
        [ 'truncate', truncate ],
    ]);

    #pageDataStore = null;
    #templateFileStore = null;
    #pageDataCache = new Map();
    #templateCache = new Map();

    /**
     * @param {Object} options - Service configuration
     * @param {import('../logger/logger.js').default} options.logger - Root logger used to create a HyperviewService child logger
     * @throws {AssertionError} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'HyperviewService requires a logger');
        this.#logger = logger.createChild('HyperviewService');
    }

    /**
     * @param {Object} args
     * @param {Object} args.pageDataStore - Store for fetching page JSON and text file assets
     * @param {Object} args.templateFileStore - Store for fetching base templates and partials
     */
    initialize(args) {
        const { pageDataStore, templateFileStore } = args ?? {};
        assert(pageDataStore, 'HyperviewService requires a pageDataStore');
        assert(templateFileStore, 'HyperviewService requires a templateFileStore');
        this.#pageDataStore = pageDataStore;
        this.#templateFileStore = templateFileStore;
    }

    /**
     * Fetches and assembles page data for a pathname by merging all ancestor page.json files,
     * resolving title/description templates, and loading file includes.
     * @param {Object} context - Request context passed through to the page data store
     * @param {URL} url - Request URL used to derive canonical_url and href defaults
     * @param {string} pathname - URL pathname identifying the page (e.g., '/blog/2026/post-slug')
     * @param {Object|null} [props=null] - Optional props merged last, overriding all page data
     * @param {Object} [options] - Page data loading options
     * @param {boolean} [options.useCache=false] - Reuse assembled static page data from this service instance
     * @returns {Promise<Object|null>} Assembled page data, or null if the leaf page.json does not exist
     * @throws {AssertionError} When an include entry is missing its required filename property
     */
    async getPageData(context, url, pathname, props = null, options) {
        const { useCache = false } = options ?? {};
        const canUseCache = useCache && (props === null || isUndefined(props));
        if (canUseCache && this.#pageDataCache.has(pathname)) {
            this.#logger.debug('getPageData() using cached data for pathname', { pathname });
            return this.#pageDataCache.get(pathname);
        }

        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json

        const parts = pathname.split('/').filter((part) => part);
        const filepaths = [ '/page.json' ];
        let path = '';

        if (pathname !== '/') {
            for (const part of parts) {
                path = `${ path }/${ part }`;
                filepaths.push(`${ path }/page.json`);
            }
        }

        this.#logger.debug('getPageData() fetching page data', { pathname });

        const items = await this.#pageDataStore.getJSONFiles(context, null, filepaths);

        if (!items[items.length - 1]) {
            this.#logger.debug('getPageData() page data not found', { pathname });
            if (canUseCache) {
                this.#pageDataCache.set(pathname, null);
            }
            return null;
        }

        // Extract json payloads for merging. Parent page.json files are optional, nulls are skipped.
        const jsonItems = items.filter((x) => x).map((x) => x.json);

        // The props override all pages when present.
        if (isObjectNotNull(props)) {
            jsonItems.push(props);
        }

        // Merge the pages together, with the more specific page data objects overriding
        // their parents.
        const data = deepMerge(...jsonItems);

        if (data.page) {
            const { page } = data;

            // Set canonical URL from request URL if not already defined in page data
            // Canonical URL excludes query string and hash to provide a stable reference
            if (!page.canonical_url) {
                page.canonical_url = this.#urlToCanonicalURLString(url);
            }
            if (!page.href) {
                page.href = url.href;
            }

            if (isNonEmptyString(page.title?.template)) {
                const tpl = this.#createMiniTemplate(`${ path }/page.title`, page.title.template);
                page.title = tpl(data);
            }
            if (isNonEmptyString(page.description?.template)) {
                const tpl = this.#createMiniTemplate(`${ path }/page.description`, page.description.template);
                page.description = tpl(data);
            }

            // Create the Open Graph object if it does not yet exist.
            if (!page.open_graph) {
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
        }

        // Process included files. Example:
        // const data = {
        //     includes: {
        //         header: { filename: 'header.html', template: true },
        //         summary: { filename: 'summary.md' },
        //         body: { filename: 'body.md', template: true },
        //     },
        // };
        if (data.includes) {
            this.#logger.debug('getPageData() loading included resources', { pathname, includes: data.includes });

            // Build a flat list without mutating data.includes — the name is carried
            // separately so missing files leave the original slot untouched.
            const includesList = Object.keys(data.includes)
                .map((name) => {
                    const item = data.includes[name];
                    if (item) {
                        return Object.assign({}, item, { name });
                    }
                    return null;
                })
                .filter((x) => x);

            const includedFilepaths = includesList.map(({ name, filename }) => {
                if (!isNonEmptyString(filename)) {
                    throw new AssertionError(`Missing includes[${name}].filename from ${pathname}`, null, this.getPageData);
                }
                return `${ path }/${ filename }`;
            });

            const files = await this.#pageDataStore.getTextFiles(context, null, includedFilepaths);

            const includedContent = files
                .map((file, index) => {
                    if (file) {
                        const { filepath, source } = file;
                        return Object.assign(includesList[index], { filepath, source });
                    }
                    return null;
                })
                .filter((x) => x);

            for (const item of includedContent) {
                if (item.template) {
                    const tpl = this.#createMiniTemplate(item.filepath, item.source);
                    data.includes[item.name] = tpl(data);
                } else {
                    data.includes[item.name] = item.source;
                }
            }
        }

        if (canUseCache) {
            this.#pageDataCache.set(pathname, data);
        }

        return data;
    }

    /**
     * Loads and compiles a shared base template with all available partials.
     * @param {RequestContext} context - Request context passed through to the template file store
     * @param {string} templateId - Base template identifier understood by the template file store
     * @param {Object} [options] - Template loading options
     * @param {boolean} [options.useCache=false] - Reuse compiled templates from this service instance
     * @returns {Promise<Function|null>} Render function, or null when the base template does not exist
     * @throws {Error} When a template or partial cannot be compiled
     */
    async getBaseTemplate(context, templateId, options) {
        const { useCache = false } = options ?? {};
        const partials = await this.loadPartials(context, { useCache });
        const file = await this.#templateFileStore.getTemplate(context, null, templateId);
        if (file) {
            let template = useCache ? this.#templateCache.get(file.filepath) : null;
            if (!template) {
                template = this.compileTemplate(file.filepath, file.source, this.#customHelpers, partials);
                if (useCache) {
                    this.#templateCache.set(file.filepath, template);
                }
            }
            return template;
        }
        return null;
    }

    /**
     * Loads and compiles a page-specific template with all available partials.
     * @param {RequestContext} context - Request context passed through to the stores
     * @param {string} pathname - Page pathname used as the template directory
     * @param {string} templateId - Template filename relative to the page pathname
     * @param {Object} [options] - Template loading options
     * @param {boolean} [options.useCache=false] - Reuse compiled templates from this service instance
     * @returns {Promise<Function|null>} Render function, or null when the page template does not exist
     * @throws {Error} When a template or partial cannot be compiled
     */
    async getPageTemplate(context, pathname, templateId, options) {
        const { useCache = false } = options ?? {};
        const filepath = pathname === '/' ? `/${ templateId }` : `${ pathname }/${ templateId }`;
        const partials = await this.loadPartials(context, { useCache });
        const cachedTemplate = useCache ? this.#templateCache.get(filepath) : null;
        if (cachedTemplate) {
            return cachedTemplate;
        }
        const source = await this.#pageDataStore.getTextFile(context, null, filepath) ?? null;
        if (source !== null) {
            const template = this.compileTemplate(filepath, source, this.#customHelpers, partials);
            if (useCache) {
                this.#templateCache.set(filepath, template);
            }
            return template;
        }
        return null;
    }

    /**
     * Loads and compiles shared partial templates for use by base and page templates.
     * @param {RequestContext} context - Request context passed through to the template file store
     * @param {Object} [options] - Partial loading options
     * @param {boolean} [options.useCache=false] - Reuse compiled partials from this service instance
     * @returns {Promise<Map<string, Function>>} Partial render functions keyed by template include name
     * @throws {Error} When a partial cannot be compiled
     */
    async loadPartials(context, options) {
        const { useCache = false } = options ?? {};
        const files = await this.#templateFileStore.getPartials(context, null);

        const partials = new Map();

        for (const { filepath, source } of files) {
            const name = filepath.replace(/^\/?partials\//, '');
            let template = useCache ? this.#templateCache.get(filepath) : null;
            if (!template) {
                template = this.compileTemplate(filepath, source, this.#customHelpers, partials);
                if (useCache) {
                    this.#templateCache.set(filepath, template);
                }
            }
            partials.set(name, template);
        }

        return partials;
    }

    /**
     * Compiles template source into a render function. Custom helpers override built-ins
     * when they share the same key.
     * @param {string} templateId - Unique identifier used in error reporting
     * @param {string} source - Template source code
     * @param {Map<string, Function>} customHelpers - Helper functions that override built-in helpers
     * @param {Map<string, Function>} partials - Compiled partial templates keyed by partial name
     * @returns {Function} Render function: accepts a data object and returns a rendered string
     */
    compileTemplate(templateId, source, customHelpers, partials) {
        const helpers = new Map([...templating.helpers, ...customHelpers]);

        const tokens = templating.tokenize(null, templateId, source);
        const tree = templating.buildSyntaxTree(null, tokens);

        return templating.createRenderFunction(null, helpers, partials, tree);
    }

    /**
     * Compiles a template with helpers but no partials.
     * @param {string} templateId - Unique identifier used in error messages
     * @param {string} templateSource - Template source text which may contain template syntax
     * @returns {Function} Render function: accepts a data object and returns a rendered string
     */
    #createMiniTemplate(templateId, templateSource) {
        // Metadata fields (title, description) can contain template syntax, so compile
        // and render them with page data. Use empty partials since metadata templates
        // shouldn't include partials to avoid circular dependencies
        const partials = new Map();
        return this.compileTemplate(templateId, templateSource, this.#customHelpers, partials);
    }

    /**
     * Converts a URL object to a canonical URL string without query string or hash.
     *
     * Builds a stable reference URL that doesn't change with request parameters or fragments.
     * Used for canonical URLs and Open Graph metadata.
     * @param {URL} url - URL object with protocol, host, and pathname properties
     * @returns {string} Canonical URL string (e.g., 'https://example.com/blog/post')
     */
    #urlToCanonicalURLString(url) {
        return `${ url.protocol }//${ url.host }${ url.pathname }`;
    }
}
