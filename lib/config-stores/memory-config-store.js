import EventEmitter from '../event-emitter.js';
import { assert } from '../assertions.js';

/**
 * Holds configuration and secrets from in-memory plain objects.
 *
 * Intended for use with statically imported JS modules, embedded configuration,
 * or test fixtures where config is already available in memory rather than on
 * disk. Emits update events when config or secrets are loaded so subscribers
 * (e.g. Config) can merge and apply values.
 *
 * @see {import('../ports/config-store.js').ConfigStore} ConfigStore port
 * @emits MemoryConfigStore#update:config - Emitted when configuration is loaded via loadConfig()
 * @emits MemoryConfigStore#update:secrets - Emitted when secrets are loaded via loadSecrets()
 */
export default class MemoryConfigStore {

    /** Event emitter for update:config and update:secrets */
    #emitter = new EventEmitter();

    /** Plain object holding application configuration */
    #config = null;

    /** Plain object holding application secrets */
    #secrets = null;

    /**
     * @param {Object} options - MemoryConfigStore initialization options
     * @param {Object} options.config - Plain object containing application configuration (required)
     * @param {Object} [options.secrets] - Plain object containing application secrets (optional, defaults to {})
     * @throws {AssertionError} When config is not provided
     */
    constructor(options) {
        const {
            config,
            secrets,
        } = options || {};

        assert(config, 'MemoryConfigStore config must be provided');

        this.#config = config;
        this.#secrets = secrets ?? {};
    }

    /**
     * Registers a listener for update events.
     * @public
     * @param {string} eventName - Event name ('update:config' or 'update:secrets')
     * @param {function(Object): void} listener - Callback invoked with loaded values
     * @returns {MemoryConfigStore} This instance for chaining
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
        return this;
    }

    /**
     * Emits the configuration object provided at construction.
     *
     * @public
     * @async
     * @returns {Promise<Object>} The configuration object
     */
    async loadConfig() {
        this.#emitter.emit('update:config', this.#config);
        return this.#config;
    }

    /**
     * Emits the secrets object provided at construction.
     *
     * Returns an empty object when no secrets were provided at construction,
     * allowing applications to run without secrets when all configuration is
     * non-sensitive.
     *
     * @public
     * @async
     * @returns {Promise<Object>} The secrets object, or empty object if none were provided
     */
    async loadSecrets() {
        this.#emitter.emit('update:secrets', this.#secrets);
        return this.#secrets;
    }
}
