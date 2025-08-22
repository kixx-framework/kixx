import path from 'node:path';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import { AssertionError, WrappedError, ValidationError } from '../errors/mod.js';
import { assertArray } from '../assertions/mod.js';
import VirtualHostSpec from '../http-server/virtual-host-spec.js';
import HttpRouteSpec from '../http-server/http-route-spec.js';
import defaultRoutes from './default-routes.js';
import * as fileSystem from '../lib/file-system.js';

/**
 * @typedef {Object} RoutesConfigOptions
 * @property {string} app_directory - Application root directory path
 * @property {string} routes_directory - Directory containing route configuration files
 * @property {Object} [fileSystem] - File system interface (defaults to built-in)
 */

/**
 * @typedef {Object} VirtualHostConfig
 * @property {string} name - Virtual host name
 * @property {string[]} routes - Array of route URNs (kixx:// or app://)
 */

/**
 * @fileoverview Loads and validates application virtual host and route configuration
 *
 * Supports resolving route URNs with two schemes:
 * - kixx:// for built-in framework routes
 * - app:// for application-specific routes
 */
export default class RoutesStore {

    #app_directory = null;
    #routes_directory = null;
    #fs = null;

    /**
     * @param {RoutesConfigOptions} options - Configuration options
     */
    constructor(options) {
        this.#app_directory = options.app_directory;
        this.#routes_directory = options.routes_directory;
        this.#fs = options.fileSystem || fileSystem;
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
     * @async
     * @returns {Promise<VirtualHostSpec[]>} Array of validated virtual host specifications
     * @throws {AssertionError} When virtual host configuration is invalid
     */
    async loadVhostSpecs() {
        const vhostsConfigs = await this.loadVhostsConfigs();
        return vhostsConfigs.map(VirtualHostSpec.validateAndCreate);
    }

    /**
     * @async
     * @returns {Promise<VirtualHostConfig[]>} Array of virtual host configurations with resolved routes
     * @throws {AssertionError} When routes config file is invalid or missing
     */
    async loadVhostsConfigs() {
        const filepath = this.getRoutesConfigFilepath();
        const configs = await this.loadJSONFile(filepath);

        assertArray(configs, `vhosts config must be an array (${ filepath })`);

        const promises = configs.map(this.loadRoutesConfigs.bind(this));

        const routes = await Promise.all(promises);
        return routes;
    }

    /**
     * @async
     * @param {VirtualHostConfig} vhostConfig - Virtual host configuration to process
     * @returns {Promise<VirtualHostConfig>} Virtual host config with resolved routes
     * @throws {AssertionError} When route URNs are invalid or route configs fail validation
     */
    async loadRoutesConfigs(vhostConfig) {
        // Each URN in vhostConfig.routes may resolve to multiple route configs
        const promises = vhostConfig.routes.map(this.resolveRoutesConfigUrn.bind(this, vhostConfig));
        const matrix = await Promise.all(promises);

        // Flatten 2D array: [[routes], [routes], ...] -> [route, route, route, ...]
        // Each URN can expand to multiple routes, so we need to flatten for final vhost config
        // eslint-disable-next-line require-atomic-updates
        vhostConfig.routes = matrix.flat();
        return vhostConfig;
    }

    /**
     * @async
     * @param {VirtualHostConfig} vhostConfig - Virtual host configuration context
     * @param {string} urn - Route URN to resolve (kixx:// or app://)
     * @returns {Promise<Object[]>} Array of validated route configuration objects
     * @throws {AssertionError} When URN scheme is invalid or route config validation fails
     */
    async resolveRoutesConfigUrn(vhostConfig, urn) {
        let routesConfigs;

        // Support two URN schemes: kixx:// for framework defaults, app:// for application-specific routes
        if (urn.startsWith('kixx://')) {
            // Built-in routes are preloaded and always available (no I/O needed)
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

        // Validate each route config and enhance error messages with context
        return routesConfigs.map((config, index) => {
            try {
                HttpRouteSpec.validateAndCreate(config, vhostConfig.name, index);
            } catch (cause) {
                // Wrap validation errors with URN context to help debugging configuration issues
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
     * Loads and parses a JSONC or JSON file, with fallback between formats.
     *
     * Attempts to read the given file as JSONC first; if not found, falls back to the
     * corresponding JSON (or vice versa). Only files with .jsonc or .json extensions are allowed.
     *
     * @async
     * @param {string} filepath - Path to JSONC/JSON file
     * @returns {Promise<Object>} Parsed configuration object
     * @throws {AssertionError} When file extension is invalid or file cannot be read
     */
    async loadJSONFile(filepath) {
        let config = await this.attemptReadJSONFile(filepath);

        if (config) {
            return config;
        }

        // If the first attempt didn't work, then try changing the file extension.
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
     * Attempts to read and parse a JSONC/JSON file
     * @async
     * @param {string} filepath - Path to the JSONC/JSON file
     * @returns {Promise<Object|null>} Parsed object or null if file doesn't exist
     * @throws {WrappedError} When file read fails for reasons other than non-existence
     * @throws {ValidationError} When JSONC parsing fails with detailed error information
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

        // Parse JSONC with comment support and trailing comma allowance
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
     * @param {string} urn - Application URN (app:// scheme)
     * @returns {string} Filesystem path corresponding to the URN
     */
    resolveAppUrnToFilepath(urn) {
        // Convert URN path to filesystem path
        // e.g., "app://api/v1/users.jsonc" becomes "/users/me/my_project/routes/api/v1/users.jsonc"
        const pathnameParts = urn.split('://')[1].split('/').filter(Boolean);
        return path.join(this.#routes_directory, ...pathnameParts);
    }

    /**
     * @returns {string} Path to the main routes configuration file
     */
    getRoutesConfigFilepath() {
        return path.join(this.#app_directory, 'routes.jsonc');
    }
}
