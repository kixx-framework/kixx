import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';
import HttpRouter from '../http-server/http-router.js';
import RoutesConfig from './routes-config.js';
import { middleware, registerMiddleware } from '../request-handlers/middleware/mod.js';
import { handlers, registerHandler } from '../request-handlers/handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../request-handlers/error-handlers/mod.js';
import { readDirectory, importAbsoluteFilepath } from '../lib/file-system.js';
import { assertFunction } from '../assertions/mod.js';

export default class DevelopmentServer extends HttpServer {
    /**
     * @private
     * @type {ApplicationContext}
     */
    #context = null;

    /**
     * @private
     * @type {RoutesConfig}
     */
    #routesConfig = null;

    /**
     * @private
     * @type {HttpRouter}
     */
    #router = null;

    constructor(context, router, routesConfig, options) {
        super(options);
        this.#context = context;
        this.#router = router;
        this.#routesConfig = routesConfig;
    }

    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        const context = this.#context;

        // Hot-reload virtual hosts on each request for dynamic route configuration
        const virtualHosts = await this.#routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);

        // Reset router with fresh configuration, invalidating any cached routing
        this.#router.resetVirtualHosts(virtualHosts);

        return this.#router.handleHttpRequest(context, request, response);
    }

    /**
     * Creates and initializes ApplicationServer with all plugins loaded
     *
     * Loads middleware, request handlers, and error handlers from all plugin
     * directories before creating the configured server instance.
     *
     * @async
     * @param {ApplicationContext} context - Application context with plugin paths
     * @param {Object} serverOptions - HttpServer configuration options
     * @returns {Promise<ApplicationServer>} Fully initialized server instance
     * @throws {WrappedError} When plugin loading fails
     * @throws {Error} When context.paths.getPlugins() fails
     *
     * @example
     * const server = await ApplicationServer.load(context, { port: 3000 });
     * await server.start();
     */
    static async load(context, serverOptions) {
        const AppServerConstructor = this;
        const { paths } = context;

        const router = new HttpRouter();
        const routesConfig = new RoutesConfig(paths);

        // Load all plugin handlers in parallel for faster startup
        const plugins = await paths.getPlugins();
        const promises = plugins.map(loadHandlersFromPlugin);
        await Promise.all(promises);

        return new AppServerConstructor(context, router, routesConfig, serverOptions);
    }
}

/**
 * Loads and registers all handler types from a single plugin
 *
 * @async
 * @param {PluginDescriptor} plugin - Plugin with handler directory paths
 * @returns {Promise<void>}
 * @throws {WrappedError} When any handler directory fails to load
 */
async function loadHandlersFromPlugin(plugin) {
    const {
        middlewareDirectory,
        requestHandlerDirectory,
        errorHandlerDirectory,
    } = plugin;

    // Load all handler types in parallel
    await Promise.all([
        loadMiddlewareDirectory(middlewareDirectory, registerMiddleware),
        loadMiddlewareDirectory(requestHandlerDirectory, registerHandler),
        loadMiddlewareDirectory(errorHandlerDirectory, registerErrorHandler),
    ]);
}

/**
 * Loads all modules from directory and registers them using provided function
 *
 * @async
 * @param {string} directory - Absolute path to directory containing modules
 * @param {Function} register - Registration function that accepts (name, handler)
 * @returns {Promise<void>}
 * @throws {Error} When directory reading fails
 * @throws {WrappedError} When module loading fails
 */
async function loadMiddlewareDirectory(directory, register) {
    const entries = await readDirectory(directory);

    // Filter for regular files and build full file paths in a single pass
    const files = entries.filter((entry) => entry.isFile());

    // Load and register all modules in parallel
    const promises = files.map((file) => {
        const filepath = path.join(directory, file.name);
        return loadMiddlewareFunction(filepath).then((fn) => {
            assertFunction(fn, `Middlware function in ${ filepath } must be a function`);
            register(fn.name, fn);
            return true;
        });
    });

    await Promise.all(promises);
}

/**
 * Loads a middleware module and returns its default export
 *
 * @async
 * @param {string} filepath - Absolute path to module file
 * @returns {Promise<Function>} Module's default export function
 * @throws {WrappedError} When module import fails
 * @throws {Error} When module has no default export
 */
async function loadMiddlewareFunction(filepath) {
    let mod;
    try {
        mod = await importAbsoluteFilepath(filepath);
    } catch (cause) {
        throw new WrappedError(`Error loading module from ${ filepath }`, { cause });
    }

    return mod.default;
}
