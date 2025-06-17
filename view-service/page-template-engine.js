import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';
import format_date from './helpers/format_date.js';
import * as fileSystem from '../lib/file-system.js';


export default class PageTemplateEngine {

    #logger = null;
    #partialsDirectory = null;
    #fileSystem = null;

    constructor(options) {
        this.#logger = options.logger;
        this.#partialsDirectory = options.partialsDirectory;

        this.#fileSystem = options.fileSystem || fileSystem;

        this.verboseLogging = Boolean(options.verboseLogging);
        this.renderErrorMessages = Boolean(options.renderErrorMessages);

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
        const tokens = this.tokenizeTemplateSource(templateId, utf8);
        const tree = this.buildSyntaxTree(templateId, tokens);
        return this.createRenderFunction(templateId, tree);
    }

    tokenizeTemplateSource(templateId, utf8) {
        const { errors, tokens } = tokenize({}, templateId, utf8);

        if (errors && errors.length > 0) {
            if (this.verboseLogging) {
                for (const error of errors) {
                    this.#logger.warn('template parsing error', { templateId }, error);
                    // eslint-disable-next-line no-console
                    console.warn(error.toString());
                }
            }

            throw errors[0];
        }

        return tokens;
    }

    buildSyntaxTree(templateId, tokens) {
        const { errors, tree } = buildSyntaxTree({}, tokens);

        if (errors && errors.length > 0) {
            if (this.verboseLogging) {
                for (const error of errors) {
                    this.#logger.warn('template syntax error', { templateId }, error);
                    // eslint-disable-next-line no-console
                    console.warn(error.toString());
                }
            }

            throw errors[0];
        }

        return tree;
    }

    createRenderFunction(templateId, tree) {
        // Compile time errors will be returned here, but runtime errors will be
        // handled according to the options and passed to the error handler.
        const { errors, render } = createRenderFunction(
            { includeErrorMessages: this.renderErrorMessages },
            this.onRuntimeError.bind(this, templateId),
            this.partials,
            this.helpers,
            tree
        );

        if (errors && errors.length > 0) {
            if (this.verboseLogging) {
                for (const error of errors) {
                    this.#logger.warn('template create render function error', { templateId }, error);
                    // eslint-disable-next-line no-console
                    console.warn(error.toString());
                }
            }

            throw errors[0];
        }

        return render;
    }

    onRuntimeError(templateId, { error, lineError }) {
        if (this.verboseLogging) {
            this.#logger.error('template runtime error', { templateId }, error);
            // eslint-disable-next-line no-console
            console.error(lineError.toString());
        }

        throw lineError;
    }

    filepathForTemplate(directory, templateId) {
        // Filtering out empty strings removes leading and trailing slashes.
        const idParts = templateId.split('/').filter(Boolean);
        return path.join(directory, ...idParts);
    }
}
