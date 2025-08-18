import path from 'node:path';
import { assertNonEmptyString, assertFunction } from '../assertions/mod.js';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import plus_one from './helpers/plus_one.js';
import * as fileSystem from '../lib/file-system.js';


export default class PageTemplateEngine {

    #helpersDirectory = null;
    #partialsDirectory = null;
    #templatesDirectory = null;
    #fileSystem = null;

    constructor(options) {
        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;
        this.#templatesDirectory = options.templatesDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        // Start with built-in helpers from kixx-templating, then add custom ones
        this.helpers = new Map(helpers);
        this.helpers.set('format_date', format_date);
        this.helpers.set('plus_one', plus_one);

        // Partials are loaded dynamically from disk and cached in this Map.
        this.partials = new Map();
    }

    async initialize() {
        await this.#loadHelpers();
    }

    async getTemplate(templateId) {
        await this.loadPartials();

        const filepath = this.filepathForTemplate(templateId);
        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return this.compileTemplate(templateId, source);
    }

    async createMetadataTemplate(templateId, source) {
        const includePartials = false;
        return this.compileTemplate(templateId, source, includePartials);
    }

    async getPageTemplate(templateId, filepath) {
        await this.loadPartials();

        const source = await this.#fileSystem.readUtf8File(filepath);

        if (!source) {
            return null;
        }

        return this.compileTemplate(templateId, source);
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
            const entries = await fs.readDirectory(directory);

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
     * Compiles a template source string into a render function using kixx-templating.
     *
     * This method tokenizes the provided UTF-8 template source, builds a syntax tree,
     * and returns a render function. Optionally, partials can be excluded
     * from the compilation process.
     *
     * @param {string} templateId - The identifier for the template (used for error reporting).
     * @param {string} utf8 - The template source as a UTF-8 encoded string.
     * @param {boolean} [includePartials=true] - Whether to include registered partials in the render function.
     * @returns {Function} The compiled render function for the template.
     */
    compileTemplate(templateId, utf8, includePartials = true) {
        const tokens = tokenize(null, templateId, utf8);
        const tree = buildSyntaxTree(null, tokens);
        const partials = includePartials ? this.partials : new Map();
        return createRenderFunction(null, this.helpers, partials, tree);
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

    async #loadHelpers() {

        let entries;
        try {
            entries = this.#fileSystem.readDirectory(this.#helpersDirectory);
        } catch (cause) {
            throw new WrappedError(`Unable to read helpers directory ${ this.#helpersDirectory }`, { cause });
        }

        for (const entry of entries) {
            if (entry.isFile()) {
                const filepath = path.join(this.#helpersDirectory, entry.name);

                let name;
                let helper;
                try {
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
