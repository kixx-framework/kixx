import process from 'node:process';
import { assert } from '../assertions/mod.js';
import Datastore from '../datastore/datastore.js';
import JobQueue from '../job-queue/job-queue.js';
import ViewService from '../view-service/view-service.js';


/**
 * Context
 * =======
 *
 * The Context class provides a central registry and accessor for core application services,
 * such as configuration, paths, logging, data stores, job queues, and view services.
 * It is responsible for managing the lifecycle and access to these services, and for providing
 * a consistent interface for other parts of the application to retrieve them.
 *
 * Core Features:
 *   - Registers and retrieves named services (e.g., Datastore, JobQueue, ViewService)
 *   - Provides access to application config, paths, and logger
 *   - Static loader for initializing and wiring up all core services
 *
 * Usage Example:
 *   const context = await Context.load(config, paths, logger);
 *   const datastore = context.getService('kixx.Datastore');
 *   const jobQueue = context.getService('kixx.JobQueue');
 */
export default class Context {
    /**
     * @private
     * @type {Map<string, any>}
     * Internal registry of named services.
     */
    #services = new Map();

    /**
     * Construct a new Context instance.
     *
     * @param {Object} options
     * @param {Object} options.config - The application configuration object.
     * @param {Object} options.paths - The application paths object.
     * @param {Object} options.logger - The application logger instance.
     */
    constructor({ config, paths, logger }) {
        /**
         * The application configuration object.
         * @type {Object}
         */
        this.config = config;

        /**
         * The application paths object.
         * @type {Object}
         */
        this.paths = paths;

        /**
         * The application logger instance.
         * @type {Object}
         */
        this.logger = logger;
    }

    /**
     * Registers a service instance under a given name.
     *
     * @param {string} name - The unique name for the service.
     * @param {any} service - The service instance to register.
     */
    registerService(name, service) {
        this.#services.set(name, service);
    }

    /**
     * Retrieves a registered service by name.
     *
     * @param {string} name - The name of the service to retrieve.
     * @returns {any} The registered service instance.
     * @throws {AssertionError} If the service is not registered.
     */
    getService(name) {
        assert(this.#services.has(name), `The service "${ name }" is not registered`);
        return this.#services.get(name);
    }

    /**
     * Loads and initializes all core application services, registers them, and returns a Context instance.
     *
     * @param {Object} config - The application configuration object.
     * @param {Object} paths - The application paths object.
     * @param {Object} logger - The application logger instance.
     * @returns {Promise<Context>} The fully initialized Context instance.
     */
    static async load(config, paths, logger) {
        const context = new Context({
            config,
            paths,
            logger,
        });

        const viewService = createViewService(logger, paths);
        const datastore = await loadDatastore(paths);
        const jobQueue = createJobQueue(logger, paths);

        context.registerService('kixx.Datastore', datastore);
        context.registerService('kixx.JobQueue', jobQueue);
        context.registerService('kixx.AppViewService', viewService);

        return context;
    }
}

/**
 * Creates and configures a JobQueue instance, wiring up logger event handlers.
 *
 * @param {Object} logger - The application logger instance.
 * @param {Object} paths - The application paths object.
 * @returns {JobQueue} The configured JobQueue instance.
 */
function createJobQueue(logger, paths) {
    const jobQueue = new JobQueue({
        directory: paths.job_directory,
    });

    jobQueue.on('error', (event) => {
        logger.error(event.message, event.info, event.cause);
        if (event.fatal) {
            logger.error(`${ event.name }:${ event.message }; fatal error; exiting`);
            process.exit(1);
        }
    });

    jobQueue.on('debug', (event) => {
        logger.debug(event.message, event.info, event.cause);
    });

    jobQueue.on('info', (event) => {
        logger.info(event.message, event.info, event.cause);
    });

    jobQueue.on('warning', (event) => {
        logger.warn(event.message, event.info, event.cause);
    });

    return jobQueue;
}

/**
 * Loads and initializes the Datastore service.
 *
 * @param {Object} paths - The application paths object.
 * @returns {Promise<Datastore>} The loaded Datastore instance.
 */
async function loadDatastore(paths) {
    const datastore = new Datastore({
        directory: paths.kv_store_directory,
    });

    await datastore.load();

    return datastore;
}

/**
 * Creates and configures a ViewService instance.
 *
 * @param {Object} logger - The application logger instance.
 * @param {Object} paths - The application paths object.
 * @returns {ViewService} The configured ViewService instance.
 */
function createViewService(logger, paths) {
    return new ViewService({
        logger,
        // Directory tree where application template files are stored.
        templatesDirectory: paths.application_templates_directory,
        // Directory tree where application template partials are stored.
        partialsDirectory: paths.application_partials_directory,
        // Directory tree where application template helpers are stored.
        helpersDirectory: paths.application_helpers_directory,
        // Directory tree where page data files (index.json) are stored, and
        // represent pathnames for the server.
        pageDirectory: paths.application_pages_directory,
        // File path to the site-wide page data JSON file.
        sitePageDataFilepath: paths.application_site_page_data_filepath,
    });
}
