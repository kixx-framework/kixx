import path from 'node:path';
import { EventEmitter } from 'node:events';
import { assertNonEmptyString } from '../assertions/mod.js';
import { readJSONFile } from '../lib/file-system.js';
import deepMerge from '../lib/deep-merge.js';

/**
 * @fileoverview Application configuration management with environment-specific overrides
 *
 * The Config class provides a structured interface for loading, merging, and accessing
 * application configuration data. It supports environment-specific overrides and
 * separate secret management through JSON files.
 */

/**
 * @typedef {Object} ConfigurationData
 * @property {string} [name] - Application name
 * @property {string} [procName] - Process name for the application
 * @property {Object} [environments] - Environment-specific configuration overrides
 * @property {...*} [namespace] - Additional configuration namespaces
 */

/**
 * @typedef {Object} SecretsData
 * @property {Object} [environments] - Environment-specific secrets
 * @property {...*} [namespace] - Secret values organized by namespace
 */

/**
 * Application configuration manager with environment-specific overrides and secret management.
 *
 * Loads configuration from JSON files, merging environment-specific overrides and
 * managing secrets separately from main configuration data. Extends EventEmitter
 * to support configuration change notifications.
 *
 * @extends EventEmitter
 *
 * @example
 * // Load configuration for production environment
 * const config = await Config.loadConfigs('/path/to/config.json', 'production');
 *
 * @example
 * // Access configuration namespaces and secrets
 * const dbConfig = config.getNamespace('database');
 * const dbSecrets = config.getSecrets('database');
 */
export default class Config extends EventEmitter {
    /**
     * Merged configuration values from root and environment-specific settings
     * @private
     * @type {ConfigurationData}
     */
    #values = {};

    /**
     * Merged secrets from root and environment-specific secret files
     * @private
     * @type {SecretsData}
     */
    #secrets = {};

    /**
     * Creates a new Config instance with merged configuration and secrets
     *
     * @param {ConfigurationData} values - The merged configuration object
     * @param {SecretsData} secrets - The merged secrets object
     */
    constructor(values, secrets) {
        super();
        this.#values = values;
        this.#secrets = secrets;
    }

    /**
     * Application name from configuration
     * @type {string}
     */
    get name() {
        return this.#values.name || 'Kixx Application';
    }

    /**
     * Process name for the application
     * @type {string}
     */
    get procName() {
        return this.#values.procName || 'kixx';
    }

    /**
     * Retrieves configuration values for a specific namespace
     *
     * @param {string} namespace - The configuration namespace to retrieve
     * @returns {Object} Configuration object for the namespace, empty object if namespace not found
     *
     * @example
     * // Get database configuration
     * const dbConfig = config.getNamespace('database');
     * // Returns: { host: 'localhost', port: 5432, ... }
     */
    getNamespace(namespace) {
        return this.#values[namespace] || {};
    }

    /**
     * Retrieves secret values for a specific namespace
     *
     * @param {string} namespace - The secrets namespace to retrieve
     * @returns {Object} Secrets object for the namespace, empty object if namespace not found
     *
     * @example
     * // Get database secrets
     * const dbSecrets = config.getSecrets('database');
     * // Returns: { password: 'secret123', apiKey: '...' }
     */
    getSecrets(namespace) {
        return this.#secrets[namespace] || {};
    }

    /**
     * Loads and merges configuration and secrets for the specified environment
     *
     * Reads the main configuration file and optional .secrets.json file from the same
     * directory. Environment-specific settings override root-level settings.
     *
     * @async
     * @param {string} filepath - Absolute or relative path to the main configuration JSON file
     * @param {string} environment - Environment name for configuration overrides (e.g., 'production', 'development')
     * @returns {Promise<Config>} Resolves to a configured Config instance
     * @throws {AssertionError} When filepath or environment is not a non-empty string
     * @throws {Error} When configuration file cannot be read or contains invalid JSON
     * @throws {Error} When configuration validation fails
     *
     * @example
     * // Load production configuration
     * const config = await Config.loadConfigs('./config.json', 'production');
     *
     * @example
     * // Load development configuration with secrets
     * const config = await Config.loadConfigs('/app/config/app.json', 'development');
     */
    static async loadConfigs(filepath, environment) {
        assertNonEmptyString(filepath, 'loadConfigs(); filepath is required');
        assertNonEmptyString(environment, 'loadConfigs(); environment is required');

        // Load and parse the main configuration file
        const configJSON = await readJSONFile(filepath);
        const rootConfig = configJSON || {};

        // Priority order: environment config overrides root config
        const environmentConfig = rootConfig.environments?.[environment] || {};

        // Remove environments object to prevent it from appearing in final merged config
        // This keeps the config clean and prevents accidental access to other environments
        delete rootConfig.environments;

        // Load secrets from conventional .secrets.json file in same directory
        // This separation keeps sensitive data out of main config files
        const rootDirectory = path.dirname(filepath);
        const secretsJSON = await readJSONFile(path.join(rootDirectory, '.secrets.json'));
        const rootSecrets = secretsJSON || {};

        // Environment-specific secrets take precedence over root-level secrets
        // This allows per-environment database passwords, API keys, etc.
        const environmentSecrets = rootSecrets.environments?.[environment] || {};

        // Remove environments object from secrets to keep final structure clean
        delete rootSecrets.environments;

        // Merge with environment configs taking precedence over root configs
        // deepMerge handles nested objects properly, unlike Object.assign
        const configs = deepMerge(rootConfig, environmentConfig);
        const secrets = deepMerge(rootSecrets, environmentSecrets);

        return new Config(configs, secrets);
    }
}
