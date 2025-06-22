import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import PageTemplateEngine from './page-template-engine.js';
import deepMerge from '../lib/deep-merge.js';
import * as fileSystem from '../lib/file-system.js';
import { isNonEmptyString } from '../assertions/mod.js';


export default class ViewService {

    #pageDirectory = null;
    #sitePageDataFilepath = null;
    #logger = null;
    #pageTemplateEngine = null;
    #fileSystem = null;

    /**
     * Create a new ViewService instance
     *
     * @param {Object} options - Configuration options
     * @param {Object} options.logger - Logger instance
     * @param {string} options.pageDirectory - Directory containing page files
     * @param {string} options.sitePageDataFilepath - Path to site-wide page data file
     * @param {string} options.templateDirectory - Directory containing templates
     * @param {string} options.partialsDirectory - Directory containing template partials
     * @param {string} options.helpersDirectory - Directory containing template helpers
     * @param {Object} [options.pageTemplateEngine] - Optional PageTemplateEngine instance for testing
     * @param {Object} [options.fileSystem] - Optional file system implementation for testing
     */
    constructor(options) {
        this.#pageTemplateEngine = options.pageTemplateEngine || new PageTemplateEngine({
            templatesDirectory: options.templatesDirectory,
            partialsDirectory: options.partialsDirectory,
            helpersDirectory: options.helpersDirectory,
        });

        this.#logger = options.logger;
        this.#fileSystem = options.fileSystem || fileSystem;
        this.#pageDirectory = options.pageDirectory;
        this.#sitePageDataFilepath = options.sitePageDataFilepath;
    }

    async getPageData(pathname, props) {
        const pathParts = this.urlPathnameToParts(pathname);
        pathParts.push('page.json');

        const filepath = path.join(this.#pageDirectory, ...pathParts);

        this.#logger.debug('fetching page data', { pathname, filepath });
        let pageData;
        try {
            pageData = await this.#fileSystem.readJSONFile(filepath);
        } catch (cause) {
            throw new WrappedError(`Unable to read page data file ${ filepath }`, { cause });
        }

        let sitePageData;
        try {
            sitePageData = await this.#fileSystem.readJSONFile(this.#sitePageDataFilepath);
        } catch (cause) {
            throw new WrappedError(`Unable to read site page data file ${ this.#sitePageDataFilepath }`, { cause });
        }

        const page = deepMerge(sitePageData || {}, pageData || {}, props || {});

        if (!isNonEmptyString(page.baseTemplateId)) {
            page.baseTemplateId = 'base.html';
        }

        return page;
    }

    async getPageMarkup(pathname, pageData) {
        const pathParts = this.urlPathnameToParts(pathname);
        const filepath = path.join(this.#pageDirectory, ...pathParts.concat('page.html'));

        this.#logger.debug('fetching page markup', { pathname, filepath });

        const templateId = `${ pathname }/page.html`;
        const pageTemplate = await this.#pageTemplateEngine.getPageTemplate(templateId, filepath);

        if (!pageTemplate) {
            return null;
        }

        return pageTemplate(pageData);
    }

    async getBaseTemplate(templateId) {
        templateId = templateId || 'base.html';
        this.#logger.debug('fetching base template', { templateId });
        const template = await this.#pageTemplateEngine.getTemplate(templateId);
        return template;
    }

    async renderMarkupForError(error) {
        const html = await this.getPageBodyForError(error);
        if (html) {
            return html;
        }
        return this.renderDefaultErrorPage(error);
    }

    async getPageBodyForError(error) {
        const pathname = error.httpStatusCode ? error.httpStatusCode.toString() : 'error';
        const pageData = await this.getPageData(pathname, {});

        const [ body, template ] = await Promise.all([
            this.getPageMarkup(pathname, pageData),
            this.getBaseTemplate(pageData.baseTemplateId),
        ]);

        if (!body) {
            this.#logger.warn('no page body found for error page', { pathname });
            return null;
        }
        if (!template) {
            this.#logger.warn('no base template found for error page', { pathname });
            return null;
        }

        const ctx = Object.assign({}, pageData || {}, { body });
        return template(ctx);
    }

    renderDefaultErrorPage(error) {
        const message = error.httpStatusCode ? `HTTP Status Code: ${ error.httpStatusCode }` : 'An error occurred.';
        return `<html><body><p>${ message }</p></body></html>\n`;
    }

    urlPathnameToParts(pathname) {
        // Remove file extension and leading/trailing slashes
        const parts = pathname.replace(/\.[^/.]+$/, '').split('/').filter(Boolean);

        // Ignore index pages.
        if (parts[parts.length - 1] === 'index') {
            parts.pop();
        }

        return parts;
    }
}
