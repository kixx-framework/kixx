/**
 * @fileoverview Application initialization and context management
 *
 * This module provides the core initialization logic for the application,
 * including configuration loading, logger setup, context creation, and
 * plugin system initialization. It serves as the primary entry point for
 * bootstrapping the application runtime environment.
 */

import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';
import { isFunction } from '../assertions/mod.js';
import Logger from '../logger/mod.js';
import Config from './config.js';
import Paths from './paths.js';
import Context from './context.js';

/**
 * @typedef {Object} ApplicationRuntime
 * @property {string} [command] - Command name for CLI applications
 * @property {Object} [server] - Server configuration for web applications
 * @property {string} server.name - Server name identifier
 */

/**
 * @typedef {Object} LoggerOptions
 * @property {string} [level] - Log level (debug, info, warn, error)
 * @property {string} [mode] - Logger output mode (console, file, etc.)
 */

/**
 * @typedef {Object} PluginModule
 * @property {string} filepath - Absolute path to the plugin file
 */

/**
 * Initializes and returns the core application context.
 *
 * This function performs the following steps:
 *   1. Loads and merges configuration and secrets from the specified file path and environment.
 *   2. Constructs application paths based on the configuration file location.
 *   3. Creates a logger instance configured according to the loaded configuration.
 *   4. Loads and registers all core services into the application context.
 *   5. Loads and initializes all plugins for the application.
 *
 * @async
 * @param {ApplicationRuntime} runtime - The application runtime object
 * @param {string} configFilepath - Absolute path to the application's configuration file
 * @param {string} environment - The environment name (e.g., 'development', 'production')
 * @returns {Promise<Context>} Resolves to the fully initialized application context
 * @throws {WrappedError} When configuration loading fails
 * @throws {WrappedError} When plugin loading or initialization fails
 * @throws {Error} When core services fail to load into context
 * @example
 * // Initialize for CLI application
 * const context = await initialize(
 *   { command: 'migrate' },
 *   '/app/config.js',
 *   'production'
 * );
 *
 * @example
 * // Initialize for web server
 * const context = await initialize(
 *   { server: { name: 'api' } },
 *   './config/app.js',
 *   'development'
 * );
 */
export async function initialize(runtime, configFilepath, environment) {
    // Load configuration first - everything else depends on this foundation
    let config;
    try {
        config = await Config.loadConfigs(configFilepath, environment);
    } catch (error) {
        // Wrap config errors to provide context about which file failed
        // This helps debugging when multiple config files might be involved
        throw new WrappedError(`Error loading application config from ${ configFilepath }`, { cause: error });
    }

    // Build application structure: paths → logger → context → plugins
    // Each step depends on the previous ones being fully initialized
    const paths = Paths.fromConfigFilepath(configFilepath);
    const logger = createLogger(config);

    // Context.load registers all core services and makes them available
    // After this call, the context is ready for plugin registration
    const context = await Context.load(runtime, config, paths, logger);

    // Initialize user plugins last - they may depend on core services
    await initializePlugins(context);

    return context;
}

/**
 * Creates and configures a Logger instance for the application.
 *
 * This function initializes a Logger with the application's name and logger
 * configuration options. It also sets up a listener to update the logger's
 * level and mode dynamically when configuration changes at runtime.
 *
 * @param {Object} config - Application configuration object with getNamespace method
 * @param {string} config.name - Application name used for logger identification
 * @param {Function} config.getNamespace - Method to retrieve namespaced configuration
 * @param {Function} config.on - Method to listen for configuration changes
 * @returns {Logger} The configured Logger instance with dynamic reconfiguration
 * @throws {Error} When logger configuration namespace is invalid
 * @example
 * const logger = createLogger(config);
 * // Logger automatically updates when config changes
 * config.emit('change'); // Triggers logger reconfiguration
 */
export function createLogger(config) {
    const options = config.getNamespace('logger');

    const logger = new Logger({
        name: config.name,
        level: options.level || 'debug',
        mode: options.mode || 'console',
    });

    // Set up dynamic reconfiguration - allows changing log level/mode
    // without restarting the application (useful for debugging production issues)
    config.on('change', () => {
        const newConfig = config.getNamespace('logger');

        // Only update properties that are explicitly set in new config
        // Preserves existing values if new config doesn't specify them
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
 * Loads and initializes all plugin modules for the application.
 *
 * This function discovers plugin modules using the application's paths object,
 * dynamically imports each plugin, and invokes their lifecycle methods.
 * Plugins follow a two-phase initialization: register() for synchronous setup
 * and initialize() for asynchronous operations.
 *
 * @async
 * @param {Object} context - Application context with paths and services
 * @param {Object} context.paths - Paths object with getPlugins method
 * @returns {Promise<void>} Resolves when all plugins have been loaded and initialized
 * @throws {WrappedError} When a plugin fails to load via dynamic import
 * @throws {WrappedError} When a plugin's initialize method throws an error
 * @throws {Error} When a plugin's register method throws an error
 * @example
 * // Plugins are loaded sequentially in discovery order
 * await initializePlugins(context);
 *
 * // Plugin contract example:
 * // export function register(context) {  }
 * // export async function initialize(context) {  }
 */
export async function initializePlugins(context) {
    const plugins = await context.paths.getPlugins();

    // Process plugins sequentially to ensure deterministic loading order
    // Some plugins may depend on others being registered first
    for (const { filepath } of plugins) {
        let mod;
        try {
            // pathToFileURL needed because dynamic import() requires URL format
            // for absolute file paths on all platforms (Windows compatibility)
            // eslint-disable-next-line no-await-in-loop -- Sequential loading required for plugin dependencies
            mod = await import(pathToFileURL(filepath));
        } catch (cause) {
            throw new WrappedError(`Error loading plugin from ${ filepath }`, { cause });
        }

        // Plugin contract: register() for sync setup, initialize() for async setup
        // Both methods are optional - plugins can provide just one or both
        if (isFunction(mod.register)) {
            // register() runs synchronously and typically registers services/routes
            mod.register(context);
        }
        if (isFunction(mod.initialize)) {
            // initialize() handles async setup like database connections, file system ops
            // eslint-disable-next-line no-await-in-loop -- Sequential loading required for plugin dependencies
            await mod.initialize(context);
        }
    }
}
