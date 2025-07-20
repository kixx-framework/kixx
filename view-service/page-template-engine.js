import path from 'node:path';
import { assertNonEmptyString, assertFunction } from '../assertions/mod.js';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import * as fileSystem from '../lib/file-system.js';


/**
 * PageTemplateEngine
 * ==================
 *
 * The PageTemplateEngine is a high-level wrapper around the kixx-templating library,
 * providing dynamic template, partial, and helper loading for server-side rendering.
 *
 * It is designed to integrate with the Kixx.js view-service and supports:
 *   - Loading and compiling templates from disk using kixx-templating primitives
 *   - Dynamic registration of helpers (including custom helpers from a directory)
 *   - Dynamic registration of partials (recursively from a directory)
 *   - Safe, isolated template rendering with support for custom helpers and partials
 *
 * This engine uses the following kixx-templating APIs:
 *   - tokenize:    Converts template source to tokens
 *   - buildSyntaxTree: Builds a syntax tree from tokens
 *   - createRenderFunction: Compiles a render function from the syntax tree, helpers, and partials
 *   - helpers:     The default set of built-in helpers (Map)
 *
 * Template helpers must be ES modules exporting:
 *   - name:   string (the helper name)
 *   - helper: function (the helper implementation)
 *
 * Example usage:
 *   const engine = new PageTemplateEngine({ ... });
 *   const render = await engine.getTemplate('my-template.html');
 *   const html = render({ title: 'Hello' });
 */
export default class PageTemplateEngine {
    // Private fields for configuration and state
    #helpersDirectory = null;
    #partialsDirectory = null;
    #templatesDirectory = null;
    #fileSystem = null;

    #helpersLoaded = false;
    #helpersLoadedPromise = null;

    /**
     * Construct a new PageTemplateEngine.
     *
     * @param {Object} options
     * @param {string} options.helpersDirectory   - Directory containing helper modules
     * @param {string} options.partialsDirectory  - Directory containing partial templates
     * @param {string} options.templatesDirectory - Directory containing main templates
     * @param {Object} [options.fileSystem]       - Optional file system abstraction for testing
     */
    constructor(options) {
        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;
        this.#templatesDirectory = options.templatesDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        // Start with built-in helpers from kixx-templating, then add custom ones
        this.helpers = new Map(helpers);
        this.helpers.set('format_date', format_date);

        // Partials are loaded dynamically from disk
        this.partials = new Map();
    }

    /**
     * Load, compile, and return a render function for a template by ID.
     * Loads helpers and partials before compiling.
     *
     * @param {string} templateId - Template identifier (relative path)
     * @returns {Promise<Function|null>} - Compiled render function or null if not found
     */
    async getTemplate(templateId) {
        // TODO: Optimize template and partial loading for production.
        await this.loadHelpers();
        await this.loadPartials();

        const filepath = this.filepathForTemplate(templateId);
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return this.compileTemplate(templateId, source);
    }

    /**
     * Load, compile, and return a render function for a template at a specific filepath.
     * Loads helpers and partials before compiling.
     *
     * @param {string} templateId - Template identifier (used for error reporting)
     * @param {string} filepath   - Absolute path to the template file
     * @returns {Promise<Function|null>} - Compiled render function or null if not found
     */
    async getPageTemplate(templateId, filepath) {
        // TODO: Optimize template and partial loading for production.
        await this.loadHelpers();
        await this.loadPartials();

        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return this.compileTemplate(templateId, source);
    }

    /**
     * Dynamically load all helpers from the helpers directory.
     * Each helper module must export { name, helper }.
     * Ensures helpers are loaded only once (idempotent).
     *
     * @returns {Promise<void>}
     * @throws {WrappedError} If a helper cannot be loaded or is invalid
     */
    async loadHelpers() {
        if (this.#helpersLoaded) {
            return;
        }

        if (this.#helpersLoadedPromise) {
            return this.#helpersLoadedPromise;
        }

        const fs = this.#fileSystem;
        const helpersMap = this.helpers;
        const helpersDirectory = this.#helpersDirectory;

        const entries = await fs.readDirectory(helpersDirectory);

        const promises = entries.map(async (entry) => {
            const filepath = path.join(helpersDirectory, entry);
            const stats = await fs.getFileStats(filepath);

            if (stats.isFile()) {
                let mod;
                try {
                    mod = await fs.importAbsoluteFilepath(filepath);
                } catch (cause) {
                    throw new WrappedError(`Unable to load template helper from ${ filepath }`, { cause });
                }

                const { name, helper } = mod;

                assertNonEmptyString(name, 'A template helper file must export a `name`');
                assertFunction(helper, 'A template helper file must export a `helper`');

                helpersMap.set(name, helper);
            }
        });

        this.#helpersLoadedPromise = Promise.all(promises);
        await this.#helpersLoadedPromise;
        this.#helpersLoadedPromise = null;
        this.#helpersLoaded = true;
    }

    /**
     * Recursively load all partial templates from the partials directory.
     * Each partial is compiled and registered by its relative path.
     *
     * @returns {Promise<void>}
     */
    async loadPartials() {
        const sources = [];
        const fs = this.#fileSystem;

        // Recursively walk the partials directory and collect sources
        async function walkDirectory(directory, parts = []) {
            const filepaths = await fs.readDirectory(directory);

            for (const filepath of filepaths) {
                const filename = path.basename(filepath);
                // eslint-disable-next-line no-await-in-loop
                const stats = await fs.getFileStats(filepath);

                if (stats.isDirectory()) {
                    // eslint-disable-next-line no-await-in-loop
                    await walkDirectory(filepath, parts.concat(filename));
                } else {
                    const id = parts.concat(filename).join('/');
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
     * Compile a template source string into a render function using kixx-templating.
     *
     * @param {string} templateId - Template identifier (for error reporting)
     * @param {string} utf8       - Template source as UTF-8 string
     * @returns {Function}        - Compiled render function
     */
    compileTemplate(templateId, utf8) {
        const tokens = tokenize(null, templateId, utf8);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.helpers, this.partials, tree);
    }

    /**
     * Resolve a template ID to an absolute filepath within the templates directory.
     *
     * @param {string} templateId - Template identifier (relative path)
     * @returns {string}          - Absolute path to the template file
     */
    filepathForTemplate(templateId) {
        // Filtering out empty strings removes leading and trailing slashes.
        const idParts = templateId.split('/').filter(Boolean);
        return path.join(this.#templatesDirectory, ...idParts);
    }
}
