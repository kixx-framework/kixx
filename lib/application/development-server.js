import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';


/**
 * Development server that provides hot-reloading capabilities for rapid development
 *
 * Extends the base HTTP server to automatically reload configuration and routes
 * on every request, enabling live development without server restarts. This
 * prioritizes development speed over performance.
 */
export default class DevelopmentServer extends HttpServer {

    /**
     * Application instance for accessing configuration and routes
     * @type {Application}
     */
    #app = null;

    /**
     * Router instance reset with fresh routes on each request
     * @type {HttpRouter}
     */
    #router = null;

    /**
     * Store for loading and caching virtual host route configurations
     * @type {HttpRoutesStore}
     */
    #routesStore = null;

    /**
     * Creates a new development server instance
     *
     * @param {Application} app - Application instance for configuration and route access
     * @param {HttpRouter} router - Router to handle requests after route hot-reloading
     * @param {HttpRoutesStore} routesStore - The routesStore for hot-reloading routes
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
     * Handles HTTP requests with hot-reloading enabled
     *
     * Reloads configuration and routes on every request to enable live development.
     * This allows developers to modify config files and routes without restarting the server.
     *
     * @async
     * @param {Object} nodeRequest - Node.js HTTP request object
     * @param {Object} nodeResponse - Node.js HTTP response object
     * @param {URL} url - Parsed request URL
     * @param {string} requestId - Unique request identifier
     * @returns {Promise<HttpServerResponse>} HTTP response object
     * @throws {WrappedError} When configuration or route loading fails
     */
    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        await this.#app.loadConfiguration();

        const { middleware, requestHandlers, errorHandlers } = this.#app;
        const vhosts = await this.#routesStore.loadVirtualHosts(middleware, requestHandlers, errorHandlers);
        this.#router.resetVirtualHosts(vhosts);

        return this.#router.handleHttpRequest(this.#app.context, request, response);
    }
}
