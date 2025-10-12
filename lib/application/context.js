import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @property {string} command - Command name when running as CLI
 * @property {Object} server - Server configuration when running as server
 * @property {string} server.name - Server name
 */

export default class Context {
    #services = new Map();

    #collections = new Map();
    #forms = new Map();
    #views = new Map();
    #userRoles = new Map();

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
        // The rootUser should be set by the application loader.
        this.rootUser = null;
    }

    /**
     * Retrieves a registered collection by name.
     * @param {string} name - Collection identifier to retrieve
     * @returns {Collection} The registered collection instance
     * @throws {AssertionError} When collection is not registered
     */
    getCollection(name) {
        if (!this.#collections.has(name)) {
            throw new AssertionError(`The collection "${ name }" is not registered`, null, this.getCollection);
        }
        return this.#collections.get(name);
    }

    /**
     * Retrieves a registered view by name.
     * @param {string} name - View identifier to retrieve
     * @returns {View} The registered view instance
     * @throws {AssertionError} When view is not registered
     */
    getView(name) {
        if (!this.#views.has(name)) {
            throw new AssertionError(`The view "${ name }" is not registered`, null, this.getView);
        }
        return this.#views.get(name);
    }

    /**
     * Retrieves a registered user role by name.
     * @param {string} name - User role identifier to retrieve
     * @returns {UserRole} The registered user role instance
     * @throws {AssertionError} When user role is not registered
     */
    getUserRole(name) {
        return this.#userRoles.get(name) || null;
    }

    /**
     * Retrieves a registered form by name.
     * @param {string} name - Form identifier to retrieve
     * @returns {Form} The registered form instance
     * @throws {AssertionError} When form is not registered
     */
    getForm(name) {
        if (!this.#forms.has(name)) {
            throw new AssertionError(`The form "${ name }" is not registered`, null, this.getForm);
        }
        return this.#forms.get(name);
    }

    /**
     * Retrieves a registered service by name.
     * @param {string} name - Service identifier to retrieve
     * @returns {object} The registered service instance
     * @throws {AssertionError} When service is not registered
     */
    getService(name) {
        if (!this.#services.has(name)) {
            throw new AssertionError(`The service "${ name }" is not registered`, null, this.getService);
        }
        return this.#services.get(name);
    }

    /**
     * @private
     */
    registerForm(name, form) {
        assertNonEmptyString(name, 'Form name must be a non-empty string');
        this.#forms.set(name, form);
    }

    /**
     * @private
     */
    registerView(name, view) {
        assertNonEmptyString(name, 'View name must be a non-empty string');
        this.#views.set(name, view);
    }

    /**
     * @private
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
    }

    /**
     * @private
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
    }

    /**
     * @private
     */
    registerUserRole(name, userRole) {
        assertNonEmptyString(name, 'User role name must be a non-empty string');
        this.#userRoles.set(name, userRole);
    }
}
