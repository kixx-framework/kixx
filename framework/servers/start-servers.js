// @ts-check

import path from 'node:path';
import KixxAssert from 'kixx-assert';
import { ProgrammerError } from 'kixx-server-errors';
// Some imports are only used for type checking purposes.
/* eslint-disable no-unused-vars */
import { Logger } from 'kixx-logger';
import EventBus from '../lib/event-bus.js';
import ApplicationServerConfig from '../configuration/application-server-config.js';
import ServerConfig from '../configuration/server-config.js';
import ApplicationContext from '../core/application-context.js';
/* eslint-enable no-unused-vars */
import { ErrorEvent } from '../lib/events.js';
import WrappedNodeRequest from './wrapped-node-request.js';
import WrappedNodeResponse from './wrapped-node-response.js';
import createUnencryptedServer from './create-unencrypted-server.js';
import createTLSServer from './create-tls-server.js';

const { isNonEmptyString, isFunction } = KixxAssert.helpers;

// The "^" symbol within "[^]" means one NOT of the following set of characters.
// eslint-disable-next-line no-useless-escape
const DISALLOWED_URL_CHARACTERS = /[^a-z0-9_\.\:\-\/\&\?\=%]/i;

/**
 * @prop {Logger} logger
 * @prop {EventBus} eventBus
 * @prop {Map} applications
 * @prop {ApplicationServerConfig} config
 * @return {Promise} Returns a Promise which resolves to an array of HTTP Servers.
 */
export default function startServers(logger, eventBus, applications, config) {

    const servers = [];

    eventBus.on(ErrorEvent.NAME, (event) => {
        if (event && event.fatal) {
            logger.fatal('fatal error event detected; closing servers');
            // Give a full turn of the event loop for the error event to propagate
            // before closing the servers.
            setTimeout(() => {
                closeServers(servers);
            }, 1);
        }
    });

    // Start the servers serially (using reduce()) instead of in parallel (using map()). Starting
    // in serial allows us to shut them down if one fails to start.
    const allDonePromise = config.servers.reduce((promise, serverConfig) => {
        return promise.then(() => {
            const params = {
                logger,
                eventBus,
                config,
                applications,
            };

            return startServer(params, serverConfig).then((server) => {
                servers.push(server);
                return server;
            });
        });
    }, Promise.resolve(null));

    return allDonePromise.catch((cause) => {
        if (servers.length > 0) {
            logger.info('error detected while starting servers; closing servers');
        }

        closeServers(servers);
        return Promise.reject(cause);
    });
}

/**
 * @typedef StartServerParams
 * @prop {EventBus} eventBus
 * @prop {Logger} logger
 * @prop {ApplicationServerConfig} config
 * @prop {Map} applications
 */

/**
 * @param  {StartServerParams} params
 * @param  {ServerConfig} serverConfig
 * @return {Promise}
 */
