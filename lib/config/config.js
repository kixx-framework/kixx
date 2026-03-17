import { EventEmitter } from 'node:events';
import { assert, assertNonEmptyString } from '../assertions.js';
import deepMerge from '../utils/deep-merge.js';

/**
 * @typedef {Object} ConfigStore
 * @property {function(string, function(Object): void): ConfigStore} on - Registers a listener for 'update:config' or 'update:secrets'; returns this for chaining
 * @property {function(): Promise<Object>} loadConfig - Loads configuration and emits 'update:config' with the values
 * @property {function(): Promise<Object>} loadSecrets - Loads secrets and emits 'update:secrets' with the values
 */

/**
 * Application configuration manager with environment-specific overrides and secret management.
 *
 * Subscribes to a config store for updates, merging environment-specific overrides and
 * managing secrets separately from main configuration data. Emits update events when
 * configuration or secrets change so subscribers can react.
 *
 * @public
 * @emits Config#update:config - Emitted when configuration is updated (no payload; use getNamespace to read)
 * @emits Config#update:secrets - Emitted when secrets are updated (no payload; use getSecrets to read)
 */
export default class Config {

    /**
     * Merged configuration values from root and environment-specific settings.
     * The properties of this object form the namespaces
     * accessed by getNamespace(namespace).
     * @type {Object}
     */
    #values = {};

    /**
     * Merged secrets from root and environment-specific secrets. The
     * properties of this object form the namespaces
     * accessed by getSecrets(namespace).
     * @type {Object}
     */
    #secrets = {};

    /** Store that emits 'update:config' and 'update:secrets' when config files are loaded */
    #store = null;

    /** Event emitter for update:config and update:secrets */
    #emitter = new EventEmitter();

    /**
     * @param {ConfigStore} store - Config store with on(eventName, listener) that emits 'update:config' and 'update:secrets'
     * @param {string} environment - Environment name for config/secrets overrides (e.g., 'development', 'production')
     * @param {string} applicationDirectory - Absolute path to the application root directory
     * @throws {AssertionError} When store is falsy, or environment or applicationDirectory are not non-empty strings
     */
    constructor(store, environment, applicationDirectory) {
        assert(store, 'The Config requires a store');
        assertNonEmptyString(environment, 'The Config requires an environment');
        assertNonEmptyString(applicationDirectory, 'The Config requires an applicationDirectory');

        this.#store = store;

        this.#store.on('update:config', (values) => this.#updateConfig(values));
        this.#store.on('update:secrets', (values) => this.#updateSecrets(values));

        Object.defineProperties(this, {
            /**
             * Absolute path to the application root directory.
             * @name applicationDirectory
             * @type {string}
             */
            applicationDirectory: {
                enumerable: true,
                value: applicationDirectory,
            },
            /**
             * Environment name used to select overrides from config.environments[environment].
             * @name environment
             * @type {string}
             */
            environment: {
                enumerable: true,
                value: environment,
            },
        });
    }

    /**
     * Registers a listener for config or secrets update events.
     * @public
     * @param {string} eventName - Event name ('update:config' or 'update:secrets')
     * @param {function(): void} listener - Called when configuration or secrets are updated
     * @returns {Config} This instance for chaining
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
        return this;
    }

    /**
     * Application name from configuration
     * @public
     * @type {string}
     */
    get name() {
        return this.#values.name || 'KixxApp';
    }

    /**
     * Process name for the application
     * @public
     * @type {string}
     */
    get processName() {
        return this.#values.processName || 'kixxapp';
    }

    /**
     * Retrieves configuration values for a specific namespace.
     * @public
     * @param {string} namespace - The namespace to retrieve
     * @returns {Object} Deep copy of namespace configuration or empty object
     * @throws {AssertionError} When namespace is not a non-empty string
     */
    getNamespace(namespace) {
        assertNonEmptyString(namespace, 'getNamespace() requires a non-empty string for the namespace key');

        const values = this.#values[namespace];
        if (values) {
            // Return deep copy to prevent external mutations from affecting internal state
            return structuredClone(values);
        }
        return {};
    }

    /**
     * Retrieves secrets for a specific namespace.
     * @public
     * @param {string} namespace - The namespace to retrieve
     * @returns {Object} Deep copy of namespace secrets or empty object
     * @throws {AssertionError} When namespace is not a non-empty string
     */
    getSecrets(namespace) {
        assertNonEmptyString(namespace, 'getSecrets() requires a non-empty string for the namespace key');

        const values = this.#secrets[namespace];
        if (values) {
            // Return deep copy to prevent external mutations from affecting internal state
            return structuredClone(values);
        }
        return {};
    }

    /**
     * Merges root config with environment overrides and emits update.
     * @param {Object} rootConfig - Root configuration object with optional environments key
     */
    #updateConfig(rootConfig) {
        const environmentConfig = rootConfig?.environments?.[this.environment] || {};

        // Environment configs override root configs to allow per-environment customization
        // deepMerge preserves nested object structure unlike Object.assign which would
        // replace entire nested objects
        this.#values = deepMerge(structuredClone(rootConfig || {}), environmentConfig);

        // Remove the internal environments key to prevent accidental access and reduce memory
        delete this.#values.environments;

        this.#emitter.emit('update:config');
    }

    /**
     * Merges root secrets with environment overrides and emits update.
     * @param {Object} rootSecrets - Root secrets object with optional environments key
     */
    #updateSecrets(rootSecrets) {
        const environmentSecrets = rootSecrets?.environments?.[this.environment] || {};

        // Environment secrets override root secrets to allow per-environment customization
        // deepMerge preserves nested object structure unlike Object.assign which would
        // replace entire nested objects
        this.#secrets = deepMerge(structuredClone(rootSecrets || {}), environmentSecrets);

        // Remove the internal environments key to prevent accidental access and reduce memory
        delete this.#secrets.environments;

        this.#emitter.emit('update:secrets');
    }
}
