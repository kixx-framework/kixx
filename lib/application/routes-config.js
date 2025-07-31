import path from 'node:path';
import { AssertionError } from '../errors/mod.js';
import { assertArray } from '../assertions/mod.js';
import VirtualHostSpec from '../http-server/virtual-host-spec.js';
import HttpRouteSpec from '../http-server/http-route-spec.js';
import defaultRoutes from './default-routes.js';
import { readJSONFile } from '../lib/file-system.js';

/**
 * @typedef {Object} ApplicationPaths
 * @property {string} vhosts_config - Path to the virtual hosts configuration file
 * @property {string} routes_directory - Path to the routes configuration directory
 */

/**
 * @typedef {Object} VirtualHostConfig
 * @property {string} name - Name identifier for the virtual host
 * @property {string[]} routes - Array of route URNs to resolve and load
 */

/**
 * @fileoverview Loads and validates application virtual host and route configuration
 *
 * The RoutesConfig class handles loading configuration from JSON files, resolving
 * route URNs (both built-in kixx:// and application app:// schemes), and validating
 * configuration using VirtualHostSpec and HttpRouteSpec classes.
 */

/**
 * Loads and validates virtual host and route configuration from JSON files
 *
 * Supports resolving route URNs with two schemes:
 * - kixx:// for built-in framework routes
 * - app:// for application-specific routes
 *
 * @example
 * const routesConfig = new RoutesConfig(paths);
 * const vhosts = await routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);
 */
export default class RoutesConfig {
    /**
     * Application paths configuration object
     * @private
     * @type {ApplicationPaths}
     */
    #paths = null;

    /**
     * Creates a new RoutesConfig instance
     * @param {ApplicationPaths} paths - Application paths configuration object
     */
    constructor(paths) {
        this.#paths = paths;
    }

    /**
     * Loads virtual hosts with assigned middleware and handlers
     * @async
     * @param {Function[]} middleware - Array of middleware functions to assign
     * @param {Object.<string, Function>} handlers - Map of handler names to functions
     * @param {Object.<string, Function>} errorHandlers - Map of error handler names to functions
     * @returns {Promise<Object[]>} Array of VirtualHost objects ready for use
     * @throws {AssertionError} When virtual hosts config is invalid or missing
     * @throws {Error} When file system operations fail
     */
    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            // Transform specs into runtime objects: assign handlers, flatten route hierarchy, convert to VirtualHost
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            vhostSpec.flattenRoutes();
            return vhostSpec.toVirtualHost();
        });
    }

    /**
     * Loads and validates virtual host specifications
     * @async
     * @returns {Promise<Object[]>} Array of validated VirtualHostSpec instances
     * @throws {AssertionError} When virtual host configurations are invalid
     * @throws {Error} When configuration files cannot be read
     */
    async loadVhostSpecs() {
        const vhostsConfigs = await this.loadVhostsConfigs();
        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    /**
     * Loads virtual hosts configuration and resolves all route configurations
     * @async
     * @returns {Promise<VirtualHostConfig[]>} Virtual host configs with resolved routes
     * @throws {AssertionError} When vhosts config is not an array
     * @throws {Error} When configuration file cannot be read
     */
    async loadVhostsConfigs() {
        const filepath = this.#getVhostsConfigFilepath();
        const configs = await readJSONFile(filepath);

        assertArray(configs, `vhosts config must be an array (${ filepath })`);

        // Resolve route configs for all vhosts concurrently to avoid blocking on I/O
        const promises = configs.map(this.loadRoutesConfigs.bind(this));

        return Promise.all(promises);
    }

    /**
     * Resolves route configurations for a virtual host
     * @async
     * @param {VirtualHostConfig} vhostConfig - Virtual host configuration object
     * @returns {Promise<VirtualHostConfig>} Virtual host config with resolved and validated routes
     * @throws {AssertionError} When route URNs are invalid or route configs are malformed
     * @throws {Error} When route configuration files cannot be read
     */
    async loadRoutesConfigs(vhostConfig) {
        // Each route entry in vhostConfig.routes is a URN that may resolve to multiple route configs
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // Flatten the 2D array: each URN can resolve to multiple routes, so we get [[routes], [routes], ...]
        // and need to flatten to [route, route, route, ...] for the final vhost configuration
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    /**
     * Resolves a route configuration URN to route objects
     * @async
     * @param {VirtualHostConfig} vhostConfig - Virtual host configuration for context
     * @param {string} urn - Route URN (kixx:// for built-in, app:// for application routes)
     * @returns {Promise<Object[]>} Array of validated route configuration objects
     * @throws {AssertionError} When URN scheme is unsupported or route configs are invalid
     * @throws {Error} When application route files cannot be read
     *
     * @example
     * // Built-in routes
     * await resolveRoutesConfigUrn(vhost, 'kixx://default');
     *
     * @example
     * // Application routes
     * await resolveRoutesConfigUrn(vhost, 'app://api/v1/users.json');
     */
    async resolveRoutesConfigUrn(vhostConfig, urn) {
        let routesConfigs;

        // Support two URN schemes: kixx:// for framework defaults, app:// for application-specific routes
        if (urn.startsWith('kixx://')) {
            // Built-in routes are preloaded and always available (no I/O needed)
            routesConfigs = defaultRoutes;
        } else if (urn.startsWith('app://')) {
            // Application routes: convert URN path to filesystem path
            // e.g., "app://api/v1/users.json" becomes "routes/api/v1/users.json"
            const pathnameParts = urn.split('://')[1].split('/').filter(Boolean);
            const filepath = path.join(this.#getRoutesConfigDirectory(), ...pathnameParts);
            routesConfigs = await readJSONFile(filepath);
        } else {
            throw new AssertionError(`Invalid routes config URN: ${ urn }`);
        }

        assertArray(routesConfigs, `routes config must be an array (${ urn })`);

        // Validate each route config and enhance error messages with context
        return routesConfigs.map((config, index) => {
            try {
                HttpRouteSpec.validateAndCreate(config, vhostConfig.name, index);
            } catch (cause) {
                // Wrap validation errors with URN context to help debugging configuration issues
                throw new AssertionError(`Error validating routes config: ${ cause.message } (${ urn })`, { cause });
            }
            return config;
        });
    }

    /**
     * Gets the virtual hosts configuration file path
     * @private
     * @returns {string} Path to vhosts configuration file
     */
    #getVhostsConfigFilepath() {
        return this.#paths.vhosts_config;
    }

    /**
     * Gets the routes configuration directory path
     * @private
     * @returns {string} Path to routes configuration directory
     */
    #getRoutesConfigDirectory() {
        return this.#paths.routes_directory;
    }
}
