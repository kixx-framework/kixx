import process from 'node:process';
import { assert } from '../assertions/mod.js';
import Datastore from '../datastore/datastore.js';
import ObjectStore from '../object-store/object-store.js';
import JobQueue from '../job-queue/job-queue.js';
import ViewService from '../view-service/view-service.js';

/**
 * @typedef {Object} AppRuntime
 * @property {string} [command] - Command name when running as CLI
 * @property {Object} [server] - Server configuration when running as server
 * @property {string} server.name - Server name
 */

/**
 * @typedef {Object} AppConfig
 * @property {*} [key] - Configuration values (structure varies by application)
 */

/**
 * @typedef {Object} AppPaths
 * @property {string} job_directory - Directory path for job queue storage
 * @property {string} kv_store_directory - Directory path for key-value datastore
 * @property {string} object_store_directory - Directory path for object storage
 * @property {string} templates_directory - Directory path for view templates
 * @property {string} partials_directory - Directory path for template partials
 * @property {string} helpers_directory - Directory path for template helpers
 * @property {string} pages_directory - Directory path for page definitions
 * @property {string} site_page_data_filepath - File path for site page data
 */

/**
 * @typedef {Object} AppLogger
 * @property {Function} error - Log error messages
 * @property {Function} warn - Log warning messages
 * @property {Function} info - Log info messages
 * @property {Function} debug - Log debug messages
 */

/**
 * Central registry and accessor for core application services
 *
 * Manages lifecycle and access to core services including datastores, job queues,
 * and view services. Provides consistent interface for service retrieval throughout
 * the application.
 *
 * @example
 * const context = await Context.load(runtime, config, paths, logger);
 * const datastore = context.getService('kixx.Datastore');
 * const jobQueue = context.getService('kixx.JobQueue');
 */
export default class Context {
    /**
     * Internal registry of named services
     * @private
     * @type {Map<string, any>}
     */
    #services = new Map();

    /**
     * @param {Object} options - Context initialization options
     * @param {AppRuntime} options.runtime - Application runtime configuration
     * @param {AppConfig} options.config - Application configuration object
     * @param {AppPaths} options.paths - Application directory and file paths
     * @param {AppLogger} options.logger - Application logger instance
     */
    constructor({ runtime, config, paths, logger }) {
        /**
         * Application runtime configuration
         * @type {AppRuntime}
         */
        this.runtime = runtime;

        /**
         * Application configuration object
         * @type {AppConfig}
         */
        this.config = config;

        /**
         * Application directory and file paths
         * @type {AppPaths}
         */
        this.paths = paths;

        /**
         * Application logger instance
         * @type {AppLogger}
         */
        this.logger = logger;
    }

    /**
     * Registers a service instance under a unique name
     *
     * @param {string} name - Unique service identifier
     * @param {any} service - Service instance to register
     */
    registerService(name, service) {
        this.#services.set(name, service);
    }

    /**
     * Retrieves a registered service by name
     *
     * @param {string} name - Service identifier to retrieve
     * @returns {any} The registered service instance
     * @throws {Error} When service is not registered
     */
    getService(name) {
        assert(this.#services.has(name), `The service "${ name }" is not registered`);
        return this.#services.get(name);
    }

    /**
     * Initializes and wires up all core application services
     *
     * Creates instances of Datastore, ObjectStore, JobQueue, and ViewService,
     * performs any required async initialization, and registers them with
     * the context using kixx.* namespace convention.
     *
     * @async
     * @param {AppRuntime} runtime - Application runtime configuration
     * @param {AppConfig} config - Application configuration object
     * @param {AppPaths} paths - Application directory and file paths
     * @param {AppLogger} logger - Application logger instance
     * @returns {Promise<Context>} Fully initialized context with all services registered
     * @throws {Error} When service initialization fails
     */
    static async load(runtime, config, paths, logger) {
        const context = new Context({
            runtime,
            config,
            paths,
            logger,
        });

        // Initialize services in dependency order
        // ViewService and JobQueue are stateless and can be created immediately
        const viewService = createViewService(logger, paths);
        const jobQueue = createJobQueue(logger, paths);

        // Datastore and ObjectStore require async initialization to set up file system connections
        const datastore = await loadDatastore(paths);
        const objectStore = await loadObjectStore(paths);

        // Register services using kixx.* namespace convention
        // WARNING: When changing service names here, also update:
        // - Any code that calls context.getService() with these names
        // - Documentation referencing these service identifiers
        context.registerService('kixx.Datastore', datastore);
        context.registerService('kixx.ObjectStore', objectStore);
        context.registerService('kixx.JobQueue', jobQueue);
        context.registerService('kixx.AppViewService', viewService);

        return context;
    }
}

/**
 * Creates JobQueue instance with logger event handlers wired up
 *
 * Configures job queue to forward all events to application logger and
 * handles fatal errors by terminating the process to prevent data corruption.
 *
 * @param {AppLogger} logger - Application logger instance
 * @param {AppPaths} paths - Application paths for job directory
 * @returns {JobQueue} Configured JobQueue instance with event handlers
 */
function createJobQueue(logger, paths) {
    const jobQueue = new JobQueue({
        directory: paths.job_directory,
    });

    // Wire up event handlers to forward JobQueue events to application logger
    // This ensures all job queue activity is captured in application logs
    jobQueue.on('error', (event) => {
        logger.error(event.message, event.info, event.cause);
        if (event.fatal) {
            logger.error(`${ event.name }:${ event.message }; fatal error; exiting`);
            // Fatal job queue errors indicate corrupted state - immediate exit prevents data corruption
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
 * Loads and initializes Datastore with file system connections
 *
 * @async
 * @param {AppPaths} paths - Application paths for datastore directory
 * @returns {Promise<Datastore>} Initialized Datastore instance
 * @throws {Error} When datastore initialization or directory validation fails
 */
async function loadDatastore(paths) {
    const datastore = new Datastore({
        directory: paths.kv_store_directory,
    });

    // Load must be called to initialize file system connections and validate directory structure
    await datastore.load();

    return datastore;
}

/**
 * Creates and returns ObjectStore instance
 *
 * ObjectStore initializes lazily, so no explicit load operation is required.
 *
 * @async
 * @param {AppPaths} paths - Application paths for object store directory
 * @returns {Promise<ObjectStore>} ObjectStore instance
 */
async function loadObjectStore(paths) {
    const store = new ObjectStore({
        directory: paths.object_store_directory,
    });
    // ObjectStore initializes lazily - no explicit load() call needed
    return store;
}

/**
 * Creates ViewService instance with template directories configured
 *
 * @param {AppLogger} logger - Application logger instance
 * @param {AppPaths} paths - Application paths for template directories and files
 * @returns {ViewService} Configured ViewService instance
 */
function createViewService(logger, paths) {
    return new ViewService({
        logger,
        templatesDirectory: paths.templates_directory,
        partialsDirectory: paths.partials_directory,
        helpersDirectory: paths.helpers_directory,
        pageDirectory: paths.pages_directory,
        sitePageDataFilepath: paths.site_page_data_filepath,
    });
}
