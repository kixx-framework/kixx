import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { AssertionError } from '../errors.js';
import { isNumberNotNaN, isString, isUndefined, isFunction } from '../assertions.js';
import ServerRequest from './server-request.js';
import ServerResponse from '../http/server-response.js';

/**
 * Payload for NodeServer 'debug' events (request-received, response-sent).
 * @typedef {Object} NodeServerDebugEvent
 * @property {string} name - Event name: 'request-received' or 'response-sent'
 * @property {string} message - Human-readable log message
 * @property {Object} info - Request/response context
 * @property {string} info.id - Unique request identifier (e.g. 'req-1')
 * @property {string} info.method - HTTP method
 * @property {string} info.url - Full request URL
 * @property {number} [info.status] - HTTP status code (present only for 'response-sent')
 */

/**
 * Payload for NodeServer 'info' events (server-listening, server-closed).
 * @typedef {Object} NodeServerInfoEvent
 * @property {string} name - Event name: 'server-listening' or 'server-closed'
 * @property {string} message - Human-readable log message
 * @property {Object} info - Server context
 * @property {number} info.port - Port the server is bound to
 */

/**
 * Payload for NodeServer 'error' events (server-error, request-error, request-handler-error).
 * @typedef {Object} NodeServerErrorEvent
 * @property {string} name - Event name: 'server-error', 'request-error', or 'request-handler-error'
 * @property {string} message - Human-readable error message
 * @property {Object} info - Context (port for server-error; id, method, url for request errors)
 * @property {boolean} fatal - Whether the error is fatal (server must be restarted or request aborted)
 * @property {Error} cause - Underlying Node.js or application error
 */

/**
 * Wraps a Node.js http.Server to manage the lifecycle of HTTP request/response handling.
 *
 * Emits structured log events ('debug', 'info', 'error') rather than writing to console,
 * letting callers attach their own logging. Translates raw Node.js IncomingMessage and
 * ServerResponse objects into ServerRequest/ServerResponse instances for the handler.
 *
 * @emits NodeServer#debug - Emits a NodeServerDebugEvent when a request is received or a response is sent
 * @emits NodeServer#info - Emits a NodeServerInfoEvent when the server starts listening or closes
 * @emits NodeServer#error - Emits a NodeServerErrorEvent on server error, request stream error, or unhandled handler error
 */
export default class NodeServer {

    /**
     * Internal counter for generating unique request identifiers
     * @type {number}
     */
    #requestId = 0;

    /**
     * Event emitter for server events (error, info, debug)
     * @type {EventEmitter}
     */
    #emitter = new EventEmitter();

    /**
     * @type {http.Server|null}
     */
    #nodeServer = null;

    /**
     * http module interface used to create the server; injectable for testing
     * @type {Object}
     */
    #http = null;

    /**
     * @param {Object} options - Server configuration options
     * @param {number} [options.port=8080] - Port number to listen on
     * @param {Object} [options.http] - http module interface; defaults to Node.js built-in http
     */
    constructor(options) {
        options = options || {};

        this.#http = options.http || http;

        Object.defineProperties(this, {
            /**
             * The port number the server will listen on.
             * @name port
             * @public
             * @type {number}
             */
            port: {
                enumerable: true,
                value: isNumberNotNaN(options.port) ? options.port : 8080,
            },
        });
    }

