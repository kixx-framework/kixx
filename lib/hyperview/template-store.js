import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AssertionError, WrappedError } from '../errors/mod.js';
import * as fileSystem from '../lib/file-system.js';
import { isFunction, isNonEmptyString } from '../assertions/mod.js';


/**
 * @typedef {Object} SourceFile
 * @property {string} filename - The name of the file (e.g., 'page.html', 'articles/body.md')
 * @property {string} source - The UTF-8 encoded content of the file
 */

/**
 * @typedef {Object} Helper
 * @property {string} name - Helper function name used in templates
 * @property {Function} helper - Helper function that transforms template data
 */

/**
 * Manages loading and retrieval of template files, partials, and helper functions for the templating system.
 *
 * TemplateStore provides centralized access to template resources from the filesystem,
 * handling base templates, partials (reusable template components), and custom helper
 * functions. It supports nested directory structures for partials and validates helper
 * exports to ensure they meet the required interface.
 */
export default class TemplateStore {

    /**
     * Absolute path to the directory containing custom template helper modules
     * @type {string|null}
     */
    #helpersDirectory = null;

    /**
     * Absolute path to the directory containing reusable template partials
     * @type {string|null}
     */
    #partialsDirectory = null;

    /**
     * Absolute path to the directory containing base template files
     * @type {string|null}
     */
    #templatesDirectory = null;

    /**
     * File system abstraction for reading files and directories
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Creates a new TemplateStore instance with specified directory paths.
     * @param {Object} options={} - Configuration options
     * @param {string} options.helpersDirectory - Absolute path to custom template helpers directory
     * @param {string} options.partialsDirectory - Absolute path to template partials directory
     * @param {string} options.templatesDirectory - Absolute path to base templates directory
     * @param {Object} [options.fileSystem] - File system abstraction (defaults to lib/file-system.js for testing purposes)
     */
    constructor(options) {
        options = options || {};

        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;
        this.#templatesDirectory = options.templatesDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;
    }

    /**
     * Retrieves a base template file by its identifier.
     *
     * This method validates that the resolved path remains within the templates directory
     * to prevent path traversal attacks. Requests attempting to access parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @async
     * @param {string} templateId - Template identifier supporting nested paths (e.g., 'layouts/base.html', 'pages/home.html')
     * @returns {Promise<SourceFile|null>} Source file object with filename and source, or null if template doesn't exist or path is invalid
     */
    async getBaseTemplate(templateId) {
        const filepath = this.#templateIdToFilepath(templateId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // readUtf8File() returns null if file doesn't exist
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return { filename: templateId, source };
    }

    /**
     * Writes template content from a request stream to the specified templateId within the templates directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large template uploads. The method validates that the resolved path remains
     * within the templates directory to prevent path traversal attacks.
     *
     * Returns null if the templateId is invalid or would resolve outside the templates directory.
     * The file is overwritten if it already exists.
     *
     * This method validates that the resolved path remains within the templates directory
     * to prevent path traversal attacks. Requests attempting to write to parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} templateId - Relative path to the template (e.g., 'layouts/base.html', 'pages/home.html')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the template data
     * @returns {Promise<string|null>} The templateId if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putBaseTemplate(templateId, incomingStream) {
        const filepath = this.#templateIdToFilepath(templateId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // Ensure parent directory exists before writing
        await this.#fileSystem.ensureDirectory(path.dirname(filepath));

        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return templateId;
    }

    /**
     * Deletes a base template file from the templates directory.
     *
     * Returns null if the templateId is invalid or would resolve outside the templates directory.
     * The operation is idempotent - if the template doesn't exist, it succeeds silently.
     *
     * This method validates that the resolved path remains within the templates directory
     * to prevent path traversal attacks. Requests attempting to delete files in parent
     * directories (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} templateId - Template identifier supporting nested paths (e.g., 'layouts/base.html', 'pages/home.html')
     * @returns {Promise<string|null>} The templateId if the template was successfully deleted, or null if the path is invalid
     * @throws {Error} When the delete operation fails (e.g., permission denied, path is a directory with contents)
     */
    async deleteBaseTemplate(templateId) {
        const filepath = this.#templateIdToFilepath(templateId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        await this.#fileSystem.removeFile(filepath);

        return templateId;
    }

