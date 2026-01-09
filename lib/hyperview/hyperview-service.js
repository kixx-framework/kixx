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

        let pageExists = false;
        if (useCache) {
            pageExists = this.#pageDataCache.has(cacheKey);
        }
        if (!pageExists) {
            pageExists = await this.#pageStore.doesPageExist(pathname);
        }
        if (!pageExists) {
            return null;
        }

        let pageData;

        if (useCache && pageExists) {
            pageData = this.#pageDataCache.get(cacheKey);
        }
        if (!pageData) {
            pageData = await this.#pageStore.getPageData(pathname);
            this.#pageDataCache.set(cacheKey, pageData);
        }

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
                const key = filename.replace(/.md$/, '');
                markdownTemplates.set(key, template);
            }

            if (useCache) {
                this.#markdownContentCache.set(cacheKey, markdownTemplates);
            }
        }

        const content = {};

        for (const [ key, template ] of markdownTemplates) {
            const markdown = template(pageData);
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
        if (this.#partials.size > 0) {
            return this.#partials;
        }

        const files = await this.#templateStore.loadPartialFiles();

        for (const { filename, source } of files) {
            const partial = this.#templateEngine.compileTemplate(filename, source, this.#helpers, this.#partials);
            this.#partials.set(filename, partial);
        }

        return this.#partials;
    }

    #hydratePageData(url, page) {
        if (!isNonEmptyString(page.canonicalURL)) {
            // Only assign the canonical URL if it is not yet defined.
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
        const partials = new Map();
        const template = this.#templateEngine.compileTemplate(templateId, templateSource, this.#helpers, partials);
        return template(props);
    }

    #urlToCanonicalURLString(url) {
        const { protocol, host, pathname } = url;
        // Strips the query string and hash
        return `${ protocol }//${ host }${ pathname }`;
    }
}
