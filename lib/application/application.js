import path from 'node:path';
import ConfigStore from './config-store.js';
import Config from './config.js';
import Paths from './paths.js';
import Logger from '../logger/mod.js';
import Context from './context.js';
import PluginStore from './plugin-store.js';
import RoutesStore from './routes-store.js';
import Datastore from '../datastore/datastore.js';
import ViewService from '../view-service/view-service.js';
import { WrappedError } from '../errors/mod.js';
import { middleware, registerMiddleware } from '../http-server/request-handlers/middleware/mod.js';
import { handlers, registerHandler } from '../http-server/request-handlers/handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../http-server/request-handlers/error-handlers/mod.js';
import * as fileSystem from '../lib/file-system.js';

import {
    isFunction,
    isNonEmptyString,
    assert,
    assertNonEmptyString,
    assertFunction
} from '../assertions/mod.js';


/**
 * @typedef {Object} PluginDescriptor
 * @property {string} directory - Plugin's root directory path
 * @property {string} filepath - Path to the plugin's main file (plugin.js or plugin.mjs)
 * @property {Function|null} register - Plugin registration function
 * @property {Function|null} initialize - Plugin initialization function
 * @property {string} middlewareDirectory - Path to middleware handlers
 * @property {string} requestHandlerDirectory - Path to request handlers
 * @property {string} errorHandlerDirectory - Path to error handlers
 */


export default class Application {

    #environment = null;
    #currentWorkingDirectory = null;
    #applicationDirectory = null;
    #configFilepath = null;
    #secretsFilepath = null;
    #configStore = null;
    #config = null;
    #context = null;
    #fileSystem = null;

    constructor(options) {
        const {
            currentWorkingDirectory,
            applicationDirectory,
        } = options;

        assertNonEmptyString(currentWorkingDirectory, 'An Application instance requires a currentWorkingDirectory path');

        this.#currentWorkingDirectory = currentWorkingDirectory;

        // The application directory is not required in the constructor. If not provided here
        // it can be derived in the initialization method based on the location of the
        // current working directory and config filepath.
        if (isNonEmptyString(applicationDirectory)) {
            this.#applicationDirectory = applicationDirectory;
        }

        this.#fileSystem = options.fileSystem || fileSystem;
    }

    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    get context() {
        return this.context;
    }

    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        assertNonEmptyString(environment);
        assertNonEmptyString(configFilepath);
        assertNonEmptyString(secretsFilepath);

        this.#environment = environment;
        this.#configFilepath = configFilepath;
        this.#secretsFilepath = secretsFilepath;

        const config = await this.loadConfiguration();
        const paths = this.createPathsConfiguration(config.applicationDirectory);
        const logger = this.createLogger(config);
        const context = this.createContext(runtime, config, paths, logger);

        const viewService = await this.createAndInitializeViewService();
        const datastore = await this.createAndLoadDatastore();

        // Register services using kixx.* namespace convention
        context.registerService('kixx.Datastore', datastore);
        context.registerService('kixx.AppViewService', viewService);

        await this.initializePlugins();

        return context;
    }

    async loadConfiguration() {
        assertNonEmptyString(this.#environment);
        assertNonEmptyString(this.#configFilepath);
        assertNonEmptyString(this.#secretsFilepath);

        if (!this.#configStore) {
            this.#configStore = new ConfigStore({
                currentWorkingDirectory: this.#currentWorkingDirectory,
                applicationDirectory: this.#applicationDirectory,
            });
        }

        const configs = await this.#configStore.loadLatestConfigJSON(this.#configFilepath);
        const secrets = await this.#configStore.loadLatestSecretsJSON(this.#secretsFilepath);

        const { applicationDirectory } = this.#configStore;
        this.#applicationDirectory = applicationDirectory;

        if (this.#config) {
            this.#config.updateConfig(this.#environment, configs);
            this.#config.updateSecrets(this.#environment, secrets);
        } else {
            this.#config = Config.create(this.#environment, configs, secrets, applicationDirectory);
        }

        return this.#config;
    }

    createPathsConfiguration(applicationDirectory) {
        return new Paths(applicationDirectory);
    }

    createLogger(config) {
        const options = config.getNamespace('logger');

        const logger = new Logger({
            name: options.name || config.procName,
            level: options.level || 'debug',
            mode: options.mode || 'console',
        });

        // Set up dynamic reconfiguration - allows changing log level/mode
        // without restarting the application.
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

    createContext(runtime, config, paths, logger) {
        this.#context = new Context({
            runtime,
            config,
            paths,
            logger,
        });
        return this.#context;
    }

    async createAndLoadDatastore(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to createAndLoadDatastore()');
        const { paths } = context;

        const datastore = new Datastore({
            directory: paths.kv_store_directory,
        });

        await datastore.load();
        return datastore;
    }

    async createAndInitializeViewService(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to createAndInitializeViewService()');
        const { paths } = context;

        const viewService = new ViewService({
            pageDirectory: paths.pages_directory,
            templatesDirectory: paths.templates_directory,
            partialsDirectory: paths.partials_directory,
            helpersDirectory: paths.helpers_directory,
        });

        await viewService.initialize();
        return viewService;
    }

    async initializePlugins(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to initializePlugins()');

        const { paths } = context;
        const pluginStore = new PluginStore({ directory: paths.plugins_directory });
        const plugins = await pluginStore.loadPlugins();

        for (const plugin of plugins) {
            const { filepath, register, initialize } = plugin;

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

            // eslint-disable-next-line no-await-in-loop
            await this.loadHandlersFromPlugin(plugin);
        }
    }

    /**
     * Loads and registers all handler types from a single plugin
     *
     * @async
     * @param {PluginDescriptor} plugin - Plugin with handler directory paths
     * @returns {Promise<void>}
     * @throws {WrappedError} When any handler directory fails to load
     */
    async loadHandlersFromPlugin(plugin) {
        const {
            middlewareDirectory,
            requestHandlerDirectory,
            errorHandlerDirectory,
        } = plugin;

        await Promise.all([
            this.loadMiddlewareDirectory(middlewareDirectory, registerMiddleware),
            this.loadMiddlewareDirectory(requestHandlerDirectory, registerHandler),
            this.loadMiddlewareDirectory(errorHandlerDirectory, registerErrorHandler),
        ]);
    }

    async loadMiddlewareDirectory(directory, register) {
        const entries = await this.#fileSystem.readDirectory(directory);

        const files = entries.filter((entry) => entry.isFile());

        const promises = files.map((file) => {
            const filepath = path.join(directory, file.name);

            return this.loadMiddlewareFunction(filepath).then((fn) => {
                register(fn.name, fn);
                return true;
            });
        });

        await Promise.all(promises);
    }

    async loadMiddlewareFunction(filepath) {
        let mod;
        try {
            mod = await this.#fileSystem.importAbsoluteFilepath(filepath);
        } catch (cause) {
            throw new WrappedError(`Error loading module from ${ filepath }`, { cause });
        }

        assertFunction(mod.default, `Middlware default export from ${ filepath } must be a function`);

        return mod.default;
    }

    async loadRoutes(context) {
        context = context || this.#context;
        assert(context, 'A Context object must be provided to loadRoutes()');

        const { paths } = context;

        const routesStore = new RoutesStore({
            app_directory: paths.app_directory,
            routes_directory: paths.routes_directory,
        });

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        return vhosts;
    }
}
