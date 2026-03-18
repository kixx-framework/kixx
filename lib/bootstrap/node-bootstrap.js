import path from 'node:path';
import process from 'node:process';
import * as fileSystem from '../node-filesystem/mod.js';
import ApplicationAssembler from './application-assembler.js';
import NodeConfigStore from '../node-config-store/node-config-store.js';
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

        const assembler = new ApplicationAssembler({
            environment,
            applicationDirectory,
            printWriter: process.stdout.write.bind(process.stdout),
        });

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
             * Platform-neutral application assembler used for core wiring.
             * @name assembler
             * @type {ApplicationAssembler}
             */
            assembler: {
                enumerable: true,
                value: assembler,
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
        const configStore = this.createConfigStore();
        return this.assembler.bootstrapApplication({ runtime, plugins, configStore });
    }

    /**
     * Creates the Node.js config store for the application directory.
     * @returns {NodeConfigStore}
     */
    createConfigStore() {
        return new NodeConfigStore({
            configFilepath: path.join(this.applicationDirectory, 'kixx-config.jsonc'),
            secretsFilepath: path.join(this.applicationDirectory, '.secrets.jsonc'),
            fileSystem,
        });
    }

    /**
     * Calls register() on all plugins first, then initialize() on each plugin in sequence.
     * @param {Map<string, Plugin>} plugins
     * @param {import('../context/application-context.js').default} applicationContext
     * @returns {Promise<import('../context/application-context.js').default>}
     */
    async loadPlugins(plugins, applicationContext) {
        return this.assembler.loadPlugins(plugins, applicationContext);
    }

    /**
     * Creates an HttpRouter wired to the middleware, request handlers, and error handlers
     * registered on the application context.
     * @public
     * @param {import('../context/application-context.js').default} applicationContext - Fully bootstrapped application context
     * @param {Array<Object>} vhostsConfigs - Virtual host route configurations
     * @returns {import('../http-router/http-router.js').default}
     */
    createHttpRouter(applicationContext, vhostsConfigs) {
        const store = new RoutesStore(vhostsConfigs);
        return this.assembler.createHttpRouter(applicationContext, store);
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
