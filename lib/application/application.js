import path from 'node:path';
import Config from './config.js';
import Paths from './paths.js';
import Logger from '../logger/mod.js';
import Context from './context.js';
import Plugin from './plugin.js';
import RoutesStore from './routes-store.js';
import Datastore from '../datastore/datastore.js';
import ViewService from '../view-service/view-service.js';
import { WrappedError } from '../errors/mod.js';
import { middleware, registerMiddleware } from '../request-handlers/middleware/mod.js';
import { handlers, registerHandler } from '../request-handlers/handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../request-handlers/error-handlers/mod.js';
import * as fileSystem from '../lib/file-system.js';

import {
    isFunction,
    isNonEmptyString,
    assert,
    assertNonEmptyString
} from '../assertions/mod.js';


export default class Application {

    #environment = null;

    #currentWorkingDirectory = null;
    #applicationDirectory = null;
    #configFilepath = null;
    #secretsFilepath = null;

    #config = null;
    #context = null;
    #routesStore = null;

    #fileSystem = null;

    constructor(options) {
        const {
            currentWorkingDirectory,
            applicationDirectory,
        } = options;

        assertNonEmptyString(currentWorkingDirectory, 'An Application instance requires a currentWorkingDirectory path');
        this.#currentWorkingDirectory = currentWorkingDirectory;

        // Application directory can be derived during initialization from config filepath.
        // This allows for flexible deployment scenarios where the app directory is
        // determined by the config file location rather than constructor params.
        if (isNonEmptyString(applicationDirectory)) {
            this.#applicationDirectory = applicationDirectory;
        }

        // Allow the internal file system API to be overridden for testing.
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    get context() {
        return this.#context;
    }

    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        assertNonEmptyString(environment);

        // Cache the environment, config filepath, and secrets filepath so that
        // we can reload configs later without passing them in again.
        this.#environment = environment;
        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;

        // NOTE: Loading the configs may reset the #applicationDirectory based
        //       on the config file location.
        const config = await this.loadConfiguration();

        // We need the application directory to be set by the config loader
        // above, before creating the paths object.
        const paths = new Paths(this.#applicationDirectory);

        const logger = this.createLogger(config);

        this.#context = new Context({
            runtime,
            config,
            paths,
            logger,
        });

