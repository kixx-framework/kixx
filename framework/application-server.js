// @ts-check

import EventBus from './lib/event-bus.js';
import { createLogger } from './lib/logger.js';
import readFileConfiguration from './configuration/read-file-configuration.js';
import startServers from './servers/start-servers.js';

/**
 * @typedef ApplicationServerSpecification
 * @prop {String} name
 * @prop {String} environment
 * @prop {String} configDirectory
 */

export default class ApplicationServer {

    name;
    environment;
    logger;
    eventBus;

    #configDirectory;
    #applications = new Map();

    /**
     * @param {ApplicationServerSpecification} spec
     */
    constructor(spec) {
        const { name, environment, configDirectory } = spec;

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            environment: {
                enumerable: true,
                value: environment,
            },
            logger: {
                enumerable: true,
                value: createLogger({ environment, name }),
            },
            eventBus: {
                enumerable: true,
                value: new EventBus(),
            },
        });

        this.#configDirectory = configDirectory;
    }

    registerApplication(name, appContext) {
        this.#applications.set(name, appContext);
        return this;
    }

    async startNodeServer() {
        const { logger, eventBus } = this;

        const config = await readFileConfiguration(this.#configDirectory);

        const applications = await this.#initializeApplications();

        await startServers(logger, eventBus, applications, config);

        return this;
    }

    #initializeApplications() {
        const promises = [];

        this.#applications.forEach((appContext) => {
            promises.push(appContext.initialize());
        });

        return Promise.all(promises);
    }
}
