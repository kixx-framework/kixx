import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';
import { isFunction } from '../assertions/mod.js';
import Logger from '../logger/mod.js';
import Config from './config.js';
import Paths from './paths.js';
import Context from './context.js';


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
 * @function initialize
 * @param {object} runtime - The application runtime object (e.g., { command: <command-name> } or { server: { name: <server-name> } }).
 * @param {string} configFilepath - Absolute path to the application's configuration file.
 * @param {string} environment - The environment name (e.g., 'development', 'production').
 * @returns {Promise<Context>} Resolves to the fully initialized application context.
 * @throws {WrappedError} If configuration loading fails.
 */
export async function initialize(runtime, configFilepath, environment) {
    let config;
    try {
        config = await Config.loadConfigs(configFilepath, environment);
    } catch (error) {
        throw new WrappedError(`Error loading application config from ${ configFilepath }`, { cause: error });
    }

    const paths = Paths.fromConfigFilepath(configFilepath);
    const logger = createLogger(config);
    const context = await Context.load(runtime, config, paths, logger);

    await initializePlugins(context);

    return context;
}

/**
 * Creates and configures a Logger instance for the application.
 *
 * This function initializes a Logger with the application's name and logger
 * configuration options (level and mode). It also sets up a listener to update
 * the logger's level and mode dynamically if the configuration changes at runtime.
 *
 * @function createLogger
 * @param {Object} config - The application configuration object.
 * @returns {Logger} The configured Logger instance.
 */
export function createLogger(config) {
    const options = config.getNamespace('logger');

    const logger = new Logger({
        name: config.name,
        level: options.level || 'debug',
        mode: options.mode || 'console',
    });

    config.on('change', () => {
        const newConfig = config.getNamespace('logger');

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
 * dynamically imports each plugin, and invokes their `register` and `initialize`
 * methods if present. The `register` method is called synchronously, while
 * `initialize` is awaited to support asynchronous initialization logic.
 *
 * @async
 * @function initializePlugins
 * @param {Object} context - The application context, providing access to paths and services.
 * @returns {Promise<void>} Resolves when all plugins have been loaded and initialized.
 * @throws {WrappedError} If a plugin fails to load or initialize.
 */
export async function initializePlugins(context) {
    const plugins = await context.paths.getPlugins();

    for (const { filepath } of plugins) {
        let mod;
        try {
            // eslint-disable-next-line no-await-in-loop
            mod = await import(pathToFileURL(filepath));
        } catch (cause) {
            throw new WrappedError(`Error loading plugin from ${ filepath }`, { cause });
        }

        if (isFunction(mod.register)) {
            mod.register(context);
        }
        if (isFunction(mod.initialize)) {
            // eslint-disable-next-line no-await-in-loop
            await mod.initialize(context);
        }
    }
}
