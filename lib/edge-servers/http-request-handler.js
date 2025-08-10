import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
    sendBadGateway,
    sendAcmeChallenge,
    sendGatewayTimeout,
    sendInvalidUrlResponse,
    sendInvalidHostResponse,
    sendNotFoundHostResponse
} from './response-helpers.js';


const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public', import.meta.url));


// Client request headers which we do not forward to the backend server.
const DISALLOWED_HEADERS = [
    'host',
    'connection',
    'keep-alive',
];

// The "^" symbol within "[^]" means one NOT of the following set of characters.
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\:\-\/\&\?\=%]/i;
// eslint-disable-next-line no-useless-escape
const DISALLOWED_HOST_CHARACTERS = /[^a-z0-9_\.\:\-]/i;

// Roughly match an IP address to avoid uneccessary logging.
const IP_ADDR_PATTERN = /^[\d]{1,3}.[\d]{1,3}.[\d]{1,3}.[\d]{1,3}$/;

const ACME_CHALLENGE_PATHNAME = '/.well-known/acme-challenge/';

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


/**
 * @param  {Logger} logger    A Kixx Logger instance.
 * @param  {Map} vhostsByHost A Map of {}.
 * @param  {String} protocol  The expected protocol string "http" or "https".
 * @return {Function}         A Node.js request handler function.
 */
export function createHttpRequestHandler(logger, vhostsByHost, protocol) {

    // Public
    return function httpRequestHandler(req, res) {
        const id = generateReqId();
        const { method, socket } = req;
        const ip = socket.remoteAddress;
        const host = req.headers.host;

        let url;
        let edgeHref = `${ protocol }://${ host }${ req.url }`;

        let proxyRequest; // eslint-disable-line prefer-const
        let proxyResponse;

        let requestError;
        let responseError; // eslint-disable-line no-unused-vars

        let gatewayTimeout;

        function onGatewayTimeout() {
            const href = url && url.href;
            logger.warn('gateway timeout', { id, GATEWAY_TIMEOUT_MS, href });

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
                logger.info('client request aborted', {
                    id,
                    code: error.code,
                });
            } else {
                logger.warn('client request error event', {
                    id,
                    code: error.code,
                }, error);
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
                logger.warn('client request closed after response', { id });
            }
        });

        res.on('error', function onResError(error) {
            responseError = error;
            logger.warn('response error event', {
                id,
                code: error.code,
            }, error);
        });

        res.once('close', function onResClose() {
            if (res.writableEnded) {
                logger.info('response write ended', {
                    id,
                    ip,
                    statusCode: res.statusCode,
                    method,
                    href: edgeHref,
                });
            } else {
                logger.warn('response prematurely closed', {
                    id,
                    ip,
                    method,
                    href: edgeHref,
                });
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

        if (!isValidHostString(host)) {
            logger.debug('no host header', { id, ip });
            // The request will be destroyed after the response is sent
            // (see res "close" event above).
            sendInvalidHostResponse(req, res);
            return;
        }

        try {
            url = createFullURL(protocol, host, req.url);
        } catch (error) {
            logger.debug('invalid request url', {
                id,
                ip,
                url: req.url,
                errorMessage: error.message,
            });

            // The request will be destroyed after the response is sent
            // (see res "close" event above).
            sendInvalidUrlResponse(req, res);
            return;
        }

        // Answer ACME challenge requests to acquire an SSL certificate.
        if (url.pathname.startsWith(ACME_CHALLENGE_PATHNAME)) {
            sendAcmeChallenge(req, res, logger, PUBLIC_DIRECTORY, url);
            return;
        }

        const vhost = vhostsByHost.get(url.host);

        if (!vhost) {
            // Often the host not found scenario is a result of somebody
            // pinging the server using the IP address as a hostname. We can
            // avoid logging these bacuse they are generally not interesting.
            if (!IP_ADDR_PATTERN.test(url.hostname)) {
                logger.debug(
                    'host does not exist',
                    { id, ip, hostname: url.hostname }
                );
            }

            // The request will be destroyed after the response is sent
            // (see res "close" event above).
            sendNotFoundHostResponse(req, res);
            return;
        }

        // Capture the href value before we start mutating the URL instance.
        edgeHref = url.href;

        logger.info('will proxy request', { id, ip, method, href: edgeHref });

        url.hostname = 'localhost';
        url.port = vhost.port;

        // Gets the protocol string property without the ":".
        const proto = getTrimmedProtocolString(url);

        const headers = formatHttpHeaders(req.headers, {
            'host': url.host,
            'x-forwarded-host': host,
            'x-forwarded-proto': proto,
            'x-request-id': id,
            'connection': 'keep-alive',
            'keep-alive': `timeout=${ BACKEND_CONNECTION_TIMEOUT_SECONDS }`,
        });

        const options = {
            agent, // Use the custom HTTP agent.
            method,
            port: url.port,
            path: req.url,
            headers,
        };

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
                    logger.info('proxy response aborted', {
                        id,
                        code: error.code,
                    });
                } else {
                    logger.warn('proxy response error event', {
                        id,
                        code: error.code,
                    });
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
                logger.info('proxy request aborted before response', {
                    id,
                    code: error.code,
                });
            } else {
                logger.warn('proxy request error event', {
                    id,
                    code: error.code,
                });
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

export function createFullURL(proto, host, pathname) {
    // We run the decode functions here just to double check for invalid
    // inputs. If the inputs are invalid, then the decodeURIComponent()
    // function will throw.
    decodeURIComponent(host);
    decodeURIComponent(pathname);

    if (DISALLOWED_HOST_CHARACTERS.test(host)) {
        throw new TypeError('Disallowed characters in hostname');
    }
    if (DISALLOWED_URL_CHARACTERS.test(pathname)) {
        throw new TypeError('Disallowed characters in request URL');
    }

    // Parse the URL.
    return new URL(pathname, `${ proto }://${ host }`);
}

function isValidHostString(x) {
    return x && typeof x === 'string';
}

function getTrimmedProtocolString(url) {
    return url.protocol.replace(/:$/, '');
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
