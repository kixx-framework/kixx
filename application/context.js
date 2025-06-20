import process from 'node:process';
import { assert } from '../assertions/mod.js';
import Datastore from '../datastore/datastore.js';
import JobQueue from '../job-queue/job-queue.js';
import ViewService from '../view-service/view-service.js';


export default class Context {

    #services = new Map();

    constructor({ config, paths, logger }) {
        this.config = config;
        this.paths = paths;
        this.logger = logger;
    }

    registerService(name, service) {
        this.#services.set(name, service);
    }

    getService(name) {
        assert(this.#services.has(name), `The service "${ name }" is not registered`);
        return this.#services.get(name);
    }

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

async function loadDatastore(paths) {
    const datastore = new Datastore({
        directory: paths.kv_store_directory,
    });

    await datastore.load();

    return datastore;
}

function createViewService(logger, paths) {
    return new ViewService({
        logger,
        // Directory tree where application template files are stored.
        templateDirectory: paths.application_templates_directory,
        // Directory tree where application template partials are stored.
        partialsDirectory: paths.application_partials_directory,
        // Directory tree where page data files (index.json) are stored, and
        // represent pathnames for the server.
        pageDirectory: paths.application_pages_directory,
        // File path to the site-wide page data JSON file.
        sitePageDataFilepath: paths.application_site_page_data_filepath,
    });
}
