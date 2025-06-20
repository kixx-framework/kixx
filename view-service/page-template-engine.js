import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import * as fileSystem from '../lib/file-system.js';


export default class PageTemplateEngine {

    #partialsDirectory = null;
    #fileSystem = null;

    constructor(options) {
        this.#partialsDirectory = options.partialsDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        this.helpers = new Map(helpers);
        this.helpers.set('format_date', format_date);

        this.partials = new Map();
    }

    async loadPartials() {
        const fileNames = await this.#fileSystem.readDirectory(this.#partialsDirectory);

        const promises = fileNames.map((filename) => {
            const filepath = path.join(this.#partialsDirectory, filename);

            return this.#fileSystem.readUtf8File(filepath).then((source) => {
                return { id: filename, source };
            }).catch((cause) => {
                throw new WrappedError(`Unable to read partial file ${ filepath }`, { cause });
            });
        });

        const sourceFiles = await Promise.all(promises);

        this.partials.clear();
        for (const { id, source } of sourceFiles) {
            this.partials.set(id, this.compileTemplate(id, source));
        }
    }

    compileTemplate(templateId, utf8) {
        const tokens = tokenize(null, templateId, utf8);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.helpers, this.partials, tree);
    }

    filepathForTemplate(directory, templateId) {
        // Filtering out empty strings removes leading and trailing slashes.
        const idParts = templateId.split('/').filter(Boolean);
        return path.join(directory, ...idParts);
    }
}
