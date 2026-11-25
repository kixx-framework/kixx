import defaultProcess from 'node:process';
import path from 'node:path';
import http from 'node:http';
import util from 'node:util';
import { Readable } from 'node:stream';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isFunction,
    isNonEmptyString,
    isObjectNotNull,
} from '../../../../assertions/mod.js';
import { OperationalError } from '../../../../errors/mod.js';
import HttpRouter from '../../../../http-router/http-router.js';
import ServerResponse from '../../../../http-router/server-response.js';
import { readConfig } from '../../../../config/read-config.js';
import { bootApplication } from '../../../../context/boot-application.js';
import TraceLogger from '../../../../logger/trace-logger.js';
import {
    resolveDotenvFilepath,
    readEnvironment,
    readSourceConfigFile,
    createResolveFilepath,
} from './node-environment.js';


const DEFAULT_PORT = '2026';

// Milliseconds to wait for in-flight requests and plugins' stop() hooks to
// finish before forcing exit. A stop() hook must finish inside this.
const SHUTDOWN_TIMEOUT_MS = 10000;


/**
 * @typedef {Object} NodeServerRegistry
 * @property {Function} LoggerWriter - Logger writer class for Node.js
 * @property {Function} ServerRequest - Server request class for Node.js
 * @property {Map<string, Object>} plugins - Lifecycle modules, in the order they run
 * @property {Object} configDefaults - Config defaults, merged under the selected environment's config
 * @property {{ required: string[], optional: string[] }} secrets - Every declared secret name
 */

/**
 * @typedef {Object} NodeServer
 * @property {import('../../../../context/application-context.js').default} appContext
 * @property {import('../../../../logger/logger.js').default} logger
 * @property {import('node:http').Server} server - The listening HTTP server
 * @property {function(string, { force: boolean, exitCode?: number }): void} shutdown - Closes the server, stops plugins, closes services, then exits the process
 */


/**
 * Boots the application and serves it over HTTP. A Node.js entry point calls
 * it once and does nothing else.
 *
 * In order: the command line is parsed (`--environment`/`-e`, `--port`/`-p`,
 * `--dotenv`), the environment is read from the dotenv files and the process
 * environment, `node-config.jsonc` is read with the registry's defaults under
 * the selected environment's section, every declared secret is checked, and
 * each lifecycle module is registered and initialized. Then the server
 * listens, the start() hooks run, and the SIGTERM and SIGINT handlers are
 * registered.
 *
 * A failure before the server listens rejects, with nothing listening and no
 * signal handler registered. A start() hook that fails is logged and shuts the
 * server down; the returned promise still resolves.
 *
 * The environment is `--environment`, else `NODE_ENV`, else `development`. The
 * port is `--port`, else `PORT`, else 2026.
 *
 * @param {Object} options
 * @param {NodeServerRegistry} options.registry - The exports of the project's Node.js registry module
 * @param {Array<Object>} options.virtualHosts - Virtual host specifications for the router
 * @param {Object} options.app - The application's own lifecycle hooks
 * @param {string} options.baseDirectory - Directory holding `node-config.jsonc` and the `.env.<environment>` files
 * @param {Object} [options.process] - The process: `argv`, `env`, `exit`, and `on` are used. Defaults to `node:process`.
 * @param {(filepath: string) => string} [options.readFile] - UTF-8 file reader for the dotenv and config files, defaulting to `fs.readFileSync`
 * @param {string} [options.hostname] - Address to bind. When omitted the server accepts connections on every address.
 * @returns {Promise<NodeServer>}
 * @throws {OperationalError} When the port is invalid, a dotenv or config file can't be read, the config has no
 *     section for the environment, or a declared secret is missing
 */
