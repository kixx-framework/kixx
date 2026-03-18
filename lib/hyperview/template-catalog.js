import { marked } from '../vendor/mod.js';

import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';


const defaultHelpers = new Map([
    [ 'formatDate', formatDate ],
    [ 'markup', markup ],
    [ 'truncate', truncate ],
]);

/**
 * Manages Hyperview helpers, partials, and compiled template caches.
 *
 * This collaborator owns the template-centric responsibilities that were
 * previously embedded directly in `HyperviewService`: loading helper files,
 * compiling page/base/markdown templates, and caching reusable template state.
 */
export default class TemplateCatalog {

    /**
     * @type {import('../ports/hyperview-page-store.js').HyperviewPageStore}
     */
    #pageStore;

    /**
     * @type {import('../ports/hyperview-template-store.js').HyperviewTemplateStore}
     */
    #templateStore;

    /**
     * @type {import('../ports/hyperview-template-engine.js').HyperviewTemplateEngine}
     */
    #templateEngine;

    /**
     * @type {Map<string, Function>}
     */
    #helpers = new Map(defaultHelpers);

    /**
     * @type {Map<string, Function>}
     */
    #partials = new Map();

    /**
     * @type {Map<string, Function>}
     */
    #pageTemplateCache = new Map();

    /**
     * @type {Map<string, Map<string, Function>>}
     */
    #markdownContentCache = new Map();

    /**
     * @type {Map<string, Function>}
     */
    #baseTemplateCache = new Map();

    /**
     * @param {Object} options
     * @param {import('../ports/hyperview-page-store.js').HyperviewPageStore} options.pageStore
     * @param {import('../ports/hyperview-template-store.js').HyperviewTemplateStore} options.templateStore
     * @param {import('../ports/hyperview-template-engine.js').HyperviewTemplateEngine} options.templateEngine
     */
    constructor({ pageStore, templateStore, templateEngine }) {
        this.#pageStore = pageStore;
        this.#templateStore = templateStore;
        this.#templateEngine = templateEngine;
    }

    /**
     * Loads custom template helper functions and merges them with the built-in helpers.
     * @returns {Promise<void>}
     */
    async initialize() {
        const helperFiles = await this.#templateStore.loadHelperFiles();
        for (const { name, helper } of helperFiles) {
            this.#helpers.set(name, helper);
        }
    }

    /**
     * Returns the helper map currently available to the template engine.
     * @returns {Map<string, Function>}
     */
    getHelpers() {
        return this.#helpers;
    }

    /**
     * Retrieves the compiled page template function for the given pathname.
     * @param {string} pathname
     * @param {Object} [options={}]
     * @param {boolean} [options.useCache=false]
     * @param {string} [options.templateFilename]
     * @returns {Promise<Function|null>}
     */
    async getPageTemplate(pathname, options) {
        const { useCache, templateFilename } = options || {};
        const cacheKey = templateFilename ? `${ pathname }:${ templateFilename }` : pathname;

        let template;

        if (useCache && this.#pageTemplateCache.has(cacheKey)) {
            template = this.#pageTemplateCache.get(cacheKey);
        }

        if (!template) {
            template = await this.#compilePageTemplate(pathname, options);

            if (template && useCache) {
                this.#pageTemplateCache.set(cacheKey, template);
            }
        }

        return template;
    }

    /**
     * Loads and renders all markdown content files for the given pathname.
     * @param {string} pathname
     * @param {Object} pageData
     * @param {Object} [options={}]
     * @param {boolean} [options.useCache=false]
     * @returns {Promise<Object>}
     */
    async getPageMarkdown(pathname, pageData, options) {
        const { useCache } = options || {};
        const cacheKey = pathname;

        let markdownTemplates;

        if (useCache && this.#markdownContentCache.has(cacheKey)) {
            markdownTemplates = this.#markdownContentCache.get(cacheKey);
        }

        if (!markdownTemplates) {
            markdownTemplates = new Map();

            const markdownFiles = await this.#pageStore.getMarkdownContent(pathname);

            for (const { filename, source } of markdownFiles) {
                const template = await this.#compileMarkdownTemplate(pathname, filename, source, options);
                const key = filename.replace(/\.md$/, '');
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

    /**
     * Retrieves the compiled base template function for the given template ID.
     * @param {string} templateId
     * @param {Object} [options={}]
     * @param {boolean} [options.useCache=false]
     * @returns {Promise<Function|null>}
     */
    async getBaseTemplate(templateId, options) {
        const { useCache } = options || {};

        let template;

        if (useCache && this.#baseTemplateCache.has(templateId)) {
            template = this.#baseTemplateCache.get(templateId);
        }

        if (!template) {
            const file = await this.#templateStore.getBaseTemplate(templateId);

            if (!file) {
                return null;
            }

            const partials = await this.#loadPartials(options);
            template = this.#templateEngine.compileTemplate(templateId, file.source, this.#helpers, partials);

            if (template && useCache) {
                this.#baseTemplateCache.set(templateId, template);
            }
        }

        return template;
    }

    async #compilePageTemplate(pathname, options) {
        const { templateFilename } = options || {};
        const file = await this.#pageStore.getPageTemplate(pathname, { templateFilename });

        if (!file) {
            return null;
        }

        const templateId = `${ pathname }/${ file.filename }`;
        const partials = await this.#loadPartials(options);

        return this.#templateEngine.compileTemplate(templateId, file.source, this.#helpers, partials);
    }

    async #compileMarkdownTemplate(pathname, filename, source, options) {
        const templateId = `${ pathname }/${ filename }`;
        const partials = await this.#loadPartials(options);
        return this.#templateEngine.compileTemplate(templateId, source, this.#helpers, partials);
    }

    async #loadPartials(options) {
        const { useCache } = options || {};

        // TemplateCatalog is long-lived (one instance per HyperviewService), so
        // #partials persists across requests. Checking size > 0 is safe: partials
        // are either all loaded or none loaded — there's no partial-load state.
        if (useCache && this.#partials.size > 0) {
            return this.#partials;
        }

        this.#partials.clear();

        const files = await this.#templateStore.loadPartialFiles();

        for (const { filename, source } of files) {
            const partial = this.#templateEngine.compileTemplate(filename, source, this.#helpers, this.#partials);
            this.#partials.set(filename, partial);
        }

        return this.#partials;
    }
}
