import path from 'node:path';
import { AssertionError, WrappedError } from '../errors/mod.js';
import * as fileSystem from '../lib/file-system.js';
import { isFunction, isNonEmptyString } from '../assertions/mod.js';


export default class TemplateStore {

    #helpersDirectory = null;
    #partialsDirectory = null;
    #templatesDirectory = null;

    #fileSystem = null;

    constructor(options) {
        options = options || {};

        this.#helpersDirectory = options.helpersDirectory;
        this.#partialsDirectory = options.partialsDirectory;
        this.#templatesDirectory = options.templatesDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;
    }

    async getBaseTemplate(templateId) {
        const parts = templateId.split('/');
        const filepath = path.join(this.#templatesDirectory, ...parts);

        const source = await this.#fileSystem.readUtf8File(filepath);

        return { filename: templateId, source };
    }

    async loadPartialFiles() {
        const files = [];
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
                    const filename = parts.concat(entry.name).join('/');

                    // eslint-disable-next-line no-await-in-loop
                    const source = await fs.readUtf8File(filepath);
                    files.push({ filename, source });
                }
            }
        }

        await walkDirectory(this.#partialsDirectory);

        return files;
    }

    async loadHelperFiles() {
        let entries;
        try {
            entries = await this.#fileSystem.readDirectory(this.#helpersDirectory);
        } catch (cause) {
            throw new WrappedError(`Unable to read helpers directory ${ this.#helpersDirectory }`, { cause });
        }

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
