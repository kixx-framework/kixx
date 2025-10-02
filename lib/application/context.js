import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} server.name - Server name
 */

/**
 * Central registry for application services, collections, forms, and views.
 */
export default class Context {
    /**
     * Internal registry of named services
     * @private
     * @type {Map<string, any>}
     */
    #services = new Map();

    #userTypes = new Map();
    #collections = new Map();
    #forms = new Map();
    #views = new Map();

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
     * Registers a service instance under a unique name.
     * @param {string} name - Unique service identifier
     * @param {any} service - Service instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
    }

    /**
     * Retrieves a registered service by name.
     * @param {string} name - Service identifier to retrieve
     * @returns {any} The registered service instance
     * @throws {AssertionError} When service is not registered
     */
    getService(name) {
        if (!this.#services.has(name)) {
            throw new AssertionError(`The service "${ name }" is not registered`, null, this.getService);
        }
        return this.#services.get(name);
    }

    registerUserType(userType, UserConstructor) {
        assertNonEmptyString(userType, 'User type must be a non-empty string');
        this.#userTypes.set(userType, UserConstructor);
    }

    getUserType(userType) {
        if (!this.#userTypes.has(userType)) {
            throw new AssertionError(`The user type "${ userType }" is not registered`, null, this.getUserType);
        }
        return this.#userTypes.get(userType);
    }

    /**
     * Registers a collection instance under a unique name.
     * @param {string} name - Unique collection identifier
     * @param {any} collection - Collection instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
    }

    /**
     * Retrieves a registered collection by name.
     * @param {string} name - Collection identifier to retrieve
     * @returns {any} The registered collection instance
     * @throws {AssertionError} When collection is not registered
     */
    getCollection(name) {
        if (!this.#collections.has(name)) {
            throw new AssertionError(`The collection "${ name }" is not registered`, null, this.getCollection);
        }
        return this.#collections.get(name);
    }

    /**
     * Registers a form instance under a unique name.
     * @param {string} name - Unique form identifier
     * @param {any} form - Form instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerForm(name, form) {
        assertNonEmptyString(name, 'Form name must be a non-empty string');
        this.#forms.set(name, form);
    }

    /**
     * Retrieves a registered form by name.
     * @param {string} name - Form identifier to retrieve
     * @returns {any} The registered form instance
     * @throws {AssertionError} When form is not registered
     */
    getForm(name) {
        if (!this.#forms.has(name)) {
            throw new AssertionError(`The form "${ name }" is not registered`, null, this.getForm);
        }
        return this.#forms.get(name);
    }

    /**
     * Registers a view instance under a unique name.
     * @param {string} name - Unique view identifier
     * @param {any} view - View instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerView(name, view) {
        assertNonEmptyString(name, 'View name must be a non-empty string');
        this.#views.set(name, view);
    }

    /**
     * Retrieves a registered view by name.
     * @param {string} name - View identifier to retrieve
     * @returns {any} The registered view instance
     * @throws {AssertionError} When view is not registered
     */
    getView(name) {
        if (!this.#views.has(name)) {
            throw new AssertionError(`The view "${ name }" is not registered`, null, this.getView);
        }
        return this.#views.get(name);
    }
}
