import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


const JSON_FILE_PATTERN = /page.jsonc?$/;
const TEMPLATE_FILE_PATTERN = /page.(html|xml)$/;
const MARKDOWN_FILE_PATTERN = /.md$/;

/**
 * @typedef {Object} SourceFile
 * @property {string} filename - The name of the file (e.g., 'page.html', 'body.md')
 * @property {string} source - The UTF-8 encoded content of the file
 */

/**
 * This is the default PageStore implementation for the HyperviewService.
 *
 * It manages page content stored in a directory structure, where each page is represented
 * by a directory containing template files, JSON data files, and markdown content files.
 *
 * Discovers and loads page components following Kixx naming conventions:
 * - Page data: `page.json` or `page.jsonc` files
 * - Page templates: `page.html` or `page.xml` files
 * - Markdown content: any `.md` files
 *
 * The directory structure mirrors URL pathnames, so `/blog/post` maps to `directory/blog/post/`.
 */
export default class PageStore {

    #fileSystem = null;
    #directory = null;

    /**
     * @param {object} options - PageStore configuration options
     * @param {string} directory - Absolute or relative path to the base directory containing page directories
     * @param {object} [fileSystem] - Optional file system API for testing. Defaults to the standard file system implementation.
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options) {
        options = options || {};

        assertNonEmptyString(options.directory, 'PageStore requires a base directory path');

        this.#directory = options.directory;
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    /**
     * Checks if a page directory exists for the given pathname.
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @returns {Promise<boolean>} True if the page directory exists, false otherwise
     */
    async doesPageExist(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);
        const stats = await this.#fileSystem.getFileStats(dirpath);
        return Boolean(stats && stats.isDirectory());
    }

    /**
     * Loads page data from a JSON or JSONC file in the page directory.
     * Returns an empty object if no JSON file is found or if the file cannot be read.
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @returns {Promise<Object>} Page data object parsed from JSON/JSONC file, or empty object if not found
     */
    async getPageData(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const file = files.find((f) => {
            return JSON_FILE_PATTERN.test(f.name);
        });

        if (!file || !file.isFile()) {
            return {};
        }

        const data = await this.#fileSystem.readJSONFile(path.join(dirpath, file.name));

        // Return empty object if file read returns null (race condition where file
        // was deleted between directory listing and reading)
        return data || {};
    }

    /**
     * Loads the page template file (HTML or XML) from the page directory.
     *
     * The template file is returned as a SourceFile object.
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/sitemap')
     * @returns {Promise<SourceFile|null>} Template object with filename and source, or null if no template file is found
     */
    async getPageTemplate(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const file = files.find((f) => {
            return TEMPLATE_FILE_PATTERN.test(f.name);
        });

        if (!file || !file.isFile()) {
            return null;
        }

        const source = await this.#fileSystem.readUtf8File(path.join(dirpath, file.name));

        // Return null if file read returns null (race condition where file
        // was deleted between directory listing and reading)
        if (!source) {
            return null;
        }

        return { filename: file.name, source };
    }

    /**
     * Loads all markdown content files from the page directory.
     *
     * Markdown files are loaded in directory listing order and returned as an array
     * of SourceFile objects.
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/documentation')
     * @returns {Promise<SourceFile[]>} Array of markdown file objects, or empty array if no markdown files are found
     */
    async getMarkdownContent(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const markdownFiles = files.filter((f) => {
            return MARKDOWN_FILE_PATTERN.test(f.name);
        });

        const promises = markdownFiles.map((file) => {
            return this.#fileSystem.readUtf8File(path.join(dirpath, file.name));
        });

        const sources = await Promise.all(promises);

        return sources.map((source, index) => {
            const filename = markdownFiles[index].name;
            return { filename, source };
        });
    }

    /**
     * Converts a URL pathname to a directory path relative to the base directory.
     * Handles leading and trailing slashes by normalizing them through path.join().
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/')
     * @returns {string} Directory path joined with the base directory
     */
    #pathnameToDirectory(pathname) {
        const parts = pathname.split('/');
        // The call to path.join() will ignore empty strings in the parts Array, removing
        // leading/trailing slashes for us.
        return path.join(this.#directory, ...parts);
    }
}
