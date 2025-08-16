import { EventEmitter } from 'node:events';
import { assertNonEmptyString, assertNotEqual } from '../assertions/mod.js';
import deepMerge from '../lib/deep-merge.js';

/**
 * @fileoverview Application configuration management with environment-specific overrides
 *
 * Provides a structured interface for loading, merging, and accessing application
 * configuration data with environment-specific overrides and separate secret management.
 */

/**
 * @typedef {Object} ConfigurationData
 * @property {string} [name] - Application name
 * @property {string} [procName] - Process name for the application
 * @property {Object.<string, Object>} [environments] - Environment-specific configuration overrides
 * @property {...Object} [namespace] - Additional configuration namespaces
 */

/**
 * @typedef {Object} SecretsData
 * @property {Object.<string, Object>} [environments] - Environment-specific secrets
 * @property {...Object} [namespace] - Secret values organized by namespace
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
     * The application directory path
     * @private
     * @type {string|null}
     */
    #applicationDirectory = null;

    /**
     * Creates a new Config instance with merged configuration and secrets
     *
     * @param {ConfigurationData} values - The merged configuration object
     * @param {SecretsData} secrets - The merged secrets object
     * @param {string} applicationDirectory - The application directory path
     */
    constructor(values, secrets, applicationDirectory) {
        super();
        this.#values = values || {};
        this.#secrets = secrets || {};
        this.#applicationDirectory = applicationDirectory;
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
        return this.#values.procName || 'kixxapp';
    }

    /**
     * Application directory path
     * @type {string}
     */
    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    /**
     * Retrieves configuration values for a specific namespace
     *
     * @param {string} namespace - The namespace to retrieve
     * @returns {Object} Deep copy of namespace configuration or empty object
     * @throws {Error} When namespace is empty or equals "environments"
     */
    getNamespace(namespace) {
        assertNonEmptyString(namespace, 'getNamespace() requires a non empty string for the namespace key');

        // Prevent access to internal "environments" key to maintain abstraction
        // This ensures consumers can't accidentally override environment-specific logic
        assertNotEqual('environments', namespace, 'getNamespace() cannot be called with "environments" as namespace key');

        const values = this.#values[namespace];
        if (values) {
            // Return deep copy to prevent external mutations from affecting internal state
            return structuredClone(values);
        }
        return {};
    }

    /**
     * Retrieves secrets for a specific namespace
     *
     * @param {string} namespace - The namespace to retrieve
     * @returns {Object} Deep copy of namespace secrets or empty object
     * @throws {Error} When namespace is empty or equals "environments"
     */
    getSecrets(namespace) {
        assertNonEmptyString(namespace, 'getSecrets() requires a non empty string for the namespace key');

        // Prevent access to internal "environments" key to maintain abstraction
        // This ensures consumers can't accidentally override environment-specific logic
        assertNotEqual('environments', namespace, 'getSecrets() cannot be called with "environments" as namespace key');

        const values = this.#secrets[namespace];
        if (values) {
            // Return deep copy to prevent external mutations from affecting internal state
            return structuredClone(values);
        }
        return {};
    }

    /**
     * Updates configuration with environment-specific overrides
     *
     * @param {string} environment - The environment name
     * @param {ConfigurationData} rootConfig - The root configuration object
     */
    updateConfig(environment, rootConfig) {
        const environmentConfig = rootConfig.environments?.[environment] || {};

        // Environment configs override root configs to allow per-environment customization
        // deepMerge preserves nested object structure unlike Object.assign which would
        // replace entire nested objects
        this.#values = deepMerge(rootConfig, environmentConfig);
        this.emit('update:config');
    }

    /**
     * Updates secrets with environment-specific overrides
     *
     * @param {string} environment - The environment name
     * @param {SecretsData} rootSecrets - The root secrets object
     */
    updateSecrets(environment, rootSecrets) {
        const environmentSecrets = rootSecrets.environments?.[environment] || {};

        // Environment secrets override root secrets to allow per-environment customization
        // deepMerge preserves nested object structure unlike Object.assign which would
        // replace entire nested objects
        this.#secrets = deepMerge(rootSecrets, environmentSecrets);
        this.emit('update:secrets');
    }

    /**
     * Creates a new Config instance with merged configuration and secrets
     *
     * @param {string} environment - The environment name
     * @param {ConfigurationData} [rootConfig] - The root configuration object
     * @param {SecretsData} [rootSecrets] - The root secrets object
     * @param {string|null} [applicationDirectory] - The application directory path
     * @returns {Config} New Config instance with merged data
     */
    static create(environment, rootConfig, rootSecrets, applicationDirectory) {
        rootConfig = rootConfig || {};
        rootSecrets = rootSecrets || {};

        // Extract environment-specific overrides
        const environmentConfig = rootConfig.environments?.[environment] || {};
        const environmentSecrets = rootSecrets.environments?.[environment] || {};

        // Merge configurations with environment overrides taking precedence
        // deepMerge handles nested objects properly, unlike Object.assign which would
        // replace entire nested objects and lose root-level properties
        const configs = deepMerge(rootConfig, environmentConfig);
        const secrets = deepMerge(rootSecrets, environmentSecrets);

        return new Config(configs, secrets, applicationDirectory);
    }
}
