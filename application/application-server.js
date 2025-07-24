import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';
import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';
import HttpRouter from '../http-server/http-router.js';
import RoutesConfig from './routes-config.js';
import { middleware, registerMiddleware } from '../request-handlers/middleware/mod.js';
import { handlers, registerHandler } from '../request-handlers/handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../request-handlers/error-handlers/mod.js';
import { readDirectory } from '../lib/file-system.js';


/**
 * ApplicationServer
 * =================
 *
 * The ApplicationServer class extends the core HttpServer to provide a fully
 * configured HTTP server for a Kixx application. It manages the application
 * context, routing, and dynamic loading of plugin middleware, handlers, and
 * error handlers.
 *
 * Core Features:
 *   - Handles incoming HTTP requests using the application's router and context.
 *   - Dynamically loads and registers middleware, request handlers, and error handlers
 *     from plugin directories at startup.
 *   - Supports hot-reloading of virtual host and route configuration on each request.
 */
export default class ApplicationServer extends HttpServer {
    /**
     * @private
     * @type {Object}
     * The application context instance.
     */
    #context = null;

    /**
     * @private
     * @type {RoutesConfig}
     * The application's routes configuration instance.
     */
    #routesConfig = null;

    /**
     * @private
     * @type {HttpRouter}
     * The application's HTTP router instance.
     */
    #router = null;

    /**
     * Constructs a new ApplicationServer instance.
     *
     * @param {Object} context - The application context.
     * @param {HttpRouter} router - The HTTP router instance.
     * @param {RoutesConfig} routesConfig - The routes configuration instance.
     * @param {Object} options - Server options to pass to the base HttpServer.
     */
    constructor(context, router, routesConfig, options) {
        super(options);
        this.#context = context;
        this.#router = router;
        this.#routesConfig = routesConfig;
    }

    /**
     * Handles an incoming HTTP request.
     *
     * This method creates framework-specific request and response objects,
     * loads the current virtual host configuration, resets the router, and
     * delegates the request to the router for handling.
     *
     * @param {IncomingMessage} nodeRequest - The Node.js HTTP request object.
     * @param {ServerResponse} nodeResponse - The Node.js HTTP response object.
     * @param {URL} url - The parsed request URL.
     * @param {string} requestId - A unique request identifier.
     * @returns {Promise<Object>} The response object after handling.
     */
    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        const context = this.#context;

        // Load and assign the latest virtual hosts configuration on each request.
        const virtualHosts = await this.#routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);
        this.#router.resetVirtualHosts(virtualHosts);

        return this.#router.handleHttpRequest(context, request, response);
    }

    /**
     * Loads and initializes an ApplicationServer instance.
     *
     * This static method loads all plugin middleware, request handlers, and error handlers,
     * then constructs and returns a fully configured ApplicationServer.
     *
     * @param {Object} context - The application context.
     * @param {Object} serverOptions - Options to pass to the HttpServer constructor.
     * @returns {Promise<ApplicationServer>} The initialized ApplicationServer instance.
     */
    static async load(context, serverOptions) {
        const AppServerConstructor = this;
        const { paths } = context;

        const router = new HttpRouter();
        const routesConfig = new RoutesConfig(paths);

        // Discover and load all plugin middleware, handlers, and error handlers.
        const plugins = await paths.getPlugins();
        const promises = plugins.map(loadHandlersFromPlugin);
        await Promise.all(promises);

        return new AppServerConstructor(context, router, routesConfig, serverOptions);
    }
}

/**
 * Loads and registers all middleware, request handlers, and error handlers from a plugin.
 *
 * @param {Object} plugin - The plugin descriptor object.
 * @returns {Promise<void>}
 */
async function loadHandlersFromPlugin(plugin) {
    const {
        middlewareDirectory,
        requestHandlerDirectory,
        errorHandlerDirectory,
    } = plugin;

    await loadMiddlewareDirectory(middlewareDirectory, registerMiddleware);
    await loadMiddlewareDirectory(requestHandlerDirectory, registerHandler);
    await loadMiddlewareDirectory(errorHandlerDirectory, registerErrorHandler);
}

/**
 * Loads all modules from a directory and registers them using the provided register function.
 *
 * @param {string} directory - The directory containing modules to load.
 * @param {Function} register - The function to register each loaded module.
 * @returns {Promise<void>}
 */
async function loadMiddlewareDirectory(directory, register) {
    const filepaths = await readDirectory(directory);

    const promises = filepaths.map((filepath) => {
        return loadMiddlewareFunction(filepath).then((fn) => {
            register(fn.name, fn);
            return true;
        });
    });

    await Promise.all(promises);
}

/**
 * Dynamically imports a module from the given filepath and returns its default export.
 *
 * @param {string} filepath - The absolute path to the module file.
 * @returns {Promise<Function>} The default export of the module.
 * @throws {WrappedError} If the module fails to load.
 */
async function loadMiddlewareFunction(filepath) {
    let mod;
    try {
        mod = await import(pathToFileURL(filepath));
    } catch (cause) {
        throw new WrappedError(`Error loading error handler from ${ filepath }`, { cause });
    }

    return mod.default;
}
