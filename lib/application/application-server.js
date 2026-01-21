import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';


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

    async load() {
        const { middleware, requestHandlers, errorHandlers } = this.#app;
        const vhosts = await this.#routesStore.loadVirtualHosts(middleware, requestHandlers, errorHandlers);
        this.#router.resetVirtualHosts(vhosts);
    }

    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        return this.#router.handleHttpRequest(this.#app.context, request, response);
    }
}