export async function startNodeServer(options) {
    const {
        registry,
        virtualHosts,
        app,
        baseDirectory,
        process = defaultProcess,
        readFile,
        hostname,
    } = options ?? {};

    assert(isObjectNotNull(registry), 'startNodeServer: options.registry must be a registry module');
    assertFunction(registry.ServerRequest, 'startNodeServer: options.registry.ServerRequest');
    assertNonEmptyString(baseDirectory, 'startNodeServer: options.baseDirectory');
    assert(isObjectNotNull(process), 'startNodeServer: options.process must be an object');

    const { ServerRequest } = registry;

    // Parse CLI options.
    const { values: cliOptions } = util.parseArgs({
        args: process.argv.slice(2),
        options: {
            environment: { type: 'string', short: 'e' },
            port: { type: 'string', short: 'p' },
            dotenv: { type: 'string' },
        },
        strict: false,
        allowPositionals: true,
    });

    // The environment selects a section of the config file's `environments` map;
    // default to development when --environment or NODE_ENV is not provided.
    let environment = isNonEmptyString(cliOptions.environment)
        ? cliOptions.environment
        : process.env.NODE_ENV;

    if (!environment) {
        environment = 'development';
    }

    const dotenvFile = resolveDotenvFilepath({
        baseDirectory,
        environment,
        dotenv: cliOptions.dotenv,
    });

    const env = readEnvironment({
        dotenvFile,
        processEnv: process.env,
        readFile,
    });

    const resolveFilepath = createResolveFilepath({
        baseDirectory,
        dataDirectory: env.DATA_DIRECTORY,
    });

    const sourceConfig = readSourceConfigFile(path.join(baseDirectory, 'node-config.jsonc'), readFile);

    const config = readConfig(sourceConfig, environment, {
        resolveFilepath,
        defaults: registry.configDefaults,
    });

    // The server port defaults to 2026, can be set with PORT, and is overridable by --port.
    let portValue = DEFAULT_PORT;
    if (isNonEmptyString(env.PORT)) {
        portValue = env.PORT;
    }
    if (isNonEmptyString(cliOptions.port)) {
        portValue = cliOptions.port;
    }
    const port = parsePort(portValue);

    if (port === null) {
        throw new OperationalError(
            'The server port must be a valid integer from 0 to 65535',
        );
    }

    const { appContext, logger, start, stop } = bootApplication({
        env,
        config,
        LoggerWriter: registry.LoggerWriter,
        plugins: registry.plugins,
        app,
        secrets: registry.secrets,
    });

    // Whether to trust the X-Forwarded-For header when resolving a request's client
    // IP. Enable only when running behind a trusted reverse proxy that sets it;
    // otherwise a directly-connected client could spoof its own IP address.
    const trustProxy = appContext.getEnvBoolean('TRUST_PROXY');

    const router = new HttpRouter(virtualHosts);

    // Key on `expected`, not `httpError`: a bug is fatal even when it carries an
    // HTTP status code. Expected HTTP errors (404, 422, ...) are routine and not logged.
    router.on('error', ({ error, requestId }) => {
        if (!error.expected) {
            logger.error('unexpected error while routing request', { requestId }, error);
            shutdown('fatal router error', { force: false, exitCode: 1 });
        } else if (!error.httpError) {
            logger.warn('operational error while routing request', { requestId }, error);
        }
    });

    async function handleRequest(nodeRequest, nodeResponse) {
        const trace = new TraceLogger(logger, 'http-request');
        let pathname;
        let isHeadRequest = false;
        let request;

        try {
            request = new ServerRequest(nodeRequest, { trustProxy });

            // Registered before routing so every response path, including the 500
            // below, discards an unread body. Node skips its own discard once the
            // adapter starts reading the body.
            nodeResponse.once('finish', () => request.discardUnreadBody());

            pathname = request.url.pathname;
            isHeadRequest = request.isHeadRequest();
            const requestContext = appContext.createRequestContext(env, request);
            const response = await router.handleRequest(requestContext, request, new ServerResponse());
            trace.ok({ pathname });
            sendResponse(nodeResponse, response, isHeadRequest);
        } catch (cause) {
            // A malformed request target is the client's fault, so answer 400 and
            // keep running.
            if (!request && cause.name === 'BadRequestError') {
                logger.warn('bad request target', { url: nodeRequest.url });
                trace.error({ pathname: nodeRequest.url });
                sendBadRequest(nodeResponse, nodeRequest.method === 'HEAD');
                return;
            }

            // The router emits 'error' events for logging, but a rejection here still
            // needs to terminate the socket or the client hangs until it times out.
            logger.error('unhandled error while handling request', null, cause);

            trace.error({ pathname });

            if (nodeResponse.headersSent) {
                nodeResponse.destroy(cause);
                shutdown('fatal request error', { force: false, exitCode: 1 });
                return;
            }

            nodeResponse.statusCode = 500;
            nodeResponse.setHeader('content-type', 'text/plain; charset=utf-8');
            // This response bypasses the router, which otherwise enforces the cache policy.
            nodeResponse.setHeader('cache-control', 'no-store');

            if (isHeadRequest) {
                nodeResponse.end();
            } else {
                nodeResponse.end('Internal Server Error\n');
            }

            shutdown('fatal request error', { force: false, exitCode: 1 });
        }
    }

    // Translate the framework ServerResponse into the Node http.ServerResponse:
    // apply the status, headers, and body so the response is written to the socket.
    function sendResponse(nodeResponse, response, isHeadRequest) {
        // Iterating a Web Headers instance folds repeated Set-Cookie values into a
        // single comma-joined string, which is invalid for cookies. Apply every
        // other header here and pull the cookies from getSetCookie() below so each
        // Set-Cookie is emitted as its own header line.
        for (const [ name, value ] of response.headers) {
            if (name !== 'set-cookie') {
                nodeResponse.setHeader(name, value);
            }
        }

        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) {
            nodeResponse.setHeader('set-cookie', cookies);
        }

        nodeResponse.statusCode = response.status;

        const { body } = response;

        // A HEAD response carries the same headers (including Content-Length) as the
        // equivalent GET, but never a body. Emit headers and end the response without
        // writing or piping a body, even if middleware left one set.
        if (isHeadRequest || body === null || body === undefined) {
            nodeResponse.end();
            return;
        }

        // A Web ReadableStream must be adapted to a Node stream before piping.
        if (body instanceof ReadableStream) {
            pipeStream(Readable.fromWeb(body), nodeResponse);
            return;
        }

        // Any object exposing pipe() is treated as a Node Readable stream.
        if (isFunction(body.pipe)) {
            pipeStream(body, nodeResponse);
            return;
        }

        // Strings and Buffers are written directly.
        nodeResponse.end(body);
    }

    // pipe() does not forward source errors or tear down the destination, so a body
    // stream that fails mid-response would otherwise leak the socket. Destroy the
    // Node response on error to terminate the connection.
    function pipeStream(readStream, nodeResponse) {
        readStream.on('error', (cause) => {
            logger.error('error streaming response body', null, cause);
            nodeResponse.destroy(cause);
        });
        readStream.pipe(nodeResponse);
    }

    const nodeServer = http.createServer(handleRequest);

    let isShuttingDown = false;

    // Shut down the process: stop accepting new connections, then exit.
    //
    // SIGTERM is the deploy/orchestrator path, so we drain — let in-flight requests
    // finish before exiting, with the force-exit timer as a backstop for a stuck
    // request. SIGINT is an interactive Ctrl-C, so we exit immediately and drop any
    // in-flight requests; a developer expects Ctrl-C to be instant, not to block on
    // a held-open connection.
    function shutdown(reason, shutdownOptions) {
        const { force, exitCode = 0 } = shutdownOptions ?? {};

        if (isShuttingDown) {
            return;
        }

        isShuttingDown = true;
        logger.info('closing server', { reason, force, exitCode });

        const forceExit = setTimeout(() => {
            logger.error('graceful shutdown timed out; forcing exit', null);
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);

        // Don't let the timer itself keep the event loop alive once draining is done.
        forceExit.unref();

        nodeServer.close(async (cause) => {
            if (cause) {
                logger.error('error closing server during shutdown', null, cause);
            }

            // Let plugins end their long-running work before the stores it
            // uses are closed underneath it. stop() isolates its own
            // failures, so this await resolves even if a hook throws.
            await stop();

            // In-flight requests have drained, so it is now safe to close store
            // connections (SQLite databases) without interrupting a request
            // mid-query. appContext.close() isolates its own failures, so this
            // await resolves even if a service close throws.
            await appContext.close();

            // Clear the backstop only after store close finishes, so a stuck close
            // is still force-exited by the timer rather than hanging the process.
            clearTimeout(forceExit);

            const finalExitCode = cause ? 1 : exitCode;
            logger.info('server closed; exiting', { reason, exitCode: finalExitCode });
            process.exit(finalExitCode);
        });

        // close() only resolves once every connection has ended. Idle HTTP
        // keep-alive sockets stay open until the client's keep-alive timeout fires,
        // and active sockets stay open until their request finishes, so without
        // intervention close() stalls until the force-exit timeout.
        if (force) {
            // Interactive Ctrl-C: destroy every connection, including in-flight
            // requests, so close() resolves and we exit right away.
            nodeServer.closeAllConnections();
        } else {
            // Graceful drain: release only idle keep-alive sockets. Sockets serving
            // a request keep draining until their request finishes.
            nodeServer.closeIdleConnections();
        }
    }

    // Attach event handlers before listen() so bind failures are logged by the app
    // logger. A startup bind failure must exit non-zero; otherwise supervisors see
    // a clean process exit even though no server is accepting traffic.
    nodeServer.on('error', (cause) => {
        logger.error('node.js server error event', null, cause);
        if (!nodeServer.listening && !isShuttingDown) {
            process.exit(1);
        }
    });

    nodeServer.on('listening', () => {
        const addr = nodeServer.address();
        logger.info('node.js server running', { address: addr.address, port: addr.port });
    });

    // State transitions to 'listening' (emits event above) or 'error' if port unavailable
    await listen(nodeServer, port, hostname);

    // Start plugins' long-running work once the server is bound. An error a
    // plugin can't recover from is fatal, like an unexpected request error.
    try {
        await start({
            onUnexpectedError(error) {
                logger.error('unexpected error reported by a plugin', null, error);
                shutdown('fatal plugin error', { force: false, exitCode: 1 });
            },
        });
    } catch (cause) {
        logger.error('error starting a plugin', null, cause);
        shutdown('fatal start error', { force: false, exitCode: 1 });
    }

    process.on('SIGTERM', () => shutdown('SIGTERM', { force: false }));
    process.on('SIGINT', () => shutdown('SIGINT', { force: true }));

    return {
        appContext,
        logger,
        server: nodeServer,
        shutdown,
    };
}

