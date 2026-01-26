import http from 'node:http';
import { EventEmitter } from 'node:events';
import { isFunction, isNumberNotNaN } from '../assertions/mod.js';
import { headersToObject } from '../lib/http-utils.js';
import HttpServerResponse from './http-server-response.js';

/**
 * HttpServer error event.
 * @typedef {Object} HttpServerError
 * @property {string} name - Event name identifier
 * @property {string} message - Human-readable event description
 * @property {Object} info - Additional event context data
 * @property {boolean} fatal - Whether this is a fatal error
 * @property {Error} cause - Original error that triggered this event
 */

/**
 * HttpServer info event.
 * @typedef HttpServerEvent
 * @type {Object}
 * @property {string} name - Event name identifier
 * @property {string} message - Human-readable event description
 * @property {Object} info - Additional event context data
 */

/**
 * HTTP server wrapper that provides lifecycle management, request/response handling,
 * and comprehensive event emission for monitoring server and request activity.
 *
 * @extends EventEmitter
 * @emits HttpServer#error - Emits an HttpServerError for underlying errors, request errors, or handler errors
 * @emits HttpServer#info - Emits an HttpServerEvent for server lifecycle events (listening, closed)
 * @emits HttpServer#debug - Emits an HttpServerEvent for request/response activity for debugging
 */
export default class HttpServer extends EventEmitter {

    /**
     * Internal Node.js HTTP server instance
     * @type {http.Server|null}
     */
    #nodeServer = null;

    /**
     * Internal counter for generating unique request identifiers
     * @type {number}
     */
    #requestId = 0;

    /**
     * Creates a new HttpServer instance with the specified port configuration.
     * @param {Object} options - Server configuration options
     * @param {number} [options.port=8080] - Port number to listen on
     */
    constructor({ port }) {
        super();

        Object.defineProperties(this, {
            /**
             * The port number the server will listen on
             * @name port
             * @readonly
             * @public
             * @type {number}
             */
            port: {
                enumerable: true,
                value: isNumberNotNaN(port) ? port : 8080,
            },
        });
    }

