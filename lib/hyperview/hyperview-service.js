import { marked } from '../vendor/marked/mod.js';
import { isNonEmptyString } from '../assertions/mod.js';
import deepMerge from '../lib/deep-merge.js';

import formatDate from './helpers/format-date.js';
import plusOne from './helpers/plus-one.js';


const defaultHelpers = new Map();
defaultHelpers.set('format_date', formatDate);
defaultHelpers.set('plus_one', plusOne);


export default class HyperviewService {

    #pageStore = null;
    #templateStore = null;
    #templateEngine = null;
    #staticFileServerStore = null;

    #helpers = defaultHelpers;
    #partials = new Map();

    #pageDataCache = new Map();
    #pageTemplateCache = new Map();
    #markdownContentCache = new Map();
    #baseTemplateCache = new Map();

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

    async getPageMarkup(pathname, pageData, options) {
        const { useCache } = options || {};
        const cacheKey = pathname;

        let template;

        if (useCache) {
            if (this.#pageTemplateCache.has(cacheKey)) {
                template = this.#pageTemplateCache.get(cacheKey);
            }
        }

        if (!template) {
            template = await this.#getPageTemplate(pathname);

            if (template && useCache) {
                this.#pageTemplateCache.set(cacheKey, template);
            }
        }

        if (!template) {
            return null;
        }

        const content = await this.getPageMarkdown(pathname, pageData, { useCache });

        // Create shallow copy of pageData to avoid mutating the original object when
        // adding the content property for template rendering
        const templateContext = Object.assign({}, pageData, { content });

        return template(templateContext);
    }

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
                const template = this.#getMarkdownTemplate(pathname, filename, source);
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
            const partials = await this.#loadPartials();

            template = this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);

            if (template && useCache) {
                this.#baseTemplateCache.set(templateId, template);
            }
        }

        return template;
    }

    async getStaticFile(pathname) {
        const file = await this.#staticFileServerStore.getFile(pathname);
        return file;
    }

    async #getPageTemplate(pathname) {
        const file = await this.#pageStore.getPageTemplate(pathname);
        if (!file) {
            return null;
        }

        const { filename, source } = file;

        const templateId = `${ pathname }/${ filename }`;
        const partials = await this.#loadPartials();

        return this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);
    }

    async #getMarkdownTemplate(pathname, filename, source) {
        const templateId = `${ pathname }/${ filename }`;
        const partials = await this.#loadPartials();

        return this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);
    }

    async #loadPartials() {
        // Partials are loaded once and cached for the lifetime of the service instance
        // since they don't change during runtime
        if (this.#partials.size > 0) {
            return this.#partials;
        }

        const files = await this.#templateStore.loadPartialFiles();

        // Partials can reference other partials, so pass the partials map during compilation
        // to enable recursive partial inclusion (e.g., header includes nav)
        for (const { filename, source } of files) {
            const partial = this.#templateEngine.compileTemplate(filename, source, this.#helpers, this.#partials);
            this.#partials.set(filename, partial);
        }

        return this.#partials;
    }

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

    #hydrateMetadataTemplate(templateId, templateSource, props) {
        // Metadata fields (title, description) can contain template syntax, so compile
        // and render them with page data. Use empty partials since metadata templates
        // shouldn't include partials to avoid circular dependencies
        const partials = new Map();
        const template = this.#templateEngine.compileTemplate(templateId, templateSource, this.#helpers, partials);
        return template(props);
    }

    #urlToCanonicalURLString(url) {
        const { protocol, host, pathname } = url;
        // Build canonical URL without query string or hash to provide a stable
        // reference that doesn't change with request parameters or fragments
        return `${ protocol }//${ host }${ pathname }`;
    }
}
