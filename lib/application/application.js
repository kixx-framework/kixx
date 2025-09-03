import path from 'node:path';
import ConfigStore from './config-store.js';
import Config from './config.js';
import Paths from './paths.js';
import Logger from '../logger/mod.js';
import Context from './context.js';
import PluginStore from './plugin-store.js';
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
    assertNonEmptyString,
    assertFunction
} from '../assertions/mod.js';


/**
 * @typedef {Object} PluginDescriptor
 * @property {string} directory - Plugin's root directory path
 * @property {string} filepath - Path to the plugin's main file (plugin.js or plugin.mjs)
 * @property {Function|null} register - Plugin registration function called during setup phase
 * @property {Function|null} initialize - Plugin initialization function called after registration
 * @property {string} middlewareDirectory - Path to middleware handlers directory
 * @property {string} requestHandlerDirectory - Path to request handlers directory
 * @property {string} errorHandlerDirectory - Path to error handlers directory
 */

/**
 * @typedef {Object} ApplicationOptions
 * @property {string} currentWorkingDirectory - Current working directory path
 * @property {string} [applicationDirectory] - Application directory path (optional, can be derived from config)
 * @property {Object} [fileSystem] - File system interface for testing (defaults to node:fs)
 */

/**
 * @typedef {Object} InitializeOptions
 * @property {string} runtime - Runtime environment identifier
 * @property {string} environment - Environment name (e.g., 'development', 'production')
 * @property {string} configFilepath - Path to configuration file
 * @property {string} secretsFilepath - Path to secrets file
 */

/**
 * Core application class that manages the lifecycle of a Kixx application
 *
 * Handles configuration loading, service initialization, plugin management,
 * and provides the application context for dependency injection.
 */
export default class Application {

    /**
     * The current environment name (e.g., 'development', 'production').
     * @type {string|null}
     * @private
     */
    #environment = null;

    /**
     * The current working directory path.
     * @type {string|null}
     * @private
     */
    #currentWorkingDirectory = null;

    /**
     * The application directory path.
     * @type {string|null}
     * @private
     */
    #applicationDirectory = null;

    /**
     * The path to the configuration file.
     * @type {string|null}
     * @private
     */
    #configFilepath = null;

    /**
     * The path to the secrets file.
     * @type {string|null}
     * @private
     */
    #secretsFilepath = null;

    /**
     * The configuration store instance.
     * @type {ConfigStore|null}
     * @private
     */
    #configStore = null;

    /**
     * The configuration instance.
     * @type {Config|null}
     * @private
     */
    #config = null;

    /**
     * The application context instance.
     * @type {Context|null}
     * @private
     */
    #context = null;

    /**
     * The file system instance.
     * @type {FileSystem|null}
     * @private
     */
    #fileSystem = null;

    /**
     * Creates a new Application instance
     *
     * @param {ApplicationOptions} options - Application configuration options
     * @throws {Error} When currentWorkingDirectory is not provided or is empty
     */
    constructor(options) {
        const {
            currentWorkingDirectory,
            applicationDirectory,
        } = options;

        assertNonEmptyString(currentWorkingDirectory, 'An Application instance requires a currentWorkingDirectory path');

        this.#currentWorkingDirectory = currentWorkingDirectory;

        // Application directory can be derived during initialization from config filepath
        // This allows for flexible deployment scenarios where the app directory
        // is determined by the config file location rather than constructor params
        if (isNonEmptyString(applicationDirectory)) {
            this.#applicationDirectory = applicationDirectory;
        }

        this.#fileSystem = options.fileSystem || fileSystem;
    }

    /**
     * Gets the current working directory path
     *
     * @returns {string} Current working directory path
     */
    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    /**
     * Gets the application directory path
     *
     * @returns {string|null} Application directory path or null if not set
     */
    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    /**
     * Gets the application context
     *
     * @returns {Context} Application context object
     */
    get context() {
        return this.#context;
    }

