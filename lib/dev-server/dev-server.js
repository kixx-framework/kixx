import http from 'node:http';

// Headers that would interfere with proxy forwarding or create security issues
// when passed through to backend servers
const DISALLOWED_HEADERS = [
    'host',
    'connection',
    'keep-alive',
];

// Regex to validate URL path characters - allows alphanumeric, dots, colons,
// hyphens, slashes, ampersands, question marks, equals, and percent signs
// The "^" symbol within "[^]" means "NOT any of the following characters"
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\:\-\/\&\?\=%]/i;

export const BACKEND_CONNECTION_TIMEOUT_SECONDS = 300;
export const FRONTEND_CONNECTION_TIMEOUT_SECONDS = 20;


// Generate unique request IDs using timestamp + increment to avoid collisions
const generateReqId = (function createIdGenerator() {
    let i = 0;

    return function genReqId() {
        i += 1;
        return `req-${ Math.floor(Date.now() / 1000) }-${ i }`;
    };
}());

// Custom HTTP agent with persistent connections to reduce connection overhead
// and improve performance for repeated requests to the same backend
const agent = new http.Agent({
    keepAlive: true,
    timeout: BACKEND_CONNECTION_TIMEOUT_SECONDS * 1000,
});


export default class DevServer {

    #logger = null;
    #targetProtocol = 'http';
    #targetHostname = 'localhost';
    #backendHost = 'localhost';
    #backendPort = 3000;

    /**
     * Creates a new DevServer instance for proxying requests to a backend server
     * @param {Object} logger - Logger instance for logging proxy events
     * @param {Object} [config={}] - Configuration object for proxy settings
     * @param {string} [config.targetProtocol='http'] - Protocol for the target hostname (http/https)
     * @param {string} [config.targetHostname='localhost'] - Hostname to set in x-forwarded-host header
     * @param {string} [config.backendHost='localhost'] - Backend server hostname
     * @param {number} [config.backendPort=3000] - Backend server port
     */
    constructor(logger, config = {}) {
        this.#logger = logger;
        this.#targetProtocol = config.targetProtocol || 'http';
        this.#targetHostname = config.targetHostname || 'localhost';
        this.#backendHost = config.backendHost || 'localhost';
        this.#backendPort = config.backendPort || 3000;
    }

    startServer(port) {
        const logger = this.#logger;

        const server = http.createServer({
            // This keepAlive setting does not seem to have an impact
            // either way.
            // keepAlive: true,
            //
            // This keepAliveTimeout setting will update the
            // Keep-Alive timeout=n value. Default is 5 seconds.
            // keepAliveTimeout: 5 * 1000,
            //
            // These timeout options were not found to be reliable in testing. First, there is no
            // easy way to test the headers timeout. Secondly, the request timeout will often allow
            // a request to go way beyond the configured timeout limit.
            //
            // Sets the timeout value in milliseconds for receiving the complete HTTP headers
            // from the client. Default: 60000
            // headersTimeout: 20 * 1000,
            // Sets the timeout value in milliseconds for receiving the entire request from
            // the client. Default: 300000
            // requestTimeout: 60 * 1000,
        });

        server.once('error', function onServerError(error) {
            logger.error('server error event', null, error);
        });

        server.once('listening', function onServerListening() {
            const addr = server.address();
            logger.info('server listening', { port: addr.port });
        });

        server.on('request', this.handleRequest.bind(this));

        server.listen(port);

        return server;
    }

    handleRequest(req, res) {
        const { method, path } = req;
        const id = generateReqId();
        const targetProtocol = this.#targetProtocol;
        const targetHostname = this.#targetHostname;
        const backendHost = this.#backendHost;
        const backendPort = this.#backendPort;
        const logger = this.#logger;

        try {
            this.checkURL(targetHostname, path);
        } catch (error) {
            logger.warn('invalid request url', { method, path, id }, error);

            // Request will be cleaned up after response is sent (see 'close' event handler)
            this.sendInvalidUrlResponse(req, res, `Bad Request: Invalid URL ("${ path }") ${ error.message }`);
            return;
        }

        // Transform headers for proxy forwarding:
        // - Replace 'host' with backend hostname
        // - Add X-Forwarded-* headers for backend to identify original request
        // - Add request ID for tracing
        // - Set keep-alive parameters for connection reuse
        const headers = this.formatHttpHeaders(req.headers, {
            'host': backendHost,
            'x-forwarded-host': targetHostname,
            'x-forwarded-proto': targetProtocol,
            'x-request-id': id,
            'connection': 'keep-alive',
            'keep-alive': `timeout=${ BACKEND_CONNECTION_TIMEOUT_SECONDS }`,
        });

        const options = {
            agent, // Use persistent connection agent for better performance
            method,
            port: backendPort,
            path,
            headers,
        };

        logger.info('proxy request', { method, path, id, forwardedHost: targetHostname });

        const proxyRequest = http.request(options, function onDownstreamResponse(proxyResponse) {
            proxyResponse.once('error', function onProxyResponseError(error) {
                // ECONNRESET is expected when client aborts request during response streaming
                if (error.code === 'ECONNRESET') {
                    logger.info('proxy response aborted', { method, path, id });
                } else {
                    logger.warn('proxy response error event', { method, path, id }, error);
                }
            });

            res.writeHead(
                proxyResponse.statusCode,
                proxyResponse.statusMessage,
                proxyResponse.headers
            );

            // Stream backend response directly to client without buffering
            proxyResponse.pipe(res);
        });

        proxyRequest.on('error', function onProxyReqError(error) {
            // ECONNRESET is expected when client aborts before backend responds
            if (error.code === 'ECONNRESET') {
                logger.info('proxy request aborted before response', { method, path, id });
            } else {
                logger.warn('proxy request error event', { method, path, id }, error);
            }
        });

        // Stream client request directly to backend without buffering
        req.pipe(proxyRequest);
    }

    checkURL(hostname, pathname) {
        // Validate URL encoding to catch malformed requests early
        // decodeURIComponent() throws if pathname contains invalid percent-encoding
        decodeURIComponent(pathname);

        if (DISALLOWED_URL_CHARACTERS.test(pathname)) {
            throw new TypeError('Disallowed characters in request URL');
        }

        // Parse and validate URL structure using Node.js URL constructor
        return new URL(pathname, `https://${ hostname }`);
    }

    formatHttpHeaders(requestHeaders, newHeaders) {
        const headers = {};

        for (const key of Object.keys(requestHeaders)) {
            // Filter out headers that would interfere with proxy forwarding
            // Node.js automatically lowercases header keys
            if (!DISALLOWED_HEADERS.includes(key)) {
                headers[key] = requestHeaders[key];
            }
        }

        return Object.assign(headers, newHeaders);
    }

    sendInvalidUrlResponse(req, res) {
        const body = `Bad Request: Invalid request URL path ("${ req.url }")\n`;
        this.sendErrorResponse(req, res, 400, body);
    }

    sendErrorResponse(req, res, statusCode, utf8Body = '') {
        const headers = { connection: 'close' };

        if (utf8Body) {
            headers['content-type'] = 'text/plain; charset=UTF-8';
            headers['content-length'] = Buffer.byteLength(utf8Body).toString();
        }

        res.writeHead(statusCode, headers);

        if (utf8Body) {
            res.end(utf8Body);
        } else {
            res.end();
        }
    }
}
