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
import { middleware, registerMiddleware } from '../middleware/mod.js';
import { handlers, registerHandler } from '../request-handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../error-handlers/mod.js';
import * as fileSystem from '../lib/file-system.js';

import {
    isFunction,
    isNonEmptyString,
    assert,
    assertNonEmptyString
} from '../assertions/mod.js';

/**
 * @typedef {Object} ApplicationOptions
 * @property {string} currentWorkingDirectory - Absolute path to the current working directory
 * @property {string} [applicationDirectory] - Optional absolute path to the application directory. If not provided, will be derived from config file location during initialization.
 * @property {Object} [fileSystem] - Optional file system API for testing. Defaults to the standard file system implementation.
 */

/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * @typedef {Object} InitializeOptions
 * @property {AppRuntime} runtime - Runtime configuration indicating whether running as CLI command or server
 * @property {string} environment - Environment name (e.g., 'development', 'production')
 * @property {string} [configFilepath] - Optional absolute filepath to configuration file. If not provided, will be discovered from application directory.
 * @property {string} [secretsFilepath] - Optional absolute filepath to secrets file. If not provided, will be discovered from application directory.
 */

/**
 * Main application class responsible for initializing and managing the Kixx application lifecycle.
 *
 * The Application class coordinates the setup of core services (configuration, logging, datastore,
 * view service), discovers and loads plugins, and initializes the application context. Use the
 * initialize() method to set up the application, which returns a Context instance that provides
 * access to all application components.
 */
export default class Application {

    /**
     * Current environment name (e.g., 'development', 'production').
     * @type {string|null}
     */
    #environment = null;

    /**
     * Absolute path to the current working directory.
     * @type {string|null}
     */
    #currentWorkingDirectory = null;

    /**
     * Absolute path to the application directory. May be set during construction or derived
     * from config file location during initialization.
     * @type {string|null}
     */
    #applicationDirectory = null;

    /**
     * Absolute filepath to the configuration file, if explicitly provided during initialization.
     * @type {string|null}
     */
    #configFilepath = null;

    /**
     * Absolute filepath to the secrets file, if explicitly provided during initialization.
     * @type {string|null}
     */
    #secretsFilepath = null;

    /**
     * Application configuration manager instance.
     * @type {Config|null}
     */
    #config = null;

    /**
     * Application context instance providing access to registered services, collections, forms, views, and user roles.
     * @type {Context|null}
     */
    #context = null;

    /**
     * Routes store instance for loading virtual hosts and routes.
     * @type {RoutesStore|null}
     */
    #routesStore = null;

    /**
     * File system API instance for reading directories and files.
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Creates a new Application instance.
     * @param {ApplicationOptions} options - Application initialization options
     * @throws {AssertionError} When currentWorkingDirectory is not a non-empty string
     */
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

    /**
     * Gets the current working directory path.
     * @returns {string} Absolute path to the current working directory
     */
    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    /**
     * Gets the application directory path.
     * @returns {string|null} Absolute path to the application directory, or null if not yet determined
     */
    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    /**
     * Gets the application context instance.
     * @returns {Context|null} The application context instance, or null if not yet initialized
     */
    get context() {
        return this.#context;
    }

    /**
     * Initializes the application, loading configuration, creating core services, and discovering plugins.
     * This method performs the complete application bootstrap process, including:
     * - Loading configuration and secrets
     * - Creating logger, datastore, and view service
     * - Discovering and loading plugins
     * - Registering plugin components (collections, forms, views, user roles, middleware, handlers)
     * - Calling plugin register() and initialize() functions
     * @async
     * @param {InitializeOptions} options - Initialization options
     * @returns {Promise<Context>} The initialized application context
     * @throws {AssertionError} When environment is not a non-empty string
     * @throws {WrappedError} When configuration cannot be loaded
     * @throws {WrappedError} When a plugin register() or initialize() function throws an error
     */
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

    /**
     * Loads or reloads application configuration for the specified environment.
     * If a Config instance already exists, it will be updated in-place to allow hot reloading
     * without breaking references held by other components.
     * @async
     * @param {string} [environment] - Environment name. Defaults to the environment set during initialize().
     * @returns {Promise<Config>} The configuration manager instance
     * @throws {AssertionError} When environment is not set and no environment was provided
     * @throws {WrappedError} When configuration files cannot be loaded
     */
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

    /**
     * Creates a logger instance configured from the application configuration.
     * The logger will automatically update its settings when configuration changes, allowing
     * dynamic log level adjustments at runtime without application restarts.
     * @param {Config} config - Configuration manager instance
     * @returns {Logger} The configured logger instance
     */
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