    /**
     * Initializes the application with configuration and core services
     *
     * Loads configuration, creates paths, logger, and context, then initializes
     * core services (datastore, view service) and plugins.
     *
     * @async
     * @param {InitializeOptions} options - Initialization options
     * @returns {Promise<Context>} Application context with all services registered
     * @throws {Error} When required options are missing or invalid
     * @throws {WrappedError} When configuration loading fails
     * @throws {WrappedError} When service initialization fails
     * @throws {WrappedError} When plugin initialization fails
     */
    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        assertNonEmptyString(environment);
        assertNonEmptyString(configFilepath);
        assertNonEmptyString(secretsFilepath);

        this.#environment = environment;
        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;

        const config = await this.loadConfiguration();
        const paths = this.createPathsConfiguration(config.applicationDirectory);
        const logger = this.createLogger(config);
        const context = this.createContext(runtime, config, paths, logger);

        const viewService = await this.createAndInitializeViewService();
        const datastore = await this.createAndLoadDatastore();

        // Register services using kixx.* namespace convention
        context.registerService('kixx.Datastore', datastore);
        context.registerService('kixx.AppViewService', viewService);

        await this.initializePlugins();

        return context;
    }

    /**
     * Loads and parses configuration from files
     *
     * Creates or updates the configuration store and loads both config and secrets.
     * Supports hot reloading by updating existing config instances.
     *
     * The application directory is derived from the config filepath.
     *
     * @async
     * @returns {Promise<Config>} Configuration object
     * @throws {AssertionError} When environment, configFilepath, or secretsFilepath are not set
     * @throws {WrappedError} When configuration files cannot be loaded or parsed
     */
    async loadConfiguration() {
        assertNonEmptyString(this.#environment);
        assertNonEmptyString(this.#configFilepath);
        assertNonEmptyString(this.#secretsFilepath);

        if (!this.#configStore) {
            this.#configStore = new ConfigStore({
                currentWorkingDirectory: this.#currentWorkingDirectory,
                applicationDirectory: this.#applicationDirectory,
            });
        }

        const configs = await this.#configStore.loadLatestConfigJSON(this.#configFilepath);
        const secrets = await this.#configStore.loadLatestSecretsJSON(this.#secretsFilepath);

        const { applicationDirectory } = this.#configStore;
        this.#applicationDirectory = applicationDirectory;

        // Update existing config or create new one - allows for hot reloading
        // without losing existing config references held by other components
        if (this.#config) {
            this.#config.updateConfig(this.#environment, configs);
            this.#config.updateSecrets(this.#environment, secrets);
        } else {
            this.#config = Config.create(this.#environment, configs, secrets, applicationDirectory);
        }

        return this.#config;
    }

    /**
     * Creates paths configuration for the application
     *
     * @param {string} applicationDirectory - Application directory path
     * @returns {Paths} Paths configuration object
     */
    createPathsConfiguration(applicationDirectory) {
        return new Paths(applicationDirectory);
    }

    /**
     * Creates and configures the application logger
     *
     * Sets up dynamic reconfiguration to allow runtime log level changes
     * without application restarts.
     *
     * @param {Config} config - Application configuration
     * @returns {Logger} Configured logger instance
     */
    createLogger(config) {
        const options = config.getNamespace('logger');

        const logger = new Logger({
            name: options.name || config.processName,
            level: options.level || 'debug',
            mode: options.mode || 'console',
        });

        // Enable dynamic reconfiguration to change log settings at runtime
        // This allows adjusting log levels for debugging without application restarts
        config.on('change', () => {
            const newConfig = config.getNamespace('logger');

            // Only update properties that are explicitly set in new config
            // This preserves existing values when config doesn't specify them
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
     * Creates the application context
     *
     * @param {string} runtime - Runtime environment identifier
     * @param {Config} config - Application configuration
     * @param {Paths} paths - Application paths
     * @param {Logger} logger - Application logger
     * @returns {Context} Application context
     */
    createContext(runtime, config, paths, logger) {
        this.#context = new Context({
            runtime,
            config,
            paths,
            logger,
        });
        return this.#context;
    }

    /**
     * Creates and loads the application datastore
     *
     * @async
     * @param {Context} [context] - Application context (uses internal context if not provided)
     * @returns {Promise<Datastore>} Loaded datastore instance
     * @throws {AssertionError} When context is not provided and internal context is not available
     * @throws {WrappedError} When datastore loading fails
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
     * Creates and initializes the view service
     *
     * @async
     * @param {Context} [context] - Application context (uses internal context if not provided)
     * @returns {Promise<ViewService>} Initialized view service instance
     * @throws {AssertionError} When context is not provided and internal context is not available
     * @throws {WrappedError} When view service initialization fails
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
     * Initializes all plugins in the application. Loads plugins from the
     * plugins directory and calls their register and initialize methods.
     *
     * @async
     * @param {Context} [context] - Application context (uses internal context if not provided)
     * @throws {AssertionError} When context is not provided and internal context is not available
     * @throws {WrappedError} When plugin loading or initialization fails
     */
    async initializePlugins(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to initializePlugins()');

        const { paths } = context;
        const pluginStore = new PluginStore({ directory: paths.plugins_directory });
        const plugins = await pluginStore.loadPlugins();

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

            // Load handlers after plugin is fully initialized
            // eslint-disable-next-line no-await-in-loop
            await this.loadHandlersFromPlugin(plugin);
        }
    }

    /**
     * Loads and registers middleware, request handlers, and error handlers from a single plugin
     *
     * @async
     * @param {PluginDescriptor} plugin - Plugin with handler directory paths
     * @returns {Promise<void>}
     * @throws {WrappedError} When any handler directory fails to load
     */
    async loadHandlersFromPlugin(plugin) {
        const {
            middlewareDirectory,
            requestHandlerDirectory,
            errorHandlerDirectory,
        } = plugin;

        await Promise.all([
            this.loadMiddlewareDirectory(middlewareDirectory, registerMiddleware),
            this.loadMiddlewareDirectory(requestHandlerDirectory, registerHandler),
            this.loadMiddlewareDirectory(errorHandlerDirectory, registerErrorHandler),
        ]);
    }

    /**
     * Loads and registers middleware functions from a directory
     *
     * Scans directory for files, loads each as a module, and registers
     * the default export as a middleware function.
     *
     * @async
     * @param {string} directory - Directory path containing middleware files
     * @param {Function} register - Registration function to call with loaded middleware
     * @throws {WrappedError} When directory cannot be read or modules cannot be loaded
     * @throws {AssertionError} When middleware default export is not a function
     */
    async loadMiddlewareDirectory(directory, register) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const files = entries.filter((entry) => entry.isFile());

        const promises = files.map((file) => {
            const filepath = path.join(directory, file.name);

            return this.loadMiddlewareFunction(filepath).then((fn) => {
                register(fn.name, fn);
                return true;
            });
        });

        await Promise.all(promises);
    }

    /**
     * Loads a single middleware function from a file
     *
     * @async
     * @param {string} filepath - Path to the middleware file
     * @returns {Promise<Function>} Middleware function (default export from module)
     * @throws {WrappedError} When module cannot be loaded
     * @throws {AssertionError} When default export is not a function
     */
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

    /**
     * Loads application routes and virtual hosts
     *
     * @async
     * @param {Context} [context] - Application context (uses internal context if not provided)
     * @returns {Promise<VirtualHost[]>} Array of virtual host configurations
     * @throws {AssertionError} When context is not provided and internal context is not available
     * @throws {WrappedError} When routes cannot be loaded
     */
    async loadRoutes(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to loadRoutes()');

        const { paths } = context;

        const routesStore = new RoutesStore({
            app_directory: paths.app_directory,
            routes_directory: paths.routes_directory,
        });

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        return vhosts;
    }
}
