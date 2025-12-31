import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * Central registry and dependency injection container for application components.
 *
 * Provides access to registered services, collections, forms, views, and user roles
 * throughout the application lifecycle. Use the getter methods (getCollection, getView,
 * etc.) to retrieve registered instances by name. Components are registered during
 * application initialization and plugin loading.
 *
 * @public
 */
export default class Context {

    /**
     * Internal map of registered services
     * @type {Map}
     */
    #services = new Map();

    /**
     * Internal map of registered collections
     * @type {Map}
     */
    #collections = new Map();

    /**
     * Internal map of registered forms
     * @type {Map}
     */
    #forms = new Map();

    /**
     * Internal map of registered views
     * @type {Map}
     */
    #views = new Map();

    /**
     * Internal map of registered user roles
     * @type {Map}
     */
    #userRoles = new Map();

    /**
     * The root user with permission to perform any operation in the app.
     * @name rootUser
     * @type {User}
     * @public
     * @readonly
     */

    /**
     * Creates a new application context instance with runtime configuration and core services.
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Runtime configuration indicating whether the application
     *   is running as a CLI command or server
     * @param {Config} options.config - Application configuration manager instance with environment-specific settings
     * @param {Paths} options.paths - Path manager instance providing directory paths for routes, templates, plugins, etc.
     * @param {Logger} options.logger - Logger instance for application logging
     */
    constructor({ runtime, config, paths, logger }) {
        Object.defineProperties(this, {
            /**
             * Runtime configuration indicating whether the application is running as a CLI command or server.
             * @name runtime
             * @readonly
             * @public
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
            /**
             * Application configuration manager instance with environment-specific settings.
             * @name config
             * @readonly
             * @public
             * @type {Config}
             */
            config: { value: config },
            /**
             * Path manager instance providing directory paths for routes, templates, plugins, etc.
             * @name paths
             * @readonly
             * @public
             * @type {Paths}
             */
            paths: { value: paths },
            /**
             * Logger instance for application logging.
             * @name logger
             * @readonly
             * @public
             * @type {Logger}
             */
            logger: { value: logger },
        });
    }

    /**
     * Retrieves a registered collection instance by name.
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection} The registered collection instance
     * @throws {AssertionError} When the collection is not registered in the context
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
     * Retrieves a registered view instance by name.
     * @public
     * @param {string} name - View identifier
     * @returns {View} The registered view instance
     * @throws {AssertionError} When the view is not registered in the context
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
     * Retrieves a registered form instance by name.
     * @public
     * @param {string} name - Form identifier
     * @returns {Form} The registered form instance
     * @throws {AssertionError} When the form is not registered in the context
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
     * Retrieves a registered service instance by name.
     * @public
     * @param {string} name - Service identifier (e.g., 'kixx.Datastore', 'kixx.AppViewService')
     * @returns {Object} The registered service instance
     * @throws {AssertionError} When the service is not registered in the context
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
     * Retrieves a registered user role instance by name.
     * @public
     * @param {string} name - User role identifier
     * @returns {UserRole|null} The registered user role instance, or null if not registered
     */
    getUserRole(name) {
        return this.#userRoles.get(name) || null;
    }

    /**
     * Sets the root user instance for the context, creating a read-only rootUser property.
     * @param {User} user - Root user instance with elevated privileges
     * @throws {TypeError} When rootUser has already been set (operation cannot be repeated)
     */
    setRootUser(user) {
        Object.defineProperty(this, 'rootUser', {
            value: user,
        });
    }

    /**
     * Registers a form instance in the context registry for later retrieval.
     * @param {string} name - Form identifier used for lookup via getForm()
     * @param {Object} form - Form instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerForm(name, form) {
        assertNonEmptyString(name, 'Form name must be a non-empty string');
        this.#forms.set(name, form);
    }

    /**
     * Registers a view instance in the context registry for later retrieval.
     * @param {string} name - View identifier used for lookup via getView()
     * @param {Object} view - View instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerView(name, view) {
        assertNonEmptyString(name, 'View name must be a non-empty string');
        this.#views.set(name, view);
    }

    /**
     * Registers a service instance in the context registry for later retrieval.
     * @param {string} name - Service identifier used for lookup via getService()
     * @param {Object} service - Service instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
    }

    /**
     * Registers a collection instance in the context registry for later retrieval.
     * @param {string} name - Collection identifier used for lookup via getCollection()
     * @param {Object} collection - Collection instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
    }

    /**
     * Registers a user role instance in the context registry for later retrieval.
     * @param {string} name - User role identifier used for lookup via getUserRole()
     * @param {Object} userRole - User role instance to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerUserRole(name, userRole) {
        assertNonEmptyString(name, 'User role name must be a non-empty string');
        this.#userRoles.set(name, userRole);
    }
}
