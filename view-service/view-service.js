import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import PageTemplateEngine from './page-template-engine.js';
import deepMerge from '../lib/deep-merge.js';
import * as fileSystem from '../lib/file-system.js';
import { isNonEmptyString } from '../assertions/mod.js';


/**
 * ViewService
 * ===========
 *
 * The ViewService class provides a high-level API for loading, merging, and rendering
 * page data and templates for server-side rendering in a web application.
 *
 * It is designed to work with the Kixx.js view-service architecture and the PageTemplateEngine.
 *
 * Core Responsibilities:
 *   - Load and merge per-page and site-wide page data (JSON)
 *   - Load and render page markup (HTML) using templates and partials
 *   - Provide error page rendering with fallback to a default error page
 *   - Normalize URL pathnames to file system paths for page data and markup
 *
 * Usage Example:
 *   const viewService = new ViewService({ ... });
 *   const pageData = await viewService.getPageData('/about', { custom: 'value' });
 *   const html = await viewService.getPageMarkup('/about', pageData);
 */
export default class ViewService {
    /**
     * @private
     * @type {string|null}
     * Directory containing page files (JSON/HTML)
     */
    #pageDirectory = null;

    /**
     * @private
     * @type {string|null}
     * Path to the site-wide page data JSON file
     */
    #sitePageDataFilepath = null;

    /**
     * @private
     * @type {Object|null}
     * Logger instance for debug/warn output
     */
    #logger = null;

    /**
     * @private
     * @type {PageTemplateEngine|null}
     * Instance of the PageTemplateEngine for template rendering
     */
    #pageTemplateEngine = null;

    /**
     * @private
     * @type {Object|null}
     * File system abstraction for reading files (defaults to Node.js fs)
     */
    #fileSystem = null;

    /**
     * Construct a new ViewService instance.
     *
     * @param {Object} options - Configuration options
     * @param {Object} options.logger - Logger instance for debug/warn output
     * @param {string} options.pageDirectory - Directory containing page files (JSON/HTML)
     * @param {string} options.sitePageDataFilepath - Path to site-wide page data JSON file
     * @param {string} options.templatesDirectory - Directory containing main templates
     * @param {string} options.partialsDirectory - Directory containing template partials
     * @param {string} options.helpersDirectory - Directory containing template helpers
     * @param {Object} [options.pageTemplateEngine] - Optional PageTemplateEngine instance (for testing/mocking)
     * @param {Object} [options.fileSystem] - Optional file system abstraction (for testing/mocking)
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

    /**
     * Load and merge page data for a given pathname.
     *
     * Loads per-page JSON data and merges it with site-wide page data and any additional props.
     * Ensures that a baseTemplateId is set (defaults to 'base.html').
     *
     * @param {string} pathname - The URL pathname (e.g., '/about')
     * @param {Object} props - Additional properties to merge into the page data
     * @returns {Promise<Object>} - The merged page data object
     * @throws {WrappedError} - If reading page or site data fails
     */
    async getPageData(pathname, props) {
        // TODO: ViewService#getPageData() should accept a full URL instance and merge it in with the page data.
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

    /**
     * Load and render the page markup (HTML) for a given pathname and page data.
     *
     * @param {string} pathname - The URL pathname (e.g., '/about')
     * @param {Object} pageData - The merged page data object
     * @returns {Promise<string|null>} - The rendered HTML markup, or null if not found
     */
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

    /**
     * Load and return the base template render function by template ID.
     *
     * @param {string} [templateId] - The template ID (defaults to 'base.html')
     * @returns {Promise<Function|null>} - The template render function, or null if not found
     */
    async getBaseTemplate(templateId) {
        templateId = templateId || 'base.html';
        this.#logger.debug('fetching base template', { templateId });
        const template = await this.#pageTemplateEngine.getTemplate(templateId);
        return template;
    }

    /**
     * Render markup for an error, using a custom error page if available,
     * or falling back to a default error page.
     *
     * @param {Error} error - The error object (should have httpStatusCode if possible)
     * @returns {Promise<string>} - The rendered error page HTML
     */
    async renderMarkupForError(error) {
        const html = await this.getPageBodyForError(error);
        if (html) {
            return html;
        }
        return this.renderDefaultErrorPage(error);
    }

    /**
     * Attempt to render the body of a custom error page for a given error.
     *
     * @param {Error} error - The error object (should have httpStatusCode if possible)
     * @returns {Promise<string|null>} - The rendered error page body, or null if not found
     */
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

    /**
     * Render a default error page as a fallback if no custom error page is available.
     *
     * @param {Error} error - The error object (should have httpStatusCode if possible)
     * @returns {string} - The fallback error page HTML
     */
    renderDefaultErrorPage(error) {
        const message = error.httpStatusCode
            ? `HTTP Status Code: ${ error.httpStatusCode }`
            : 'An error occurred.';
        return `<html><body><p>${ message }</p></body></html>\n`;
    }

    /**
     * Convert a URL pathname to an array of path parts for file system lookup.
     *
     * Removes file extensions, leading/trailing slashes, and ignores 'index' pages.
     *
     * @param {string} pathname - The URL pathname (e.g., '/about/index.html')
     * @returns {string[]} - Array of path parts (e.g., ['about'])
     */
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