    /**
     * Starts the HTTP server and begins listening for incoming connections.
     * Emits 'info' event when listening starts or 'error' event when the underlying
     * server emits an 'error' event.
     * @public
     * @throws {Error} When server is already started
     */
    startServer() {
        if (this.#nodeServer) {
            throw new Error('Server already started');
        }

        const { port } = this;

        this.#nodeServer = http.createServer(this.#handleNodeRequest.bind(this));

        // Attach event handlers BEFORE listen() to catch port-in-use errors
        this.#nodeServer.on('error', (cause) => {
            this.emit('error', {
                name: 'server-error',
                message: 'error event on node.js server',
                info: { port },
                fatal: true,
                cause,
            });
        });

        this.#nodeServer.on('close', () => {
            this.emit('info', {
                name: 'server-closed',
                message: 'server closed',
                info: { port },
            });
        });

        this.#nodeServer.on('listening', () => {
            this.emit('info', {
                name: 'server-listening',
                message: `server listening on port ${ port }`,
                info: { port },
            });
        });

        // State transitions to 'listening' (emits event above) or 'error' if port unavailable
        this.#nodeServer.listen(port);
    }

    /**
     * Gracefully closes the HTTP server, stopping new connections and allowing existing
     * requests to complete. Force-closes all connections after the specified timeout
     * to ensure shutdown completes even with HTTP keep-alive connections.
     * @public
     * @param {number} [waitToCloseConnectionsMs=5500] - Milliseconds to wait before force-closing connections
     */
    close(waitToCloseConnectionsMs) {
        waitToCloseConnectionsMs = Number.isInteger(waitToCloseConnectionsMs) ? waitToCloseConnectionsMs : 5500;

        const nodeServer = this.#nodeServer;

        if (nodeServer) {
            // HTTP keep-alive connections can hold the server open indefinitely.
            // Force-close after 3 seconds to ensure shutdown completes.
            const shutdownTimeout = setTimeout(() => {
                nodeServer.closeAllConnections();
            }, waitToCloseConnectionsMs);

            nodeServer.on('close', () => {
                clearTimeout(shutdownTimeout);
            });

            // Stops accepting new connections; existing requests finish normally
            nodeServer.close();
        }
    }

    /**
     * Processes an incoming HTTP request and returns a response.
     * Override this method in subclasses to implement custom request handling logic.
     * Supports both synchronous (returns HttpServerResponse) and asynchronous
     * (returns Promise<HttpServerResponse>) handlers.
     * @public
     * @param {http.IncomingMessage} nodeRequest - Node.js request object
     * @param {http.ServerResponse} nodeResponse - Node.js response object
     * @param {URL} url - Parsed request URL with protocol and host reconstructed from headers
     * @param {string} requestId - Unique request identifier for tracing and correlation
     * @returns {HttpServerResponse|Promise<HttpServerResponse>} Response object or Promise resolving to response
     */
    handleRequest(nodeRequest, nodeResponse, url, requestId) {
        const response = new HttpServerResponse(requestId);
        return response.respondWithUtf8(200, 'Hello, world!\n');
    }

    /**
     * Internal Node.js request handler that manages the request/response lifecycle.
     * Handles both synchronous and asynchronous request handlers with unified error handling.
     * Reconstructs full URL from headers (supports reverse proxies), generates request IDs,
     * and emits debug/error events for monitoring.
     * @param {http.IncomingMessage} nodeRequest - Node.js HTTP request object
     * @param {http.ServerResponse} nodeResponse - Node.js HTTP response object
     */
    #handleNodeRequest(nodeRequest, nodeResponse) {
        // Support distributed tracing: use incoming request ID or generate one
        const requestId = nodeRequest.headers['x-request-id'] || this.#generateRequestId();

        // Behind reverse proxies (nginx, load balancers), the original protocol
        // and host are in x-forwarded-* headers. Reconstruct the full URL.
        const method = nodeRequest.method;
        const proto = this.#getHttpProtocol(nodeRequest);
        const host = this.#getHttpHost(nodeRequest);
        const url = new URL(nodeRequest.url, `${ proto }://${ host }`);

        this.emit('debug', {
            name: 'request-received',
            message: 'request received',
            info: { requestId, method, url: url.href },
        });

        // Request stream errors (client disconnect, malformed data) prevent the
        // 'end' event from firing. This naturally aborts any in-progress work
        // like file uploads that are waiting on request data.
        nodeRequest.on('error', (cause) => {
            this.emit('error', {
                name: 'request-error',
                message: 'request error event',
                info: { requestId, method, url: url.href },
                fatal: false,
                cause,
            });
        });

        nodeResponse.on('finish', () => {
            const status = nodeResponse.statusCode;

            this.emit('debug', {
                name: 'response-sent',
                message: 'response sent',
                info: { requestId, status },
            });
        });

        const completeResponse = (response) => {
            if (nodeRequest.complete) {
                this.#sendResponse(nodeRequest, nodeResponse, response);
            } else {
                // HTTP requires consuming the entire request body before responding.
                // If we respond early (e.g., auth error on a large upload), the
                // connection hangs unless we drain the remaining data.
                nodeRequest.on('end', () => {
                    this.#sendResponse(nodeRequest, nodeResponse, response);
                });
                nodeRequest.on('data', () => {}); // Drain to trigger 'end'
            }
        };

        const handleError = (cause) => {
            this.emit('error', {
                name: 'request-handler-error',
                message: 'caught fatal error from request handler',
                info: { requestId, method, url: url.href },
                fatal: true,
                cause,
            });

            // Generic response avoids leaking internal error details to clients
            const status = 500;
            const body = 'Internal server error.\n';

            const headers = new Headers({
                'content-type': 'text/plain; charset=utf-8',
                'content-length': new Blob([ body ]).size,
            });

            completeResponse({ status, headers, body });
        };

        // Support both sync handlers (return object) and async handlers (return Promise)
        try {
            const result = this.handleRequest(nodeRequest, nodeResponse, url, requestId);

            // Duck-type Promise check: avoid instanceof for cross-realm compatibility
            if (result && typeof result.then === 'function') {
                result.then(completeResponse, handleError);
            } else {
                completeResponse(result);
            }
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Sends HTTP response to client handling different body types and HTTP methods.
     * Supports streaming responses for large files via readable streams and properly
     * handles HEAD requests by omitting the response body per HTTP specification.
     * @param {http.IncomingMessage} nodeRequest - Node.js request object
     * @param {http.ServerResponse} nodeResponse - Node.js response object
     * @param {HttpServerResponse} response - Response object with status, headers, and body
     */
    #sendResponse(nodeRequest, nodeResponse, response) {
        const {
            status,
            headers,
            body,
        } = response;

        nodeResponse.writeHead(status, headersToObject(headers));

        // HEAD requests must not include a body per HTTP spec
        if (body && nodeRequest.method !== 'HEAD') {
            // Stream support: if body has pipe(), it's a readable stream
            if (isFunction(body.pipe)) {
                body.pipe(nodeResponse);
            } else {
                nodeResponse.end(body);
            }
        } else {
            nodeResponse.end();
        }
    }

    /**
     * Determines HTTP protocol from request headers with reverse proxy support.
     * Checks x-forwarded-proto header first, falling back to 'http' for direct connections.
     * @param {http.IncomingMessage} req - Node.js request object
     * @returns {string} Protocol ('http' or 'https')
     */
    #getHttpProtocol(req) {
        return req.headers['x-forwarded-proto'] || 'http';
    }

    /**
     * Extracts host information from request headers with reverse proxy support.
     * Checks x-forwarded-host header first, then host header, falling back to 'localhost'.
     * @param {http.IncomingMessage} req - Node.js request object
     * @returns {string} Host header value or 'localhost' fallback
     */
    #getHttpHost(req) {
        return req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    }

    /**
     * Generates unique request identifier for tracking and correlation.
     * Increments internal counter and formats as 'req-{number}'.
     * @returns {string} Formatted request ID (e.g., 'req-1', 'req-2')
     */
    #generateRequestId() {
        this.#requestId += 1;
        return `req-${ this.#requestId }`;
    }
}
