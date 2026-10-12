import Logger from '../logger/logger.js';
import ApplicationContext from './application-context.js';
import AppRuntime from './app-runtime.js';
import { isFunction } from '../assertions/mod.js';


/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @typedef {Object} PluginModule
 * @property {Function} [register] - Constructs the adapter and registers it. Must not call context.getService().
 * @property {Function} [initialize] - Wires up dependencies between already-registered services.
 */

/**
 * Builds the ApplicationContext and runs the plugin lifecycle shared by every
 * entry point: construct the runtime and logger, register every plugin before
 * initializing any of them, run the application's own register/initialize
 * hooks last, then finalize the logger.
 *
 * This function is the composition step every platform entry point shares. It
 * does not construct a router or translate requests, because that behavior
 * legitimately differs per platform and stays in the entry point.
 *
 * @param {Object} options
 * @param {Object} options.env - Environment variables, secrets, and platform bindings.
 * @param {Object} options.config - Resolved application configuration.
 * @param {Function} options.LoggerWriter - Platform logger writer constructor.
 * @param {Map<string, PluginModule>} options.plugins - Merged plugin registry to run through the two-phase lifecycle.
 * @param {PluginModule} options.app - The application's own register/initialize hooks.
 * @returns {{ appContext: ApplicationContext, logger: Logger }}
 */
export function bootApplication(options) {
    const {
        env,
        config,
        LoggerWriter,
        plugins,
        app,
    } = options ?? {};

    // BUILD_ID identifies a single deploy rather than an environment, so it stays
    // an environment variable while the application name and log level do not.
    const runtime = new AppRuntime({
        build: { id: env.BUILD_ID },
        server: { name: config.name },
    });

    const logger = new Logger({
        name: config.name,
        level: config.env.LOGGER.level,
        writer: new LoggerWriter(),
    });

    const appContext = new ApplicationContext({
        env,
        config,
        runtime,
        logger,
    });

    // Register all plugins before calling initialize() on each, so registry
    // order between plugins is irrelevant.
    for (const plugin of plugins.values()) {
        if (isFunction(plugin?.register)) {
            plugin.register(appContext);
        }
    }

    for (const plugin of plugins.values()) {
        if (isFunction(plugin?.initialize)) {
            plugin.initialize(appContext);
        }
    }

    if (isFunction(app.register)) {
        app.register(appContext);
    }

    if (isFunction(app.initialize)) {
        app.initialize(appContext);
    }

    // Finalize the logger to prevent creating infinite child loggers.
    // This must be done *after* the plugins have been registered and initialized.
    logger.finalize();

    return { appContext, logger };
}
