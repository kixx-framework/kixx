import HttpServer from '../http-server/http-server.js';
import HttpServerRequest from '../http-server/http-server-request.js';
import HttpServerResponse from '../http-server/http-server-response.js';
import HttpRouter from '../http-server/http-router.js';

export default class DevelopmentServer extends HttpServer {

    #app = null;

    /**
     * @private
     * @type {HttpRouter}
     */
    #router = null;

    constructor(app, options) {
        super(options);
        this.#app = app;
        this.#router = new HttpRouter();
    }

    async handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const request = new HttpServerRequest(nodeRequest, url, requestId);
        const response = new HttpServerResponse(requestId);

        // We reload the configuration on every request for the development server.
        await this.#app.loadConfiguration();

        // Hot-reload virtual hosts on each request for the development server.
        const routes = await this.#app.loadRoutes();

        // Reset router with fresh configuration, invalidating any cached routing
        this.#router.resetVirtualHosts(routes);

        return this.#router.handleHttpRequest(this.#app.context, request, response);
    }
}
