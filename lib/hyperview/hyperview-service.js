import { isNonEmptyString } from '../assertions.js';
import deepMerge from '../utils/deep-merge.js';

import TemplateCatalog from './template-catalog.js';

/**
 * @typedef {import('../ports/hyperview-page-store.js').HyperviewSourceFile} HyperviewSourceFile
 */

/**
 * @typedef {import('../ports/hyperview-page-store.js').HyperviewHelperFile} HyperviewHelperFile
 */

/**
 * @typedef {import('../ports/hyperview-page-store.js').HyperviewPageStore} HyperviewPageStore
 */

/**
 * @typedef {import('../ports/hyperview-template-store.js').HyperviewTemplateStore} HyperviewTemplateStore
 */

/**
 * @typedef {import('../ports/hyperview-template-engine.js').HyperviewTemplateEngine} HyperviewTemplateEngine
 */

/**
 * @typedef {import('../ports/hyperview-static-file-server-store.js').HyperviewStaticFileServerStore} HyperviewStaticFileServerStore
 */

/**
 * Core service for rendering hypermedia-driven pages in the Hyperview system.
 *
 * HyperviewService coordinates page data loading, template compilation, markdown processing,
 * and static file serving. It manages caching of compiled templates and page data to improve
 * performance. The service merges page data with response properties, hydrates metadata
 * (canonical URLs, Open Graph tags), and renders templates with markdown content.
 */
export default class HyperviewService {

    /**
     * PageStore instance for loading page data, templates, and markdown files
     * @type {HyperviewPageStore}
     */
    #pageStore;

    /**
     * TemplateEngine instance for compiling template source code into render functions
     * @type {HyperviewTemplateEngine}
     */
    #templateEngine;

    /**
     * StaticFileServerStore instance for serving static files
     * @type {HyperviewStaticFileServerStore}
     */
    #staticFileServerStore;

    /**
     * Cache of page data objects keyed by pathname
     * @type {Map<string, Object>}
     */
    #pageDataCache = new Map();

    /**
     * Template-centric collaborator that owns helpers, partials, and compiled template caches
     * @type {TemplateCatalog}
     */
    #templateCatalog;

