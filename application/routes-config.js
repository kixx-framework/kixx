import path from 'node:path';
import { AssertionError } from '../errors/mod.js';
import { assertArray } from '../assertions/mod.js';
import VirtualHostSpec from '../http-server/virtual-host-spec.js';
import HttpRouteSpec from '../http-server/http-route-spec.js';
import defaultRoutes from './default-routes.js';
import { readJSONFile } from '../lib/file-system.js';


/**
 * RoutesConfig
 * ============
 *
 * The RoutesConfig class is responsible for loading and validating the application's
 * virtual host and route configuration. It supports loading configuration from
 * JSON files, resolving route URNs, and validating route and virtual host specs.
 *
 * Core Features:
 *   - Loads virtual host configuration from a JSON file.
 *   - Resolves and loads route configuration for each virtual host, supporting
 *     both built-in (kixx://) and application (app://) URNs.
 *   - Validates virtual host and route specs using VirtualHostSpec and HttpRouteSpec.
 *   - Assigns middleware, handlers, and error handlers to each virtual host.
 *
 * Usage Example:
 *   const routesConfig = new RoutesConfig(paths);
 *   const vhosts = await routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);
 */
export default class RoutesConfig {
    /**
     * @private
     * @type {Object}
     * Stores the application's paths object.
     */
    #paths = null;

    /**
     * Construct a new RoutesConfig instance.
     *
     * @param {Object} paths - The application's paths object.
     */
    constructor(paths) {
        this.#paths = paths;
    }

    /**
     * Loads and returns an array of VirtualHost objects, with middleware and handlers assigned.
     *
     * @param {Array} middleware - Array of middleware functions to assign.
     * @param {Object} handlers - Object mapping handler names to handler functions.
     * @param {Object} errorHandlers - Object mapping error handler names to functions.
     * @returns {Promise<Array>} Array of VirtualHost objects.
     */
    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            vhostSpec.flattenRoutes();
            return vhostSpec.toVirtualHost();
        });
    }

    /**
     * Loads and validates virtual host specs from configuration.
     *
     * @returns {Promise<Array>} Array of VirtualHostSpec instances.
     */
    async loadVhostSpecs() {
        const vhostsConfigs = await this.loadVhostsConfigs();
        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    /**
     * Loads the virtual hosts configuration file and resolves all route configs for each vhost.
     *
     * @returns {Promise<Array>} Array of virtual host config objects with routes resolved.
     * @throws {AssertionError} If the vhosts config is not an array.
     */
    async loadVhostsConfigs() {
        const filepath = this.#getVhostsConfigFilepath();
        const configs = await readJSONFile(filepath);

        assertArray(configs, `vhosts config must be an array (${ filepath })`);

        const promises = configs.map(this.loadRoutesConfigs.bind(this));

        return Promise.all(promises);
    }

    /**
     * Loads and resolves all route configs for a given virtual host config.
     *
     * @param {Object} vhostConfig - The virtual host config object.
     * @returns {Promise<Object>} The virtual host config with routes resolved and validated.
     */
    async loadRoutesConfigs(vhostConfig) {
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    /**
     * Resolves a route config URN for a given virtual host config.
     * Supports 'kixx://' for built-in routes and 'app://' for application routes.
     *
     * @param {Object} vhostConfig - The virtual host config object.
     * @param {string} urn - The route config URN to resolve.
     * @returns {Promise<Array>} Array of validated route config objects.
     * @throws {AssertionError} If the URN is invalid or the routes config is not an array.
     */
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

    /**
     * Returns the file path to the application's virtual hosts config file.
     *
     * @private
     * @returns {string} The virtual hosts config file path.
     */
    #getVhostsConfigFilepath() {
        return this.#paths.application_vhosts_config;
    }

    /**
     * Returns the directory path to the application's routes config directory.
     *
     * @private
     * @returns {string} The routes config directory path.
     */
    #getRoutesConfigDirectory() {
        return this.#paths.application_routes_directory;
    }
}