    /**
     * Retrieves a partial template file by its identifier.
     *
     * Partials are reusable template components that can be included in base templates.
     * This method provides access to individual partials by their identifier, which may
     * include nested directory paths (e.g., 'cards/user.html', 'modals/auth/login.html').
     *
     * This method validates that the resolved path remains within the partials directory
     * to prevent path traversal attacks. Requests attempting to access parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} partialId - Partial identifier supporting nested paths (e.g., 'cards/user.html', 'header.html')
     * @returns {Promise<SourceFile|null>} Source file object with filename and source, or null if partial doesn't exist or path is invalid
     */
    async getPartialFile(partialId) {
        const filepath = this.#partialIdToFilepath(partialId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // readUtf8File() returns null if file doesn't exist
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return { filename: partialId, source };
    }

    /**
     * Writes partial content from a request stream to the specified partialId within the partials directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large partial uploads. The method validates that the resolved path remains
     * within the partials directory to prevent path traversal attacks.
     *
     * Returns null if the partialId is invalid or would resolve outside the partials directory.
     * The file is overwritten if it already exists.
     *
     * This method validates that the resolved path remains within the partials directory
     * to prevent path traversal attacks. Requests attempting to write to parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} partialId - Relative path to the partial (e.g., 'cards/user.html', 'header.html')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the partial data
     * @returns {Promise<string|null>} The partialId if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putPartialFile(partialId, incomingStream) {
        const filepath = this.#partialIdToFilepath(partialId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // Ensure parent directory exists before writing
        await this.#fileSystem.ensureDirectory(path.dirname(filepath));

        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return partialId;
    }

    /**
     * Deletes a partial file from the partials directory.
     *
     * Returns null if the partialId is invalid or would resolve outside the partials directory.
     * The operation is idempotent - if the partial doesn't exist, it succeeds silently.
     *
     * This method validates that the resolved path remains within the partials directory
     * to prevent path traversal attacks. Requests attempting to delete files in parent
     * directories (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} partialId - Partial identifier supporting nested paths (e.g., 'cards/user.html', 'header.html')
     * @returns {Promise<string|null>} The partialId if the partial was successfully deleted, or null if the path is invalid
     * @throws {Error} When the delete operation fails (e.g., permission denied, path is a directory with contents)
     */
    async deletePartialFile(partialId) {
        const filepath = this.#partialIdToFilepath(partialId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        await this.#fileSystem.removeFile(filepath);

        return partialId;
    }

    /**
     * Retrieves a helper file by its identifier.
     *
     * Helper files are JavaScript modules that provide custom template functions.
     * Unlike partials, helpers must be in the top-level helpers directory (no subdirectories).
     *
     * This method validates that the resolved path remains within the helpers directory
     * to prevent path traversal attacks. Requests with nested paths (e.g., 'sub/helper.js')
     * or attempting to access parent directories will return null.
     * @public
     * @async
     * @param {string} helperId - Helper identifier for top-level files only (e.g., 'format-date.js')
     * @returns {Promise<SourceFile|null>} Source file object with filename and source, or null if helper doesn't exist or path is invalid
     */
    async getHelperFile(helperId) {
        const filepath = this.#helperIdToFilepath(helperId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // readUtf8File() returns null if file doesn't exist
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return { filename: helperId, source };
    }

