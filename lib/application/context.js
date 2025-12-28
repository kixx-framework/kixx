import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name] - Server name
 */

/**
 * The application context provides access to registered services, collections, forms, views, and
 * user roles. A Kixx application creates a single instance of the Context as a central registry
 * and dependency injection container for application components.
 */
export default class Context {

    #services = new Map();
    #collections = new Map();
    #forms = new Map();
    #views = new Map();
    #userRoles = new Map();

    /**
     * Initializes a new application context with runtime configuration and core services.
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Application runtime configuration
     * @param {Config} options.config - Application configuration object
     * @param {Paths} options.paths - Application directory and file paths
     * @param {Logger} options.logger - Application logger instance
     */
    constructor({ runtime, config, paths, logger }) {
        Object.defineProperties(this, {
            /**
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
            /**
             * @type {Config}
             */
            config: { value: config },
            /**
             * @type {Paths}
             */
            paths: { value: paths },
            /**
             * @type {Logger}
             */
            logger: { value: logger },
        });

        // The rootUser should be set by the application loader.
        this.rootUser = null;
    }

    /**
     * Retrieves a registered collection by name. Throws an AssertionError if
     * the collection is not registered.
     * @param {string} name
     * @returns {Collection}
     * @throws {AssertionError} When collection is not registered
     */
    getCollection(name) {
        if (!this.#collections.has(name)) {
            throw new AssertionError(
                `The collection "${ name }" is not registered`,
                null,
                this.getCollection
            );
        }
        return this.#collections.get(name);
    }

    /**
     * Retrieves a registered view by name. Throws an AssertionError if
     * the view is not registered.
     * @param {string} name
     * @returns {View}
     * @throws {AssertionError} When view is not registered
     */
    getView(name) {
        if (!this.#views.has(name)) {
            throw new AssertionError(
                `The view "${ name }" is not registered`,
                null,
                this.getView
            );
        }
        return this.#views.get(name);
    }

    /**
     * Retrieves a registered user role by name. Returns null if the user
     * role is not registered.
     * @param {string} name
     * @returns {UserRole|null}
     */
    getUserRole(name) {
        return this.#userRoles.get(name) || null;
    }

    /**
     * Retrieves a registered form by name. Throws an AssertionError if
     * the form is not registered.
     * @param {string} name
     * @returns {Form}
     * @throws {AssertionError} When form is not registered.
     */
    getForm(name) {
        if (!this.#forms.has(name)) {
            throw new AssertionError(
                `The form "${ name }" is not registered`,
                null,
                this.getForm
            );
        }
        return this.#forms.get(name);
    }

    /**
     * Retrieves a registered service by name. Throws an AssertionError if
     * the service is not registered.
     * @param {string} name
     * @returns {Object}
     * @throws {AssertionError} When service is not registered.
     */
    getService(name) {
        if (!this.#services.has(name)) {
            throw new AssertionError(
                `The service "${ name }" is not registered`,
                null,
                this.getService
            );
        }
        return this.#services.get(name);
    }

    /**
     * Registers a form instance with the context.
     * @private
     * @param {string} name - Form identifier
     * @param {Object} form - Form instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerForm(name, form) {
        assertNonEmptyString(name, 'Form name must be a non-empty string');
        this.#forms.set(name, form);
    }

    /**
     * Registers a view instance with the context.
     * @private
     * @param {string} name - View identifier
     * @param {Object} view - View instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerView(name, view) {
        assertNonEmptyString(name, 'View name must be a non-empty string');
        this.#views.set(name, view);
    }

    /**
     * Registers a service instance with the context.
     * @private
     * @param {string} name - Service identifier
     * @param {Object} service - Service instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
    }

    /**
     * Registers a collection instance with the context.
     * @private
     * @param {string} name - Collection identifier
     * @param {Object} collection - Collection instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
    }

    /**
     * Registers a user role instance with the context.
     * @private
     * @param {string} name - User role identifier
     * @param {Object} userRole - User role instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerUserRole(name, userRole) {
        assertNonEmptyString(name, 'User role name must be a non-empty string');
        this.#userRoles.set(name, userRole);
    }
}