    /**
     * Subscribes to a server lifecycle event.
     * @public
     * @param {'debug'|'info'|'error'} eventName - Event to listen for
     * @param {function(NodeServerDebugEvent|NodeServerInfoEvent|NodeServerErrorEvent): void} listener - Called with the event payload (shape depends on eventName)
     * @returns {void}
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
    }

    /**
     * Creates and starts the underlying Node.js HTTP server.
     * @public
     * @param {function(ServerRequest, ServerResponse): ServerResponse|Promise<ServerResponse>} handler - Request handler invoked for each incoming request
     * @returns {void}
     * @throws {AssertionError} When the server has already been started
     */
    startServer(handler) {
        if (this.#nodeServer) {
            throw new AssertionError('Server already started');
        }

        const { port } = this;

        this.#nodeServer = this.#http.createServer(this.#handleNodeRequest.bind(this, handler));

        // Attach event handlers BEFORE listen() to catch port-in-use errors
        this.#nodeServer.on('error', (cause) => {
            this.#emitter.emit('error', {
                name: 'server-error',
                message: 'error event on node.js server',
                info: { port },
                fatal: true,
                cause,
            });
        });

        this.#nodeServer.on('close', () => {
            this.#emitter.emit('info', {
                name: 'server-closed',
                message: 'server closed',
                info: { port },
            });
        });

        this.#nodeServer.on('listening', () => {
            this.#emitter.emit('info', {
                name: 'server-listening',
                message: 'http server listening',
                info: { port },
            });
        });

        // State transitions to 'listening' (emits event above) or 'error' if port unavailable
        this.#nodeServer.listen(port);
    }

    #handleNodeRequest(handler, nodeRequest, nodeResponse) {
        const id = this.#generateRequestId();
        const protocol = this.#getHttpProtocol(nodeRequest);
        const host = this.#getHttpHost(nodeRequest);
        const { method } = nodeRequest;
        const url = new URL(nodeRequest.url, `${ protocol }://${ host }`);

        const request = new ServerRequest(nodeRequest, url, id);
        const response = new ServerResponse(id);

        this.#emitter.emit('debug', {
            name: 'request-received',
            message: 'request received',
            info: { id, method, url: url.href },
        });

        // Request stream errors (client disconnect, malformed data) prevent the 'end' event from
        // firing. This naturally aborts any in-progress work like file uploads that are
        // waiting on request data, but we report it here anyway.
        nodeRequest.on('error', (cause) => {
            this.#emitter.emit('error', {
                name: 'request-error',
                message: 'request error event',
                info: { id, method, url: url.href },
                fatal: false,
                cause,
            });
        });

        nodeResponse.on('finish', () => {
            const status = nodeResponse.statusCode;

            this.#emitter.emit('debug', {
                name: 'response-sent',
                message: 'response sent',
                info: { id, method, status, url: url.href },
            });
        });

        const handleError = (cause) => {
            this.#emitter.emit('error', {
                name: 'request-handler-error',
                message: 'Unhandled error in request handler',
                info: { id },
                fatal: true,
                cause,
            });

            // Generic response avoids leaking internal error details to clients
            const body = 'Internal server error.\n';

            const headers = new Headers({
                'content-type': 'text/plain; charset=utf-8',
                'content-length': new Blob([ body ]).size,
            });

            this.#writeResponse(nodeRequest, nodeResponse, { status: 500, headers, body });
        };

        const completeResponse = () => {
            // Fall back to the pre-created response object if the handler returns nothing.
            if (nodeRequest.complete) {
                this.#writeResponse(nodeRequest, nodeResponse, response);
            } else {
                // HTTP requires consuming the entire request body before responding.
                // If we respond early (e.g., auth error on a large upload), the
                // connection hangs unless we drain the remaining data.
                nodeRequest.on('end', () => {
                    this.#writeResponse(nodeRequest, nodeResponse, response);
                });
                nodeRequest.on('data', () => {}); // Drain to trigger 'end'
            }
        };

        // Support both sync handlers (return object) and async handlers (return Promise)
        try {
            const result = handler(request, response);

            // Duck-type Promise check
            if (result && isFunction(result.then)) {
                result.then(completeResponse, handleError);
            } else {
                completeResponse(result);
            }
        } catch (error) {
            handleError(error);
        }
    }

    #writeResponse(nodeRequest, nodeResponse, serverResponse) {
        // Convert Web API Headers to an array of [name, value] pairs.
        // Array format preserves multiple Set-Cookie headers as separate entries
        // rather than joining them with ', ', which would corrupt cookie values.
        const headers = [ ...serverResponse.headers.entries() ];
        nodeResponse.writeHead(serverResponse.status, headers);

        const { body } = serverResponse;

        if (body === null || isUndefined(body)) {
            nodeResponse.end();
        } else if (nodeRequest.method !== 'HEAD') {
            if (isFunction(body.pipe)) {
                // Node.js Readable stream — pipe into the response without buffering
                body.pipe(nodeResponse);
            } else if (isFunction(body.getReader)) {
                // WHATWG ReadableStream bodies are supported by converting them into
                // a Node.js Readable at the final adapter boundary.
                Readable.fromWeb(body).pipe(nodeResponse);
            } else if (isString(body) || Buffer.isBuffer(body)) {
                nodeResponse.end(body);
            }
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
     * Generates a unique request ID for tracking and log correlation.
     * @returns {string} Formatted request ID (e.g., 'req-1', 'req-2')
     */
    #generateRequestId() {
        this.#requestId += 1;
        return `req-${ this.#requestId }`;
    }
}
