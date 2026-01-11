import path from 'node:path';
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
     * @async
     * @param {string} templateId - Template identifier supporting nested paths (e.g., 'layouts/base.html', 'pages/home.html')
     * @returns {Promise<SourceFile|null>} Source file object with filename and source, or null if template doesn't exist
     */
    async getBaseTemplate(templateId) {
        // Split templateId by '/' and join with base directory to support
        // nested template paths like 'layouts/base.html' or 'pages/home.html'
        const parts = templateId.split('/');
        const filepath = path.join(this.#templatesDirectory, ...parts);

        // readUtf8File() returns null if file doesn't exist
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return { filename: templateId, source };
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
}
