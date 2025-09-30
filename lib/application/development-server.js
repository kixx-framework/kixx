import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';
import HttpRouter from '../http-server/http-router.js';

/**
 * @typedef {Object} HttpServerOptions
 * @property {number} [port=8080] - Port number to listen on
 */

/**
 * Development server that provides hot-reloading capabilities for rapid development
 *
 * Extends the base HTTP server to automatically reload configuration and routes
 * on every request, enabling live development without server restarts. This
 * prioritizes development speed over performance.
 */
export default class DevelopmentServer extends HttpServer {

    /**
     * The application instance for accessing configuration and routes
     * @type {Application}
     * @private
     */
    #app = null;

    /**
     * HTTP router for handling requests with fresh route configurations
     * @type {HttpRouter}
     * @private
     */
    #router = null;

    /**
     * Creates a new development server instance
     *
     * @param {Application} app - Application instance for configuration and route access
     * @param {HttpServerOptions} options - Server configuration options
     */
    constructor(app, options) {
        super(options);
        this.#app = app;
        this.#router = new HttpRouter();

        const { logger } = app.context;

        this.#router.on('error', (error) => {
            logger.debug('http server route handling error', null, error);
        });
    }

    async preload() {
        await this.#app.loadConfiguration();
        const routes = await this.#app.loadRoutes();
        this.#router.resetVirtualHosts(routes);
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
     * @throws {WrappedError} When configuration loading fails
     * @throws {WrappedError} When route loading fails
     * @throws {Error} When request handling fails
     */
    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        // Reload configuration on every request to enable live config changes
        // This allows developers to modify config files without restarting the server
        await this.#app.loadConfiguration();

        // Hot-reload routes to pick up changes to route definitions, middleware, and handlers
        // Enables rapid development iteration without server restarts
        const routes = await this.#app.loadRoutes();

        // Reset router with fresh routes to ensure all changes are immediately available
        // This invalidates any cached routing decisions from previous requests
        this.#router.resetVirtualHosts(routes);

        return this.#router.handleHttpRequest(this.#app.context, request, response);
    }
}
