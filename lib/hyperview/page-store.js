import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isNonEmptyString, assertNonEmptyString } from '../assertions/mod.js';
import { getFileExtensionForContentType } from '../lib/http-utils.js';
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

        // Resolve to absolute path for security checks in #pathnameToDirectory()
        this.#directory = path.resolve(options.directory);
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
        if (!dirpath) {
            return false;
        }
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
        if (!dirpath) {
            return {};
        }

        const files = await this.#fileSystem.readDirectory(dirpath);

        const file = files.find((f) => {
            return f.isFile() && JSON_FILE_PATTERN.test(f.name);
        });

        if (!file) {
            return {};
        }

        const data = await this.#fileSystem.readJSONFile(path.join(dirpath, file.name));

        // Return empty object if file read returns null (race condition where file
        // was deleted between directory listing and reading)
        return data || {};
    }

    /**
     * Writes page data from a request stream to a page.json or page.jsonc file in the page directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large JSON uploads. The method validates that the resolved path remains
     * within the base directory to prevent path traversal attacks.
     *
     * If a page.json or page.jsonc file already exists in the directory, it will be overwritten.
     * If no JSON file exists, page.jsonc will be used as the default.
     *
     * Returns null if the pathname is invalid or would resolve outside the base directory.
     *
     * This method validates that the resolved path remains within the base directory
     * to prevent path traversal attacks. Requests attempting to write to parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the JSON data
     * @returns {Promise<string|null>} The pathname if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putPageData(pathname, incomingStream) {
        const dirpath = this.#pathnameToDirectory(pathname);

        // If the dirpath is not returned, then we assume the path is invalid.
        if (!dirpath) {
            return null;
        }

        // Ensure page directory exists before reading or writing
        await this.#fileSystem.ensureDirectory(dirpath);

        // Check for existing JSON files in the directory.
        const files = await this.#fileSystem.readDirectory(dirpath);
        const existingJsonFile = files.find((f) => {
            return f.isFile() && JSON_FILE_PATTERN.test(f.name);
        });

        const filename = existingJsonFile ? existingJsonFile.name : 'page.jsonc';

        const filepath = path.join(dirpath, filename);
        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return pathname;
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
        if (!dirpath) {
            return null;
        }

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
     * Writes page template from a request stream to a page.html or page.xml file in the page directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large template uploads. The method validates that the resolved path remains
     * within the base directory to prevent path traversal attacks.
     *
     * If a page.html or page.xml file already exists in the directory, it will be overwritten.
     * If no template file exists, page.html will be used as the default.
     *
     * Returns null if the pathname is invalid or would resolve outside the base directory.
     *
     * This method validates that the resolved path remains within the base directory
     * to prevent path traversal attacks. Requests attempting to write to parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/sitemap')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the template data
     * @param {string} [contentType] - The MIME type of the template data. Only used if no template file exists.
     * @returns {Promise<string|null>} The pathname if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putPageTemplate(pathname, incomingStream, contentType) {
        const dirpath = this.#pathnameToDirectory(pathname);

        // If the dirpath is not returned, then we assume the path is invalid.
        if (!dirpath) {
            return null;
        }

        // Ensure page directory exists before reading or writing
        await this.#fileSystem.ensureDirectory(dirpath);

        // Check for existing template files in the directory.
        const files = await this.#fileSystem.readDirectory(dirpath);
        const existingTemplateFile = files.find((f) => {
            return f.isFile() && TEMPLATE_FILE_PATTERN.test(f.name);
        });

        let filename;
        if (existingTemplateFile) {
            filename = existingTemplateFile.name;
        } else if (isNonEmptyString(contentType)) {
            const extname = getFileExtensionForContentType(contentType) || '.html';
            filename = `page${ extname }`;
        } else {
            filename = 'page.html';
        }

        const filepath = path.join(dirpath, filename);
        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return pathname;
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
        if (!dirpath) {
            return [];
        }

        const files = await this.#fileSystem.readDirectory(dirpath);

        const markdownFiles = files.filter((f) => {
            return MARKDOWN_FILE_PATTERN.test(f.name);
        });

        const promises = markdownFiles.map((file) => {
            return this.#fileSystem.readUtf8File(path.join(dirpath, file.name));
        });

        const sources = await Promise.all(promises);

        return sources
            // Assign filenames using the indexes before filtering out null values. Otherwise,
            // the indexes will be incorrect after filtering out null values.
            .map((source, index) => {
                if (source) {
                    const filename = markdownFiles[index].name;
                    return { filename, source };
                }
                return null;
            })
            // Filter out null values (race condition where file was deleted between
            // directory listing and reading)
            .filter((item) => item);
    }

    /**
     * Loads a single markdown file from the page directory.
     *
     * Returns the file as a SourceFile object with filename and UTF-8 source.
     * Returns null if the file doesn't exist, the pathname is invalid, or the filename is invalid.
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {string} filename - Markdown filename (e.g., 'body.md', 'intro.md')
     * @returns {Promise<SourceFile|null>} Markdown file object, or null if not found or invalid
     */
    async getMarkdownFile(pathname, filename) {
        const filepath = this.#pathnameAndFilenameToFilepath(pathname, filename);
        if (!filepath) {
            return null;
        }

        const source = await this.#fileSystem.readUtf8File(filepath);

        // Return null if file doesn't exist (readUtf8File returns null)
        if (!source) {
            return null;
        }

        return { filename, source };
    }

    /**
     * Writes a markdown file to the page directory from a request stream.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory.
     * The method validates that the pathname is valid and the filename is a valid top-level markdown filename.
     *
     * If a file with the same filename already exists in the directory, it will be overwritten.
     *
     * Returns the filename if successful, or null if the pathname or filename is invalid.
     * @public
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {string} filename - Markdown filename (e.g., 'body.md', 'intro.md')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the markdown data
     * @returns {Promise<string|null>} The filename if successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putMarkdownFile(pathname, filename, incomingStream) {
        const filepath = this.#pathnameAndFilenameToFilepath(pathname, filename);

        // If the filepath is not returned, then we assume the path or filename is invalid
        if (!filepath) {
            return null;
        }

        // Require .md extension
        if (!MARKDOWN_FILE_PATTERN.test(filepath)) {
            return null;
        }

        // Ensure parent directories exist before writing
        // Use dirname because we need the page directory (not the file itself) to exist
        await this.#fileSystem.ensureDirectory(path.dirname(filepath));

        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise
        await pipeline(incomingStream, destination);

        return filename;
    }

    /**
     * Deletes a markdown file from the page directory.
     *
     * This operation is idempotent - it succeeds even if the file doesn't exist.
     * Returns null if the pathname or filename is invalid.
     * @public
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @param {string} filename - Markdown filename (e.g., 'body.md', 'intro.md')
     * @returns {Promise<string|null>} The filename if operation succeeded, or null if the path is invalid
     */
    async deleteMarkdownFile(pathname, filename) {
        const filepath = this.#pathnameAndFilenameToFilepath(pathname, filename);

        // If the filepath is not returned, then we assume the path or filename is invalid
        if (!filepath) {
            return null;
        }

        await this.#fileSystem.removeFile(filepath);

        return filename;
    }

    /**
     * Deletes a page directory and all its contents recursively.
     *
     * Removes the entire page directory including page data files (page.json/page.jsonc),
     * template files (page.html/page.xml), markdown files (*.md), and any subdirectories
     * with their contents.
     *
     * This operation is idempotent - it succeeds even if the page directory doesn't exist.
     * Returns null if the pathname is invalid or would resolve outside the base directory.
     * @public
     * @async
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/team')
     * @returns {Promise<string|null>} The pathname if operation succeeded, or null if the path is invalid
     */
    async deletePage(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        // If the dirpath is not returned, then we assume the path is invalid
        if (!dirpath) {
            return null;
        }

        await this.#fileSystem.removeDirectory(dirpath);

        return pathname;
    }

    /**
     * Validates and resolves a pathname to an absolute directory path within the base directory.
     *
     * Prevents path traversal attacks by ensuring the resolved path stays within the base directory.
     * Returns null if the path would resolve outside the base directory.
     * Handles leading and trailing slashes by normalizing them through path.join().
     * @private
     * @param {string} pathname - URL pathname (e.g., '/blog/post', '/about/')
     * @returns {string|null} Absolute directory path if valid, or null if path traversal detected
     */
    #pathnameToDirectory(pathname) {
        const parts = pathname.split('/');
        // The call to path.join() will ignore empty strings in the parts Array, removing
        // leading/trailing slashes for us.
        const dirpath = path.join(this.#directory, ...parts);

        // Security check: ensure the resolved dirpath is within the base directory.
        // We compute the relative path from base dir to the directory - if it starts with
        // '..' or is absolute, the directory is outside the base directory (path traversal).
        const resolvedDirpath = path.resolve(dirpath);
        const relativePath = path.relative(this.#directory, resolvedDirpath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedDirpath;
    }

    /**
     * Validates pathname and filename, then resolves to an absolute file path.
     *
     * Security validations:
     * - Pathname must be valid (pass #pathnameToDirectory check)
     * - Filename must not contain '/' (no nested paths allowed)
     * - Resolved path must be within the page directory
     * @private
     * @param {string} pathname - URL pathname (e.g., '/blog/post')
     * @param {string} filename - Markdown filename (e.g., 'body.md')
     * @returns {string|null} Absolute file path if valid, or null if validation fails
     */
    #pathnameAndFilenameToFilepath(pathname, filename) {
        // Validate pathname first
        const dirpath = this.#pathnameToDirectory(pathname);
        if (!dirpath) {
            return null;
        }

        // Reject nested paths (no '/' allowed in filename)
        if (filename.includes('/')) {
            return null;
        }

        // Construct and validate the full file path
        const filepath = path.join(dirpath, filename);
        const resolvedFilepath = path.resolve(filepath);

        // Final security check: ensure resolved path is within the page directory
        const relativePath = path.relative(dirpath, resolvedFilepath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedFilepath;
    }
}
