// @ts-check

import KixxAssert from 'kixx-assert';
// Imported for TypeScript support
// eslint-disable-next-line no-unused-vars
import ServerConfig from './server-config.js';
import HostnameConfig from './hostname-config.js';

const { isNonEmptyString } = KixxAssert.helpers;

export default class ApplicationConfig {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {String}
     */
    environment;

    /**
     * @type {Boolean}
     */
    preferEncrypted = false;

    /**
     * @type {Array<Number>}
     */
    ports = [];

    /**
     * @type {Array<HostnameConfig>}
     */
    hostnames = [];

    constructor(spec) {

        this.name = spec.name;
        this.environment = spec.environment;
        this.ports = Object.freeze(spec.ports);
        this.hostnames = Object.freeze(spec.hostnames);
        this.preferEncrypted = spec.preferEncrypted;

        Object.freeze(this);
    }

    /**
     * @return {String|null}
     */
    getPreferredHost() {
        if (this.hostnames.length > 0) {
            return this.hostnames[0].hostname;
        }

        return null;
    }

    /**
     * @return {Number|null}
     */
    getPreferredPort() {
        if (this.ports.length > 0) {
            return this.ports[0];
        }

        return null;
    }

    /**
     * @param  {Array<ServerConfig>} servers
     * @param  {ApplicationConfigSpecification} config
     * @return {ApplicationConfig}
     */
    static fromConfigFile(servers, config) {
        // TODO: Validate server application configuration.
        const { name } = config;

        const serverPorts = servers.map((server) => server.port);

        const encryptedServerPorts = servers
            .filter((server) => server.encrypted)
            .map((server) => server.port);

        const environment = isNonEmptyString(config.environment)
            ? config.environment
            : 'production';

        const ports = Array.isArray(config.ports)
            ? config.ports.filter((port) => serverPorts.includes(port))
            : serverPorts;

        const tlsPorts = ports.filter((port) => {
            return encryptedServerPorts.includes(port);
        });

        const preferEncrypted = Boolean(tlsPorts.length);

        const hostnamConfigs = Array.isArray(config.hostnames) ? config.hostnames : [];

        const hostnames = hostnamConfigs.map(({ hostname, certificate }) => {
            return HostnameConfig.fromConfigFile(preferEncrypted, { hostname, certificate });
        });

        return new ApplicationConfig({
            name,
            environment,
            ports,
            hostnames,
            preferEncrypted,
        });
    }
}

export class ApplicationConfigSpecification {

    /**
     * @type {String}
     */
    name;

    /**
     * @type {String}
     */
    environment;

    /**
     * @type {Array<Number>|undefined}
     */
    ports = [];

    /**
     * @type {Array<{ hostname:String, certificate:String }>}
     */
    hostnames = [];
}
