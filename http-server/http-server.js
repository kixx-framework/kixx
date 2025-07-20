import http from 'node:http';
import { EventEmitter } from 'node:events';
import { isFunction, isNumberNotNaN } from '../assertions/mod.js';
import { headersToObject } from '../lib/http-utils.js';


/**
 * HttpServer is a lightweight HTTP server wrapper around Node.js's built-in http.Server.
 * It provides lifecycle management, request/response handling, and emits events for server and request activity.
 *
 * Features:
 * - Starts and stops a Node.js HTTP server on a configurable port.
 * - Emits events for server errors, server close, server listening, request received, and response sent.
 * - Handles graceful shutdown with a timeout for open connections.
 * - Provides a default request handler (can be overridden) that returns a simple "Hello, world!" response.
 * - Handles request and response errors, emitting error events and sending appropriate HTTP responses.
 * - Supports custom request IDs for tracking.
 *
 * Events:
 * - 'error': Emitted on server or request errors.
 * - 'info': Emitted on server close and listening.
 * - 'debug': Emitted on request received and response sent.
 *
 * Usage:
 *   const server = new HttpServer({ port: 8080 });
 *   server.startServer();
 *   server.on('error', (err) => { ... });
 *   server.on('info', (info) => { ... });
 *   server.on('debug', (debug) => { ... });
 */
export default class HttpServer extends EventEmitter {

    /**
     * @type {http.Server|null}
     * @private
     * The underlying Node.js HTTP server instance.
     */
    #nodeServer = null;

    /**
     * @type {number}
     * @private
     * Internal counter for generating unique request IDs.
     */
    #requestId = 0;

    /**
     * Constructs a new HttpServer instance.
     * @param {Object} options
     * @param {number} [options.port=8080] - The port to listen on.
     */
    constructor({ port }) {
        super();

        Object.defineProperties(this, {
            /**
             * The port number the server will listen on.
             * @memberof HttpServer#
             * @type {number}
             * @readonly
             */
            port: {
                enumerable: true,
                value: isNumberNotNaN(port) ? port : 8080,
            },
        });
    }

    /**
     * Starts the HTTP server and begins listening for connections.
     * Emits 'info' and 'error' events for server lifecycle.
     * @throws {Error} If the server is already started.
     */
    startServer() {
        if (this.#nodeServer) {
            throw new Error('Server already started');
        }

        const { port } = this;

        this.#nodeServer = http.createServer(this.#handleNodeRequest.bind(this));

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

        this.#nodeServer.listen(port);
    }

    /**
     * Gracefully shuts down the server, allowing open connections to finish.
     * If connections remain after 3 seconds, forcibly closes all connections.
     */
    close() {
        const nodeServer = this.#nodeServer;

        if (nodeServer) {
            const shutdownTimeout = setTimeout(() => {
                nodeServer.closeAllConnections();
            }, 3 * 1000);

            nodeServer.on('close', () => {
                clearTimeout(shutdownTimeout);
            });

            nodeServer.close();
        }
    }

    /**
     * Default request handler.
     * Returns a simple "Hello, world!" response.
     * Override this method to implement custom request handling logic.
     *
     * @returns {Object} An object with { status, headers, body }.
     */
    handleRequest() {
        const status = 200;
        const headers = new Headers();
        const body = 'Hello, world!\n';

        headers.set('content-type', 'text/plain; charset=utf-8');
        headers.set('content-length', new Blob([ body ]).size);

        return {
            status,
            headers,
            body,
        };
    }

    /**
     * Internal Node.js request handler.
     * Handles request/response lifecycle, error handling, and emits events.
     *
     * @private
     * @param {http.IncomingMessage} nodeRequest
     * @param {http.ServerResponse} nodeResponse
     */
    #handleNodeRequest(nodeRequest, nodeResponse) {
        const requestId = nodeRequest.headers['x-request-id'] || this.#generateRequestId();

