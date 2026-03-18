import EventEmitter from '../event-emitter.js';
import { assert, assertNonEmptyString } from '../assertions.js';

/**
 * Loads configuration and secrets from JSONC files on the local filesystem.
 *
 * This adapter is the Node.js implementation of the ConfigStore port used by
 * the default bootstrap path. It reads `kixx-config.jsonc` and `.secrets.jsonc`
 * via the injected filesystem adapter so the bootstrapper stays decoupled from
 * direct `node:fs` access.
 *
 * Missing or empty files resolve to empty objects so applications can start
 * with minimal configuration and add secrets only when needed.
 *
 * @see {import('../ports/config-store.js').ConfigStore} ConfigStore port
 * @emits NodeConfigStore#update:config - Emitted when configuration is loaded via loadConfig()
 * @emits NodeConfigStore#update:secrets - Emitted when secrets are loaded via loadSecrets()
 */
export default class NodeConfigStore {

    /** Event emitter for update:config and update:secrets */
    #emitter = new EventEmitter();

    /** Absolute path to the JSONC config file */
    #configFilepath = null;

    /** Absolute path to the JSONC secrets file */
    #secretsFilepath = null;

    /** Filesystem adapter used to read JSONC files */
    #fileSystem = null;

    /**
     * @param {Object} options
     * @param {string} options.configFilepath - Absolute path to the main config file
     * @param {string} options.secretsFilepath - Absolute path to the secrets file
     * @param {import('../ports/filesystem.js').Filesystem} options.fileSystem - Filesystem adapter used to read the files
     */
    constructor({ configFilepath, secretsFilepath, fileSystem }) {
        assertNonEmptyString(configFilepath, 'NodeConfigStore requires a configFilepath string');
        assertNonEmptyString(secretsFilepath, 'NodeConfigStore requires a secretsFilepath string');
        assert(fileSystem, 'NodeConfigStore requires a fileSystem adapter');

        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;
        this.#fileSystem = fileSystem;
    }

    /**
     * Registers a listener for update events.
     * @public
     * @param {string} eventName - Event name ('update:config' or 'update:secrets')
     * @param {function(Object): void} listener - Callback invoked with the loaded values
     * @returns {NodeConfigStore} This instance for chaining
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
        return this;
    }

    /**
     * Loads configuration from the configured JSONC file and emits update:config.
     * @public
     * @returns {Promise<Object>} Parsed configuration object, or {} when the file is missing or empty
     */
    async loadConfig() {
        const config = await this.#loadJSONFile(this.#configFilepath);
        this.#emitter.emit('update:config', config);
        return config;
    }

    /**
     * Loads secrets from the configured JSONC file and emits update:secrets.
     * @public
     * @returns {Promise<Object>} Parsed secrets object, or {} when the file is missing or empty
     */
    async loadSecrets() {
        const secrets = await this.#loadJSONFile(this.#secretsFilepath);
        this.#emitter.emit('update:secrets', secrets);
        return secrets;
    }

    async #loadJSONFile(filepath) {
        const values = await this.#fileSystem.readJSONFile(filepath);
        return values || {};
    }
}
