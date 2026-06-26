import * as templating from '../templating/mod.js';
import deepMerge from '../utils/deep-merge.js';
import {
    AssertionError,
    assert,
    assertNonEmptyString,
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
        assert(kvStore, 'HyperviewService requires a kvStore');
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
        // their parents. Includes are page-relative, so only the leaf page can declare
        // files that should be loaded for the requested pathname.
        const mergeItems = jsonItems.map((json, index) => {
            if (index === jsonItems.length - 1) {
                return json;
            }

            const parentJson = Object.assign({}, json);
            delete parentJson.includes;
            return parentJson;
        });

        const metadata = deepMerge(...mergeItems);

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
     * Writes a page's metadata file (`page.json`) to a build, fully replacing any
     * existing file at that path.
     *
     * Unlike the template writes, page data writes deliberately allow the current
     * build id so content can be edited on the live build; the only build-id rule
     * is that it must be a non-empty string (contrast with #assertWritableBuildId).
     *
     * Caller responsibilities, not enforced here: the metadata must reference every
     * include it expects under its `includes` map, and — for a write to the current
     * build — it must carry a changed `version`, because the full-page and includes
     * caches key on `version`; an unchanged version serves stale cached content.
     * @param {RequestContext} context - Request context passed through to the page data store
     * @param {string} buildId - Target build id (write namespace); may be the current build id
     * @param {string} pathname - Normalized page pathname, such as `/` or `/blog/post`
     * @param {Object} metadata - The complete page metadata to store as `page.json`
     * @returns {Promise<import('./page-data-store-interface.js').PageDataFileRef>} The logical filepath that was written
     * @throws {AssertionError} When buildId or pathname is not a non-empty string
     */
    async putPageMetadata(context, buildId, pathname, metadata) {
        assertNonEmptyString(buildId, 'HyperviewService page data writes require a buildId');
        assertNonEmptyString(pathname, 'HyperviewService.putPageMetadata requires a pathname');
        const filepath = joinPageFilepath(pathname, 'page.json');
        return await this.#pageDataStore.putJSONFile(context, buildId, filepath, metadata);
    }

    /**
     * Writes an include's text content file for a page to a build.
     *
     * Writes only the content file; it does not index the include. The caller is
     * responsible for referencing the include in the page's `page.json` `includes`
     * map (see putPageMetadata) — an unreferenced include is never loaded at render
     * time.
     * @param {RequestContext} context - Request context passed through to the page data store
     * @param {string} buildId - Target build id (write namespace); may be the current build id
     * @param {string} pathname - Normalized page pathname the include belongs to
     * @param {string} filename - Include filename relative to the page pathname, such as `body.md`
     * @param {string} source - Include source text to store
     * @returns {Promise<import('./page-data-store-interface.js').PageDataFileRef>} The logical filepath that was written
     * @throws {AssertionError} When buildId, pathname, or filename is not a non-empty string
     */
    async putIncludeContent(context, buildId, pathname, filename, source) {
        assertNonEmptyString(buildId, 'HyperviewService page data writes require a buildId');
        assertNonEmptyString(pathname, 'HyperviewService.putIncludeContent requires a pathname');
        assertNonEmptyString(filename, 'HyperviewService.putIncludeContent requires a filename');
        const filepath = joinPageFilepath(pathname, filename);
        return await this.#pageDataStore.putTextFile(context, buildId, filepath, source);
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
     * Writes a base template source file to a target build's namespace.
     *
     * Stores the source verbatim — no compilation — so template syntax is
     * validated at render time, not at write time.
     * @param {RequestContext} context - Request context carrying the current build id
     * @param {string} buildId - Target build id (write namespace); must differ from the current build id
     * @param {string} templateId - Base template filename relative to `base/`
     * @param {string} source - Template source text to store
     * @returns {Promise<import('./template-file-store-interface.js').TemplateFileRef>} The logical filepath that was written
     * @throws {AssertionError} When the current build id is unset, buildId is not a non-empty string, or buildId matches the current build id
     */
    async putBaseTemplate(context, buildId, templateId, source) {
        this.#assertWritableBuildId(context, buildId);
        return await this.#templateFileStore.putBaseTemplate(context, buildId, templateId, source);
    }

    /**
     * Writes a page template source file to a target build's namespace.
     *
     * Stores the source verbatim — no compilation — so template syntax is
     * validated at render time, not at write time. The templateId may be nested
     * several segments deep, delimited by `/`.
     * @param {RequestContext} context - Request context carrying the current build id
     * @param {string} buildId - Target build id (write namespace); must differ from the current build id
     * @param {string} templateId - Page template filepath relative to `pages/`
     * @param {string} source - Template source text to store
     * @returns {Promise<import('./template-file-store-interface.js').TemplateFileRef>} The logical filepath that was written
     * @throws {AssertionError} When the current build id is unset, buildId is not a non-empty string, or buildId matches the current build id
     */
    async putPageTemplate(context, buildId, templateId, source) {
        this.#assertWritableBuildId(context, buildId);
        return await this.#templateFileStore.putPageTemplate(context, buildId, templateId, source);
    }

    /**
     * Writes a partial template source file to a target build's namespace.
     *
     * Stores the source verbatim — no compilation — so template syntax and
     * cross-partial references are resolved at render time, not at write time.
     * @param {RequestContext} context - Request context carrying the current build id
     * @param {string} buildId - Target build id (write namespace); must differ from the current build id
     * @param {string} filepath - Partial filename relative to `partials/`
     * @param {string} source - Partial source text to store
     * @returns {Promise<import('./template-file-store-interface.js').TemplateFileRef>} The logical filepath that was written
     * @throws {AssertionError} When the current build id is unset, buildId is not a non-empty string, or buildId matches the current build id
     */
    async putPartial(context, buildId, filepath, source) {
        this.#assertWritableBuildId(context, buildId);
        return await this.#templateFileStore.putPartial(context, buildId, filepath, source);
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

        // Only retain the compiled partials when caching is enabled; otherwise the
        // map would grow even though no reader ever consults it (the read above is
        // guarded by useCache), matching getBaseTemplate/getPageTemplate.
        if (useCache) {
            this.#partialsCache.set(cacheKey, partials);
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
     * Asserts that the target build id is safe to write to. All template writes
     * publish a *new* build under its own build id and must never mutate the
     * build id the live site is currently reading from.
     * @param {RequestContext} context - Request context carrying the current build id
     * @param {string} buildId - Target build id (write namespace)
     * @throws {AssertionError} When no current build id is set, when buildId is not
     *   a non-empty string, or when buildId matches the current build id
     */
    #assertWritableBuildId(context, buildId) {
        const currentBuildId = context.runtime.build?.id ?? null;

        // Writes target a build *other* than the one being served, so without a
        // current build there is no live namespace to protect and nothing to
        // differ from; requiring one keeps the guard meaningful.
        assert(
            isNonEmptyString(currentBuildId),
            'HyperviewService template writes require a current build id',
        );

        assertNonEmptyString(buildId, 'HyperviewService template writes require a buildId');

        // The new build's namespace must differ from the live build's namespace
        // so a deploy can never overwrite templates the running site is serving.
        assert(
            buildId !== currentBuildId,
            'HyperviewService template write buildId must not match the current build id',
        );
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
