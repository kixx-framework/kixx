import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';
import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from './http-server-request.js';
import HttpServerResponse from './http-server-response.js';
import HttpRouter from '../http-server/http-router.js';
import RoutesConfig from './routes-config.js';
import { middleware, registerMiddleware } from '../request-handlers/middleware/mod.js';
import { handlers, registerHandler } from '../request-handlers/handlers/mod.js';
import { errorHandlers, registerErrorHandler } from '../request-handlers/error-handlers/mod.js';
import { readDirectory } from '../lib/file-system.js';


export default class ApplicationServer extends HttpServer {

    #context = null;
    #routesConfig = null;
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

        const virtualHosts = await this.#routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);
        this.#router.resetVirtualHosts(virtualHosts);

        return this.#router.handleHttpRequest(context, request, response);
    }

    static async load(context, serverOptions) {
        const AppServerConstructor = this;
        const { paths } = context;

        const router = new HttpRouter();
        const routesConfig = new RoutesConfig(paths);

        const plugins = await paths.getPlugins();
        const promises = plugins.map(loadHandlersFromPlugin);
        await Promise.all(promises);

        return new AppServerConstructor(context, router, routesConfig, serverOptions);
    }
}

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

async function loadMiddlewareFunction(filepath) {
    let mod;
    try {
        mod = await import(pathToFileURL(filepath));
    } catch (cause) {
        throw new WrappedError(`Error loading error handler from ${ filepath }`, { cause });
    }

    return mod.default;
}
