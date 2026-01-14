import path from 'node:path';
import { AssertionError, WrappedError, ValidationError } from '../errors/mod.js';
import * as fileSystem from '../lib/file-system.js';
import VirtualHostSpec from './virtual-host-spec.js';
import HttpRouteSpec from './http-route-spec.js';
import { isNonEmptyString } from '../assertions/mod.js';


export default class HttpRoutesStore {

    #app_directory = null;
    #routes_directory = null;
    #fileSystem = null;

    /**
     * @param {object} options
     * @param {string} options.app_directory - Application root directory path
     * @param {string} options.routes_directory - Directory containing route configuration files
     * @param {Object} [options.fileSystem] - File system interface (defaults to built-in)
     */
    constructor(options) {
        this.#app_directory = options.app_directory;
        this.#routes_directory = options.routes_directory;
        this.#fileSystem = options.fileSystem || fileSystem;
    }

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
                HttpRouteSpec.validateAndCreate(config, urn, index);
            } catch (cause) {
                throw new ValidationError(
                    `${ cause.message }: ${ urn }#routes[${ index }]`,
                    { cause },
                    this.loadVirtualHosts
                );
            }
            return config;
        });
    }

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
