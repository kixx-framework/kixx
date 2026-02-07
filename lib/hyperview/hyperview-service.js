import { marked } from '../vendor/mod.js';
import { isNonEmptyString } from '../assertions/mod.js';
import deepMerge from '../lib/deep-merge.js';

import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';


const defaultHelpers = new Map([
    [ 'formatDate', formatDate ],
    [ 'markup', markup ],
    [ 'truncate', truncate ],
]);

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
     * @type {Object|null}
     */
    #pageStore = null;

    /**
     * TemplateStore instance for loading base templates, partials, and helper functions
     * @type {Object|null}
     */
    #templateStore = null;

    /**
     * TemplateEngine instance for compiling template source code into render functions
     * @type {Object|null}
     */
    #templateEngine = null;

    /**
     * StaticFileServerStore instance for serving static files
     * @type {Object|null}
     */
    #staticFileServerStore = null;

    /**
     * Map of template helper functions keyed by helper name
     * Includes built-in helpers (format_date) and custom helpers loaded from files
     * @type {Map<string, Function>}
     */
    #helpers = defaultHelpers;

    /**
     * Map of compiled partial templates keyed by partial filename
     * Partials are loaded once and cached for the lifetime of the service instance
     * @type {Map<string, Function>}
     */
    #partials = new Map();

    /**
     * Cache of page data objects keyed by pathname
     * @type {Map<string, Object>}
     */
    #pageDataCache = new Map();

    /**
     * Cache of compiled page template functions keyed by pathname
     * @type {Map<string, Function>}
     */
    #pageTemplateCache = new Map();

    /**
     * Cache of compiled markdown template functions keyed by pathname
     * @type {Map<string, Map<string, Function>>}
     */
    #markdownContentCache = new Map();

    /**
     * Cache of compiled base template functions keyed by template ID
     * @type {Map<string, Function>}
     */
    #baseTemplateCache = new Map();

    /**
     * Initializes the service with required store and engine instances.
     *
     * Loads custom template helper functions from the template store and merges them
     * with built-in helpers. Must be called before using any other service methods.
     * @async
     * @param {Object} options - Service initialization options
     * @param {Object} options.pageStore - PageStore instance for loading page data and templates
     * @param {Object} options.templateStore - TemplateStore instance for loading base templates and partials
     * @param {Object} options.templateEngine - TemplateEngine instance for compiling templates
     * @param {Object} options.staticFileServerStore - StaticFileServerStore instance for serving static files
     */
    async initialize(options) {
        const {
            pageStore,
            templateStore,
            templateEngine,
            staticFileServerStore,
        } = options;

        this.#pageStore = pageStore;
        this.#templateStore = templateStore;
        this.#templateEngine = templateEngine;
        this.#staticFileServerStore = staticFileServerStore;

        const helperFiles = await this.#templateStore.loadHelperFiles();
        for (const { name, helper } of helperFiles) {
            this.#helpers.set(name, helper);
        }
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
        const { useCache, templateFilename } = options || {};
        // Include templateFilename in cache key so different templates are cached separately
        const cacheKey = templateFilename ? `${ pathname }:${ templateFilename }` : pathname;

        let template;

        if (useCache) {
            if (this.#pageTemplateCache.has(cacheKey)) {
                template = this.#pageTemplateCache.get(cacheKey);
            }
        }

        if (!template) {
            template = await this.#getPageTemplate(pathname, options);

            if (template && useCache) {
                this.#pageTemplateCache.set(cacheKey, template);
            }
        }

        return template;
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
        const { useCache } = options || {};
        const cacheKey = pathname;

        let markdownTemplates;

        if (useCache) {
            if (this.#markdownContentCache.has(cacheKey)) {
                markdownTemplates = this.#markdownContentCache.get(cacheKey);
            }
        }

        if (!markdownTemplates) {
            markdownTemplates = new Map();

            const markdownFiles = await this.#pageStore.getMarkdownContent(pathname);

            for (const { filename, source } of markdownFiles) {
                // eslint-disable-next-line no-await-in-loop
                const template = await this.#getMarkdownTemplate(pathname, filename, source, options);
                // Remove .md extension to create content key (e.g., 'body.md' -> 'body')
                const key = filename.replace(/\.md$/, '');
                markdownTemplates.set(key, template);
            }

            if (useCache) {
                this.#markdownContentCache.set(cacheKey, markdownTemplates);
            }
        }

        // Render each markdown template with pageData, then parse to HTML
        // Content keys match filenames without .md extension (e.g., 'body.md' -> 'body')
        const content = {};

        for (const [ key, template ] of markdownTemplates) {
            // Template may contain template syntax (e.g., {{title}}), so render it first
            const markdown = template(pageData);
            // Parse rendered markdown string to HTML
            content[key] = marked.parse(markdown);
        }

        return content;
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
        const { useCache } = options || {};

        let template;

        if (useCache) {
            if (this.#baseTemplateCache.has(templateId)) {
                template = this.#baseTemplateCache.get(templateId);
            }
        }

        if (!template) {
            const file = await this.#templateStore.getBaseTemplate(templateId);

            if (!file) {
                return null;
            }

            const { source } = file;
            const partials = await this.#loadPartials(options);

            template = this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);

            if (template && useCache) {
                this.#baseTemplateCache.set(templateId, template);
            }
        }

        return template;
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
     * Loads and compiles the page template file for the given pathname.
     *
     * Retrieves the template file from the page store and compiles it with helpers and partials.
     * This is the internal implementation used by getPageTemplate().
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {Object} [options={}] - Cache and template options
     * @param {boolean} [options.useCache=false] - Whether to use cached partials when available
     * @param {string} [options.templateFilename] - Explicit template filename to load instead of page.html/page.xml
     * @returns {Promise<Function|null>} Compiled template function, or null if template file doesn't exist
     */
    async #getPageTemplate(pathname, options) {
        const { templateFilename } = options || {};

        const file = await this.#pageStore.getPageTemplate(pathname, { templateFilename });
        if (!file) {
            return null;
        }

        const { filename, source } = file;

        const templateId = `${ pathname }/${ filename }`;
        const partials = await this.#loadPartials(options);

        return this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);
    }

    /**
     * Compiles a markdown file source into a template function.
     *
     * Compiles the markdown source as a template (allowing template syntax) with helpers
     * and partials. The compiled template can be rendered with page data before parsing to HTML.
     * @param {string} pathname - URL pathname for the page containing this markdown file
     * @param {string} filename - Markdown filename (e.g., 'body.md', 'intro.md')
     * @param {string} source - Markdown source code that may contain template syntax
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached partials when available
     * @returns {Function} Compiled template function that accepts page data and returns markdown string
     */
    async #getMarkdownTemplate(pathname, filename, source, options) {
        const templateId = `${ pathname }/${ filename }`;
        const partials = await this.#loadPartials(options);

        return this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);
    }

    /**
     * Loads and caches all partial templates from the template store.
     *
     * Partials can reference other partials, enabling recursive partial inclusion
     * (e.g., header includes nav). When useCache is enabled, partials are returned
     * from cache if available; otherwise they are reloaded from the filesystem.
     * @async
     * @param {Object} [options={}] - Cache options
     * @param {boolean} [options.useCache=false] - Whether to use cached partials when available
     * @returns {Promise<Map<string, Function>>} Map of compiled partial functions keyed by partial filename
     */
    async #loadPartials(options) {
        const { useCache } = options || {};

        if (useCache && this.#partials.size > 0) {
            return this.#partials;
        }

        // Clear existing partials before reloading to ensure stale entries are removed
        this.#partials.clear();

        const files = await this.#templateStore.loadPartialFiles();

        // Partials can reference other partials, so pass the partials map during compilation
        // to enable recursive partial inclusion (e.g., header includes nav)
        for (const { filename, source } of files) {
            const partial = this.#templateEngine.compileTemplate(filename, source, this.#helpers, this.#partials);
            this.#partials.set(filename, partial);
        }

        return this.#partials;
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
        const template = this.#templateEngine.compileTemplate(templateId, templateSource, this.#helpers, partials);
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