// Resolves once the server is listening. Rejects with a bind failure, so a
// caller whose process.exit() returns isn't left waiting.
function listen(nodeServer, port, hostname) {
    return new Promise((resolve, reject) => {
        function onListening() {
            nodeServer.off('error', onError);
            resolve();
        }

        function onError(cause) {
            nodeServer.off('listening', onListening);
            reject(cause);
        }

        nodeServer.once('listening', onListening);
        nodeServer.once('error', onError);

        if (isNonEmptyString(hostname)) {
            nodeServer.listen(port, hostname);
        } else {
            nodeServer.listen(port);
        }
    });
}

// Sent outside the router, which otherwise enforces the cache policy.
function sendBadRequest(nodeResponse, isHeadRequest) {
    nodeResponse.statusCode = 400;
    nodeResponse.setHeader('content-type', 'text/plain; charset=utf-8');
    nodeResponse.setHeader('cache-control', 'no-store');

    if (isHeadRequest) {
        nodeResponse.end();
    } else {
        nodeResponse.end('Bad Request\n');
    }
}

function parsePort(value) {
    if (!isNonEmptyString(value) || !/^\d+$/.test(value)) {
        return null;
    }

    const parsedPort = Number.parseInt(value, 10);
    if (parsedPort < 0 || parsedPort > 65535) {
        return null;
    }

    return parsedPort;
}
