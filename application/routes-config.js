import path from 'node:path';
import { AssertionError } from '../errors/mod.js';
import { assertArray } from '../assertions/mod.js';
import VirtualHostSpec from '../http-server/virtual-host-spec.js';
import HttpRouteSpec from '../http-server/http-route-spec.js';
import defaultRoutes from './default-routes.js';
import { readJSONFile } from '../lib/file-system.js';


export default class RoutesConfig {

    #paths = null;

    constructor(paths) {
        this.#paths = paths;
    }

    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            vhostSpec.flattenRoutes();
            return vhostSpec.toVirtualHost();
        });
    }

    async loadVhostSpecs() {
        const vhostsConfigs = await this.loadVhostsConfigs();
        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    async loadVhostsConfigs() {
        const filepath = this.#getVhostsConfigFilepath();
        const configs = await readJSONFile(filepath);

        assertArray(configs, `vhosts config must be an array (${ filepath })`);

        const promises = configs.map(this.loadRoutesConfigs.bind(this));

        return Promise.all(promises);
    }

    async loadRoutesConfigs(vhostConfig) {
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    async resolveRoutesConfigUrn(vhostConfig, urn) {
        let routesConfigs;

        if (urn.startsWith('kixx://')) {
            routesConfigs = defaultRoutes;
        } else if (urn.startsWith('app://')) {
            const pathnameParts = urn.split('://')[1].split('/').filter(Boolean);
            const filepath = path.join(this.#getRoutesConfigDirectory(), ...pathnameParts);
            routesConfigs = await readJSONFile(filepath);
        } else {
            throw new AssertionError(`Invalid routes config URN: ${ urn }`);
        }

        assertArray(routesConfigs, `routes config must be an array (${ urn })`);

        return routesConfigs.map((config, index) => {
            try {
                HttpRouteSpec.validateAndCreate(config, vhostConfig.name, index);
            } catch (cause) {
                throw new AssertionError(`Error validating routes config: ${ cause.message } (${ urn })`, { cause });
            }
            return config;
        });
    }

    #getVhostsConfigFilepath() {
        return this.#paths.application_vhosts_config;
    }

    #getRoutesConfigDirectory() {
        return this.#paths.application_routes_directory;
    }
}