    /**
     * @param {Object} options - Constructor options
     * @param {HyperviewPageStore} options.pageStore - PageStore instance for loading page data and templates
     * @param {HyperviewTemplateStore} options.templateStore - TemplateStore instance for loading base templates and partials
     * @param {HyperviewTemplateEngine} options.templateEngine - TemplateEngine instance for compiling templates
     * @param {HyperviewStaticFileServerStore} options.staticFileServerStore - StaticFileServerStore instance for serving static files
     */
    constructor({ pageStore, templateStore, templateEngine, staticFileServerStore }) {
        this.#pageStore = pageStore;
        this.#templateEngine = templateEngine;
        this.#staticFileServerStore = staticFileServerStore;
        this.#templateCatalog = new TemplateCatalog({
            pageStore,
            templateStore,
            templateEngine,
        });
    }

    /**
     * Loads custom template helper functions and merges them with the built-in helpers.
     *
     * Must be called before using any other service methods.
     * @async
     */
    async initialize() {
        await this.#templateCatalog.initialize();
    }

    /**
     * Loads and hydrates page data for the given pathname.
     *
     * Retrieves page data from the page store, merges it with response properties,
     * and hydrates metadata fields (canonical URL, Open Graph tags, etc.). Returns
     * null if the page doesn't exist. Page data is cloned before merging to avoid
     * mutating cached objects.
     * @async
     * @public
     * @param {Object} request - HTTP request object with url property
     * @param {Object} response - HTTP response object with props property to merge into page data
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached page data when available
     * @returns {Promise<Object|null>} Hydrated page data object, or null if page doesn't exist
     */
    async getPageData(request, response, pathname, options) {
        const { useCache } = options || {};
        const cacheKey = pathname;

        // Check cache first to avoid filesystem call if page existence is already known
        let pageExists = false;
        if (useCache) {
            pageExists = this.#pageDataCache.has(cacheKey);
        }
        // Only check filesystem if not found in cache (cache miss or caching disabled)
        if (!pageExists) {
            pageExists = await this.#pageStore.doesPageExist(pathname);
        }
        if (!pageExists) {
            return null;
        }

        let pageData;

        // Try cache first to avoid filesystem read
        if (useCache && pageExists) {
            pageData = this.#pageDataCache.get(cacheKey);
        }
        // Load from filesystem on cache miss or when caching is disabled
        if (!pageData) {
            pageData = await this.#pageStore.getPageData(pathname);
            // Store in cache even if useCache is false, so subsequent calls with caching
            // enabled can benefit from the loaded data
            this.#pageDataCache.set(cacheKey, pageData);
        }

        // Clone pageData before merging to avoid mutating the cached object, which would
        // cause response.props to leak into the cache and affect future requests
        const page = deepMerge(structuredClone(pageData), response.props);

        return this.#hydratePageData(request.url, page);
    }

    /**
     * Retrieves the compiled page template function for the given pathname.
     *
     * Loads the page template file (page.html or page.xml) from the page store and
     * compiles it into a render function. The template function accepts a context object
     * and returns a rendered string. Templates are cached when useCache is enabled.
     * @async
     * @public
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {Object} [options={}] - Cache and template options
     * @param {boolean} [options.useCache=false] - Whether to use cached template when available
     * @param {string} [options.templateFilename] - Explicit template filename to load instead of page.html/page.xml
     * @returns {Promise<Function|null>} Compiled template function, or null if template doesn't exist
     */
    async getPageTemplate(pathname, options) {
        return this.#templateCatalog.getPageTemplate(pathname, options);
    }

    /**
     * Renders the complete page markup by combining page template with markdown content.
     *
     * Loads the page template and markdown content, then renders the template with
     * the content included. This is a convenience method that combines getPageTemplate
     * and getPageMarkdown. Returns null if the page template doesn't exist.
     * @async
     * @public
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {Object} pageData - Page data object to use as template context
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached templates and content when available
     * @returns {Promise<string|null>} Rendered page markup string, or null if template doesn't exist
     */
    async getPageMarkup(pathname, pageData, options) {
        const template = await this.getPageTemplate(pathname, options);

        if (!template) {
            return null;
        }

        const content = await this.getPageMarkdown(pathname, pageData, options);

        // Create shallow copy of pageData to avoid mutating the original object when
        // adding the content property for template rendering
        const templateContext = Object.assign({}, pageData, { content });

        return template(templateContext);
    }

    /**
     * Loads and renders all markdown content files for the given pathname.
     *
     * Loads markdown files from the page directory, compiles them as templates (allowing
     * template syntax in markdown), renders them with page data, and parses the result
     * to HTML. Returns an object keyed by filename without .md extension (e.g., 'body.md' -> 'body').
     * Markdown templates are cached when useCache is enabled.
     * @async
     * @public
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/documentation')
     * @param {Object} pageData - Page data object to use as template context for markdown templates
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached markdown templates when available
     * @returns {Promise<Object>} Object with markdown content keys mapped to HTML strings
     */
    async getPageMarkdown(pathname, pageData, options) {
        return this.#templateCatalog.getPageMarkdown(pathname, pageData, options);
    }

    /**
     * Retrieves the compiled base template function for the given template ID.
     *
     * Loads the base template file from the template store and compiles it into a render
     * function. Base templates are typically layout templates that wrap page content.
     * Templates are cached when useCache is enabled.
     * @async
     * @public
     * @param {string} templateId - Template identifier supporting nested paths (e.g., 'layouts/base.html', 'pages/home.html')
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached base template when available
     * @returns {Promise<Function|null>} Compiled template function, or null if template doesn't exist
     */
    async getBaseTemplate(templateId, options) {
        return this.#templateCatalog.getBaseTemplate(templateId, options);
    }

    /**
     * Retrieves a static file for the given pathname.
     *
     * Loads static files (images, CSS, JavaScript, etc.) from the static file server store.
     * Returns null if the file doesn't exist.
     * @async
     * @public
     * @param {string} pathname - URL pathname to the static file (e.g., '/static/css/style.css')
     * @returns {Promise<Object|null>} Static file object with metadata and read stream, or null if file doesn't exist
     */
    async getStaticFile(pathname) {
        const file = await this.#staticFileServerStore.getFile(pathname);
        return file;
    }

    /**
     * Hydrates page data with metadata fields derived from the request URL.
     *
     * Sets canonical URL, href, and Open Graph metadata if not already defined in page data.
     * Also renders title and description fields if they contain template syntax. Mutates
     * the page object in place.
     * @param {Object} url - URL object with protocol, host, pathname, and href properties
     * @param {Object} page - Page data object to hydrate
     * @returns {Object} The hydrated page object (same reference as input)
     */
    #hydratePageData(url, page) {
        // Set canonical URL from request URL if not already defined in page data
        // Canonical URL excludes query string and hash to provide a stable reference
        if (!isNonEmptyString(page.canonicalURL)) {
            page.canonicalURL = this.#urlToCanonicalURLString(url);
        }
        if (!isNonEmptyString(page.href)) {
            page.href = url.href;
        }

        if (isNonEmptyString(page.title)) {
            page.title = this.#hydrateMetadataTemplate('title', page.title, page);
        }
        if (isNonEmptyString(page.description)) {
            page.description = this.#hydrateMetadataTemplate('description', page.description, page);
        }

        // Create the Open Graph object if it does not yet exist.
        const openGraph = page.openGraph || {};
        page.openGraph = openGraph;

        if (!isNonEmptyString(openGraph.url)) {
            openGraph.url = page.canonicalURL;
        }
        if (!isNonEmptyString(openGraph.type)) {
            openGraph.type = 'website';
        }
        if (!isNonEmptyString(openGraph.title)) {
            openGraph.title = page.title;
        }
        if (!isNonEmptyString(openGraph.description)) {
            openGraph.description = page.description;
        }
        if (!isNonEmptyString(openGraph.locale)) {
            openGraph.locale = page.locale;
        }

        return page;
    }

    /**
     * Compiles and renders a metadata field that may contain template syntax.
     *
     * Metadata fields like title and description can contain template syntax (e.g., {{title}}),
     * so they need to be compiled and rendered with page data. Uses empty partials to avoid
     * circular dependencies in metadata templates.
     * @param {string} templateId - Unique identifier for the metadata template (e.g., 'title', 'description')
     * @param {string} templateSource - Template source code that may contain template syntax
     * @param {Object} props - Page data object to use as template context
     * @returns {string} Rendered metadata string
     */
    #hydrateMetadataTemplate(templateId, templateSource, props) {
        // Metadata fields (title, description) can contain template syntax, so compile
        // and render them with page data. Use empty partials since metadata templates
        // shouldn't include partials to avoid circular dependencies
        const partials = new Map();
        const template = this.#templateEngine.compileTemplate(
            templateId,
            templateSource,
            this.#templateCatalog.getHelpers(),
            partials
        );
        return template(props);
    }

    /**
     * Converts a URL object to a canonical URL string without query string or hash.
     *
     * Builds a stable reference URL that doesn't change with request parameters or fragments.
     * Used for canonical URLs and Open Graph metadata.
     * @param {Object} url - URL object with protocol, host, and pathname properties
     * @returns {string} Canonical URL string (e.g., 'https://example.com/blog/post')
     */
    #urlToCanonicalURLString(url) {
        const { protocol, host, pathname } = url;
        // Build canonical URL without query string or hash to provide a stable
        // reference that doesn't change with request parameters or fragments
        return `${ protocol }//${ host }${ pathname }`;
    }
}
