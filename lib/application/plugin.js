import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import urnPatternToRegexp from '../lib/urn-pattern-to-regexp.js';

import {
    isFunction,
    assertArray,
    assertFunction,
    assertNonEmptyString
} from '../assertions/mod.js';

const SCHEMA_FILE_PATTERN = /\.schema\.jsonc?$/i;
const JS_FILE_PATTERN = /\.m?js$/i;

export default class Plugin {

    #fileSystem = null;

    constructor(fileSystem, directory) {
        this.#fileSystem = fileSystem;

        this.name = path.basename(directory);
        this.directory = directory;

        this.usersDirectory = path.join(directory, 'users');
        this.collectionsDirectory = path.join(directory, 'collections');
        this.formsDirectory = path.join(directory, 'forms');
        this.viewsDirectory = path.join(directory, 'views');
        this.middlewareDirectory = path.join(directory, 'middleware');
        this.requestHandlerDirectory = path.join(directory, 'request-handlers');
        this.errorHandlerDirectory = path.join(directory, 'error-handlers');

        // The plugin module filepath can be set by
        // getPluginFilepath() and may be null.
        this.filepath = null;

        // Functions populated later during loadPlugins().
        this.register = null;
        this.initialize = null;

        this.collections = new Map();
        this.views = new Map();
        this.forms = new Map();
        this.users = null;

        this.middleware = new Map();
        this.requestHandlers = new Map();
        this.errorHandlers = new Map();
    }

    async load() {
        this.filepath = await this.getModuleFilepath();

        let mod;
        try {
            mod = await this.#fileSystem.importAbsoluteFilepath(this.filepath);
        } catch (cause) {
            throw new WrappedError(`Error loading plugin from ${ this.filepath }`, { cause });
        }

        this.register = isFunction(mod.register) ? mod.register : null;
        this.initialize = isFunction(mod.initialize) ? mod.initialize : null;

        this.collections = await this.loadCollections();
        this.views = await this.loadViews();
        this.forms = await this.loadForms();
        this.users = await this.loadUsers();

        this.middleware = await this.loadMiddlewareDirectory(this.middlewareDirectory);
        this.requestHandlers = await this.loadMiddlewareDirectory(this.requestHandlerDirectory);
        this.errorHandlers = await this.loadMiddlewareDirectory(this.errorHandlerDirectory);

        return this;
    }

    async getModuleFilepath() {
        const entries = await this.#fileSystem.readDirectory(this.directory);

        // Look for plugin.js, plugin.mjs, app.js, or app.mjs as entry point.
        const pluginFilePattern = /(plugin|app).(js|mjs)$/i;

        const pluginFile = entries.find((entry) => {
            return pluginFilePattern.test(entry.name) && entry.isFile();
        });

        if (pluginFile) {
            return path.join(this.directory, pluginFile.name);
        }

        return null;
    }

    async loadCollections() {
        const { collectionsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(collectionsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(collectionsDirectory, entry.name))
            .map(this.loadCollection.bind(this));

        const collections = await Promise.all(promises);

        const map = new Map();

        for (const CollectionConstructor of collections) {
            if (CollectionConstructor) {
                const key = `${ this.name }.${ CollectionConstructor.Model.name }`;
                map.set(key, CollectionConstructor);
            }
        }

        return map;
    }

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

            const CollectionConstructor = mod.default;
            assertFunction(CollectionConstructor, `Expected Collection class as default export from ${ filepath }`);
            assertFunction(CollectionConstructor.Model, `Expected Collection Model class member in ${ filepath }`);
            assertNonEmptyString(CollectionConstructor.Model.name, `Expected Collection TYPE class to have a name in ${ filepath }`);

            CollectionConstructor.schema = schema;

            return CollectionConstructor;
        }

        return null;
    }

    async loadForms() {
        const { formsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(formsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(formsDirectory, entry.name))
            .map(this.loadForm.bind(this));

        const forms = await Promise.all(promises);

        const map = new Map();

        for (const FormConstructor of forms) {
            if (FormConstructor) {
                const key = `${ this.name }.${ FormConstructor.name }`;
                map.set(key, FormConstructor);
            }
        }

        return map;
    }

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

            const FormConstructor = mod.default;
            assertFunction(FormConstructor, `Expected Form class as default export from ${ filepath }`);
            FormConstructor.schema = schema;
            return FormConstructor;
        }

        return null;
    }

    async loadViews() {
        const { viewsDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(viewsDirectory);

        const promises = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(viewsDirectory, entry.name))
            .map(this.loadView.bind(this));

        const views = await Promise.all(promises);

        const map = new Map();

        for (const ViewConstructor of views) {
            if (ViewConstructor) {
                const key = `${ this.name }.${ ViewConstructor.name }`;
                map.set(key, ViewConstructor);
            }
        }

        return map;
    }

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

            const ViewConstructor = mod.default;
            assertFunction(ViewConstructor, `Expected View class as default export from ${ filepath }`);
            ViewConstructor.schema = schema;
            return ViewConstructor;
        }

        return null;
    }

    async loadUsers() {
        const { usersDirectory } = this;
        const entries = await this.#fileSystem.readDirectory(usersDirectory);

        const roleFilePattern = /\.role\.jsonc?$/i;

        const promises = entries
            .filter((entry) => {
                return entry.isFile() && roleFilePattern.test(entry.name);
            })
            .map((entry) => {
                const filepath = path.join(usersDirectory, entry.name);
                return this.loadUserRole(filepath);
            });

        const rolesArray = await Promise.all(promises);

        const roles = new Map();

        for (const role of rolesArray) {
            roles.set(role.name, role);
        }

        return { roles };
    }

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

        role.permissions = role.permissions.map((urn) => {
            assertNonEmptyString(urn, `User role permissions must be a URN pattern string (${ filepath })`);
            const regex = urnPatternToRegexp(urn);
            return { urn, regex };
        });

        return role;
    }

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

    async loadMiddlewareFunction(filepath) {
        let mod;
        try {
            mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
        } catch (cause) {
            throw new WrappedError(`Error loading module from ${ filepath }`, { cause });
        }

        assertFunction(mod.default, `Middlware default export from ${ filepath } must be a function`);

        return mod.default;
    }
}