        this.#routesStore = new RoutesStore({
            app_directory: paths.app_directory,
            routes_directory: paths.routes_directory,
        });

        const viewService = await this.createAndInitializeViewService();
        const datastore = await this.createAndLoadDatastore();

        // Register services using kixx.* namespace convention
        this.#context.registerService('kixx.Datastore', datastore);
        this.#context.registerService('kixx.AppViewService', viewService);

        // The Root User will be created and attached to the context after
        // the plugin models are loaded, but before
        // plugins are initialized.
        await this.initializePlugins();

        return this.#context;
    }

    async loadConfiguration(environment) {
        environment = environment || this.#environment;
        assertNonEmptyString(environment, 'An environment must be set before loading the configuration');

        // The config and secrets filepath can be explicitly provided. If not
        // provided they will be derived by the Config Store.
        const configs = await this.loadLatestConfig(this.#configFilepath);
        const secrets = await this.loadLatestSecrets(this.#secretsFilepath);

        // Update existing config or create new one - allows for hot reloading
        // without losing existing config references held by other components
        if (this.#config) {
            this.#config.updateConfig(this.#environment, configs);
            this.#config.updateSecrets(this.#environment, secrets);
        } else {
            this.#config = Config.create(this.#environment, configs, secrets);
        }

        return this.#config;
    }

    createLogger(config) {
        const options = config.getNamespace('logger');

        const logger = new Logger({
            name: options.name || config.processName,
            level: options.level || 'debug',
            mode: options.mode || 'console',
        });

        // Enable dynamic reconfiguration to change log settings at runtime.
        // This allows adjusting log levels for debugging without
        // application restarts.
        config.on('change', () => {
            const newConfig = config.getNamespace('logger');

            // Only update properties that are explicitly set in new config.
            // This preserves existing values when config doesn't specify them.
            if (newConfig.level) {
                logger.level = newConfig.level;
            }
            if (newConfig.mode) {
                logger.mode = newConfig.mode;
            }
        });

        return logger;
    }

    async createAndLoadDatastore(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to createAndLoadDatastore()');
        const { paths } = context;

        const datastore = new Datastore({
            directory: paths.kv_store_directory,
        });

        await datastore.load();
        return datastore;
    }

    async createAndInitializeViewService(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to createAndInitializeViewService()');
        const { paths } = context;

        const viewService = new ViewService({
            pageDirectory: paths.pages_directory,
            templatesDirectory: paths.templates_directory,
            partialsDirectory: paths.partials_directory,
            helpersDirectory: paths.helpers_directory,
        });

        await viewService.initialize();
        return viewService;
    }

    async initializePlugins(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to initializePlugins()');

        const { paths } = context;

        const entries = await this.#fileSystem.readDirectory(paths.plugins_directory);

        const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(paths.plugins_directory, entry.name));

        // The app plugin is loaded last.
        directories.push(paths.app_plugin_directory);

        const promises = directories.map((directory) => {
            const plugin = new Plugin(this.#fileSystem, directory);
            return plugin.load();
        });

        const plugins = await Promise.all(promises);

        for (const plugin of plugins) {
            this.registerCollectionsFromPlugin(context, plugin);
            this.registerViewsFromPlugin(context, plugin);
            this.registerFormsFromPlugin(context, plugin);
            this.registerUsersFromPlugin(context, plugin);
            this.registerMiddlewareFromPlugin(plugin);
        }

        // Once the standard module definitions are available, then create the
        // Root User before the plugin registration and initialization phases.
        context.rootUser = this.createRootUser(context);

        for (const plugin of plugins) {
            const { filepath, register, initialize } = plugin;

            // Register phase: Plugins register their services
            if (isFunction(register)) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await register(context);
                } catch (cause) {
                    throw new WrappedError(`Error calling plugin register() from ${ filepath }`, { cause });
                }
            }

            // Initialize phase: Plugins can reference services and perform async setup after registration
            if (isFunction(initialize)) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await initialize(context);
                } catch (cause) {
                    throw new WrappedError(`Error calling plugin initialize() from ${ filepath }`, { cause });
                }
            }
        }
    }

    registerCollectionsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerCollectionsFromPlugin()');

        // Iterate over the plugin.collections map.
        for (const [ key, CollectionConstructor ] of plugin.collections) {
            const schema = CollectionConstructor.schema;
            const collection = new CollectionConstructor(context, schema);
            context.registerCollection(key, collection);
        }
    }

    registerFormsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerFormsFromPlugin()');

        // Iterate over the plugin.forms map.
        for (const [ key, FormConstructor ] of plugin.forms) {
            const schema = FormConstructor.schema;
            const form = new FormConstructor(context, schema);
            context.registerForm(key, form);
        }
    }

    registerViewsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerViewsFromPlugin()');

        // Iterate over the plugin.views map.
        for (const [ key, ViewConstructor ] of plugin.views) {
            const schema = ViewConstructor.schema;
            const view = new ViewConstructor(context, schema);
            context.registerView(key, view);
        }
    }

    registerUsersFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerUsersFromPlugin()');

        // Iterate over the plugin.views map.
        for (const [ key, role ] of plugin.users.roles) {
            context.registerUserRole(key, role);
        }
    }

    registerMiddlewareFromPlugin(plugin) {
        for (const [ key, fn ] of plugin.middleware) {
            registerMiddleware(key, fn);
        }

        for (const [ key, fn ] of plugin.requestHandlers) {
            registerHandler(key, fn);
        }

        for (const [ key, fn ] of plugin.errorHandlers) {
            registerErrorHandler(key, fn);
        }
    }

    createRootUser(context, collectionType = 'app.User') {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to createRootUser()');

        try {
            const collection = context.getCollection(collectionType);
            return collection.createRootUser();
        } catch (cause) {
            throw new WrappedError(
                `Unable to get to create the root user. Ensure the "${ collectionType }" collection has been defined.`,
                { cause },
                this.createRootUser
            );
        }
    }

    async loadRoutes() {
        assert(this.#routesStore, 'The RoutesStore must me initialized');
        const vhosts = await this.#routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        return vhosts;
    }

    async loadLatestConfig(filepath) {
        // Default to an empty object.
        let values = {};

        if (isNonEmptyString(filepath)) {
            values = await this.#fileSystem.readJSONFile(filepath);
            if (!values) {
                throw new WrappedError(`Specified config file does not exist: ${ filepath }`);
            }
            // Set application directory from the config file location if
            // the application directory is not already set
            if (!isNonEmptyString(this.#applicationDirectory)) {
                this.#applicationDirectory = path.dirname(filepath);
            }
            return values;
        }

        // Default the application directory to the current working directory if
        // the application directory is not set.
        if (!isNonEmptyString(this.#applicationDirectory)) {
            assertNonEmptyString(this.#currentWorkingDirectory);
            this.#applicationDirectory = this.#currentWorkingDirectory;
        }

        const entries = await this.#fileSystem.readDirectory(this.#applicationDirectory);

        // Accept both .json and .jsonc file extensions.
        const filePattern = /^kixx-config\.jsonc?$/;

        const file = entries.find((entry) => {
            return entry.isFile() && filePattern.test(entry.name);
        });

        if (file) {
            filepath = path.join(this.#applicationDirectory, file.name);
            values = await this.#fileSystem.readJSONFile(filepath);
        } else {
            throw new WrappedError(
                `Could not find kixx-config.jsonc or kixx-config.json in ${ this.#applicationDirectory }`,
                { name: 'NotFoundError', code: 'ENOENT' }
            );
        }

        return values;
    }

    async loadLatestSecrets(filepath) {
        // Default to an empty object.
        let values = {};

        if (isNonEmptyString(filepath)) {
            const result = await this.#fileSystem.readJSONFile(filepath);
            // Set application directory from the secrets file location if
            // the application directory is not already set
            if (!isNonEmptyString(this.#applicationDirectory)) {
                this.#applicationDirectory = path.dirname(filepath);
            }
            return result || values;
        }

        // Default the application directory to the current working directory if
        // the application directory is not set.
        if (!isNonEmptyString(this.#applicationDirectory)) {
            assertNonEmptyString(this.#currentWorkingDirectory);
            this.#applicationDirectory = this.#currentWorkingDirectory;
        }

        const entries = await this.#fileSystem.readDirectory(this.#applicationDirectory);

        // Accept both .json and .jsonc file extensions.
        const filePattern = /^\.secrets\.jsonc?$/;

        const file = entries.find((entry) => {
            return entry.isFile() && filePattern.test(entry.name);
        });

        if (file) {
            filepath = path.join(this.#applicationDirectory, file.name);
            values = await this.#fileSystem.readJSONFile(filepath);
        }

        return values;
    }
}
