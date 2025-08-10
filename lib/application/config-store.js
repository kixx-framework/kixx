import path from 'node:path';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import { WrappedError, ValidationError } from '../errors/mod.js';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


export default class ConfigStore {

    #fs = null;

    constructor(options) {
        assertNonEmptyString(options.appDirectory);

        this.#fs = options.fileSystem || fileSystem;

        Object.defineProperties(this, {
            appDirectory: {
                enumerable: true,
                value: options.appDirectory,
            },
        });
    }

    async loadLatestConfigJSON(filepath) {
        let values;

        if (filepath) {
            assertNonEmptyString(filepath);
            values = await this.loadSpecifiedConfigFile(filepath);
            return values;
        }

        filepath = path.join(this.appDirectory, 'kixx-config.jsonc');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            return values;
        }

        filepath = path.join(this.appDirectory, 'kixx-config.json');
        values = await this.attemptReadJSONFile(filepath);

        if (!values) {
            throw new WrappedError(
                `Could not find kixx-config.jsonc or kixx-config.json in ${ this.appDirectory }`,
                { name: 'NotFoundError', code: 'ENOENT' }
            );
        }

        return values;
    }

    async loadLatestSecretsJSON(filepath) {
        let values;

        if (filepath) {
            assertNonEmptyString(filepath);
            values = await this.attemptReadJSONFile(filepath);
            return values || {};
        }

        filepath = path.join(this.appDirectory, '.secrets.jsonc');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            return values;
        }

        filepath = path.join(this.appDirectory, '.secrets.json');
        values = await this.attemptReadJSONFile(filepath);

        return values || {};
    }

    async loadSpecifiedConfigFile(filepath) {
        const values = this.attemptReadJSONFile(filepath);
        if (!values) {
            throw new WrappedError(
                `Specified config file does not exist ${ filepath }`,
                { name: 'NotFoundError', code: 'ENOENT' }
            );
        }
        return values;
    }

    async attemptReadJSONFile(filepath) {
        let json;
        try {
            json = await this.#fs.readUtf8File(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while reading config file at ${ filepath }`,
                { cause }
            );
        }

        if (!json) {
            return null;
        }

        const errors = [];

        const obj = jsonc.parse(json, errors, {
            disallowComments: false,
            allowTrailingComma: true,
            allowEmptyContent: true,
        });

        if (errors.length > 0) {
            const verror = new ValidationError(
                `JSON parsing errors in config file ${ filepath }`,
                { filepath }
            );

            for (const parseError of errors) {
                verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
            }

            throw verror;
        }

        return obj;
    }
}
