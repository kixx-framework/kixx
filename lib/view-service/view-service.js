import path from 'node:path';
import * as jsonc from '../vendor/jsonc-parser/mod.mjs';
import { marked } from '../vendor/marked/mod.js';
import { WrappedError, ValidationError } from '../errors/mod.js';
import PageTemplateEngine from './page-template-engine.js';
import deepMerge from '../lib/deep-merge.js';
import * as fileSystem from '../lib/file-system.js';
import { isNonEmptyString, assertNonEmptyString } from '../assertions/mod.js';


/**
 * @fileoverview View service for rendering HTML pages from templates and markdown content
 *
 * This module provides functionality for loading page data, rendering templates,
 * processing markdown content, and handling error pages.
 */

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
     * Creates a new ViewService instance
     * @param {Object} options - Configuration options
     * @param {string} options.pageDirectory - Directory containing page files
     * @param {string} options.templatesDirectory - Directory containing templates
     * @param {string} options.partialsDirectory - Directory containing template partials
     * @param {string} options.helpersDirectory - Directory containing template helpers
     * @param {PageTemplateEngine} [options.pageTemplateEngine] - Custom template engine instance useful for testing
     * @param {Object} [options.fileSystem] - Custom file system abstraction useful for testing
     * @throws {AssertionError} When required options are missing or invalid
     */
    constructor(options) {
        assertNonEmptyString(options.pageDirectory);
        assertNonEmptyString(options.templatesDirectory);
        assertNonEmptyString(options.partialsDirectory);
        assertNonEmptyString(options.helpersDirectory);

        this.#pageTemplateEngine = options.pageTemplateEngine || new PageTemplateEngine({
            partialsDirectory: options.partialsDirectory,
            helpersDirectory: options.helpersDirectory,
        });

        this.#fileSystem = options.fileSystem || fileSystem;
        this.#pageDirectory = options.pageDirectory;
        this.#templatesDirectory = options.templatesDirectory;
    }

    /**
     * Initializes the view service and template engine
     * @returns {Promise<void>}
     */
    async initialize() {
        await this.#pageTemplateEngine.initialize();
    }

    async doesPageExist(urlPathname) {
        const dirpath = this.filepathForPagePath(urlPathname);
        const res = await this.#fileSystem.getFileStats(dirpath);
        return Boolean(res);
    }

    /**
     * Loads and merges page data for a given pathname
     *
     * Merges site-wide page data with page-specific data and additional props.
     * Site data provides defaults, page data overrides, and props have highest priority.
     *
     * @param {string} urlPathname - The URL pathname (e.g., '/about')
     * @param {Object} [props={}] - Additional properties to merge into the page data
     * @returns {Promise<Object>} The merged page data object
     * @throws {WrappedError} When reading page or site data fails
     * @throws {ValidationError} When page data contains invalid JSON
     */
    async getPageData(urlPathname, props = {}) {
        const sitePageDataFilepath = path.join(this.#pageDirectory, 'page.jsonc');
        const pageDataFilepath = this.filepathForPagePath(urlPathname, 'page.jsonc');

        // Load site-wide page data (shared across all pages)
        let sitePageData;
        try {
            sitePageData = await this.readPageDataJSONFile(sitePageDataFilepath);
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                throw cause;
            }
            throw new WrappedError(`Unable to read site page data file ${ sitePageDataFilepath }`, { cause });
        }

        // Load page-specific data (overrides site-wide data)
        let pageData;
        try {
            pageData = await this.readPageDataJSONFile(pageDataFilepath);
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                throw cause;
            }
            throw new WrappedError(`Unable to read page data file ${ pageDataFilepath }`, { cause });
        }

        // Merge in order: site data (base) → page data (overrides) → props (highest priority)
        return deepMerge(sitePageData || {}, pageData || {}, props || {});
    }

    hydratePageData(url, props) {
        if (!isNonEmptyString(props.canonicalURL)) {
            // Only assign the canonical URL if it is not yet defined.
            props.canonicalURL = this.urlToCanonicalURLString(url);
        }

        props.title = this.hydrateMetadataTemplate('title', props.title, props);
        props.description = this.hydrateMetadataTemplate('description', props.description, props);

        // Create the Open Graph object if it does not yet exist.
        const openGraph = props.openGraph || {};
        props.openGraph = openGraph;

        if (!isNonEmptyString(openGraph.url)) {
            openGraph.url = props.canonicalURL;
        }
        if (!isNonEmptyString(openGraph.type)) {
            openGraph.type = 'website';
        }
        if (!isNonEmptyString(openGraph.title)) {
            openGraph.title = props.title;
        }
        if (!isNonEmptyString(openGraph.description)) {
            openGraph.description = props.description;
        }
        if (!isNonEmptyString(openGraph.locale)) {
            openGraph.locale = props.locale;
        }

        return props;
    }

    /**
     * Renders HTML markup for a page by combining template and markdown content
     *
     * @param {string} urlPathname - The URL pathname (e.g., '/about')
     * @param {Object} pageData - Page data to pass to templates
     * @returns {Promise<string>} Rendered HTML markup, or markdown content if no template found
     * @throws {WrappedError} When template or markdown processing fails
     */
    async getPageMarkup(urlPathname, pageData) {
        // Template ID follows pattern: /path/to/page → /path/to/page/page.html
        const templateId = `${ this.#normalizePath(urlPathname) }/page.html`;
        const filepath = this.filepathForPagePath(urlPathname, 'page.html');

        const content = await this.getPageMarkdown(urlPathname, pageData);
        const pageTemplate = await this.#pageTemplateEngine.getTemplate(templateId, filepath);

        if (!pageTemplate) {
            return Object.keys(content).reduce((str, key) => {
                return str + '\n' + content[key];
            }, '');
        }

        const context = Object.assign({}, pageData, { content });
        return pageTemplate(context);
    }

    /**
     * Renders markdown content for a page
     *
     * @param {string} urlPathname - The URL pathname (e.g., '/about')
     * @param {Object} pageData - Page data to pass to markdown template
     * @returns {Promise<string|null>} Rendered HTML from markdown, or null if no markdown template found
     * @throws {WrappedError} When markdown processing fails
     */
    async getPageMarkdown(urlPathname, pageData) {
        const directory = this.filepathForPagePath(urlPathname);
        const files = await this.#fileSystem.readDirectory(directory);

        const markdownFiles = files
            .filter((file) => {
                return file.isFile() && file.name.endsWith('.md');
            })
            .map((file) => {
                const filepath = path.join(directory, file.name);
                // Template ID follows pattern: /path/to/page → /path/to/page/[filename].md
                const templateId = `${ this.#normalizePath(urlPathname) }/${ file.name }`;
                return { templateId, filepath, name: file.name };
            });

        const content = {};

        for (const { templateId, filepath, name } of markdownFiles) {
            const key = name.replace(/.md$/, '');
            // eslint-disable-next-line no-await-in-loop
            const markdownTemplate = await this.#pageTemplateEngine.getTemplate(templateId, filepath);
            const markdown = markdownTemplate(pageData);
            content[key] = marked.parse(markdown);
        }

        return content;
    }

    /**
     * Loads and returns the base template render function
     *
     * @param {string} [templateId='base.html'] - The template ID
     * @returns {Promise<Function|null>} The template render function, or null if not found
     * @throws {WrappedError} When template loading fails
     */
    async getBaseTemplate(templateId) {
        templateId = templateId || 'base.html';
        const filepath = this.filepathForTemplate(templateId);
        const template = await this.#pageTemplateEngine.getTemplate(templateId, filepath);
        return template;
    }

    /**
     * Hydrates small metadata templates like title and description
     * Metadata templates are lightweight templates that don't have access to registered partials.
     *
     * @param {string} templateId - Template identifier (e.g., "title", "description")
     * @param {string} template - The template source string
     * @param {Object} props - Data to hydrate the template with
     * @returns {Promise<string>} Hydrated template string
     * @throws {WrappedError} When template processing fails
     */
    hydrateMetadataTemplate(templateId, template, props) {
        const renderFunction = this.#pageTemplateEngine.createMetadataTemplate(templateId, template);
        return renderFunction(props);
    }

    /**
     * Reads and parses a JSON/JSONC page data file
     * Supports both .json and .jsonc extensions, trying the alternate if the primary isn't found.
     *
     * @param {string} filepath - Path to the JSON/JSONC file
     * @returns {Promise<Object>} Parsed page data object
     * @throws {ValidationError} When file contains invalid JSON/JSONC
     */
    async readPageDataJSONFile(filepath) {
        let json = await this.#fileSystem.readUtf8File(filepath);

        // Try alternate extension if file not found (supports both .json and .jsonc)
        if (!json) {
            if (filepath.endsWith('.json')) {
                filepath = filepath.replace(/.json$/, '.jsonc');
            } else if (filepath.endsWith('.jsonc')) {
                filepath = filepath.replace(/.jsonc$/, '.json');
            }
            json = await this.#fileSystem.readUtf8File(filepath);
        }

        if (!json) {
            return {};
        }

        const errors = [];

        // Parse with JSONC (JSON with Comments) support for better developer experience
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

    /**
     * Resolves a URL pathname to a filepath for page files
     * Normalizes the path by removing file extensions, leading/trailing slashes,
     * and handling index pages (e.g., /about/index.html → /about).
     *
     * @param {string} pathname - URL pathname (e.g., '/about')
     * @param {string} [filename] - Target filename (e.g., 'page.html')
     * @returns {string} Absolute filepath to the page file
     */
    filepathForPagePath(pathname, filename) {
        // Normalize path by removing file extensions and leading/trailing slashes
        const parts = this.#normalizePath(pathname.replace(/\.[^/.]+$/, '')).split('/');

        // Remove 'index' from path since /about/index and /about should map to same file
        if (parts[parts.length - 1] === 'index') {
            parts.pop();
        }

        if (filename) {
            parts.push(filename);
        }

        return path.join(this.#pageDirectory, ...parts);
    }

    /**
     * Resolves a template ID to an absolute filepath within the templates directory
     *
     * @param {string} pathname - Template identifier (relative path)
     * @returns {string} Absolute path to the template file
     */
    filepathForTemplate(pathname) {
        // Normalize path by removing leading/trailing slashes
        const parts = this.#normalizePath(pathname).split('/');
        return path.join(this.#templatesDirectory, ...parts);
    }

    urlToCanonicalURLString(url) {
        const { protocol, host, pathname } = url;
        return `${ protocol }//${ host }${ pathname }`;
    }

    /**
     * Removes leading and trailing slashes from a path string
     *
     * @param {string} pathString - The path string to normalize
     * @returns {string} Path string with leading and trailing slashes removed
     */
    #normalizePath(pathString) {
        return pathString.replace(/^\/+|\/+$/g, '');
    }

    /**
     * Creates and initializes a new ViewService instance
     *
     * Convenience method that combines instantiation and initialization.
     *
     * @param {Object} options - Configuration options (same as constructor)
     * @returns {Promise<ViewService>} Initialized ViewService instance
     * @throws {Error} When initialization fails
     */
    static async createAndInitialize(options) {
        const viewService = new ViewService(options);
        await viewService.initialize();
        return viewService;
    }
}
