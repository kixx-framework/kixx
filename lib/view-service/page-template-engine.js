import path from 'node:path';
import { assertNonEmptyString, assertFunction } from '../assertions/mod.js';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import plus_one from './helpers/plus_one.js';
import * as fileSystem from '../lib/file-system.js';

/**
 * Template engine for compiling and rendering page templates with partials and helpers.
 *
 * Supports:
 *  - dynamic loading of custom template helpers and partial templates from disk.
 *  - loading of templates from nested filepaths within a default templates directory.
 *  - built-in helpers for common template operations.
 *  - built-in partials for common template operations.
 */
export default class PageTemplateEngine {

    #helpersDirectory = null;
    #partialsDirectory = null;
    #fileSystem = null;

    /**
     * @param {Object} options - Configuration options
     * @param {string} options.helpersDirectory - Path to directory containing custom helper modules
     * @param {string} options.partialsDirectory - Path to directory containing partial templates
     * @param {Object} [options.fileSystem] - File system interface (defaults to built-in)
     */
    constructor(options) {
        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        // Start with built-in helpers from kixx-templating, then add custom ones
        this.helpers = new Map(helpers);
        this.helpers.set('format_date', format_date);
        this.helpers.set('plus_one', plus_one);

        // Partials are loaded dynamically from disk and cached in this Map.
        this.partials = new Map();
    }

    /**
     * Loads custom template helpers from the helpers directory.
     *
     * @async
     * @throws {WrappedError} When helpers directory cannot be read or helper modules fail to load
     */
    async initialize() {
        await this.loadHelpers(this.#helpersDirectory);
    }

    /**
     * Creates a template for metadata processing without partial support.
     *
     * @async
     * @param {string} templateId - Template identifier for error reporting
     * @param {string} source - Template source code
     * @returns {Promise<Function>} Compiled render function without partials
     */
    async createMetadataTemplate(templateId, source) {
        const includePartials = false;
        return this.compileTemplate(templateId, source, includePartials);
    }

    /**
     * Retrieves and compiles a template from a specific filepath.
     *
     * @async
     * @param {string} templateId - Template identifier for error reporting
     * @param {string} filepath - Absolute path to template file
     * @returns {Promise<Function|null>} Compiled render function or null if template not found
     * @throws {WrappedError} When template file cannot be read
     */
    async getTemplate(templateId, filepath) {
        await this.loadPartials();

        let source;
        try {
            source = await this.#fileSystem.readUtf8File(filepath);
        } catch (cause) {
            throw new WrappedError(`Unable to read template file ${ filepath }`, { cause });
        }

        if (!source) {
            return null;
        }

        return this.compileTemplate(templateId, source);
    }

    /**
     * Loads all partial templates from disk and compiles them for use in templates.
     *
     * @async
     * @throws {WrappedError} When partials directory cannot be read or files cannot be processed
     */
    async loadPartials() {
        const sources = [];
        const fs = this.#fileSystem;

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
                    // eslint-disable-next-line no-await-in-loop
                    await walkDirectory(dirpath, parts.concat(entry.name));
                } else if (entry.isFile()) {
                    const filepath = path.join(directory, entry.name);
                    const id = parts.concat(entry.name).join('/');

                    // eslint-disable-next-line no-await-in-loop
                    const source = await fs.readUtf8File(filepath);
                    sources.push({ id, source });
                }
            }
        }

        await walkDirectory(this.#partialsDirectory);

        this.partials.clear();

        for (const { id, source } of sources) {
            this.partials.set(id, this.compileTemplate(id, source));
        }
    }

    /**
     * Compiles template source into a render function.
     *
     * @param {string} templateId - Template identifier for error reporting
     * @param {string} utf8 - Template source code
     * @param {boolean} [includePartials=true] - Whether to include partials in compilation
     * @returns {Function} Compiled render function
     */
    compileTemplate(templateId, utf8, includePartials = true) {
        const tokens = tokenize(null, templateId, utf8);
        const tree = buildSyntaxTree(null, tokens);
        const partials = includePartials ? this.partials : new Map();
        return createRenderFunction(null, this.helpers, partials, tree);
    }

    /**
     * Loads custom template helpers from the specified directory.
     * Helper modules must export `name` and `helper` properties and cannot
     * be nested in the helpers directory.
     *
     * @async
     * @param {string} helpersDirectory - Path to directory containing helper modules
     * @throws {WrappedError} When helpers directory cannot be read or helper modules fail to load
     */
    async loadHelpers(helpersDirectory) {

        let entries;
        try {
            entries = await this.#fileSystem.readDirectory(helpersDirectory);
        } catch (cause) {
            throw new WrappedError(`Unable to read helpers directory ${ helpersDirectory }`, { cause });
        }

        for (const entry of entries) {
            if (entry.isFile()) {
                const filepath = path.join(helpersDirectory, entry.name);

                let name;
                let helper;
                try {
                    // ES module imports must be sequential to avoid race conditions
                    // eslint-disable-next-line no-await-in-loop
                    const mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
                    name = mod.name;
                    helper = mod.helper;
                } catch (cause) {
                    throw new WrappedError(`Unable to load template helper from ${ filepath }`, { cause });
                }

                assertNonEmptyString(name, 'A template helper file must export a `name`');
                assertFunction(helper, 'A template helper file must export a `helper`');
                this.helpers.set(name, helper);
            }
        }
    }
}
