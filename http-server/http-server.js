import http from 'node:http';
import { EventEmitter } from 'node:events';
import { isFunction, isNumberNotNaN } from '../assertions/mod.js';
import { headersToObject } from '../lib/http-utils.js';


export default class HttpServer extends EventEmitter {

    #nodeServer = null;
    #requestId = 0;

    constructor({ port }) {
        super();

        Object.defineProperties(this, {
            port: {
                enumerable: true,
                value: isNumberNotNaN(port) ? port : 8080,
            },
        });
    }

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

    // Give the server some time to gracefully shutdown before forcing an exit.
    // We could force this by calling "closeAllConnections()", but instead:
    //
    // First, we call close() to stop accepting new connections.
    // Then, we give all the open connections an opportunity to finish their work and close.
    // If open connections have not closed in a specified time, we call closeAllConnections().
    // If the server still has not closed in a specified time, we force an exit.
    //
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

    // Send the response *after* the request has completed
    // (see completeResponse() above).
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

    #getHttpProtocol(req) {
        return req.headers['x-forwarded-proto'] || 'http';
    }

    #getHttpHost(req) {
        return req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    }

    #generateRequestId() {
        this.#requestId += 1;
        return `req-${ this.#requestId }`;
    }
}
