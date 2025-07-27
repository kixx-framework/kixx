import http from 'node:http';
import { EventEmitter } from 'node:events';
import { isFunction, isNumberNotNaN } from '../assertions/mod.js';
import { headersToObject } from '../lib/http-utils.js';

/**
 * @fileoverview HTTP server wrapper with lifecycle management and event emission
 * 
 * Provides a lightweight wrapper around Node.js's built-in http.Server with
 * enhanced error handling, event emission, and graceful shutdown capabilities.
 */

/**
 * @typedef {Object} ServerEvent
 * @property {string} name - Event name identifier
 * @property {string} message - Human-readable event description
 * @property {Object} info - Additional event context data
 * @property {boolean} [fatal] - Whether this is a fatal error
 * @property {Error} [cause] - Original error that triggered this event
 */

/**
 * @typedef {Object} HttpResponse
 * @property {number} status - HTTP status code
 * @property {Headers} headers - Response headers
 * @property {string|Buffer|NodeJS.ReadableStream} body - Response body content
 */

/**
 * @typedef {Object} HttpServerOptions
 * @property {number} [port=8080] - Port number to listen on
 */

/**
 * HTTP server wrapper that provides lifecycle management, request/response handling, 
 * and comprehensive event emission for monitoring server and request activity.
 * 
 * @extends EventEmitter
 * @fires HttpServer#error - Server errors, request errors, or handler errors
 * @fires HttpServer#info - Server lifecycle events (listening, closed)
 * @fires HttpServer#debug - Request/response activity for debugging
 * 
 * @example
 * // Basic server setup
 * const server = new HttpServer({ port: 8080 });
 * server.on('error', (event) => console.error(event));
 * server.on('info', (event) => console.log(event));
 * server.startServer();
 * 
 * @example
 * // Custom request handler
 * class CustomServer extends HttpServer {
 *   handleRequest(nodeRequest, nodeResponse, url, requestId) {
 *     return {
 *       status: 200,
 *       headers: new Headers({ 'content-type': 'application/json' }),
 *       body: JSON.stringify({ message: 'Custom response' })
 *     };
 *   }
 * }
 */
export default class HttpServer extends EventEmitter {

    /**
     * @type {http.Server|null}
     * @private
     */
    #nodeServer = null;

    /**
     * @type {number}
     * @private
     */
    #requestId = 0;

