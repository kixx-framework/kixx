import path from 'node:path';
import { WrappedError, AssertionError } from '../errors/mod.js';

import {
    isFunction,
    assertArray,
    assertFunction,
    assertNonEmptyString
} from '../assertions/mod.js';

const SCHEMA_FILE_PATTERN = /\.schema\.jsonc?$/i;
const JS_FILE_PATTERN = /\.m?js$/i;

/**
 * @typedef {Object} CollectionDefinition
 * @property {string} name - The name of the Collection model class
 * @property {Function} CollectionConstructor - The Collection class constructor
 * @property {Object} schema - Schema object loaded from .schema.jsonc file, or empty object if none
 */

/**
 * @typedef {Object} FormDefinition
 * @property {string} name - The name of the Form class
 * @property {Function} FormConstructor - The Form class constructor
 * @property {Object} schema - Schema object loaded from .schema.jsonc file, or empty object if none
 */

/**
 * @typedef {Object} ViewDefinition
 * @property {string} name - The name of the View class
 * @property {Function} ViewConstructor - The View class constructor
 * @property {Object} schema - Schema object loaded from .schema.jsonc file, or empty object if none
 */

/**
 * @typedef {Object} UserRoleDefinition
 * @property {string} name - User role name
 * @property {Array<string>} permissions - Array of URN pattern strings defining permissions
 */

/**
 * Loads and manages plugin modules, discovering and loading collections, forms, views,
 * user roles, middleware, request handlers, and error handlers from a plugin directory.
 *
 * The Plugin class scans a directory structure for component definitions and loads them
 * into memory. It handles the plugin module entry point (plugin.js or app.js) and
 * discovers components following Kixx naming conventions.
 */
export default class Plugin {

    /**
     * File system API for reading directories and files.
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Creates a new Plugin instance for the given directory.
     * @param {Object} fileSystem - File system API instance for reading directories and files
     * @param {string} directory - Absolute path to the plugin directory
     */
    constructor(fileSystem, directory) {
        this.#fileSystem = fileSystem;

        /**
         * Plugin name derived from the directory basename.
         * @type {string}
         */
        this.name = path.basename(directory);

        /**
         * Absolute path to the plugin directory.
         * @type {string}
         */
        this.directory = directory;

        /**
         * Absolute path to the user-roles subdirectory.
         * @type {string}
         */
        this.userRolesDirectory = path.join(directory, 'user-roles');

        /**
         * Absolute path to the collections subdirectory.
         * @type {string}
         */
        this.collectionsDirectory = path.join(directory, 'collections');

        /**
         * Absolute path to the forms subdirectory.
         * @type {string}
         */
        this.formsDirectory = path.join(directory, 'forms');

        /**
         * Absolute path to the views subdirectory.
         * @type {string}
         */
        this.viewsDirectory = path.join(directory, 'views');

        /**
         * Absolute path to the middleware subdirectory.
         * @type {string}
         */
        this.middlewareDirectory = path.join(directory, 'middleware');

        /**
         * Absolute path to the request-handlers subdirectory.
         * @type {string}
         */
        this.requestHandlerDirectory = path.join(directory, 'request-handlers');

        /**
         * Absolute path to the error-handlers subdirectory.
         * @type {string}
         */
        this.errorHandlerDirectory = path.join(directory, 'error-handlers');

        /**
         * Absolute filepath to the plugin module entry point (plugin.js, plugin.mjs, app.js, or app.mjs).
         * Set to null if no entry point file is found. Populated during load().
         * @type {string|null}
         */
        this.filepath = null;

        /**
         * Optional register function exported from the plugin module.
         * Set to null if the module does not export a register function. Populated during load().
         * @type {Function|null}
         */
        this.register = null;

        /**
         * Optional initialize function exported from the plugin module.
         * Set to null if the module does not export an initialize function. Populated during load().
         * @type {Function|null}
         */
        this.initialize = null;

        /**
         * Map of loaded Collection definitions keyed by fully-qualified name (e.g., 'pluginName.CollectionName').
         * Populated during load().
         * @type {Map<string, CollectionDefinition>}
         */
        this.collections = new Map();

        /**
         * Map of loaded View definitions keyed by fully-qualified name (e.g., 'pluginName.ViewName').
         * Populated during load().
         * @type {Map<string, ViewDefinition>}
         */
        this.views = new Map();

        /**
         * Map of loaded Form definitions keyed by fully-qualified name (e.g., 'pluginName.FormName').
         * Populated during load().
         * @type {Map<string, FormDefinition>}
         */
        this.forms = new Map();

        /**
         * Map of loaded user role definitions keyed by role name.
         * Populated during load().
         * @type {Map<string, UserRoleDefinition>}
         */
        this.userRoles = new Map();

        /**
         * Map of loaded middleware factory functions keyed by fully-qualified name (e.g., 'pluginName.functionName').
         * Populated during load().
         * @type {Map<string, Function>}
         */
        this.middleware = new Map();

        /**
         * Map of loaded request handler factory functions keyed by fully-qualified name (e.g., 'pluginName.functionName').
         * Populated during load().
         * @type {Map<string, Function>}
         */
        this.requestHandlers = new Map();

        /**
         * Map of loaded error handler factory functions keyed by fully-qualified name (e.g., 'pluginName.functionName').
         * Populated during load().
         * @type {Map<string, Function>}
         */
        this.errorHandlers = new Map();
    }

