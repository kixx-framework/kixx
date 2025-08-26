import http from 'node:http';

// Client request headers which we do not forward to the backend server.
const DISALLOWED_HEADERS = [
    'host',
    'connection',
    'keep-alive',
];

// The "^" symbol within "[^]" means one NOT of the following set of characters.
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\:\-\/\&\?\=%]/i;

export const BACKEND_CONNECTION_TIMEOUT_SECONDS = 300;
export const FRONTEND_CONNECTION_TIMEOUT_SECONDS = 20;


// Use a simple incrementing function to generate request IDs.
const generateReqId = (function createIdGenerator() {
    let i = 0;

    return function genReqId() {
        i += 1;
        return `req-${ Math.floor(Date.now() / 1000) }-${ i }`;
    };
}());

// Create a custom HTTP agent to keep the connection to the
// backend servers open longer.
const agent = new http.Agent({
    keepAlive: true,
    timeout: BACKEND_CONNECTION_TIMEOUT_SECONDS * 1000,
});


export default class DevServer {

    #logger = null;

    constructor(logger) {
        this.#logger = logger;
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
        const { targetProtocol, targetHostname, backendHost, backendPort } = this;
        const logger = this.#logger;

        try {
            this.checkURL(targetHostname, path);
        } catch (error) {
            logger.warn('invalid request url', { method, path, id }, error);

            // The request will be destroyed after the response is sent
            // (see res "close" event above).
            this.sendInvalidUrlResponse(req, res, `Bad Request: Invalid URL ("${ path }") ${ error.message }`);
            return;
        }

        const headers = this.formatHttpHeaders(req.headers, {
            'host': backendHost,
            'x-forwarded-host': targetHostname,
            'x-forwarded-proto': targetProtocol,
            'x-request-id': id,
            'connection': 'keep-alive',
            'keep-alive': `timeout=${ BACKEND_CONNECTION_TIMEOUT_SECONDS }`,
        });

        const options = {
            agent, // Use the custom HTTP agent.
            method,
            port: backendPort,
            path,
            headers,
        };

        logger.info('proxy request', { method, path, id, forwardedHost: targetHostname });

        const proxyRequest = http.request(options, function onDownstreamResponse(proxyResponse) {
            proxyResponse.once('error', function onProxyResponseError(error) {
                // The response error event will fire when the response is in
                // progress and the request is aborted.
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

            // Pipe the backend response to the proxy dev-server response.
            proxyResponse.pipe(res);
        });

        proxyRequest.on('error', function onProxyReqError(error) {
            if (error.code === 'ECONNRESET') {
                logger.info('proxy request aborted before response', { method, path, id });
            } else {
                logger.warn('proxy request error event', { method, path, id }, error);
            }
        });

        // Pipe data from the incoming stream to the request stream.
        req.pipe(proxyRequest);
    }

    checkURL(hostname, pathname) {
        // We run the decode functions here just to double check for invalid
        // inputs. If the inputs are invalid, then the decodeURIComponent()
        // function will throw.
        decodeURIComponent(pathname);

        if (DISALLOWED_URL_CHARACTERS.test(pathname)) {
            throw new TypeError('Disallowed characters in request URL');
        }

        // Parse the URL.
        return new URL(pathname, `https://${ hostname }`);
    }

    formatHttpHeaders(requestHeaders, newHeaders) {
        const headers = {};

        for (const key of Object.keys(requestHeaders)) {
            // Header keys are lower-cased by Node.js.
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
