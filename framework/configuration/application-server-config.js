// @ts-check

import ServerConfig from './server-config.js';
// Imported for TypeScript support
// eslint-disable-next-line no-unused-vars
import ApplicationConfig, { ApplicationConfigSpecification } from './application-config.js';

export default class ApplicationServerConfig {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {String|null}
     */
    ssl_certificate_directory;

    /**
     * @type {Array<ServerConfig>}
     */
    servers = [];

    /**
     * @type {Array<ApplicationConfig>}
     */
    applications = [];

    constructor(spec) {

        this.name = spec.name;
        this.ssl_certificate_directory = spec.ssl_certificate_directory || null;
        this.servers = Object.freeze(spec.servers || []);
        this.applications = Object.freeze(spec.applications || []);

        Object.freeze(this);
    }

    /**
     * @param  {BaseConfig} config
     * @param  {Array<ApplicationConfigSpecification>} applicationConfigs
     * @return {ApplicationServerConfig}
     */
    static fromConfigFile(config, applicationConfigs) {
        // TODO: Data validation for server config files

        const servers = config.servers.map(ServerConfig.fromConfigFile);

        const applications = applicationConfigs.map((appConfig) => {
            return ApplicationConfig.fromConfigFile(servers, appConfig);
        });

        return new ApplicationServerConfig({
            ssl_certificate_directory: config.ssl_certificate_directory,
            name: config.name,
            servers,
            applications,
        });
    }
}

export class BaseConfig {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {Array<{ port:Number, encrypted:Boolean }>}
     */
    servers = [];

    /**
     * @type {String|undefined}
     */
    ssl_certificate_directory;
}