    /**
     * Creates and loads a datastore instance using paths from the context.
     * @async
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @returns {Promise<Datastore>} The loaded datastore instance
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
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

    /**
     * Creates and initializes a view service instance using paths from the context.
     * @async
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @returns {Promise<ViewService>} The initialized view service instance
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
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

    /**
     * Discovers, loads, and initializes all plugins from the plugins directory and app plugin directory.
     * This method performs the complete plugin lifecycle:
     * 1. Discovers plugin directories
     * 2. Loads each plugin (discovering components)
     * 3. Registers plugin components (collections, forms, views, user roles, middleware, handlers)
     * 4. Calls each plugin's register() function (if present)
     * 5. Calls each plugin's initialize() function (if present)
     * @async
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     * @throws {WrappedError} When a plugin register() or initialize() function throws an error
     */
    async initializePlugins(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to initializePlugins()');

        const { paths } = context;

        const entries = await this.#fileSystem.readDirectory(paths.plugins_directory);

        const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(paths.plugins_directory, entry.name));

        // The app plugin is loaded last.
        const stats = await this.#fileSystem.getFileStats(paths.app_plugin_directory);
        if (stats && stats.isDirectory()) {
            directories.push(paths.app_plugin_directory);
        }

        const promises = directories.map((directory) => {
            const plugin = new Plugin(this.#fileSystem, directory);
            return plugin.load();
        });

        const plugins = await Promise.all(promises);

        for (const plugin of plugins) {
            this.registerCollectionsFromPlugin(context, plugin);
            this.registerViewsFromPlugin(context, plugin);
            this.registerFormsFromPlugin(context, plugin);
            this.registerUserRolesFromPlugin(context, plugin);
            this.registerMiddlewareFromPlugin(plugin);
        }

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

    /**
     * Registers all Collection instances from a plugin with the application context.
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @param {Plugin} plugin - Plugin instance containing Collection definitions
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
    registerCollectionsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerCollectionsFromPlugin()');

        // Iterate over the plugin.collections map.
        for (const [ key, obj ] of plugin.collections) {
            const { CollectionConstructor, schema } = obj;
            context.registerCollection(key, new CollectionConstructor(context, schema));
        }
    }

    /**
     * Registers all Form instances from a plugin with the application context.
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @param {Plugin} plugin - Plugin instance containing Form definitions
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
    registerFormsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerFormsFromPlugin()');

        // Iterate over the plugin.forms map.
        for (const [ key, obj ] of plugin.forms) {
            const { FormConstructor, schema } = obj;
            context.registerForm(key, new FormConstructor(context, schema));
        }
    }

    /**
     * Registers all View instances from a plugin with the application context.
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @param {Plugin} plugin - Plugin instance containing View definitions
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
    registerViewsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerViewsFromPlugin()');

        // Iterate over the plugin.views map.
        for (const [ key, obj ] of plugin.views) {
            const { ViewConstructor, schema } = obj;
            context.registerView(key, new ViewConstructor(context, schema));
        }
    }

    /**
     * Registers all user role definitions from a plugin with the application context.
     * @param {Context} [context] - Application context. Defaults to the instance context if not provided.
     * @param {Plugin} plugin - Plugin instance containing user role definitions
     * @throws {AssertionError} When context is not provided and instance context is not initialized
     */
    registerUserRolesFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerUserRolesFromPlugin()');

        // Iterate over the plugin.views map.
        for (const [ key, role ] of plugin.userRoles.roles) {
            context.registerUserRole(key, role);
        }
    }

    /**
     * Registers all middleware, request handlers, and error handlers from a plugin with the global registries.
     * @param {Plugin} plugin - Plugin instance containing middleware and handler functions
     */
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

    /**
     * Loads virtual hosts and routes from the routes directory.
     * @async
     * @returns {Promise<Array>} Array of virtual host instances
     * @throws {AssertionError} When routesStore is not initialized
     */
    async loadRoutes() {
        assert(this.#routesStore, 'The RoutesStore must me initialized');
        const vhosts = await this.#routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        return vhosts;
    }

    /**
     * Loads the latest configuration file, either from the provided filepath or by discovering
     * kixx-config.jsonc or kixx-config.json in the application directory.
     * @async
     * @param {string|null} filepath - Optional absolute filepath to configuration file. If not provided, will search application directory.
     * @returns {Promise<Object>} Configuration object parsed from JSON/JSONC file
     * @throws {WrappedError} When the specified config file does not exist
     * @throws {WrappedError} When kixx-config.jsonc or kixx-config.json cannot be found in the application directory
     */
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

    /**
     * Loads the latest secrets file, either from the provided filepath or by discovering
     * .secrets.jsonc or .secrets.json in the application directory.
     * @async
     * @param {string|null} filepath - Optional absolute filepath to secrets file. If not provided, will search application directory.
     * @returns {Promise<Object>} Secrets object parsed from JSON/JSONC file, or empty object if file not found
     */
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
