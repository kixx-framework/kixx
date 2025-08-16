import { assert } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} server.name - Server name
 */

/**
 * Central registry and accessor for core application services
 *
 * Manages lifecycle and access to core services and provides a consistent interface
 * for service retrieval throughout the application.
 */
export default class Context {
    /**
     * Internal registry of named services
     * @private
     * @type {Map<string, any>}
     */
    #services = new Map();

    runtime = null;
    config = null;
    paths = null;
    logger = null;

    /**
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Application runtime configuration
     * @param {Config} options.config - Application configuration object
     * @param {Paths} options.paths - Application directory and file paths
     * @param {Logger} options.logger - Application logger instance
     */
    constructor({ runtime, config, paths, logger }) {
        this.runtime = runtime;
        this.config = config;
        this.paths = paths;
        this.logger = logger;

        Object.freeze(this);
    }

    /**
     * Registers a service instance under a unique name
     *
     * @param {string} name - Unique service identifier
     * @param {any} service - Service instance to register
     */
    registerService(name, service) {
        this.#services.set(name, service);
    }

    /**
     * Retrieves a registered service by name
     *
     * @param {string} name - Service identifier to retrieve
     * @returns {any} The registered service instance
     * @throws {Error} When service is not registered
     */
    getService(name) {
        assert(this.#services.has(name), `The service "${ name }" is not registered`);
        return this.#services.get(name);
    }
}