function startServer(params, serverConfig) {
    const {
        logger,
        eventBus,
        config,
        applications,
    } = params;

    const { port, encrypted } = serverConfig;

    async function handleHttpRequest(req, res) {
        const originatingPort = getOriginatingPort(serverConfig, req);
        const originatingProtocol = getOriginatingProtocol(serverConfig, req);
        const hostname = getHostname(serverConfig, req);
        const { method } = req;

        const href = `${ hostname }:${ originatingPort }${ req.url }`;

        logger.debug('request', { method, href });

        if (!isNonEmptyString(hostname)) {
            logger.debug('invalid request host', { host: hostname });
            sendInvalidHostResponse(req, res);
            return;
        }

        let url;

        try {
            decodeURIComponent(req.url);

            if (DISALLOWED_URL_CHARACTERS.test(req.url)) {
                throw new TypeError('Disallowed characters in request URL');
            }

            // Parse the URL.
            url = new URL(req.url, `${ originatingProtocol }://${ hostname }:${ originatingPort }`);
        } catch (cause) {
            logger.debug('invalid request url', { url: req.url, cause });
            sendInvalidUrlResponse(req, res);
            return;
        }

        let appConfig;

        // If only 1 application is registered for this server then default to it.
        // This feature allows us to use port number to designate host applications in
        // the development environment.
        if (config.applications.length === 1) {
            appConfig = config.applications[0];
        } else {
            appConfig = config.findHostApplication(hostname);
        }

        if (!appConfig) {
            logger.debug('host not available', { host: hostname });
            sendNotFoundHostResponse(req, res);
            return;
        }

        const preferredHost = appConfig.getPreferredHost();
        const preferredPort = appConfig.getPreferredPort();
        const preferredProtocol = appConfig.preferEncrypted ? 'https' : 'http';

        const usePreferredHost = preferredHost && preferredHost !== hostname;
        const usePreferredPort = preferredPort && preferredPort !== originatingPort;

        let newLocation = null;

        if (usePreferredHost && usePreferredPort) {
            logger.debug('redirect to preferred host and port', { preferredHost, preferredPort });
            // Redirect to the preferred host and port:
            newLocation = composeRedirectLocation(
                preferredProtocol,
                preferredHost,
                preferredPort,
                req.url
            );
        } else if (usePreferredHost) {
            logger.debug('redirect to preferred host', { preferredHost });
            newLocation = composeRedirectLocation(
                preferredProtocol,
                preferredHost,
                originatingPort,
                req.url
            );
        } else if (usePreferredPort) {
            logger.debug('redirect to preferred port', { preferredPort });
            newLocation = composeRedirectLocation(
                preferredProtocol,
                hostname,
                preferredPort,
                req.url
            );
        }

        if (newLocation) {
            logger.debug('301 redirection', { location: newLocation });
            send301Redirect(req, res, newLocation);
            return;
        }

        const applicationContext = applications.get(appConfig.name);

        if (!applicationContext) {
            logger.fatal('application is not registered by name', {
                host: hostname,
                name: appConfig.name,
            });

            throw new ProgrammerError('application is not registered by name', {
                fatal: true,
                info: { host: hostname, name: appConfig.name },
            });
        }

        const request = new WrappedNodeRequest({
            url,
            nodeHttpRequest: req,
        });

        const response = new WrappedNodeResponse();

        const modifiedResponse = await applicationContext.routeWebRequest(request, response);

        const responseHeaders = rawHeadersArrayFromMap(modifiedResponse.headers);
        let responseStatusCode = modifiedResponse.status;
        const responseBody = modifiedResponse.body;

        // TODO: Create and set the content-length header if it was not set by the application.
        const responseContentLength = parseInt(modifiedResponse.headers.get('content-length'), 10) || 0;

        if (req.method === 'OPTIONS' && responseContentLength === 0) {
            responseStatusCode = 204;
        }

        // TODO: Use the status text provided by the application.
        res.writeHead(responseStatusCode, responseHeaders);

        if (req.method === 'HEAD' || responseContentLength === 0) {
            res.end();
        } else if (responseBody && isFunction(responseBody.pipe)) {
            responseBody.pipe(res);
        } else if (responseBody) {
            res.write(responseBody);
            res.end();
        } else {
            res.end();
        }
    }

    if (encrypted) {
        logger.info('starting tls server', { port });

        // The certificate directory is resolved from the current working directory.
        const sslCertificateDirectory = config.ssl_certificate_directory
            ? path.resolve(config.ssl_certificate_directory)
            : null;

        return createTLSServer({
            eventBus,
            logger,
            port,
            applications: config.applications,
            sslCertificateDirectory,
        }, handleHttpRequest);
    }

    logger.info('starting unencrypted server', { port });

    return createUnencryptedServer({
        eventBus,
        logger,
        port,
    }, handleHttpRequest);
}

function closeServers(servers) {
    servers.forEach((server) => {
        server.close();
    });
}

function getOriginatingPort(serverConfig, req) { // eslint-disable-line no-unused-vars
    // TODO: Use the X-Forwarded-Port header value
    return serverConfig.port;
}

function getOriginatingProtocol(serverConfig, req) { // eslint-disable-line no-unused-vars
    // TODO: Use the X-Forwarded-Proto header value
    return serverConfig.encrypted ? 'https' : 'http';
}

function getHostname(serverConfig, req) {
    // TODO: Use the X-Forwarded-For header value
    const hostString = req.headers.host || '';
    return hostString.split(':')[0] || null;
}

function sendInvalidHostResponse(req, res) {
    const body = 'Bad Request: Invalid host request header\n';

    res.writeHead(400, 'Bad Request', {
        'content-type': 'text/plain; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
    });

    res.end(body);
}

function sendInvalidUrlResponse(req, res) {
    const body = 'Bad Request: Invalid URL\n';

    res.writeHead(400, 'Bad Request', {
        'content-type': 'text/plain; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
    });

    res.end(body);
}

function sendNotFoundHostResponse(req, res) {
    const body = 'Not Found: Host not found\n';

    res.writeHead(404, 'Not Found', {
        'content-type': 'text/plain; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
    });

    res.end(body);
}

function send301Redirect(req, res, location) {
    res.writeHead(301, 'Moved Permanently', { location });
    res.end();
}

function composeRedirectLocation(protocol, hostname, port, pathname) {
    const url = new URL(pathname, `${ protocol }://${ hostname }:${ port }`);
    return url.href;
}

function rawHeadersArrayFromMap(headersMap) {
    const rawHeaders = [];

    for (const [ key, value ] of headersMap) {
        rawHeaders.push(key);
        rawHeaders.push(value);
    }

    return rawHeaders;
}
