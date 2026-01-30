import path from 'node:path';
import Config from './config.js';
import Paths from './paths.js';
import Logger from '../logger/mod.js';
import Context from './context.js';
import Plugin from './plugin.js';
import { AssertionError, WrappedError } from '../errors/mod.js';
import * as fileSystem from '../lib/file-system.js';

import {
    isFunction,
    isNonEmptyString,
    assert,
    assertNonEmptyString
} from '../assertions/mod.js';

/**
 * @typedef {Object} AppRuntime
 * @public
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} [server.name="server"] - The given name of the server
 */

/**
 * Main application class responsible for initializing and managing the Kixx application lifecycle.
 *
 * The Application class coordinates the setup of core services (configuration and logging),
 * discovers and loads plugins, and initializes the application context. Use the
 * initialize() method to set up the application, which returns a Context
 * instance that provides access to all application components.
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
     * File system API instance for reading directories and files.
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Registry of middleware functions keyed by name.
     * @type {Map<string, Function>}
     */
    middleware = new Map();

    /**
     * Registry of request handler functions keyed by name.
     * @type {Map<string, Function>}
     */
    requestHandlers = new Map();

    /**
     * Registry of error handler functions keyed by name.
     * @type {Map<string, Function>}
     */
    errorHandlers = new Map();

    /**
     * Creates a new Application instance.
     * @param {Object} options - Application initialization options
     * @param {string} options.currentWorkingDirectory - Absolute path to the current working directory
     * @param {string} [options.applicationDirectory] - Optional absolute path to the application directory. If not provided, will be derived from config file location during initialization.
     * @param {Object} [options.fileSystem] - Optional file system API for testing. Defaults to the standard file system implementation.
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
     * @public
     * @returns {string} Absolute path to the current working directory
     */
    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    /**
     * Gets the application directory path.
     * @public
     * @returns {string|null} Absolute path to the application directory, or null if not yet determined
     */
    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    /**
     * Gets the configuration file path.
     * @public
     * @returns {string|null} Absolute path to the configuration file, or null if not yet set
     */
    get configFilepath() {
        return this.#configFilepath;
    }

    /**
     * Gets the application context instance.
     * @public
     * @returns {Context|null} The application context instance, or null if not yet initialized
     */
    get context() {
        return this.#context;
    }

    /**
     * Bootstraps the application by loading configuration, creating core services, and discovering plugins.
     * @async
     * @public
     * @param {Object} options - Initialization options
     * @param {AppRuntime} options.runtime - Runtime configuration indicating CLI command or server mode
     * @param {string} options.environment - Environment name (e.g., 'development', 'production')
     * @param {string} [options.configFilepath] - Absolute filepath to configuration file. Discovered automatically if not provided.
     * @param {string} [options.secretsFilepath] - Absolute filepath to secrets file. Discovered automatically if not provided.
     * @returns {Promise<Context>} The initialized application context
     * @throws {AssertionError} When environment is not a non-empty string
     * @throws {WrappedError} When configuration file cannot be found or loaded
     */
    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        if (!isNonEmptyString(environment)) {
            throw new AssertionError('An environment string is required', null, this.initialize);
        }

        // NOTE: Loading the configs may reset the #applicationDirectory based
        //       on the config file location.
        const config = await this.loadConfiguration({
            environment,
            configFilepath,
            secretsFilepath,
        });

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

        await this.initializePlugins(this.#context);

        return this.#context;
    }

    /**
     * Loads or reloads configuration and secrets from files. Supports hot reloading
     * by updating the existing Config instance if one exists.
     * @async
     * @public
     * @param {Object} [options] - Configuration loading options
     * @param {string} [options.environment] - Environment name. Falls back to cached environment from initialize().
     * @param {string} [options.configFilepath] - Absolute filepath to configuration file. Falls back to cached value.
     * @param {string} [options.secretsFilepath] - Absolute filepath to secrets file. Falls back to cached value.
     * @returns {Promise<Config>} The configuration manager instance
     * @throws {AssertionError} When environment has not been set
     * @throws {WrappedError} When configuration file cannot be found or loaded
     */
    async loadConfiguration(options = {}) {
        // Passed in options can override cached values.
        const {
            environment = this.#environment,
            configFilepath = this.#configFilepath,
            secretsFilepath = this.#secretsFilepath,
        } = options;

        assertNonEmptyString(environment, 'An environment must be set before loading the configuration');

        // Cache values for subsequent calls (supports hot reload without passing params again)
        this.#environment = environment;
        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;

        // The config and secrets filepath can be explicitly provided. If not
        // provided they will be derived by the Config Store.
        // NOTE: Loading the configs may reset the #applicationDirectory based
        //       on the config file location.
        const configs = await this.#loadLatestConfig(this.#configFilepath);
        const secrets = await this.#loadLatestSecrets(this.#secretsFilepath);

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
     * Creates a logger instance configured from application settings. The logger
     * subscribes to config changes for runtime reconfiguration.
     *
     * @public
     * @param {Config} [config] - Application configuration manager
     * @returns {Logger} Configured logger instance
     */
    createLogger(config) {
        config = config || this.#config;

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
     * Discovers and initializes all plugins from the plugins directory. Plugins are loaded
     * in directory order, with the app plugin loaded last to allow overrides. Each plugin
     * goes through registration (services) then initialization (async setup) phases.
     * @async
     * @public
     * @param {Context} context - Application context for plugin registration
     * @throws {WrappedError} When a plugin's register() or initialize() function throws
     */
    async initializePlugins(context) {
        const { paths } = context;

        const entries = await this.#fileSystem.readDirectory(paths.plugins_directory);

        const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(paths.plugins_directory, entry.name));

        // Load the app plugin last so it can override behavior from other plugins
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
            this.#registerCollectionsFromPlugin(context, plugin);
            this.#registerViewsFromPlugin(context, plugin);
            this.#registerFormsFromPlugin(context, plugin);
            this.#registerUserRolesFromPlugin(context, plugin);
            this.#registerMiddlewareFromPlugin(plugin);
        }

        for (const plugin of plugins) {
            const { filepath, register } = plugin;

            // Register phase: Plugins register their services
            if (isFunction(register)) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await register(context);
                } catch (cause) {
                    throw new WrappedError(`Error calling plugin register() from ${ filepath }`, { cause });
                }
            }
        }

        for (const plugin of plugins) {
            const { filepath, initialize } = plugin;

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
     * Registers a middleware function by name for use in request pipelines.
     * @public
     * @param {string} name - Unique identifier for the middleware
     * @param {Function} fn - Middleware function to register
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When fn is not a function
     */
    registerMiddleware(name, fn) {
        if (!isNonEmptyString(name)) {
            throw new AssertionError('A middleware name is required', null, this.registerMiddleware);
        }
        if (!isFunction(fn)) {
            throw new AssertionError('Middleware must be a function', null, this.registerMiddleware);
        }

        this.middleware.set(name, fn);
    }

    /**
     * Registers a request handler function by name for routing.
     * @public
     * @param {string} name - Unique identifier for the handler
     * @param {Function} fn - Request handler function to register
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When fn is not a function
     */
    registerRequestHandler(name, fn) {
        if (!isNonEmptyString(name)) {
            throw new AssertionError('A request handler name is required', null, this.registerRequestHandler);
        }
        if (!isFunction(fn)) {
            throw new AssertionError('A request handler must be a function', null, this.registerRequestHandler);
        }

        this.requestHandlers.set(name, fn);
    }

    /**
     * Registers an error handler function by name for error processing pipelines.
     * @public
     * @param {string} name - Unique identifier for the handler
     * @param {Function} fn - Error handler function to register
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When fn is not a function
     */
    registerErrorHandler(name, fn) {
        if (!isNonEmptyString(name)) {
            throw new AssertionError('An error handler name is required', null, this.registerErrorHandler);
        }
        if (!isFunction(fn)) {
            throw new AssertionError('An error handler must be a function', null, this.registerErrorHandler);
        }

        this.errorHandlers.set(name, fn);
    }

    /**
     * Instantiates and registers all collections defined in a plugin.
     * @param {Context} context - Application context for registration
     * @param {Plugin} plugin - Plugin containing collection definitions
     */
    #registerCollectionsFromPlugin(context, plugin) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to registerCollectionsFromPlugin()');

        for (const [ key, obj ] of plugin.collections) {
            const { CollectionConstructor, schema } = obj;
            context.registerCollection(key, new CollectionConstructor(context, schema));
        }
    }

    /**
     * Instantiates and registers all forms defined in a plugin.
     * @param {Context} context - Application context for registration
     * @param {Plugin} plugin - Plugin containing form definitions
     */
    #registerFormsFromPlugin(context, plugin) {
        for (const [ key, obj ] of plugin.forms) {
            const { FormConstructor, schema } = obj;
            context.registerForm(key, new FormConstructor(context, schema));
        }
    }

    /**
     * Instantiates and registers all views defined in a plugin.
     * @param {Context} context - Application context for registration
     * @param {Plugin} plugin - Plugin containing view definitions
     */
    #registerViewsFromPlugin(context, plugin) {
        for (const [ key, obj ] of plugin.views) {
            const { ViewConstructor, schema } = obj;
            context.registerView(key, new ViewConstructor(context, schema));
        }
    }

    /**
     * Registers all user roles defined in a plugin.
     * @param {Context} context - Application context for registration
     * @param {Plugin} plugin - Plugin containing user role definitions
     */
    #registerUserRolesFromPlugin(context, plugin) {
        for (const [ key, role ] of plugin.userRoles) {
            context.registerUserRole(key, role);
        }
    }

    /**
     * Registers all middleware, request handlers, and error handlers from a plugin.
     * @param {Plugin} plugin - Plugin containing handler definitions
     */
    #registerMiddlewareFromPlugin(plugin) {
        for (const [ key, fn ] of plugin.middleware) {
            this.registerMiddleware(key, fn);
        }

        for (const [ key, fn ] of plugin.requestHandlers) {
            this.registerRequestHandler(key, fn);
        }

        for (const [ key, fn ] of plugin.errorHandlers) {
            this.registerErrorHandler(key, fn);
        }
    }

    /**
     * Loads configuration from the specified filepath or discovers it in the application directory.
     * Sets #applicationDirectory as a side effect if derived from the config file location.
     * @async
     * @param {string|null} filepath - Explicit config filepath, or null to auto-discover
     * @returns {Promise<Object>} Parsed configuration object
     * @throws {WrappedError} When config file does not exist or cannot be found
     */
    async #loadLatestConfig(filepath) {
        let values = {};

        if (isNonEmptyString(filepath)) {
            values = await this.#fileSystem.readJSONFile(filepath);
            if (!values) {
                throw new WrappedError(`Config file does not exist: ${ filepath }`);
            }
            // Derive application directory from config file location to support
            // deployments where config lives outside the working directory
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
     * Loads secrets from the specified filepath or discovers them in the application directory.
     * Sets #applicationDirectory as a side effect if derived from the secrets file location.
     * Returns empty object if no secrets file exists (secrets are optional).
     * @async
     * @param {string|null} filepath - Explicit secrets filepath, or null to auto-discover
     * @returns {Promise<Object>} Parsed secrets object, or empty object if not found
     */
    async #loadLatestSecrets(filepath) {
        let values = {};

        if (isNonEmptyString(filepath)) {
            const result = await this.#fileSystem.readJSONFile(filepath);
            // Derive application directory from secrets file location to support
            // deployments where secrets live outside the working directory
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
