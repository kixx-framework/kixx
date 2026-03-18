import path from 'node:path';
import process from 'node:process';
import * as fileSystem from '../node-filesystem/mod.js';
import ApplicationContext from '../context/application-context.js';
import Config from '../config/config.js';
import ConfigStore from '../config-stores/js-module-config-store.js';
import BaseLogger from '../logger/base-logger.js';
import DevLogger from '../logger/dev-logger.js';
import ProdLogger from '../logger/prod-logger.js';
import HttpRouter from '../http-router/http-router.js';
import RoutesStore from '../http-routes-stores/js-module-http-routes-store.js';
import NodeServer from '../node-http-server/node-server.js';

import { assertNonEmptyString } from '../assertions.js';


/**
 * @typedef {Object} AppRuntime
 * @property {Object} [server] - Server descriptor when running as an HTTP server
 * @property {string} [server.name='server'] - The given name of the server instance
 */

/**
 * @typedef {import('../ports/plugin.js').Plugin} Plugin
 */

/**
 * Wires up a Kixx application for Node.js, handling config loading, logger creation,
 * and plugin initialization so application code stays platform-agnostic.
 *
 * Different bootstrap modules (e.g. CloudflareBootstrap, LambdaBootstrap) provide the
 * same interface for other deployment targets, so switching platforms requires only
 * swapping the bootstrap import.
 */
export default class NodeBootstrap {

    /**
     * @param {Object} options
     * @param {string} options.environment - Deployment environment name (e.g. 'development', 'production')
     * @param {string} options.applicationDirectory - Absolute path to the application root; used to
     *   locate kixx-config.jsonc and .secrets.jsonc
     */
    constructor({ environment, applicationDirectory }) {
        assertNonEmptyString(environment, 'NodeBootstrap requires an environment string');
        assertNonEmptyString(applicationDirectory, 'NodeBootstrap requires an applicationDirectory string');

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
        });
    }

    /**
     * Loads config, creates a logger, initializes plugins, and returns a fully
     * configured ApplicationContext ready for use.
     * @public
     * @param {Object} options
     * @param {AppRuntime} options.runtime - Runtime descriptor passed through to ApplicationContext
     * @param {Map<string, Plugin>} options.plugins - Plugins to register and initialize, in insertion order
     * @returns {Promise<ApplicationContext>} Fully initialized application context
     */
    async bootstrapApplication({ runtime, plugins }) {
        const config = await this.loadConfig();
        const logger = this.createLogger(config);

        const applicationContext = new ApplicationContext({ runtime, config, logger });

        await this.loadPlugins(plugins, applicationContext);

        return applicationContext;
    }

    /**
     * Reads kixx-config.jsonc and .secrets.jsonc from the application directory and
     * returns a configured Config instance.
     * @returns {Promise<Config>}
     */
    async loadConfig() {
        const configStore = new ConfigStore({
            configFilepath: path.join(this.applicationDirectory, 'kixx-config.jsonc'),
            secretsFilepath: path.join(this.applicationDirectory, '.secrets.jsonc'),
            fileSystem,
        });

        const config = new Config(configStore, this.environment, this.applicationDirectory);

        await configStore.loadConfig();
        await configStore.loadSecrets();

        return config;
    }

    /**
     * Creates a DevLogger in non-production environments and a ProdLogger in production.
     * @param {Config} config
     * @returns {DevLogger|ProdLogger}
     */
    createLogger(config) {
        const loggerConfig = config.getNamespace('logger');
        const name = loggerConfig.name || config.name;
        const level = loggerConfig.level || BaseLogger.LEVELS.DEBUG;

        const printWriter = process.stdout.write.bind(process.stdout);

        if (this.environment === 'production') {
            return new ProdLogger({ name, level, printWriter });
        }
        return new DevLogger({ name, level, printWriter });
    }

    /**
     * Calls register() then initialize() on each plugin in sequence.
     * @param {Map<string, Plugin>} plugins
     * @param {ApplicationContext} applicationContext
     * @returns {Promise<ApplicationContext>}
     */
    async loadPlugins(plugins, applicationContext) {
        for (const plugin of plugins.values()) {
            plugin.register(applicationContext);
            await plugin.initialize(applicationContext);
        }

        return applicationContext;
    }

    /**
     * Creates an HttpRouter wired to the middleware, request handlers, and error handlers
     * registered on the application context.
     * @public
     * @param {ApplicationContext} applicationContext - Fully bootstrapped application context
     * @param {Array<Object>} vhostsConfigs - Virtual host route configurations
     * @returns {HttpRouter}
     */
    createHttpRouter(applicationContext, vhostsConfigs) {
        const store = new RoutesStore(vhostsConfigs);

        const { middleware, requestHandlers, errorHandlers } = applicationContext;

        return new HttpRouter({
            store,
            middleware,
            handlers: requestHandlers,
            errorHandlers,
        });
    }

    /**
     * Creates a NodeServer bound to the given port, or the port from server config,
     * defaulting to 8080.
     * @public
     * @param {ApplicationContext} applicationContext - Fully bootstrapped application context
     * @param {number} [port] - Port override; falls back to config.server.port then 8080
     * @returns {NodeServer}
     */
    createHttpServer(applicationContext, port) {
        const config = applicationContext.config.getNamespace('server');

        if (!port) {
            port = config.port ?? 8080;
        }

        return new NodeServer({ port });
    }
}
