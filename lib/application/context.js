import { AssertionError, assertArray, assertNonEmptyString } from '../assertions/mod.js';
import urnPatternToRegexp from '../lib/urn-pattern-to-regexp.js';

/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * The application Context provides access to common application components as a central registry
 * and injection container. You can think of the application Context as a global singleton which
 * is passed into your middleware, request handlers, and command handlers. This allows you to
 * have access to global services, configs, logging, and collections directly from your
 * application or plugin.
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
     * The rootUser must be set with Context#setRootUser
     * @name rootUser
     * @type {User}
     * @public
     * @readonly
     */

    /**
     * The anonymous user with limited permission to perform operations in the app.
     * The anonymousUser must be set with Context#setAnonymousUser
     * @name anonymousUser
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
             * The top level Logger instance. Use it directly, or create a named child logger
             * with Logger#createChild(name)
             * @name logger
             * @readonly
             * @public
             * @type {Logger}
             */
            logger: { value: logger },
            /**
             * Application configuration manager containing namespaced environment-specific settings.
             * @name config
             * @readonly
             * @public
             * @type {Config}
             */
            config: { value: config },
            /**
             * Runtime configuration indicating whether the application is running as a CLI
             * command or server. This can be helpful to conditionally execute different
             * logic in your custom plugin based on the runtime being a server or
             * a command line invocation.
             * @name runtime
             * @readonly
             * @public
             * @type {AppRuntime}
             */
            runtime: { value: runtime },
            /**
             * Path configuration providing directory paths for routes, templates, plugins, etc.
             * @name paths
             * @readonly
             * @public
             * @type {Paths}
             */
            paths: { value: paths },
        });
    }

    /**
     * Get Collection instances registered by the application or plugins.
     * @public
     * @param {string} name - Collection identifier (e.g., 'app.User', 'app.Post')
     * @returns {Collection}
     * @throws {AssertionError} When the collection has not been registered
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
     * Get View instances registered by the application or plugins.
     * @public
     * @param {string} name - View identifier (e.g., 'app.UsersByEmail', 'PersonalizedHomePage')
     * @returns {View}
     * @throws {AssertionError} When the view has not been registered
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
     * Get Form instances registered by the application or plugins.
     * @public
     * @param {string} name - Form identifier
     * @returns {Form}
     * @throws {AssertionError} When the form has not been registered
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
     * Get a service registered by the application or plugins.
     * @public
     * @param {string} name - Service identifier (e.g., 'kixx.Datastore')
     * @returns {Object} The registered service API
     * @throws {AssertionError} When the service has not been registered
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
     * Retrieves a registered user role instance by name. The user management system uses this
     * method interinally, so unless you are customising user permission behavior, you
     * shouldn't need to use this method.
     * @param {string} name - User role identifier
     * @returns {UserRole|null} The registered user role instance, or null if not registered
     */
    getUserRole(name) {
        return this.#userRoles.get(name) || null;
    }

    /**
     * Registers a service instance for later retrieval by other coponents. Services must be
     * registered during the [application initialization](./kixx-application-initialization)
     * process in your plugin file.
     * @public
     * @param {string} name - Service identifier used for lookup via getService()
     * @param {Object} service - Service API to register
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        this.#services.set(name, service);
    }

    /**
     * Registers a Collection for later access from middleware and handlers. Since Collections
     * are automatically discovered during application initialization, there should be
     * no reason to manually register a Collection unless you are customizing the app or
     * plugin initialization process.
     * @public
     * @param {string} name - Collection identifier used for lookup via getCollection()
     * @param {Collection} collection
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        this.#collections.set(name, collection);
    }

    /**
     * Registers a View for later access from middleware and handlers. Since Views
     * are automatically discovered during application initialization, there should be
     * no reason to manually register a View unless you are customizing the app or
     * plugin initialization process.
     * @public
     * @param {string} name - View identifier used for lookup via getView()
     * @param {View} view
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerView(name, view) {
        assertNonEmptyString(name, 'View name must be a non-empty string');
        this.#views.set(name, view);
    }

    /**
     * Registers a Form for later access from middleware and handlers. Since Forms
     * are automatically discovered during [application initialization](./kixx-application-initialization),
     * there should be no reason to manually register a Form unless you are customizing
     * the app or plugin initialization process.
     *
     * If you plan to attach a schema to a form, it should be attached before
     * registering it here.
     *
     * @public
     * @param {string} name - Form identifier used for lookup via getForm()
     * @param {Form} form
     * @throws {AssertionError} When name is not a non-empty string
     */
    registerForm(name, form) {
        assertNonEmptyString(name, 'Form name must be a non-empty string');
        this.#forms.set(name, form);
    }

    /**
     * Registers a user role for later retrieval by the user management components. Since user
     * roles are automatically discovered during [application initialization](./kixx-application-initialization),
     * there should be no reason to manually register a user role unless you are customizing
     * the app or plugin initialization process.
     * @public
     * @param {string} name - User role identifier used for lookup via getUserRole()
     * @param {Object} userRole - User role to register
     * @throws {AssertionError} When name is not a non-empty string
     * @returns {Object} A new user role with permissions array.
     */
    registerUserRole(name, userRole) {
        assertNonEmptyString(name, 'User role name must be a non-empty string');
        assertArray(userRole.permissions, 'A user role must have a permissions array');

        // Return a new object representing the user role.
        const role = { name };

        role.permissions = userRole.permissions.map((urn) => {
            assertNonEmptyString(urn, 'User role permissions must be a URN pattern string');
            const regex = urnPatternToRegexp(urn);
            return { urn, regex };
        });

        this.#userRoles.set(name, role);

        return role;
    }

    /**
     * Sets the root user instance for the context, creating a read-only rootUser property.
     * Once set, you cannot reset the rootUser property.
     * @public
     * @param {User} user - Root user instance with elevated privileges
     * @throws {TypeError} When rootUser has already been set (operation cannot be repeated)
     */
    setRootUser(user) {
        Object.defineProperty(this, 'rootUser', {
            value: user,
        });
    }

    /**
     * Sets the anonymous user instance for the context, creating a read-only anonymousUser property.
     * Once set, you cannot reset the anonymousUser property.
     * @public
     * @param {User} user - Anonymous user instance with limited privileges
     * @throws {TypeError} When anonymousUser has already been set (operation cannot be repeated)
     */
    setAnonymousUser(user) {
        Object.defineProperty(this, 'anonymousUser', {
            value: user,
        });
    }
}
