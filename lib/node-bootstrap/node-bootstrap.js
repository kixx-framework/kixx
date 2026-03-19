import path from 'node:path';
import process from 'node:process';
import * as fileSystem from '../node-filesystem/mod.js';
import NodeConfigStore from '../node-config-store/node-config-store.js';
import MemoryHttpRoutesStore from '../http-routes-stores/memory-http-routes-store.js';
import NodeServer from '../node-http-server/node-server.js';

import { assertNonEmptyString } from '../assertions.js';


/**
 * Node.js platform bootstrap — implements the Bootstrap port for Node.js applications.
 *
 * Inject an instance of this class into ApplicationBootstrap to wire up a Kixx
 * application for Node.js. Different bootstrap modules (e.g. CloudflareBootstrap,
 * LambdaBootstrap) provide the same Bootstrap port for other deployment targets, so
 * switching platforms requires only swapping the bootstrap passed to ApplicationBootstrap.
 *
 * @see {import('../ports/bootstrap.js').Bootstrap}
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
     * Creates the Node.js config store for the application directory.
     * @public
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
     * Creates an in-memory routes store from the given virtual host configurations.
     * @public
     * @param {Array<Object>} vhostsConfigs - Virtual host route configurations
     * @returns {MemoryHttpRoutesStore}
     */
    createHttpRoutesStore(vhostsConfigs) {
        return new MemoryHttpRoutesStore(vhostsConfigs);
    }

    /**
     * Returns the Node.js standard output write function used as the log sink.
     * @public
     * @returns {function(string): void}
     */
    getPrintWriter() {
        return process.stdout.write.bind(process.stdout);
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
