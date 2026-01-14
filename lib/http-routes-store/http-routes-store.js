import path from 'node:path';
import { AssertionError, WrappedError, ValidationError } from '../errors/mod.js';
import * as fileSystem from '../lib/file-system.js';
import VirtualHostSpec from './virtual-host-spec.js';
import HttpRouteSpec from './http-route-spec.js';
import { isNonEmptyString } from '../assertions/mod.js';

/**
 * Manages loading and compilation of HTTP route configurations from the filesystem.
 *
 * Loads virtual host configurations from JSON/JSONC files, resolves route URNs to file paths,
 * validates route specifications, and compiles them into executable VirtualHost instances
 * with resolved middleware and handlers.
 */
export default class HttpRoutesStore {

    /**
     * Application root directory path where virtual-hosts.json/jsonc is located
     * @type {string}
     */
    #app_directory = null;

    /**
     * Directory path containing route configuration files referenced by URNs
     * @type {string}
     */
    #routes_directory = null;

    /**
     * File system interface for reading directories and JSON files
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Creates a new HttpRoutesStore instance for loading and compiling route configurations.
     *
     * @param {Object} options - Store configuration options
     * @param {string} options.app_directory - Application root directory path where virtual-hosts.json/jsonc is located
     * @param {string} options.routes_directory - Directory containing route configuration files referenced by URNs
     * @param {Object} [options.fileSystem] - File system interface (defaults to built-in file-system module)
     */
    constructor(options) {
        this.#app_directory = options.app_directory;
        this.#routes_directory = options.routes_directory;
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    /**
     * Loads virtual host configurations from the filesystem and compiles them into executable instances.
     *
     * Reads virtual host specifications from virtual-hosts.json/jsonc, resolves route URNs to
     * route configuration files, validates all route specifications, assigns middleware and handlers,
     * and converts specifications into executable VirtualHost instances ready for request routing.
     *
     * @async
     * @param {Map<string, Function>} middleware - Registry mapping middleware names to factory functions
     * @param {Map<string, Function>} handlers - Registry mapping handler names to factory functions
     * @param {Map<string, Function>} errorHandlers - Registry mapping error handler names to factory functions
     * @returns {Promise<Array<VirtualHost>>} Array of compiled VirtualHost instances ready for request routing
     */
    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.#loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            // Transform specs into runtime objects:
            //  - assign handlers
            //  - convert to VirtualHost
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            return vhostSpec.toVirtualHost();
        });
    }

    /**
     * Loads virtual host specifications from virtual-hosts.json/jsonc file.
     *
     * Reads the virtual hosts configuration file from the app directory, loads route
     * configurations referenced by URNs, and validates all virtual host specifications.
     * @returns {Promise<Array<VirtualHostSpec>>} Array of validated VirtualHostSpec instances
     */
    async #loadVhostSpecs() {
        const filenames = [ 'virtual-hosts.json', 'virtual-hosts.jsonc' ];
        const rootFiles = this.#fileSystem.readDirectory(this.#app_directory);

        const routesConfigFile = rootFiles.find(({ name }) => {
            return filenames.includes(name);
        });

        if (!routesConfigFile) {
            throw new AssertionError(
                `Unable to find expected virtual-hosts.json or virtual-hosts.jsonc file in app directory (${ this.#app_directory })`,
                null,
                this.loadVirtualHosts
            );
        }

        const filepath = path.join(this.#app_directory, routesConfigFile.name);

        let configs;
        try {
            configs = await this.#fileSystem.readJSONFile(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Error reading virtual hosts config file (${ filepath })`,
                { cause },
                this.loadVirtualHosts
            );
        }

        // Since we just read the directory, this condition should only happen when there is
        // a strange race condition after reading the directory.
        if (!configs) {
            throw new WrappedError(
                `Unable to load virtual hosts config file (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        if (!Array.isArray(configs)) {
            throw new ValidationError(
                `vhost configs must be an Array (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        const promises = configs.map((config) => {
            return this.#loadRoutesConfigs(config, filepath);
        });

        const vhostsConfigs = await Promise.all(promises);

        try {
            // Creating the VirtualHostSpec will flatten the nested routes into a single array.
            return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
        } catch (cause) {
            throw new ValidationError(`${ cause.message } (${ filepath })`, { cause }, this.loadVirtualHosts);
        }
    }

    /**
     * Loads route configurations for a virtual host by resolving URNs to route files.
     *
     * Each URN in the virtual host's routes array is resolved to a route configuration file,
     * which may contain multiple route definitions. All route configs are flattened into a
     * single array and validated before being added to the virtual host configuration.
     * @param {Object} vhostConfig - Virtual host configuration object with routes array
     * @param {string} filepath - Source file path for error reporting
     * @returns {Promise<Object>} Virtual host configuration with loaded and validated routes
     */
    async #loadRoutesConfigs(vhostConfig, filepath) {
        if (!Array.isArray(vhostConfig.routes)) {
            throw new ValidationError(
                `vhost routes must be an Array (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        // Each URN in vhostConfig.routes may resolve to multiple route configs.
        const promises = vhostConfig.routes.map((urn) => {
            return this.#loadRoutesConfigsFile(urn, filepath);
        });

        const matrix = await Promise.all(promises);

        // Flatten 2D array: [[routes], [routes], ...] -> [route, route, route, ...]
        // Each URN can expand to multiple routes, so we need to flatten it into
        // a single array for the final vhost config.
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    /**
     * Loads route configurations from a single route file referenced by URN.
     *
     * Resolves the URN to a filesystem path, reads the route configuration file,
     * and validates each route specification. Returns an array of validated route
     * configuration objects with enhanced error messages including route index context.
     * @param {string} urn - URN string referencing the route configuration file (e.g., "app://api/v1/users.jsonc")
     * @param {string} sourceFilepath - Source file path for error reporting
     * @returns {Promise<Array<HttpRouteSpec>>} Array of validated route configuration objects
     */
    async #loadRoutesConfigsFile(urn, sourceFilepath) {
        if (!isNonEmptyString(urn)) {
            throw new ValidationError(
                `vhost routes must be an Array of URN strings (${ sourceFilepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        const filepath = this.#resolveAppUrnToFilepath(urn, sourceFilepath);

        let routeConfigs;
        try {
            routeConfigs = await this.#fileSystem.readJSONFile(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Error reading HTTP routes config file (${ filepath })`,
                { cause },
                this.loadVirtualHosts
            );
        }

        if (!routeConfigs) {
            routeConfigs = [];
        }

        if (!Array.isArray(routeConfigs)) {
            throw new ValidationError(
                `HTTP route configs must be an Array (${ filepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        // Validate each route config and enhance error messages with context.
        return routeConfigs.map((config, index) => {
            try {
                return HttpRouteSpec.validateAndCreate(config, urn, index);
            } catch (cause) {
                throw new ValidationError(
                    `${ cause.message }: ${ urn }#routes[${ index }]`,
                    { cause },
                    this.loadVirtualHosts
                );
            }
        });
    }

    /**
     * Resolves an application URN to a filesystem filepath.
     *
     * Converts URN strings (e.g., "app://api/v1/users.jsonc") to absolute filesystem paths
     * by parsing the URN, validating the protocol, and joining the pathname with the routes
     * directory. Query strings and fragments in the URN are automatically ignored.
     * @param {string} urn - URN string with app: protocol (e.g., "app://api/v1/users.jsonc")
     * @param {string} sourceFilepath - Source file path for error reporting
     * @returns {string} Absolute filesystem path to the route configuration file
     */
    #resolveAppUrnToFilepath(urn, sourceFilepath) {
        // Convert URN path to filesystem path
        // e.g., "app://api/v1/users.jsonc" becomes "/users/me/my_project/routes/api/v1/users.jsonc"
        let url;
        try {
            url = new URL(urn);
        } catch (cause) {
            throw new ValidationError(
                `Invalid URN format: ${ cause.message }: ${ urn } (${ sourceFilepath })`,
                { cause },
                this.loadVirtualHosts
            );
        }

        if (url.protocol !== 'app:') {
            throw new ValidationError(
                `Invalid URN protocol: ${ url.protocol } (expected app:) (${ sourceFilepath })`,
                null,
                this.loadVirtualHosts
            );
        }

        // Remove leading slash from pathname and split into parts
        // Query strings and fragments are automatically ignored by URL.pathname
        const pathnameParts = url.pathname.split('/').filter(Boolean);
        return path.join(this.#routes_directory, ...pathnameParts);
    }
}