    /**
     * Creates a new HttpServer instance
     * @param {HttpServerOptions} options - Server configuration options
     * @throws {TypeError} When options is not an object
     */
    constructor({ port }) {
        super();

        Object.defineProperties(this, {
            /**
             * The port number the server will listen on
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
     * Starts the HTTP server and begins listening for connections
     * @throws {Error} When server is already started
     * @throws {Error} When port is already in use or invalid
     * @fires HttpServer#info
     * @fires HttpServer#error
     */
    startServer() {
        if (this.#nodeServer) {
            throw new Error('Server already started');
        }

        const { port } = this;

        // Create server with bound request handler to preserve 'this' context
        this.#nodeServer = http.createServer(this.#handleNodeRequest.bind(this));

        // Set up error handling before calling listen() to catch bind/listen errors
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

        // After this call, server state changes to 'listening' (or error if port unavailable)
        this.#nodeServer.listen(port);
    }

    /**
     * Gracefully shuts down the server with a 3-second timeout for open connections
     * @fires HttpServer#info
     */
    close() {
        const nodeServer = this.#nodeServer;

        if (nodeServer) {
            // Force close any remaining connections after 3 second grace period
            // to prevent server hanging indefinitely on keep-alive connections
            const shutdownTimeout = setTimeout(() => {
                nodeServer.closeAllConnections();
            }, 3 * 1000);

            // Clean up timeout if server closes naturally before timeout fires
            nodeServer.on('close', () => {
                clearTimeout(shutdownTimeout);
            });

            // Begin graceful shutdown - stops accepting new connections,
            // waits for existing connections to finish
            nodeServer.close();
        }
    }

    /**
     * Default request handler that can be overridden in subclasses
     * Returns a simple "Hello, world!" response with proper content headers
     * 
     * @param {http.IncomingMessage} [nodeRequest] - Node.js request object  
     * @param {http.ServerResponse} [nodeResponse] - Node.js response object
     * @param {URL} [url] - Parsed request URL
     * @param {string} [requestId] - Unique request identifier
     * @returns {HttpResponse|Promise<HttpResponse>} Response object or Promise resolving to response
     * 
     * @example
     * // Override in subclass for custom behavior
     * handleRequest(nodeRequest, nodeResponse, url, requestId) {
     *   if (url.pathname === '/api/health') {
     *     return {
     *       status: 200,
     *       headers: new Headers({ 'content-type': 'application/json' }),
     *       body: JSON.stringify({ status: 'healthy' })
     *     };
     *   }
     *   return super.handleRequest();
     * }
     */
    handleRequest() {
        const status = 200;
        const headers = new Headers();
        const body = 'Hello, world!\n';

        headers.set('content-type', 'text/plain; charset=utf-8');
        // Use Blob.size for accurate byte length (handles UTF-8 correctly)
        headers.set('content-length', new Blob([ body ]).size);

        return {
            status,
            headers,
            body,
        };
    }

    /**
     * Internal Node.js request handler that manages the request/response lifecycle
     * Handles both synchronous and asynchronous request handlers with unified error handling
     *
     * @private
     * @param {http.IncomingMessage} nodeRequest - Node.js HTTP request object
     * @param {http.ServerResponse} nodeResponse - Node.js HTTP response object  
     * @fires HttpServer#debug
     * @fires HttpServer#error
     */
    #handleNodeRequest(nodeRequest, nodeResponse) {
        // Use custom request ID header if provided, otherwise generate one
        // for distributed tracing and log correlation
        const requestId = nodeRequest.headers['x-request-id'] || this.#generateRequestId();

        // Reconstruct full URL from Node.js request components
        const method = nodeRequest.method;
        const proto = this.#getHttpProtocol(nodeRequest);
        const host = this.#getHttpHost(nodeRequest);
        const url = new URL(nodeRequest.url, `${ proto }://${ host }`);

        this.emit('debug', {
            name: 'request-received',
            message: 'request received',
            info: { requestId, method, url: url.href },
        });

        // Handle request stream errors (client disconnects, malformed data, etc.)
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

        // Track when response is fully sent to client
        nodeResponse.on('finish', () => {
            const status = nodeResponse.statusCode;

            this.emit('debug', {
                name: 'response-sent',
                message: 'response sent',
                info: { requestId, status, method, url: url.href },
            });
        });

        const completeResponse = (response) => {
            // Handle different request completion states to avoid response hanging
            if (nodeRequest.complete) {
                // Request body fully received - safe to send response immediately
                this.#sendResponse(nodeRequest, nodeResponse, response);
            } else {
                // Request body still streaming - must drain it first to prevent hanging
                // This happens when we need to respond early (auth errors, validation failures)
                // before the entire request body has been consumed
                nodeRequest.on('end', () => {
                    this.#sendResponse(nodeRequest, nodeResponse, response);
                });

                // Drain any remaining request data to trigger 'end' event
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

            // Send generic 500 response to avoid leaking internal error details
            const status = 500;
            const body = 'Internal server error.\n';

            const headers = new Headers({
                'content-type': 'text/plain; charset=utf-8',
                'content-length': new Blob([ body ]).size,
            });

            completeResponse({ status, headers, body });
        };

        // Handle both sync and async request handlers with unified error handling
        try {
            // Async request handlers return promises, sync handlers return response objects
            const result = this.handleRequest(nodeRequest, nodeResponse, url, requestId);
            
            if (result && typeof result.then === 'function') {
                result.then(completeResponse, handleError);
            } else {
                // Sync handler - complete immediately
                completeResponse(result);
            }
        } catch (error) {
            // Sync handler threw - handle immediately
            handleError(error);
        }
    }

    /**
     * Sends HTTP response to client handling different body types and HTTP methods
     * Supports streaming responses for large files and proper HEAD request handling
     *
     * @private
     * @param {http.IncomingMessage} nodeRequest - Node.js request object
     * @param {http.ServerResponse} nodeResponse - Node.js response object  
     * @param {HttpResponse} response - Response object with status, headers, and body
     */
    #sendResponse(nodeRequest, nodeResponse, response) {
        const {
            status,
            headers,
            body,
        } = response;

        nodeResponse.writeHead(status, headersToObject(headers));

        // Handle different body types based on HTTP method and content
        if (body && nodeRequest.method !== 'HEAD') {
            if (isFunction(body.pipe)) {
                // Stream response body to avoid loading large files into memory
                body.pipe(nodeResponse);
            } else {
                // Send string/buffer content directly
                nodeResponse.end(body);
            }
        } else {
            // HEAD requests or empty responses - send headers only
            nodeResponse.end();
        }
    }

    /**
     * Determines HTTP protocol from request headers with proxy support
     * @private
     * @param {http.IncomingMessage} req - Node.js request object
     * @returns {string} Protocol ('http' or 'https')
     */
    #getHttpProtocol(req) {
        // Trust reverse proxy headers for protocol detection (load balancers, CDNs)
        return req.headers['x-forwarded-proto'] || 'http';
    }

    /**
     * Extracts host information from request headers with proxy support
     * @private
     * @param {http.IncomingMessage} req - Node.js request object
     * @returns {string} Host header value or 'localhost' fallback
     */
    #getHttpHost(req) {
        // Priority order: forwarded host (proxy) -> host header -> fallback
        return req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    }

    /**
     * Generates unique request identifier for tracking and correlation
     * @private
     * @returns {string} Formatted request ID (e.g., 'req-1', 'req-2')
     */
    #generateRequestId() {
        // Simple incrementing counter - sufficient for single process
        // For multi-process/cluster deployments, consider UUID or process-specific prefixes
        this.#requestId += 1;
        return `req-${ this.#requestId }`;
    }
}
