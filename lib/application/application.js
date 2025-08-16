import ConfigStore from './config-store.js';
import Config from './config.js';
import Paths from './paths.js';
import Logger from '../logger/mod.js';
import Context from './context.js';
import PluginStore from './plugin-store.js';
import Datastore from '../datastore/datastore.js';
import ViewService from '../view-service/view-service.js';
import { WrappedError } from '../errors/mod.js';

import { isFunction, assertNonEmptyString } from '../assertions/mod.js';

export default class Application {

    #configStore = null;
    #currentWorkingDirectory = null;
    #applicationDirectory = null;

    constructor(options) {
        const {
            currentWorkingDirectory,
            applicationDirectory,
        } = options;

        assertNonEmptyString(currentWorkingDirectory, 'An Application instance requires a currentWorkingDirectory path');

        this.#currentWorkingDirectory = currentWorkingDirectory;

        this.#configStore = new ConfigStore({
            currentWorkingDirectory,
            applicationDirectory,
        });
    }

    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        const config = await this.loadConfiguration(environment, configFilepath, secretsFilepath);
        const paths = new Paths(config.applicationDirectory);

        this.#applicationDirectory = config.applicationDirectory;

        const logger = this.createLogger(config);

        const context = new Context({
            runtime,
            config,
            paths,
            logger,
        });

        const viewService = this.createViewService(context);
        const datastore = await this.createAndLoadDatastore(context);

        // Register services using kixx.* namespace convention
        context.registerService('kixx.Datastore', datastore);
        context.registerService('kixx.AppViewService', viewService);

        await this.initializePlugins(context);

        return context;
    }

    async loadConfiguration(environment, configFilepath, secretsFilepath) {
        const configs = await this.#configStore.loadLatestConfigJSON(configFilepath);
        const secrets = await this.#configStore.loadLatestSecretsJSON(secretsFilepath);

        const { applicationDirectory } = this.#configStore;

        return Config.create(environment, configs, secrets, applicationDirectory);
    }

    createLogger(config) {
        const options = config.getNamespace('logger');

        const logger = new Logger({
            name: options.name || config.procName,
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

    async createAndLoadDatastore(context) {
        const { paths } = context;

        const datastore = new Datastore({
            directory: paths.kv_store_directory,
        });

        await datastore.load();

        return datastore;
    }

    createViewService(context) {
        const { logger, paths } = context;

        return new ViewService({
            logger,
            applicationDirectory: paths.app_directory,
            templatesDirectory: paths.templates_directory,
            partialsDirectory: paths.partials_directory,
            helpersDirectory: paths.helpers_directory,
            pageDirectory: paths.pages_directory,
        });
    }

    async initializePlugins(context) {
        const { paths } = context;
        const store = new PluginStore({ directory: paths.plugins_directory });
        const plugins = await store.loadPlugins();

        for (const { filepath, register, initialize } of plugins) {
            if (isFunction(register)) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await register(context);
                } catch (cause) {
                    throw new WrappedError(`Error calling plugin register() from ${ filepath }`, { cause });
                }
            }
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
}