    /**
     * Loads the plugin module and discovers all components (collections, forms, views, user roles,
     * middleware, request handlers, error handlers) from the plugin directory structure.
     * @async
     * @returns {Promise<Plugin>} This plugin instance
     * @throws {WrappedError} When the plugin module fails to load
     */
    async load() {
        this.filepath = await this.getModuleFilepath();

        let mod;
        if (this.filepath) {
            try {
                mod = await this.#fileSystem.importAbsoluteFilepath(this.filepath);
            } catch (cause) {
                throw new WrappedError(`Error loading plugin from ${ this.filepath }`, { cause });
            }
        }

        this.register = isFunction(mod?.register) ? mod.register : null;
        this.initialize = isFunction(mod?.initialize) ? mod.initialize : null;

        this.collections = await this.loadCollections();
        this.views = await this.loadViews();
        this.forms = await this.loadForms();
        this.userRoles = await this.loadUserRoles();

        this.middleware = await this.loadMiddlewareDirectory(this.middlewareDirectory);
        this.requestHandlers = await this.loadMiddlewareDirectory(this.requestHandlerDirectory);
        this.errorHandlers = await this.loadMiddlewareDirectory(this.errorHandlerDirectory);

        return this;
    }

    /**
     * Discovers the plugin module entry point file (plugin.js, plugin.mjs, app.js, or app.mjs)
     * in the plugin directory.
     * @async
     * @returns {Promise<string|null>} Absolute filepath to the plugin module, or null if not found
     */
    async getModuleFilepath() {
        const entries = await this.#fileSystem.readDirectory(this.directory);

        // Look for plugin.js, plugin.mjs, app.js, or app.mjs as entry point.
        const pluginFilePattern = /(plugin|app)\.(js|mjs)$/i;

        const pluginFile = entries.find((entry) => {
            return pluginFilePattern.test(entry.name) && entry.isFile();
        });

        if (pluginFile) {
            return path.join(this.directory, pluginFile.name);
        }

        return null;
    }

    /**
     * Discovers and loads all Collection definitions from the collections subdirectory.
     * @async
     * @returns {Promise<Map<string, CollectionDefinition>>} Map of Collection definitions keyed by fully-qualified name
     */
    async loadCollections() {
        const { collectionsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(collectionsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(collectionsDirectory, entry.name))
            .map(this.loadCollection.bind(this));

        const collections = await Promise.all(promises);

        const map = new Map();

        for (const obj of collections) {
            const key = `${ this.name }.${ obj.name }`;
            map.set(key, obj);
        }

        return map;
    }

    /**
     * Loads a single Collection definition from a directory, including the class and optional schema.
     * @async
     * @param {string} directory - Absolute path to the collection directory
     * @returns {Promise<CollectionDefinition>} Collection definition object
     * @throws {WrappedError} When schema or class file fails to load
     * @throws {AssertionError} When class file is missing or default export is not a valid Collection
     */
    async loadCollection(directory) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const schemaFile = entries.find((entry) => {
            return entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name);
        });

