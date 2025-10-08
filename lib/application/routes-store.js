import path from 'node:path';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import { AssertionError, WrappedError, ValidationError } from '../errors/mod.js';
import { assertArray } from '../assertions/mod.js';
import VirtualHostSpec from '../http-server/virtual-host-spec.js';
import HttpRouteSpec from '../http-server/http-route-spec.js';
import defaultRoutes from './default-routes.js';
import * as fileSystem from '../lib/file-system.js';


export default class RoutesStore {

    #app_directory = null;
    #routes_directory = null;
    #fs = null;

    /**
     * @param {object} options
     * @param {string} options.app_directory - Application root directory path
     * @param {string} options.routes_directory - Directory containing route configuration files
     * @param {Object} [options.fileSystem] - File system interface (defaults to built-in)
     */
    constructor(options) {
        this.#app_directory = options.app_directory;
        this.#routes_directory = options.routes_directory;
        this.#fs = options.fileSystem || fileSystem;
    }

    /**
     * Loads VirtualHosts, and nested HttpRoutes and HttpTargets. Flattens
     * nested routes and hydrates with middleware and handlers.
     *
     * @param {Map<string, Function>} middleware - Named middleware functions
     * @param {Map<string, Function>} handlers - Named route handler functions
     * @param {Map<string, Function>} errorHandlers - Named error handler functions
     * @returns {Promise<Object[]>} Array of VirtualHosts
     */
    async loadVirtualHosts(middleware, handlers, errorHandlers) {
        const vhostSpecs = await this.loadVhostSpecs();

        return vhostSpecs.map((vhostSpec) => {
            // Transform specs into runtime objects:
            //  - assign handlers
            //  - flatten route hierarchy
            //  - convert to VirtualHost
            vhostSpec.assignMiddleware(middleware, handlers, errorHandlers);
            vhostSpec.flattenRoutes();
            return vhostSpec.toVirtualHost();
        });
    }

    /**
     * Loads the virtual host configuration with nested routes and returns
     * fully formed VirtualHostSpec, HttpRouteSpec, and HttpTargetSpec objects.
     *
     * @returns {Promise<VirtualHostSpec[]>} Array of validated virtual host specifications
     */
    async loadVhostSpecs() {
        const vhostsConfigs = await this.loadVhostsConfigs();
        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    /**
     * @private
     */
    async loadVhostsConfigs() {
        const filepath = this.getRoutesConfigFilepath();
        const configs = await this.loadJSONFile(filepath);

        if (!configs) {
            throw new AssertionError(
                `vhosts config file must exist: ${ filepath }`,
                null,
                this.loadVhostsConfigs
            );
        }

        assertArray(configs, `vhosts config must be an array: ${ filepath }`);

        const promises = configs.map(this.loadRoutesConfigs.bind(this));

        const routes = await Promise.all(promises);
        return routes;
    }

    /**
     * @private
     */
    async loadRoutesConfigs(vhostConfig) {
        // Each URN in vhostConfig.routes may resolve to multiple route configs.
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // Flatten 2D array: [[routes], [routes], ...] -> [route, route, route, ...]
        // Each URN can expand to multiple routes, so we need to flatten for
        // final vhost config.
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    /**
     * @private
     */
    async resolveRoutesConfigUrn(vhostConfig, urn) {
        let routesConfigs;

        // Support two URN schemes:
        //  - kixx:// for framework defaults
        //  - app:// for application-specific routes
        if (urn.startsWith('kixx://')) {
            routesConfigs = defaultRoutes;
        } else if (urn.startsWith('app://')) {
            const filepath = this.resolveAppUrnToFilepath(urn);
            routesConfigs = await this.loadJSONFile(filepath);
        } else {
            throw new AssertionError(
                `Invalid routes config URN: ${ urn } (expected kixx:// or app://)`,
                null,
                this.resolveRoutesConfigUrn
            );
        }

        assertArray(routesConfigs, `routes config must be an array (${ urn })`);

        // Validate each route config and enhance error messages with context.
        return routesConfigs.map((config, index) => {
            try {
                HttpRouteSpec.validateAndCreate(config, vhostConfig.name, index);
            } catch (cause) {
                throw new AssertionError(
                    `Error validating routes config: ${ urn } (${ cause.message })`,
                    { cause },
                    this.resolveRoutesConfigUrn
                );
            }
            return config;
        });
    }

    /**
     * @private
     */
    async loadJSONFile(filepath) {
        let config = await this.attemptReadJSONFile(filepath);

        if (config) {
            return config;
        }

        // If the first attempt didn't work, then try
        // changing the file extension.
        if (filepath.endsWith('.jsonc')) {
            filepath = filepath.replace(/\.jsonc$/, '.json');
        } else if (filepath.endsWith('.json')) {
            filepath = filepath.replace(/\.json$/, '.jsonc');
        } else {
            throw new AssertionError(
                `Invalid routes config file extension: ${ filepath } (expected .jsonc or .json)`,
                null,
                this.loadJSONFile
            );
        }

        config = await this.attemptReadJSONFile(filepath);
        return config;
    }

    /**
     * @private
     */
    async attemptReadJSONFile(filepath) {
        let json;
        try {
            json = await this.#fs.readUtf8File(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while reading config file at ${ filepath }`,
                { cause }
            );
        }

        if (!json) {
            return null;
        }

        const errors = [];

        // Parse JSONC with comment support and trailing comma allowance.
        const obj = jsonc.parse(json, errors, {
            disallowComments: false,
            allowTrailingComma: true,
            allowEmptyContent: true,
        });

        if (errors.length > 0) {
            const verror = new ValidationError(`JSON parsing errors in config file ${ filepath }`);

            // Collect all parsing errors for detailed feedback
            for (const parseError of errors) {
                verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
            }

            throw verror;
        }

        return obj;
    }

    /**
     * @private
     */
    resolveAppUrnToFilepath(urn) {
        // Convert URN path to filesystem path
        // e.g., "app://api/v1/users.jsonc" becomes "/users/me/my_project/routes/api/v1/users.jsonc"
        const pathnameParts = urn.split('://')[1].split('/').filter(Boolean);
        return path.join(this.#routes_directory, ...pathnameParts);
    }

    /**
     * @private
     */
    getRoutesConfigFilepath() {
        return path.join(this.#app_directory, 'virtual-hosts.jsonc');
    }
}