        const method = nodeRequest.method;
        const proto = this.#getHttpProtocol(nodeRequest);
        const host = this.#getHttpHost(nodeRequest);
        const url = new URL(nodeRequest.url, `${ proto }://${ host }`);

        this.emit('debug', {
            name: 'request-received',
            message: 'request received',
            info: { requestId, method, url: url.href },
        });

        nodeRequest.on('error', (cause) => {
            // The 'end' event will never fire, and the 'error' event WILL
            // fire on this request which will prevent downstream processing
            // from happening, as designed.
            //
            // Ex; If a request is aborted we want downstream processing to
            // also abort, like a file upload, for example.
            this.emit('error', {
                name: 'request-error',
                message: 'request error event',
                info: { requestId, method, url: url.href },
                cause,
            });
        });

        nodeResponse.on('finish', () => {
            const status = nodeResponse.statusCode;

            this.emit('debug', {
                name: 'response-sent',
                message: 'response sent',
                info: { requestId, status, method, url: url.href },
            });
        });

        const completeResponse = (response) => {
            // Differentiate between a response when the request has completed
            // (finished streaming data) and when it is still in progress, in
            // which case we need to dump the request data.
            if (nodeRequest.complete) {
                this.#sendResponse(nodeRequest, nodeResponse, response);
            } else {
                // If this function is called before the request is completely
                // read then attach a data event listener to allow it to stream
                // in the data and fire the "end" event.
                //
                // Wait until the request completes before we respond. The
                // request could be held open if the request body is not fully
                // read before this function is called. Ex; Encountering an
                // auth error during a file upload.
                nodeRequest.on('end', () => {
                    this.#sendResponse(nodeRequest, nodeResponse, response);
                });

                nodeRequest.on('data', () => {});
            }
        };

        const handleError = (cause) => {
            this.emit('error', {
                name: 'request-handler-error',
                message: 'caught fatal error from request handler',
                info: { requestId, method, url: url.href },
                cause,
            });

            const status = 500;
            const body = 'Internal server error.\n';

            const headers = new Headers({
                'content-type': 'text/plain; charset=utf-8',
                'content-length': new Blob([ body ]).size,
            });

            completeResponse({ status, headers, body });
        };

        try {
            this.handleRequest(nodeRequest, nodeResponse, url, requestId).then(completeResponse, handleError);
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Sends the HTTP response after the request has completed.
     * Handles streaming bodies, buffers, and strings.
     *
     * @private
     * @param {http.IncomingMessage} nodeRequest
     * @param {http.ServerResponse} nodeResponse
     * @param {Object} response - The response object with { status, headers, body }.
     */
    #sendResponse(nodeRequest, nodeResponse, response) {
        const {
            status,
            headers,
            body,
        } = response;

        nodeResponse.writeHead(status, headersToObject(headers));

        if (body && nodeRequest.method !== 'HEAD') {
            if (isFunction(body.pipe)) {
                // If the body is a stream which can be piped, then pipe it.
                body.pipe(nodeResponse);
            } else {
                // Otherwise assume it is a string or buffer.
                nodeResponse.end(body);
            }
        } else {
            // Or, just end it if there is no content to send.
            nodeResponse.end();
        }
    }

    /**
     * Extracts the HTTP protocol from the request headers.
     * @private
     * @param {http.IncomingMessage} req
     * @returns {string} The protocol, e.g., 'http' or 'https'.
     */
    #getHttpProtocol(req) {
        return req.headers['x-forwarded-proto'] || 'http';
    }

    /**
     * Extracts the HTTP host from the request headers.
     * @private
     * @param {http.IncomingMessage} req
     * @returns {string} The host, e.g., 'localhost'.
     */
    #getHttpHost(req) {
        return req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    }

    /**
     * Generates a unique request ID for tracking.
     * @private
     * @returns {string} The generated request ID.
     */
    #generateRequestId() {
        this.#requestId += 1;
        return `req-${ this.#requestId }`;
    }
}
