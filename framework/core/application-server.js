// @ts-check

import { ProgrammerError } from 'kixx-server-errors';
import EventBus from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import readFileConfiguration from '../configuration/read-file-configuration.js';
import startServers from '../servers/start-servers.js';
import { Events } from '../lib/events.js';

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

        const configs = await readFileConfiguration(this.#configDirectory);

        const config = configs.find(({ name }) => {
            return name === this.name;
        });

        if (!config) {
            throw new ProgrammerError(
                `Could not find application server configuration for ${ this.name }`,
                { fatal: true, name: this.name }
            );
        }

        const applications = await this.#initializeApplications(config);

        await startServers(logger, eventBus, applications, config);

        return this;
    }

    #initializeApplications(config) {
        const promises = [];

        const emitEvent = this.eventBus.emitEvent.bind(this.eventBus);

        function findApplicationConfig(appName) {
            return config.applications.find(({ name }) => {
                return name === appName;
            });
        }

        this.#applications.forEach((appContext) => {
            const appConfig = findApplicationConfig(appContext.name);

            if (!appConfig) {
                // Do not initialize applications which are not configured.
                return;
            }

            // Proxy events from the ApplicationContext up to the
            // ApplicationServer (multitenant) context.
            appContext.eventBus.on(Events.DEBUG, emitEvent);
            appContext.eventBus.on(Events.INFO, emitEvent);
            appContext.eventBus.on(Events.ERROR, emitEvent);

            promises.push(appContext.initialize(appConfig));
        });

        return Promise.all(promises).then((applications) => {
            return applications.reduce((map, app) => {
                map.set(app.name, app);
                return map;
            }, new Map());
        });
    }
}