        const collectionFilePattern = /\.collection\.(js|mjs)$/i;

        const classFile = entries.find((entry) => {
            return entry.isFile() && collectionFilePattern.test(entry.name);
        });

        let schema = {};

        if (schemaFile) {
            const filepath = path.join(directory, schemaFile.name);
            try {
                schema = await this.#fileSystem.readJSONFile(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Collection model schema from ${ filepath }`,
                    { cause }
                );
            }
        }

        let CollectionConstructor;
        let name;

        if (classFile) {
            const filepath = path.join(directory, classFile.name);
            let mod;
            try {
                mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Collection class from ${ filepath }`,
                    { cause }
                );
            }

            CollectionConstructor = mod.default;
            assertFunction(CollectionConstructor, `Expected Collection class as default export from ${ filepath }`);

            if (!isFunction(CollectionConstructor.Model)) {
                throw new AssertionError(`Expected Collection.Model class property in ${ filepath }`);
            }

            name = CollectionConstructor.Model.name;
        } else {
            throw new AssertionError(`Expected Collection class definition file in ${ directory }`);
        }

        return { name, CollectionConstructor, schema };
    }

    /**
     * Discovers and loads all Form definitions from the forms subdirectory.
     * @async
     * @returns {Promise<Map<string, FormDefinition>>} Map of Form definitions keyed by fully-qualified name
     */
    async loadForms() {
        const { formsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(formsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(formsDirectory, entry.name))
            .map(this.loadForm.bind(this));

        const forms = await Promise.all(promises);

        const map = new Map();

        for (const obj of forms) {
            const key = `${ this.name }.${ obj.name }`;
            map.set(key, obj);
        }

        return map;
    }

    /**
     * Loads a single Form definition from a directory, including the class and optional schema.
     * @async
     * @param {string} directory - Absolute path to the form directory
     * @returns {Promise<FormDefinition>} Form definition object
     * @throws {WrappedError} When schema or class file fails to load
     * @throws {AssertionError} When class file is missing or default export is not a valid Form
     */
    async loadForm(directory) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const schemaFile = entries.find((entry) => {
            return entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name);
        });

        const formFilePattern = /\.form\.(js|mjs)$/i;

        const classFile = entries.find((entry) => {
            return entry.isFile() && formFilePattern.test(entry.name);
        });

        let schema = {};
        let FormConstructor;
        let name;

        if (schemaFile) {
            const filepath = path.join(directory, schemaFile.name);
            try {
                schema = await this.#fileSystem.readJSONFile(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Form schema from ${ filepath }`,
                    { cause }
                );
            }
        }

        if (classFile) {
            const filepath = path.join(directory, classFile.name);
            let mod;
            try {
                mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load Form class from ${ filepath }`,
                    { cause }
                );
            }

            FormConstructor = mod.default;
            assertFunction(FormConstructor, `Expected Form class as default export from ${ filepath }`);
            name = FormConstructor.name;
        } else {
            throw new AssertionError(`Expected Form class definition file in ${ directory }`);
        }

        return { name, FormConstructor, schema };
    }

    /**
     * Discovers and loads all View definitions from the views subdirectory.
     * @async
     * @returns {Promise<Map<string, ViewDefinition>>} Map of View definitions keyed by fully-qualified name
     */
    async loadViews() {
        const { viewsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(viewsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(viewsDirectory, entry.name))
            .map(this.loadView.bind(this));

        const views = await Promise.all(promises);

        const map = new Map();

        for (const obj of views) {
            const key = `${ this.name }.${ obj.name }`;
            map.set(key, obj);
        }

        return map;
    }

    /**
     * Loads a single View definition from a directory, including the class and optional schema.
     * @async
     * @param {string} directory - Absolute path to the view directory
     * @returns {Promise<ViewDefinition>} View definition object
     * @throws {WrappedError} When schema or class file fails to load
     * @throws {AssertionError} When class file is missing or default export is not a valid View
     */
    async loadView(directory) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const schemaFile = entries.find((entry) => {
            return entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name);
        });

        const viewFilePattern = /\.view\.(js|mjs)$/i;

        const classFile = entries.find((entry) => {
            return entry.isFile() && viewFilePattern.test(entry.name);
        });

        let schema = {};

        if (schemaFile) {
            const filepath = path.join(directory, schemaFile.name);
            try {
                schema = await this.#fileSystem.readJSONFile(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load View schema from ${ filepath }`,
                    { cause }
                );
            }
        }

        let ViewConstructor;
        let name;

        if (classFile) {
            const filepath = path.join(directory, classFile.name);
            let mod;
            try {
                mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
            } catch (cause) {
                throw new WrappedError(
                    `Unable to load View class from ${ filepath }`,
                    { cause }
                );
            }

            ViewConstructor = mod.default;
            assertFunction(ViewConstructor, `Expected View class as default export from ${ filepath }`);
            name = ViewConstructor.name;
        } else {
            throw new AssertionError(`Expected View class definition file in ${ directory }`);
        }

        return { name, ViewConstructor, schema };
    }

    /**
     * Discovers and loads all user role definitions from the user-roles subdirectory.
     * @async
     * @returns {Promise<Map<string, UserRoleDefinition>>} Map of user role definitions keyed by role name
     */
    async loadUserRoles() {
        const { userRolesDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(userRolesDirectory);

        const roleFilePattern = /\.jsonc?$/i;

        const promises = entries
            .filter((entry) => {
                return entry.isFile() && roleFilePattern.test(entry.name);
            })
            .map((entry) => {
                const filepath = path.join(userRolesDirectory, entry.name);
                return this.loadUserRole(filepath);
            });

        const rolesArray = await Promise.all(promises);

        const roles = new Map();

        for (const role of rolesArray) {
            roles.set(role.name, role);
        }

        return roles;
    }

    /**
     * Loads a single user role definition from a JSON/JSONC file.
     * @async
     * @param {string} filepath - Absolute filepath to the user role file
     * @returns {Promise<UserRoleDefinition>} User role definition object
     * @throws {WrappedError} When the JSON file fails to load or parse
     * @throws {AssertionError} When the role is missing required name or permissions properties
     */
    async loadUserRole(filepath) {
        let role;
        try {
            role = await this.#fileSystem.readJSONFile(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Unable to load user role from ${ filepath }`,
                { cause }
            );
        }

        assertNonEmptyString(role.name, `A user role must have a name (${ filepath })`);
        assertArray(role.permissions, `A user role must have a permissions array (${ filepath })`);

        return role;
    }

    /**
     * Discovers and loads all middleware/handler functions from a directory.
     * @async
     * @param {string} directory - Absolute path to the directory containing middleware/handler files
     * @returns {Promise<Map<string, Function>>} Map of functions keyed by fully-qualified name
     */
    async loadMiddlewareDirectory(directory) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const promises = entries
            .filter((entry) => entry.isFile() && JS_FILE_PATTERN.test(entry.name))
            .map((entry) => {
                const filepath = path.join(directory, entry.name);
                return this.loadMiddlewareFunction(filepath);
            });

        const functions = await Promise.all(promises);

        const map = new Map();

        for (const fn of functions) {
            const key = `${ this.name }.${ fn.name }`;
            map.set(key, fn);
        }

        return map;
    }

    /**
     * Loads a single middleware/handler function from a JavaScript module file.
     * @async
     * @param {string} filepath - Absolute filepath to the module file
     * @returns {Promise<Function>} The default export function from the module
     * @throws {WrappedError} When the module fails to load
     * @throws {AssertionError} When the default export is not a named function
     */
    async loadMiddlewareFunction(filepath) {
        let mod;
        try {
            mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
        } catch (cause) {
            throw new WrappedError(`Error loading module from ${ filepath }`, { cause });
        }

        assertFunction(mod.default, `Middleware default export from ${ filepath } must be a function`);
        assertNonEmptyString(mod.default.name, `Middleware default export from ${ filepath } must be a named function`);

        return mod.default;
    }
}
