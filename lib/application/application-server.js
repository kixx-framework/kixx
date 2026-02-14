import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';

/**
 * Production-optimized HTTP server for Kixx applications
 *
 * Extends the base HTTP server to provide a production-ready runtime that loads
 * configuration and routes once during initialization. Unlike DevelopmentServer,
 * this server does not reload configuration or routes on every request, prioritizing
 * performance and stability over hot-reloading convenience.
 */
export default class ApplicationServer extends HttpServer {

    /**
     * Application instance for accessing configuration and routes
     * @type {Application}
     */
    #app = null;

    /**
     * Router instance for routing HTTP requests to handlers
     * @type {HttpRouter}
     */
    #router = null;

    /**
     * Store for loading and caching virtual host route configurations
     * @type {HttpRoutesStore}
     */
    #routesStore = null;

    /**
     * Creates a new production application server instance
     *
     * @param {Application} app - Application instance for configuration and route access
     * @param {HttpRouter} router - Router to handle incoming HTTP requests
     * @param {HttpRoutesStore} routesStore - Routes store for loading virtual host configurations
     * @param {Object} options - Server configuration options
     * @param {number} [options.port=8080] - Port number to listen on
     */
    constructor(app, router, routesStore, options) {
        super(options);
        this.#app = app;
        this.#router = router;
        this.#routesStore = routesStore;
    }

    /**
     * Loads initial configuration and routes before the server starts accepting requests
     *
     * Reloads application configuration and routes from disk. This method should be called
     * before startServer() to ensure the router has current routes and handlers.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {WrappedError} When configuration or route loading fails
     */
    async preload() {
        await this.#app.loadConfiguration();

        const { middleware, requestHandlers, errorHandlers } = this.#app;
        const vhosts = await this.#routesStore.loadVirtualHosts(middleware, requestHandlers, errorHandlers);
        this.#router.resetVirtualHosts(vhosts);
    }

    /**
     * Handles HTTP requests using pre-loaded routes and configuration
     *
     * Routes the request through middleware and handlers without reloading configuration,
     * making this suitable for production where performance is prioritized over live updates.
     *
     * @async
     * @param {Object} nodeRequest - Node.js HTTP request object
     * @param {Object} nodeResponse - Node.js HTTP response object
     * @param {URL} url - Parsed request URL
     * @param {string} requestId - Unique request identifier
     * @returns {Promise<HttpServerResponse>} HTTP response object
     */
    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        return this.#router.handleHttpRequest(this.#app.context, request, response);
    }
}
