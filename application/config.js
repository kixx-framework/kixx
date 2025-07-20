import path from 'node:path';
import { EventEmitter } from 'node:events';
import { assertNonEmptyString } from '../assertions/mod.js';
import { readJSONFile } from '../lib/file-system.js';
import deepMerge from '../lib/deep-merge.js';


/**
 * Config
 * ======
 *
 * The Config class provides a structured interface for application configuration,
 * supporting environment-specific overrides and secret management. It extends
 * EventEmitter to allow for configuration change notifications if needed.
 *
 * Core Features:
 *   - Loads and merges configuration from a JSON file, supporting per-environment overrides.
 *   - Loads secrets from a separate `.secrets.json` file, also supporting per-environment secrets.
 *   - Provides accessors for application name, process name, namespaces, and secrets.
 *   - Validates configuration spec before instantiation.
 *
 * Usage Example:
 *   const config = await Config.loadConfigs('/path/to/config.json', 'production');
 *   const dbConfig = config.getNamespace('database');
 *   const dbSecrets = config.getSecrets('database');
 */
export default class Config extends EventEmitter {
    /**
     * @private
     * @type {Object}
     * Stores the merged configuration values.
     */
    #values = {};

    /**
     * Construct a new Config instance.
     *
     * @param {Object} values - The merged configuration object.
     */
    constructor(values) {
        super();
        this.#values = values;
        this.#values.secrets = values.secrets || {};
    }

    /**
     * The application name.
     * @returns {string}
     */
    get name() {
        return this.#values.name || 'Kixx Application';
    }

    /**
     * The process name for the application.
     * @returns {string}
     */
    get procName() {
        return this.#values.procName || 'kixx';
    }

    /**
     * Retrieves a configuration namespace object.
     *
     * @param {string} namespace - The namespace to retrieve.
     * @returns {Object} The configuration object for the namespace, or an empty object if not found.
     */
    getNamespace(namespace) {
        return this.#values[namespace] || {};
    }

    /**
     * Retrieves secrets for a given namespace.
     *
     * @param {string} namespace - The namespace for which to retrieve secrets.
     * @returns {Object} The secrets object for the namespace, or an empty object if not found.
     */
    getSecrets(namespace) {
        return this.#values.secrets[namespace] || {};
    }

    /**
     * Loads and merges configuration and secrets for a given environment.
     *
     * @param {string} filepath - Path to the main configuration JSON file.
     * @param {string} environment - The environment name (e.g., 'production', 'development').
     * @returns {Promise<Config>} A promise that resolves to a Config instance.
     * @throws {AssertionError} If filepath or environment is not a non-empty string.
     */
    static async loadConfigs(filepath, environment) {
        assertNonEmptyString(filepath, 'loadConfigs(); filepath is required');
        assertNonEmptyString(environment, 'loadConfigs(); environment is required');

        const json = await readJSONFile(filepath);
        const rootConfig = json || {};

        // Extract environment-specific config, if present.
        const environmentConfig = rootConfig.environments?.[environment] || {};

        // Remove environments property from root config to avoid merging it.
        delete rootConfig.environments;

        // Load secrets from .secrets.json in the same directory.
        const rootDirectory = path.dirname(filepath);
        const rootSecrets = await readJSONFile(path.join(rootDirectory, '.secrets.json'));
        // Prefer environment-specific secrets, fallback to root secrets object.
        const secrets = rootSecrets?.[environment] || rootSecrets || {};

        if (rootSecrets) {
            delete rootSecrets.environments;
        }

        // Merge root config, environment config, and secrets.
        const spec = deepMerge(rootConfig, environmentConfig, { secrets });

        this.validateSpec(spec);

        return new Config(spec);
    }

    /**
     * Validates the configuration spec.
     * (No-op by default; override to implement validation logic.)
     *
     * @param {Object} spec - The configuration spec to validate.
     */
    static validateSpec(/* spec */) {
        // No-op: implement validation logic as needed.
    }
}