    /**
     * Writes helper content from a request stream to the specified helperId within the helpers directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large helper uploads. The method validates that the resolved path remains
     * within the helpers directory and enforces top-level-only constraint.
     *
     * Returns null if the helperId is invalid, contains nested paths, or would resolve outside the
     * helpers directory. The file is overwritten if it already exists.
     *
     * This method validates that the resolved path remains within the helpers directory
     * to prevent path traversal attacks. Requests with nested paths or attempting to write
     * to parent directories will return null.
     * @public
     * @async
     * @param {string} helperId - Helper identifier for top-level files only (e.g., 'format-date.js')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the helper data
     * @returns {Promise<string|null>} The helperId if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putHelperFile(helperId, incomingStream) {
        const filepath = this.#helperIdToFilepath(helperId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        // Ensure parent directory exists before writing
        await this.#fileSystem.ensureDirectory(path.dirname(filepath));

        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return helperId;
    }

    /**
     * Deletes a helper file from the helpers directory.
     *
     * Returns null if the helperId is invalid, contains nested paths, or would resolve outside
     * the helpers directory. The operation is idempotent - if the helper doesn't exist, it
     * succeeds silently.
     *
     * This method validates that the resolved path remains within the helpers directory
     * to prevent path traversal attacks. Requests with nested paths or attempting to delete
     * files in parent directories will return null.
     * @public
     * @async
     * @param {string} helperId - Helper identifier for top-level files only (e.g., 'format-date.js')
     * @returns {Promise<string|null>} The helperId if the helper was successfully deleted, or null if the path is invalid
     * @throws {Error} When the delete operation fails (e.g., permission denied, path is a directory with contents)
     */
    async deleteHelperFile(helperId) {
        const filepath = this.#helperIdToFilepath(helperId);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        await this.#fileSystem.removeFile(filepath);

        return helperId;
    }

