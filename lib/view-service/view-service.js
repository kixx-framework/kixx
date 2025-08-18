import path from 'node:path';
import jsonc from '../vendor/jsonc-parser/mod.mjs';
import { marked } from '../vendor/marked/mod.js';
import { WrappedError, ValidationError } from '../errors/mod.js';
import PageTemplateEngine from './page-template-engine.js';
import deepMerge from '../lib/deep-merge.js';
import * as fileSystem from '../lib/file-system.js';
import { isNonEmptyString, assert, assertNonEmptyString } from '../assertions/mod.js';


export default class ViewService {

    /**
     * @private
     * @type {string|null}
     * Directory containing page files (JSON/HTML/Markdown)
     */
    #pageDirectory = null;

    /**
     * @private
     * @type {string|null}
     * Directory containing templates
     */
    #templatesDirectory = null;

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

    constructor(options) {
        assert(options.logger);
        assertNonEmptyString(options.pageDirectory);
        assertNonEmptyString(options.templatesDirectory);
        assertNonEmptyString(options.partialsDirectory);
        assertNonEmptyString(options.helpersDirectory);

        this.#pageTemplateEngine = options.pageTemplateEngine || new PageTemplateEngine({
            partialsDirectory: options.partialsDirectory,
            helpersDirectory: options.helpersDirectory,
        });

        this.#logger = options.logger;
        this.#fileSystem = options.fileSystem || fileSystem;
        this.#pageDirectory = options.pageDirectory;
        this.#templatesDirectory = options.templatesDirectory;
    }

    async initialize() {
        await this.#pageTemplateEngine.initialize();
    }

    /**
     * Load and merge page data for a given pathname.
     *
     * Loads per-page JSON data and merges it with site-wide page data and any additional props.
     * Ensures that a baseTemplateId is set (defaults to 'base.html').
     *
     * @param {string} urlPathname - The URL pathname (e.g., '/about')
     * @param {Object} props - Additional properties to merge into the page data
     * @returns {Promise<Object>} - The merged page data object
     * @throws {WrappedError} - If reading page or site data fails
     */
    async getPageData(urlPathname, props = {}) {
        const sitePageDataFilepath = path.join(this.#pageDirectory, 'page.jsonc');
        const pageDataFilepath = this.filepathForPageFile(urlPathname, 'page.jsonc');

        let sitePageData;
        try {
            sitePageData = await this.readPageDataJSONFile(sitePageDataFilepath);
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                throw cause;
            }
            throw new WrappedError(`Unable to read site page data file ${ sitePageDataFilepath }`, { cause });
        }

        let pageData;
        try {
            pageData = await this.readPageDataJSONFile(pageDataFilepath);
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                throw cause;
            }
            throw new WrappedError(`Unable to read page data file ${ pageDataFilepath }`, { cause });
        }

        return deepMerge(sitePageData || {}, pageData || {}, props || {});
    }

    async getPageMarkup(urlPathname, pageData) {
        // Remove trailing slash from the URL pathname.
        const templateId = `${ urlPathname.replace(/\/+$/, '') }/page.html`;
        const filepath = this.filepathForPageFile(urlPathname, 'page.html');
        const pageTemplate = await this.#pageTemplateEngine.getTemplate(templateId, filepath);

        const content = await this.getPageMarkdown(urlPathname, pageData);

        if (!pageTemplate) {
            return content;
        }

        const context = Object.assign({}, pageData, { content });
        return pageTemplate(context);
    }

    async getPageMarkdown(urlPathname, pageData) {
        // Remove trailing slash from the URL pathname.
        const templateId = `${ urlPathname.replace(/\/+$/, '') }/page.md`;
        const filepath = this.filepathForPageFile(urlPathname, 'page.md');
        const markdownTemplate = await this.#pageTemplateEngine.getTemplate(templateId, filepath);

        if (!markdownTemplate) {
            return null;
        }

        const markdown = markdownTemplate(pageData);
        return marked.parse(markdown);
    }

    /**
     * Load and return the base template render function by template ID.
     *
     * @param {string} [templateId] - The template ID (defaults to 'base.html')
     * @returns {Promise<Function|null>} - The template render function, or null if not found
     */
    async getBaseTemplate(templateId) {
        templateId = templateId || 'base.html';
        const filepath = this.filepathForTemplate(templateId);
        const template = await this.#pageTemplateEngine.getTemplate(templateId, filepath);
        return template;
    }

    /**
     * Hydrate small metadata templates like title and description. The primary
     * difference between small metadata templates and full page templates is that
     * small metadata templates do not have access to the registered partials.
     *
     * @param  {string} templateId Simple template name like "title" or "description"
     * @param  {string} template   The template source string (macro)
     * @param  {object} props      Data to hydrate with.
     * @return {string}            Hydrated template string (macro)
     */
    async hydrateMetadataTemplate(templateId, template, props) {
        if (!isNonEmptyString(template)) {
            return template;
        }

        const renderFunction = await this.#pageTemplateEngine.createMetadataTemplate(templateId, template);
        return renderFunction(props);
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
        const pageData = await this.getPageData(pathname);

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

    async readPageDataJSONFile(filepath) {
        let json = this.#fileSystem.readUtf8File(filepath);

        if (!json) {
            if (filepath.endsWith('.json')) {
                filepath = filepath.replace(/.json$/, '.jsonc');
            } else if (filepath.endsWith('.jsonc')) {
                filepath = filepath.replace(/.jsonc$/, '.json');
            }
            json = this.#fileSystem.readUtf8File(filepath);
        }

        if (!json) {
            return {};
        }

        const errors = [];

        const obj = jsonc.parse(json, errors, {
            disallowComments: false,
            allowTrailingComma: true,
            allowEmptyContent: true,
        });

        if (errors.length > 0) {
            const verror = new ValidationError(`JSON parsing errors in page data file ${ filepath }`);

            // Collect all parsing errors for detailed feedback
            for (const parseError of errors) {
                verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
            }

            throw verror;
        }

        return obj;
    }

    filepathForPageFile(pathname, filename) {
        // Remove file extension and leading/trailing slashes
        const parts = pathname.replace(/\.[^/.]+$/, '').split('/').filter(Boolean);

        // Ignore index pages.
        if (parts[parts.length - 1] === 'index') {
            parts.pop();
        }

        // Add the filename.
        parts.push(filename);

        return path.join(this.#pageDirectory, ...parts);
    }

    /**
     * Resolve a template ID to an absolute filepath within the templates directory.
     *
     * @param {string} pathname - Template identifier (relative path)
     * @returns {string}        - Absolute path to the template file
     */
    filepathForTemplate(pathname) {
        // Remove any leading/trailing slashes
        const parts = pathname.split('/').filter(Boolean);
        return path.join(this.#templatesDirectory, ...parts);
    }

    static async createAndInitialize(options) {
        const viewService = new ViewService(options);
        await viewService.initialize();
        return viewService;
    }
}
