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
 * @typedef {import('../ports/bootstrap.js').Bootstrap} Bootstrap
 */

/**
 * Assembles Kixx core services from an injected platform bootstrap and runtime metadata.
 *
 * This is the primary interface for wiring up a Kixx application. Callers supply a
 * platform-specific Bootstrap implementation (e.g. NodeBootstrap) which the assembler
 * uses to obtain collaborators such as a ConfigStore, an HttpRoutesStore, and a log
 * output function. All platform knowledge lives in the bootstrap; the assembler remains
 * platform-neutral.
 */
export default class ApplicationAssembler {

    /**
     * @param {Object} options
     * @param {string} options.environment - Deployment environment name
     * @param {string} options.applicationDirectory - Absolute path to the application root
     * @param {Bootstrap} options.bootstrap - Platform-specific adapter that provides config,
     *   route, and logging collaborators
     */
    constructor({ environment, applicationDirectory, bootstrap }) {
        assertNonEmptyString(environment, 'ApplicationAssembler requires an environment string');
        assertNonEmptyString(applicationDirectory, 'ApplicationAssembler requires an applicationDirectory string');
        assert(bootstrap, 'ApplicationAssembler requires a bootstrap object');

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
             * Platform-specific bootstrap that provides config, route, and logging collaborators.
             * @name bootstrap
             * @type {Bootstrap}
             */
            bootstrap: {
                enumerable: true,
                value: bootstrap,
            },
        });
    }

    /**
     * Loads config through the platform bootstrap's config store, creates a logger,
     * initializes plugins, and returns a fully configured application context.
     * @public
     * @param {Object} options
     * @param {AppRuntime} options.runtime - Runtime descriptor passed through to ApplicationContext
     * @param {Map<string, Plugin>} options.plugins - Plugins to register and initialize, in insertion order
     * @returns {Promise<ApplicationContext>} Fully initialized application context
     */
    async bootstrapApplication({ runtime, plugins }) {
        const configStore = this.bootstrap.createConfigStore();
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
     * Creates the environment-appropriate logger using the platform bootstrap's print writer.
     * @public
     * @param {Config} config
     * @returns {DevLogger|ProdLogger}
     */
    createLogger(config) {
        const printWriter = this.bootstrap.getPrintWriter();
        const loggerConfig = config.getNamespace('logger');
        const name = loggerConfig.name || config.name;
        const level = loggerConfig.level || BaseLogger.LEVELS.DEBUG;

        if (this.environment === 'production') {
            return new ProdLogger({ name, level, printWriter });
        }

        return new DevLogger({ name, level, printWriter });
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
     * @param {Array<Object>} vhostsConfigs - Virtual host route configurations passed to
     *   the platform bootstrap's createHttpRoutesStore()
     * @returns {HttpRouter}
     */
    createHttpRouter(applicationContext, vhostsConfigs) {
        const store = this.bootstrap.createHttpRoutesStore(vhostsConfigs);
        const { middleware, requestHandlers, errorHandlers } = applicationContext;

        return new HttpRouter({
            store,
            middleware,
            handlers: requestHandlers,
            errorHandlers,
        });
    }
}
