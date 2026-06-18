import * as templating from '../templating/mod.js';
import deepMerge from '../utils/deep-merge.js';
import {
    AssertionError,
    assert,
    isUndefined,
    isNonEmptyString,
    isFunction,
} from '../assertions/mod.js';

import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../key-value-store/key-value-store-interface.js').KeyValueStoreInterface} KeyValueStoreInterface
 */

/**
 * @typedef {import('./page-data-store-interface.js').PageDataStoreInterface} PageDataStoreInterface
 */

/**
 * @typedef {import('./template-file-store-interface.js').TemplateFileStoreInterface} TemplateFileStoreInterface
 */

/**
 * @typedef {Object} HyperviewPageContent
 * @property {string} version - Version string composed from the merged page data files.
 * @property {Object} metadata - Page metadata merged from root to leaf page data.
 */

/**
 * @typedef {Object} HyperviewIncludeSpec
 * @property {string} filename - Page-relative file to load.
 * @property {boolean} [template=false] - Compile and render the file as a template.
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

    #kvStore = null;
    #pageDataStore = null;
    #templateFileStore = null;

    #templateCache = new Map();
    #partialsCache = new Map();
    #includesCache = new Map();

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
     * @param {KeyValueStoreInterface} [args.kvStore] - Optional key/value store for full-page caching.
     * @param {PageDataStoreInterface} args.pageDataStore - Store for page metadata and include files.
     * @param {TemplateFileStoreInterface} args.templateFileStore - Store for base, page, and partial templates.
     * @throws {AssertionError} When a required store is missing.
     */
    initialize(args) {
        const { kvStore, pageDataStore, templateFileStore } = args ?? {};
        assert(pageDataStore, 'HyperviewService requires a pageDataStore');
        assert(templateFileStore, 'HyperviewService requires a templateFileStore');
        this.#kvStore = kvStore;
        this.#pageDataStore = pageDataStore;
        this.#templateFileStore = templateFileStore;
    }

    /**
     * Loads and merges page metadata from the root page through `pathname`.
     * @param {RequestContext} context - Request context passed through to the page data store.
     * @param {string} pathname - Normalized page pathname, such as `/` or `/blog/post`.
     * @returns {Promise<HyperviewPageContent|null>} Merged page content, or null when the leaf page is missing.
     */
    async getPageMetadata(context, pathname) {
        const buildId = context.runtime.build?.id ?? null;

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

        const items = await this.#pageDataStore.getJSONFiles(context, buildId, filepaths);

        if (!items[items.length - 1]) {
            this.#logger.debug('page metadata not found', { pathname });
            return null;
        }

        let version = '';

        // Extract json payloads for merging. Parent page.json files are optional, nulls are skipped.
        const jsonItems = items
            .filter((x) => x)
            .map((x) => {
                version = version ? `${ version }:${ x.json.version }` : x.json.version;
                return x.json;
            });

        // Merge the pages together, with the more specific page data objects overriding
        // their parents.
        const metadata = deepMerge(...jsonItems);

        return { version, metadata };
    }

    /**
     * Retrieves a cached full-page HTML response.
     * @param {RequestContext} context - Request context passed through to the key/value store.
     * @param {string} pathname - Normalized page pathname.
     * @param {string} version - Page content version used to isolate cache entries.
     * @returns {Promise<string|null>} Cached HTML, or null when absent.
     * @throws {AssertionError} When no key/value store was configured.
     */
    async getCachedPage(context, pathname, version) {
        assert(this.#kvStore, 'HyperviewService requires a kvStore to cache full pages');
        const buildId = context.runtime.build?.id || '';
        const key = `hyperview_page_cache:${ buildId }:${ pathname }:${ version }`;
        const page = await this.#kvStore.get(context, key, { type: 'text' });
        if (page) {
            this.#logger.debug('cached page hit', { pathname, key });
        } else {
            this.#logger.debug('cached page miss', { pathname, key });
        }
        return page;
    }

    /**
     * Stores a rendered full-page HTML response in the key/value cache.
     * @param {RequestContext} context - Request context passed through to the key/value store.
     * @param {string} pathname - Normalized page pathname.
     * @param {string} version - Page content version used to isolate cache entries.
     * @param {string} page - Rendered HTML page.
     * @returns {Promise<void>}
     * @throws {AssertionError} When no key/value store was configured.
     */
    async setCachedPage(context, pathname, version, page) {
        assert(this.#kvStore, 'HyperviewService requires a kvStore to cache full pages');
        const buildId = context.runtime.build?.id || '';
        const key = `hyperview_page_cache:${ buildId }:${ pathname }:${ version }`;
        await this.#kvStore.put(context, key, page, { type: 'text' });
    }

    /**
     * Adds canonical URL, current href, templated title/description, and Open Graph defaults.
     * @param {URL} url - Request URL for the page being rendered.
     * @param {Object} metadata - Merged page metadata. Its `page` object is mutated and returned.
     * @returns {Object} The normalized `metadata.page` object.
     */
    mergePageMetadata(url, metadata) {
        const page = metadata.page ?? {};
        // Set canonical URL from request URL if not already defined in page data
        // Canonical URL excludes query string and hash to provide a stable reference
        if (!page.canonical_url) {
            page.canonical_url = this.#urlToCanonicalURLString(url);
        }
        if (!page.href) {
            page.href = url.href;
        }

        if (isNonEmptyString(page.title?.template)) {
            const template = this.#createMiniTemplate(`${ url.pathname }/page.title`, page.title.template);
            page.title = template(metadata);
        }
        if (isNonEmptyString(page.description?.template)) {
            const template = this.#createMiniTemplate(`${ url.pathname }/page.description`, page.description.template);
            page.description = template(metadata);
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

        return page;
    }

    /**
     * Loads include files declared by page metadata and returns rendered include content.
     * @param {RequestContext} context - Request context passed through to the page data and template stores.
     * @param {string} pathname - Normalized page pathname.
     * @param {Object<string, HyperviewIncludeSpec>} includes - Include declarations keyed by template name.
     * @param {Object} [options] - Include loading options.
     * @param {boolean} [options.useCache=false] - Reuse compiled include templates from this service instance.
     * @param {string} [options.version] - Page content version used to isolate compiled include cache entries.
     * @param {Object} [options.metadata] - Page metadata used when rendering templated includes.
     * @returns {Promise<Object<string, string>>} Rendered include content keyed by include name.
     */
    async getIncludes(context, pathname, includes, options) {
        const { useCache = false, version, metadata = {} } = options ?? {};
        const buildId = context.runtime.build?.id ?? null;

        // Process included files. Example:
        // const data = {
        //     includes: {
        //         header: { filename: 'header.html', template: true },
        //         summary: { filename: 'summary.md' },
        //         body: { filename: 'body.md', template: true },
        //     },
        // };

        let cacheKey;
        if (useCache && version) {
            cacheKey = `${ buildId }:${ pathname }:${ version }`;
            const cachedIncludes = this.#includesCache.get(cacheKey);
            if (cachedIncludes) {
                this.#logger.debug('page includes cache hit', { pathname, key: cacheKey });
                return renderIncludes(cachedIncludes, metadata);
            }
            this.#logger.debug('page includes cache miss', { pathname, key: cacheKey });
        }

        // Build a flat list without mutating metadata.includes; the name is
        // carried separately so each loaded file can be assigned to its public key.
        const includesList = Object.keys(includes)
            .map((name) => {
                const item = includes[name];
                if (item) {
                    return Object.assign({}, item, { name });
                }
                return null;
            })
            .filter((x) => x);

        let usesTemplate = false;

        const includedFilepaths = includesList.map(({ name, filename, template }) => {
            if (!isNonEmptyString(filename)) {
                throw new AssertionError(
                    `Missing includes[${ name }].filename in metadata for ${ pathname }`,
                    null,
                    this.getIncludes,
                );
            }
            if (template) usesTemplate = true;
            return joinPageFilepath(pathname, filename);
        });

        const files = await this.#pageDataStore.getTextFiles(context, buildId, includedFilepaths);

        let partials;
        if (usesTemplate) {
            partials = await this.loadPartials(context, { useCache });
        }

        const compiledIncludes = {};

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
                const template = this.compileTemplate(item.filepath, item.source, this.#customHelpers, partials);
                compiledIncludes[item.name] = template;
            } else {
                compiledIncludes[item.name] = item.source;
            }
        }

        if (cacheKey) {
            // Cache compiled include templates, not rendered strings, because
            // dynamic pages may merge different response props into each request.
            this.#includesCache.set(cacheKey, compiledIncludes);
        }

        return renderIncludes(compiledIncludes, metadata);
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
        const buildId = context.runtime.build?.id ?? null;

        let template;
        const cacheKey = `${ buildId }:base:${ templateId }`;
        if (useCache) {
            template = this.#templateCache.get(cacheKey);
            if (template) {
                this.#logger.debug('base template cache hit', { templateId, key: cacheKey });
                return template;
            }
            this.#logger.debug('base template cache miss', { templateId, key: cacheKey });
        }

        const file = await this.#templateFileStore.getBaseTemplate(context, buildId, templateId);
        if (file) {
            const partials = await this.loadPartials(context, { useCache });
            template = this.compileTemplate(file.filepath, file.source, this.#customHelpers, partials);
        }

        if (useCache) {
            this.#templateCache.set(cacheKey, template);
        }

        return template ?? null;
    }

    /**
     * Loads and compiles a page-specific template with all available partials.
     * @param {RequestContext} context - Request context
     * @param {string} templateId - Template identifier understood by the template file store
     * @param {Object} [options] - Template loading options
     * @param {boolean} [options.useCache=false] - Reuse compiled templates from this service instance
     * @returns {Promise<Function|null>} Render function, or null when the page template does not exist
     */
    async getPageTemplate(context, templateId, options) {
        const { useCache = false } = options ?? {};
        const buildId = context.runtime.build?.id ?? null;

        let template;
        const cacheKey = `${ buildId }:page:${ templateId }`;
        if (useCache) {
            template = this.#templateCache.get(cacheKey);
            if (template) {
                this.#logger.debug('page template cache hit', { templateId, key: cacheKey });
                return template;
            }
            this.#logger.debug('page template cache miss', { templateId, key: cacheKey });
        }

        const file = await this.#templateFileStore.getPageTemplate(context, buildId, templateId);
        if (file) {
            const partials = await this.loadPartials(context, { useCache });
            template = this.compileTemplate(file.filepath, file.source, this.#customHelpers, partials);
        }

        if (useCache) {
            this.#templateCache.set(cacheKey, template);
        }

        return template ?? null;
    }

    /**
     * Loads and compiles shared partial templates for use by base and page templates.
     * @param {RequestContext} context - Request context
     * @param {Object} [options] - Partial loading options
     * @param {boolean} [options.useCache=false] - Reuse compiled partials from this service instance
     * @returns {Promise<Map<string, Function>>} Partial render functions keyed by template include name
     */
    async loadPartials(context, options) {
        const { useCache = false } = options ?? {};
        const buildId = context.runtime.build?.id ?? null;

        let partials;
        const cacheKey = buildId || 'null';
        if (useCache) {
            partials = this.#partialsCache.get(cacheKey);
            if (partials) {
                this.#logger.debug('template partials cache hit', { key: cacheKey });
                return partials;
            }
            this.#logger.debug('template partials cache miss', { key: cacheKey });
        }

        const files = await this.#templateFileStore.getPartials(context, buildId);

        partials = new Map();

        for (const { filepath, source } of files) {
            const name = filepath.replace(/^\/?partials\//, '');
            const template = this.compileTemplate(filepath, source, this.#customHelpers, partials);
            partials.set(name, template);
        }

        this.#partialsCache.set(cacheKey, partials);

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

function renderIncludes(compiledIncludes, metadata) {
    const includes = {};

    for (const name of Object.keys(compiledIncludes)) {
        const include = compiledIncludes[name];
        includes[name] = isFunction(include) ? include(metadata) : include;
    }

    return includes;
}

function joinPageFilepath(pathname, filename) {
    return `${ pathname.replace(/\/$/, '') }/${ filename }`;
}
