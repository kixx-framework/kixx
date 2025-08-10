import { EventEmitter } from 'node:events';
import { assertNonEmptyString, assertNotEqual } from '../assertions/mod.js';
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

    getNamespace(namespace) {
        assertNonEmptyString(namespace, 'getNamespace() requires a non empty string for the namespace key');
        // We don't allow access to the "environments" key as a namespace
        // since that would violate the abstraction.
        assertNotEqual('environments', namespace, 'getNamespace() cannot be called with "environments" as namespace key');

        const values = this.#values[namespace];
        if (values) {
            return structuredClone(values);
        }
        return {};
    }

    getSecrets(namespace) {
        assertNonEmptyString(namespace, 'getSecrets() requires a non empty string for the namespace key');
        // We don't allow access to the "environments" key as a namespace
        // since that would violate the abstraction.
        assertNotEqual('environments', namespace, 'getSecrets() cannot be called with "environments" as namespace key');

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
        this.emit('update:config');
    }

    updateSecrets(environment, rootSecrets) {
        const environmentSecrets = rootSecrets.environments?.[environment] || {};
        // Merge with environment secrets taking precedence over root secrets
        // deepMerge handles nested objects properly, unlike Object.assign
        this.#secrets = deepMerge(rootSecrets, environmentSecrets);
        this.emit('update:secrets');
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

        return new Config(configs, secrets);
    }
}
