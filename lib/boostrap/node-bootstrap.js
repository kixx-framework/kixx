import path from 'node:path';
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


export default class NodeBootstrap {

    constructor({ environment, applicationDirectory }) {
        assertNonEmptyString(environment, 'NodeBootstrap requires an environment string');
        assertNonEmptyString(applicationDirectory, 'NodeBootstrap requires an applicationDirectory string');

        Object.defineProperties(this, {
            environment: {
                enumerable: true,
                value: environment,
            },
            applicationDirectory: {
                enumerable: true,
                value: applicationDirectory,
            },
        });
    }

    async bootstrapApplication({ runtime, plugins }) {
        const config = await this.loadConfig();
        const logger = this.createLogger(config);

        const applicationContext = new ApplicationContext({ runtime, config, logger });

        await this.loadPlugins(plugins, applicationContext);

        return applicationContext;
    }

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

    createLogger(config) {
        const loggerConfig = config.getNamespace('logger');
        const name = loggerConfig.name || config.name;
        const level = loggerConfig.level || BaseLogger.LEVELS.DEBUG;

        if (this.environment === 'production') {
            return new ProdLogger({ name, level });
        }
        return new DevLogger({ name, level });
    }

    async loadPlugins(plugins, applicationContext) {
        for (const plugin of plugins.values()) {
            plugin.register(applicationContext);
            await plugin.initialize(applicationContext);
        }

        return applicationContext;
    }

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

    createHttpServer(applicationContext, port) {
        const config = applicationContext.config.getNamespace('server');

        if (!port) {
            port = config.port ?? 8080;
        }

        return new NodeServer({ port });
    }
}