    /**
     * Recursively loads all partial template files from the partials directory.
     *
     * Walks the entire directory tree under the partials directory, loading all files
     * and preserving the directory structure in the filename. For example, a file at
     * `partials/cards/user.html` will have filename `'cards/user.html'`.
     * @async
     * @returns {Promise<SourceFile[]>} Array of SourceFile objects with filenames preserving directory structure
     * @throws {WrappedError} When unable to read the partials directory or any subdirectory
     */
    async loadPartialFiles() {
        // Accumulate all partial files in this array as we walk the directory tree
        const files = [];
        const fs = this.#fileSystem;

        // Recursively walk directory tree to load all partials, preserving
        // the directory structure in the filename (e.g., 'cards/user.html')
        async function walkDirectory(directory, parts = []) {
            let entries;
            try {
                entries = await fs.readDirectory(directory);
            } catch (cause) {
                throw new WrappedError(`Unable to read partials directory ${ directory }`, { cause });
            }

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirpath = path.join(directory, entry.name);
                    // Recurse into subdirectories, building up the path parts
                    // for the final filename (e.g., ['cards', 'user.html'])
                    // eslint-disable-next-line no-await-in-loop
                    await walkDirectory(dirpath, parts.concat(entry.name));
                } else if (entry.isFile()) {
                    const filepath = path.join(directory, entry.name);
                    // Build filename from path parts to create partial names like
                    // 'cards/user.html' for files in nested directories
                    const filename = parts.concat(entry.name).join('/');

                    // eslint-disable-next-line no-await-in-loop
                    const source = await fs.readUtf8File(filepath);
                    files.push({ filename, source });
                }
            }
        }

        await walkDirectory(this.#partialsDirectory);

        // Only return files which do not have a `null` source (not found). This is an edge
        // case which could be caused by a race condition after reading the directory.
        return files.filter(({ source }) => source);
    }

    /**
     * Loads custom template helper functions from the helpers directory.
     *
     * Dynamically imports all JavaScript files from the top-level helpers directory
     * (non-recursive) as ES modules and validates that each exports both a `name`
     * string and a `helper` function. Helper files must follow the interface:
     * `export const name = 'helperName'; export function helper() { }`
     * @async
     * @returns {Promise<Helper[]>} Array of helper objects with name and function properties
     * @throws {WrappedError} When unable to read the helpers directory or import a helper module
     * @throws {AssertionError} When a helper file doesn't export a valid name string or helper function
     */
    async loadHelperFiles() {
        let entries;
        try {
            entries = await this.#fileSystem.readDirectory(this.#helpersDirectory);
        } catch (cause) {
            throw new WrappedError(`Unable to read helpers directory ${ this.#helpersDirectory }`, { cause });
        }

        // Only load helpers from the top-level helpers directory, not subdirectories.
        const filepaths = entries
            .filter((entry) => {
                return entry.isFile();
            })
            .map((entry) => {
                return path.join(this.#helpersDirectory, entry.name);
            });

        const files = [];

        for (const filepath of filepaths) {
            let name;
            let helper;
            try {
                // ES module imports must be sequential to avoid race conditions
                // with Node.js module cache and to ensure predictable load order
                // eslint-disable-next-line no-await-in-loop
                const mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
                name = mod.name;
                helper = mod.helper;
            } catch (cause) {
                throw new WrappedError(`Unable to load template helper from ${ filepath }`, { cause });
            }

            if (!isNonEmptyString(name)) {
                throw new AssertionError(`A template helper file must export a name string (${ filepath })`);
            }
            if (!isFunction(helper)) {
                throw new AssertionError(`A template helper file must export a helper function (${ filepath })`);
            }

            files.push({ name, helper });
        }

        return files;
    }

    /**
     * Validates and resolves a templateId to an absolute filepath within the templates directory.
     *
     * Prevents path traversal attacks by ensuring the resolved path stays within the templates directory.
     * Returns null if the path would resolve outside the templates directory.
     * @private
     * @param {string} templateId - Template identifier supporting nested paths (e.g., 'layouts/base.html', 'pages/home.html')
     * @returns {string|null} Absolute filepath if valid, or null if path traversal detected
     */
    #templateIdToFilepath(templateId) {
        // Split templateId by '/' and join with templates directory to support
        // nested template paths like 'layouts/base.html' or 'pages/home.html'
        const parts = templateId.split('/');
        const filepath = path.join(this.#templatesDirectory, ...parts);

        // Security check: ensure the resolved filepath is within the templates directory.
        // We compute the relative path from templates dir to the file - if it starts with
        // '..' or is absolute, the file is outside the templates directory (path traversal).
        const resolvedFilepath = path.resolve(filepath);
        const relativePath = path.relative(this.#templatesDirectory, resolvedFilepath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedFilepath;
    }

    /**
     * Validates and resolves a partialId to an absolute filepath within the partials directory.
     *
     * Prevents path traversal attacks by ensuring the resolved path stays within the partials directory.
     * Returns null if the path would resolve outside the partials directory.
     * @private
     * @param {string} partialId - Partial identifier supporting nested paths (e.g., 'cards/user.html', 'modals/auth/login.html')
     * @returns {string|null} Absolute filepath if valid, or null if path traversal detected
     */
    #partialIdToFilepath(partialId) {
        // Split partialId by '/' and join with partials directory to support
        // nested partial paths like 'cards/user.html' or 'modals/auth/login.html'
        const parts = partialId.split('/');
        const filepath = path.join(this.#partialsDirectory, ...parts);

        // Security check: ensure the resolved filepath is within the partials directory.
        // We compute the relative path from partials dir to the file - if it starts with
        // '..' or is absolute, the file is outside the partials directory (path traversal).
        const resolvedFilepath = path.resolve(filepath);
        const relativePath = path.relative(this.#partialsDirectory, resolvedFilepath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedFilepath;
    }

    /**
     * Validates and resolves a helperId to an absolute filepath within the helpers directory.
     *
     * Prevents path traversal attacks and enforces top-level-only constraint.
     * Helpers must be in the root helpers directory (no nested subdirectories).
     * Returns null if the path would be outside helpers directory or contains subdirectories.
     * @private
     * @param {string} helperId - Helper identifier for top-level files only (e.g., 'format-date.js')
     * @returns {string|null} Absolute filepath if valid, or null if path traversal detected or nested path attempted
     */
    #helperIdToFilepath(helperId) {
        // Remove leading slash if present for consistent handling
        const normalized = helperId.startsWith('/') ? helperId.slice(1) : helperId;

        // Reject nested paths - helpers must be top-level only
        if (normalized.includes('/')) {
            return null;
        }

        const filepath = path.join(this.#helpersDirectory, normalized);

        // Security check: ensure the resolved filepath is within the helpers directory.
        // We compute the relative path from helpers dir to the file - if it starts with
        // '..' or is absolute, the file is outside the helpers directory (path traversal).
        const resolvedFilepath = path.resolve(filepath);
        const relativePath = path.relative(this.#helpersDirectory, resolvedFilepath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedFilepath;
    }
}
