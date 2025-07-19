import path from 'node:path';
import { assertNonEmptyString, assertFunction } from '../assertions/mod.js';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import * as fileSystem from '../lib/file-system.js';


export default class PageTemplateEngine {

    #helpersDirectory = null;
    #partialsDirectory = null;
    #templatesDirectory = null;
    #fileSystem = null;

    #helpersLoaded = false;
    #helpersLoadedPromise = null;

    constructor(options) {
        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;
        this.#templatesDirectory = options.templatesDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        this.helpers = new Map(helpers);
        this.helpers.set('format_date', format_date);

        this.partials = new Map();
    }

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

    async loadPartials() {
        const sources = [];
        const fs = this.#fileSystem;

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

    compileTemplate(templateId, utf8) {
        const tokens = tokenize(null, templateId, utf8);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.helpers, this.partials, tree);
    }

    filepathForTemplate(templateId) {
        // Filtering out empty strings removes leading and trailing slashes.
        const idParts = templateId.split('/').filter(Boolean);
        return path.join(this.#templatesDirectory, ...idParts);
    }
}
