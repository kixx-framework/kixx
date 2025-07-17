import path from 'node:path';
import { EventEmitter } from 'node:events';
import { assertNonEmptyString } from '../assertions/mod.js';
import { readJSONFile } from '../lib/file-system.js';
import deepMerge from '../lib/deep-merge.js';


export default class Config extends EventEmitter {

    #values = {};

    constructor(values) {
        super();
        this.#values = values;
        this.#values.secrets = values.secrets || {};
    }

    get name() {
        return this.#values.name || 'Kixx Application';
    }

    get procName() {
        return this.#values.procName || 'kixx';
    }

    getNamespace(namespace) {
        return this.#values[namespace] || {};
    }

    getSecrets(namespace) {
        return this.#values.secrets[namespace] || {};
    }

    static async loadConfigs(filepath, environment) {
        assertNonEmptyString(filepath, 'loadConfigs(); filepath is required');
        assertNonEmptyString(environment, 'loadConfigs(); environment is required');

        const json = await readJSONFile(filepath);
        const rootConfig = json || {};

        const environmentConfig = rootConfig.environments?.[environment] || {};

        delete rootConfig.environments;

        const rootDirectory = path.dirname(filepath);
        const rootSecrets = await readJSONFile(path.join(rootDirectory, '.secrets.json'));
        const secrets = rootSecrets?.[environment] || rootSecrets || {};

        if (rootSecrets) {
            delete rootSecrets.environments;
        }

        const spec = deepMerge(rootConfig, environmentConfig, { secrets });

        this.validateSpec(spec);

        return new Config(spec);
    }

    static validateSpec() {
    }
}
