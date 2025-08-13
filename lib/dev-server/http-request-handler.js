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

const GATEWAY_TIMEOUT_MS = 20 * 1000;


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


export function createHttpRequestHandler(logger, target) {

    return function httpRequestHandler(req, res) {
        const id = generateReqId();
        const { method } = req;
        const path = req.url;

        let proxyRequest; // eslint-disable-line prefer-const
        let proxyResponse;

        let requestError;
        let responseError; // eslint-disable-line no-unused-vars

        let gatewayTimeout;

        function onGatewayTimeout() {
            logger.warn('gateway timeout', { method, path, id, GATEWAY_TIMEOUT_MS });

            if (res.headersSent) {
                // If the headers have already been sent, then destroy the
                // proxy request.
                if (proxyRequest && !proxyRequest.destroyed) {
                    proxyRequest.destroy();
                }
            } else {
                sendGatewayTimeout(req, res);
            }
        }

        req.on('error', function onReqError(error) {
            requestError = error;

            if (error.code === 'ECONNRESET') {
                logger.info('client request aborted', { method, path, id });
            } else {
                logger.warn('client request error event', { method, path, id }, error);
            }
        });

        req.once('close', function onReqClose() {
            if (requestError) {
                // If there was a request error, destroy the request now.
                // If we don't destroy the proxy request then the backend server
                // will never get notified when the client request was aborted
                // (no error or close events are fired)
                if (proxyRequest && !proxyRequest.destroyed) {
                    proxyRequest.destroy();
                }
            } else if (!res.destroyed || !res.writableEnded) {
                // If there was NO request error, and no response then
                // set the gateway timeout.
                gatewayTimeout = setTimeout(onGatewayTimeout, GATEWAY_TIMEOUT_MS);
            } else {
                // We should not see client requests which are closed after the
                // response has completed. This indicates the server responded
                // before the request was complete.
                logger.warn('client request closed after response', { method, path, id });
            }
        });

        res.on('error', function onResError(error) {
            responseError = error;
            logger.warn('response error event', { method, path, id }, error);
        });

        res.once('close', function onResClose() {
            if (res.writableEnded) {
                logger.debug('response write ended', {
                    method,
                    path,
                    id,
                    statusCode: res.statusCode,
                });
            } else {
                logger.warn('response prematurely closed', { method, path, id });
            }

            // If the response has been sent (indicated by the "closed" event)
            // then we want to ensure the incoming stream is destroyed and
            // resources are cleaned up. If we don't do this, then the backend
            // server and client may never know of the ended request. This can
            // lead to orphaned/hung requests and other issues.
            if (proxyRequest && !proxyRequest.destroyed) {
                proxyRequest.destroy();
            }
            if (!req.destroyed) {
                req.destroy();
            }
        });

        let url;
        try {
            url = createFullURL(target.port, path);
        } catch (error) {
            logger.warn('invalid request url', { method, path, id }, error);

            // The request will be destroyed after the response is sent
            // (see res "close" event above).
            sendInvalidUrlResponse(req, res);
            return;
        }

        const headers = formatHttpHeaders(req.headers, {
            'host': url.host,
            'x-forwarded-host': target.host,
            'x-forwarded-proto': target.protocol,
            'x-request-id': id,
            'connection': 'keep-alive',
            'keep-alive': `timeout=${ BACKEND_CONNECTION_TIMEOUT_SECONDS }`,
        });

        const options = {
            agent, // Use the custom HTTP agent.
            method,
            port: target.port,
            path: req.url,
            headers,
        };

        logger.info('proxy request', { method, path, id, forwardedHost: target.host });

        proxyRequest = http.request(options, function onDownstreamResponse(response) {

            proxyResponse = response;

            let proxyResponseError; // eslint-disable-line no-unused-vars

            clearTimeout(gatewayTimeout);

            // Used for testing a hard crash.
            // throw new Error('Hard Crash');

            proxyResponse.once('error', function onProxyResponseError(error) {
                proxyResponseError = error;

                // The response error event will fire when the response is in
                // progress and the request is aborted.

                if (error.code === 'ECONNRESET') {
                    logger.info('proxy response aborted', { method, path, id });
                } else {
                    logger.warn('proxy response error event', { method, path, id }, error);
                }
            });

            // Destroying the response when the upstream closes can truncate
            // some responses based on different network conditions.
            // proxyResponse.on('close', () => {
            //     // Under normal conditions the server response should have
            //     // completed and will by destroyed by now. In the case of some
            //     // errors, it may not be. In those cases we need to destroy
            //     // the server response here to close the request with
            //     // the client.
            //     if (!res.destroyed) {
            //         res.destroy();
            //     }
            // });

            const responseHeaders = Object.assign({}, proxyResponse.headers, {
                connection: 'keep-alive',
                'keep-alive': `timeout=${ FRONTEND_CONNECTION_TIMEOUT_SECONDS }`,
            });

            res.writeHead(
                proxyResponse.statusCode,
                proxyResponse.statusMessage,
                responseHeaders
            );

            proxyResponse.pipe(res);
        });

        proxyRequest.on('error', function onProxyReqError(error) {
            if (error.code === 'ECONNRESET') {
                logger.info('proxy request aborted before response', { method, path, id });
            } else {
                logger.warn('proxy request error event', { method, path, id }, error);
            }

            clearTimeout(gatewayTimeout);

            if (!res.headersSent) {
                sendBadGateway(req, res);
            }
        });

        // Pipe data from the incoming stream to the request stream.
        req.pipe(proxyRequest);
    };
}

export function createFullURL(targetPort, pathname) {
    // We run the decode functions here just to double check for invalid
    // inputs. If the inputs are invalid, then the decodeURIComponent()
    // function will throw.
    decodeURIComponent(pathname);

    if (DISALLOWED_URL_CHARACTERS.test(pathname)) {
        throw new TypeError('Disallowed characters in request URL');
    }

    // Parse the URL.
    return new URL(pathname, `http://localhost:${ targetPort }`);
}

function formatHttpHeaders(requestHeaders, newHeaders) {
    // Header keys are lower-cased by Node.js.
    const headerKeys = Object.keys(requestHeaders).sort();
    const headers = {};

    for (const key of headerKeys) {
        if (!DISALLOWED_HEADERS.includes(key)) {
            headers[key] = requestHeaders[key];
        }
    }

    return Object.assign(headers, newHeaders);
}

export function sendInvalidUrlResponse(req, res) {
    const body = 'Bad Request: Invalid URL\n';
    sendErrorResponse(req, res, 400, body);
}

export function sendBadGateway(req, res) {
    sendErrorResponse(req, res, 502);
}

export function sendRequestTimeout(req, res) {
    sendErrorResponse(req, res, 408);
}

export function sendGatewayTimeout(req, res) {
    sendErrorResponse(req, res, 504);
}

export function sendErrorResponse(req, res, statusCode, utf8Body = '') {
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
