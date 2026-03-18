import ApplicationContext from '../context/application-context.js';
import Config from '../config/config.js';
import BaseLogger from '../logger/base-logger.js';
import DevLogger from '../logger/dev-logger.js';
import ProdLogger from '../logger/prod-logger.js';
import HttpRouter from '../http-router/http-router.js';

import { assertNonEmptyString, assert } from '../assertions.js';


/**
 * @typedef {Object} AppRuntime
 * @property {Object} [server] - Server descriptor when running as an HTTP server
 * @property {string} [server.name='server'] - The given name of the server instance
 */

/**
 * @typedef {import('../ports/config-store.js').ConfigStore} ConfigStore
 */

/**
 * @typedef {import('../ports/plugin.js').Plugin} Plugin
 */

/**
 * Assembles Kixx core services from injected adapters and runtime metadata.
 *
 * This keeps platform-neutral application wiring separate from runtime-specific
 * bootstrappers. Concrete bootstraps such as `NodeBootstrap` provide adapters
 * like a ConfigStore or HTTP server, while this assembler creates the core
 * `Config`, `ApplicationContext`, logger, and router objects.
 */
export default class ApplicationAssembler {

    /**
     * @param {Object} options
     * @param {string} options.environment - Deployment environment name
     * @param {string} options.applicationDirectory - Absolute path to the application root
     * @param {function(string): void} options.printWriter - Log sink used by the logger implementations
     */
    constructor({ environment, applicationDirectory, printWriter }) {
        assertNonEmptyString(environment, 'ApplicationAssembler requires an environment string');
        assertNonEmptyString(applicationDirectory, 'ApplicationAssembler requires an applicationDirectory string');
        assert(printWriter, 'ApplicationAssembler requires a printWriter function');

        Object.defineProperties(this, {
            /**
             * Deployment environment name.
             * @name environment
             * @type {string}
             */
            environment: {
                enumerable: true,
                value: environment,
            },
            /**
             * Absolute path to the application root directory.
             * @name applicationDirectory
             * @type {string}
             */
            applicationDirectory: {
                enumerable: true,
                value: applicationDirectory,
            },
            /**
             * Output function used by logger instances.
             * @name printWriter
             * @type {function(string): void}
             */
            printWriter: {
                enumerable: true,
                value: printWriter,
            },
        });
    }

    /**
     * Loads config through the provided store, creates a logger, initializes plugins,
     * and returns a fully configured application context.
     * @public
     * @param {Object} options
     * @param {AppRuntime} options.runtime - Runtime descriptor passed through to ApplicationContext
     * @param {Map<string, Plugin>} options.plugins - Plugins to register and initialize, in insertion order
     * @param {ConfigStore} options.configStore - Adapter used to load config and secrets
     * @returns {Promise<ApplicationContext>} Fully initialized application context
     */
    async bootstrapApplication({ runtime, plugins, configStore }) {
        const config = await this.loadConfig(configStore);
        const logger = this.createLogger(config);
        const applicationContext = new ApplicationContext({ runtime, config, logger });

        await this.loadPlugins(plugins, applicationContext);

        return applicationContext;
    }

    /**
     * Builds a Config instance around the provided store and triggers the initial loads.
     * @public
     * @param {ConfigStore} configStore - Adapter used to load config and secrets
     * @returns {Promise<Config>} Fully loaded configuration manager
     */
    async loadConfig(configStore) {
        const config = new Config(configStore, this.environment, this.applicationDirectory);

        await configStore.loadConfig();
        await configStore.loadSecrets();

        return config;
    }

    /**
     * Creates the environment-appropriate logger for the assembled application.
     * @public
     * @param {Config} config
     * @returns {DevLogger|ProdLogger}
     */
    createLogger(config) {
        const loggerConfig = config.getNamespace('logger');
        const name = loggerConfig.name || config.name;
        const level = loggerConfig.level || BaseLogger.LEVELS.DEBUG;

        if (this.environment === 'production') {
            return new ProdLogger({ name, level, printWriter: this.printWriter });
        }

        return new DevLogger({ name, level, printWriter: this.printWriter });
    }

    /**
     * Registers all plugins first, then initializes them in insertion order.
     * @public
     * @param {Map<string, Plugin>} plugins
     * @param {ApplicationContext} applicationContext
     * @returns {Promise<ApplicationContext>}
     */
    async loadPlugins(plugins, applicationContext) {
        for (const plugin of plugins.values()) {
            plugin.register(applicationContext);
        }

        for (const plugin of plugins.values()) {
            await plugin.initialize(applicationContext);
        }

        return applicationContext;
    }

    /**
     * Creates an HttpRouter wired to the middleware, request handlers, and error handlers
     * registered on the application context.
     * @public
     * @param {ApplicationContext} applicationContext - Fully bootstrapped application context
     * @param {import('../ports/http-routes-store.js').HttpRoutesStore} store - Route store adapter
     * @returns {HttpRouter}
     */
    createHttpRouter(applicationContext, store) {
        const { middleware, requestHandlers, errorHandlers } = applicationContext;

        return new HttpRouter({
            store,
            middleware,
            handlers: requestHandlers,
            errorHandlers,
        });
    }
}
