import { EventEmitter } from 'node:events';
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
        this.#values = values || {};
        this.#secrets = secrets || {};
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
        const values = this.#values[namespace];
        if (values) {
            return structuredClone(values);
        }
        return {};
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
        const values = this.#secrets[namespace];
        if (values) {
            return structuredClone(values);
        }
        return {};
    }

    updateConfig(environment, rootConfig) {
        const environmentConfig = rootConfig.environments?.[environment] || {};
        // Merge with environment configs taking precedence over root configs
        // deepMerge handles nested objects properly, unlike Object.assign
        this.#values = deepMerge(rootConfig, environmentConfig);
        delete this.#values.environments;
    }

    updateSecrets(environment, rootSecrets) {
        const environmentSecrets = rootSecrets.environments?.[environment] || {};
        // Merge with environment secrets taking precedence over root secrets
        // deepMerge handles nested objects properly, unlike Object.assign
        this.#secrets = deepMerge(rootSecrets, environmentSecrets);
        delete this.#secrets.environments;
    }

    static create(environment, rootConfig, rootSecrets) {
        rootConfig = rootConfig || {};
        rootSecrets = rootSecrets || {};

        const environmentConfig = rootConfig.environments?.[environment] || {};
        const environmentSecrets = rootSecrets.environments?.[environment] || {};

        // Merge with environment configs taking precedence over root configs
        // deepMerge handles nested objects properly, unlike Object.assign
        const configs = deepMerge(rootConfig, environmentConfig);
        const secrets = deepMerge(rootSecrets, environmentSecrets);

        delete configs.environments;
        delete secrets.environments;

        return new Config(configs, secrets);
    }
}
