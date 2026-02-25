import { EventEmitter } from 'node:events';
import { assert, assertNonEmptyString } from '../assertions.js';
import { WrappedError } from '../errors.js';

/**
 * File system adapter required by LocalJSONConfigStore (inverted dependency).
 * Implement this interface to supply file I/O so the store can be tested or
 * backed by alternate storage.
 *
 * @typedef {Object} FileSystem
 * @property {function(string): Promise<Object|null|undefined>} readJSONFile - Reads and parses a JSON/JSONC file at the given path. Resolves to the parsed object, or null/undefined when the file does not exist.
 */

/**
 * Reads configuration and secrets from local JSON/JSONC files on disk.
 *
 * Uses separate files for configuration and secrets so that secrets can be
 * excluded from version control. Pass a custom FileSystem adapter to support
 * testing or alternate storage backends. Emits update events when config or
 * secrets are loaded so subscribers (e.g. Config) can merge and apply values.
 *
 * @emits LocalConfigStore#update:config - Emitted when configuration is loaded via loadLatestConfig()
 * @emits LocalConfigStore#update:secrets - Emitted when secrets are loaded via loadLatestSecrets()
 */
export default class LocalJSONConfigStore {

    /** Event emitter for update:config and update:secrets */
    #emitter = new EventEmitter();

    /** Path to the main configuration JSON/JSONC file */
    #configFilepath = null;

    /** Path to the secrets JSON/JSONC file */
    #secretsFilepath = null;

    /** @type {LocalJSONConfigStoreFileSystem|null} */
    #fileSystem = null;

    /**
     * @param {Object} options - LocalConfigStore initialization options
     * @param {string} options.configFilepath - Path to the main configuration JSON/JSONC file
     * @param {string} options.secretsFilepath - Path to the secrets JSON/JSONC file
     * @param {FileSystem} options.fileSystem - File system adapter implementing readJSONFile.
     *   Override for testing or custom storage.
     * @throws {AssertionError} When configFilepath or secretsFilepath is not a non-empty string
     */
    constructor(options) {
        const {
            configFilepath,
            secretsFilepath,
            fileSystem,
        } = options || {};

        assertNonEmptyString(configFilepath, 'LocalConfigStore configFilepath must be a non-empty string');
        assertNonEmptyString(secretsFilepath, 'LocalConfigStore secretsFilepath must be a non-empty string');
        assert(fileSystem, 'LocalConfigStore fileSystem must be provided');

        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;

        // Use provided adapter or fall back to default; enables dependency injection
        // for tests and alternate storage backends
        this.#fileSystem = fileSystem;
    }

    /**
     * Registers a listener for update events.
     * @public
     * @param {string} eventName - Event name ('update:config' or 'update:secrets')
     * @param {function(Object): void} listener - Callback invoked with loaded values
     * @returns {LocalConfigStore} This instance for chaining
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
        return this;
    }

    /**
     * Loads and parses the configuration file from disk.
     *
     * @public
     * @async
     * @returns {Promise<Object>} Parsed configuration object
     * @throws {WrappedError} When config file does not exist or cannot be found
     * @throws {ValidationError} When config file contains invalid JSON/JSONC syntax
     */
    async loadConfig() {
        const values = await this.#fileSystem.readJSONFile(this.#configFilepath);

        if (!values) {
            throw new WrappedError(`Config file does not exist: ${ this.#configFilepath }`);
        }

        this.#emitter.emit('update:config', values);
        return values;
    }

    /**
     * Loads and parses the secrets file from disk.
     *
     * Returns an empty object when the file does not exist, allowing applications
     * to run without a secrets file when all configuration is non-sensitive.
     *
     * @public
     * @async
     * @returns {Promise<Object>} Parsed secrets object, or empty object if file not found
     * @throws {ValidationError} When secrets file exists but contains invalid JSON/JSONC syntax
     */
    async loadSecrets() {
        const values = await this.#fileSystem.readJSONFile(this.#secretsFilepath);
        const merged = values ?? {};

        this.#emitter.emit('update:secrets', merged);
        return merged;
    }
}
