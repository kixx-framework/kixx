import process from 'node:process';
import http from 'node:http';
import util from 'node:util';
import { Readable } from 'node:stream';
import { isFunction, isNonEmptyString } from './kixx/assertions/mod.js';
import { OperationalError } from './kixx/errors/mod.js';
import Logger from './kixx/logger/logger.js';
import ApplicationContext from './kixx/context/application-context.js';
import AppRuntime from './kixx/context/app-runtime.js';
import HttpRouter from './kixx/http-router/http-router.js';
import LoggerWriter from './plugins/node-logger-writer/lib/logger-writer.js';
import ServerRequest from './plugins/node-server-request/lib/server-request.js';
import ServerResponse from './kixx/http-router/server-response.js';
import * as app from './app/app.js';
import { generalPlugins, nodePlugins } from './plugins/mod.js';
import { readConfig } from './plugins/node-config/lib/config.js';
import virtualHosts from './virtual-hosts.js';


// Parse CLI options. The bootstrap may receive arguments we do not own, so
// unknown options must not throw.
const { values: cliOptions } = util.parseArgs({
    args: process.argv.slice(2),
    options: {
        config: { type: 'string', short: 'c' },
        environment: { type: 'string' },
        port: { type: 'string', short: 'p' },
    },
    strict: false,
    allowPositionals: true,
});

// The config file path comes from --config, falling back to the CONFIG_FILE env var.
const configFilePath = isNonEmptyString(cliOptions.config) ? cliOptions.config : process.env.CONFIG_FILE;

if (!isNonEmptyString(configFilePath)) {
    throw new OperationalError(
        'A config file path is required: pass --config or set the CONFIG_FILE environment variable',
    );
}

// The environment selects a section of the config file's `environments` map;
// default to development when --environment is not provided.
const environment = isNonEmptyString(cliOptions.environment)
    ? cliOptions.environment
    : 'development';
const config = readConfig(configFilePath, environment);

const env = Object.assign({}, process.env, config.env);

const DEFAULT_PORT = '2026';

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

const runtime = new AppRuntime({
    build: { id: env.BUILD_ID },
    server: { name: config.name },
});

const logger = new Logger({
    name: config.name,
    level: env.LOG_LEVEL || 'debug',
    writer: new LoggerWriter(),
});

const appContext = new ApplicationContext({
    config,
    env,
    runtime,
    logger,
});

// Merge plugin maps, allowing platform plugins to override general plugins.
const plugins = new Map([ ...generalPlugins, ...nodePlugins ]);

// Register all plugins before calling initialize() on each.
for (const plugin of plugins.values()) {
    if (isFunction(plugin?.register)) {
        plugin.register(appContext);
    }
}

for (const plugin of plugins.values()) {
    if (isFunction(plugin?.initialize)) {
        plugin.initialize(appContext);
    }
}

if (isFunction(app.register)) {
    app.register(appContext);
}

if (isFunction(app.initialize)) {
    app.initialize(appContext);
}

// Finalize the logger to prevent creating infinite child loggers.
// This must be done *after* the plugins have been registered and initialized.
logger.finalize();

const router = new HttpRouter(virtualHosts);

router.on('error', ({ error, requestId }) => {
    if (!error.httpError) {
        if (error.expected) {
            // Operational Error
            logger.warn('operational error while routing request', { requestId }, error);
        } else {
            logger.error('unexpected error while routing request', { requestId }, error);
        }
    }
});


async function handleRequest(nodeRequest, nodeResponse) {
    let isHeadRequest = false;

    try {
        const request = new ServerRequest(nodeRequest);
        isHeadRequest = request.isHeadRequest();
        const requestContext = appContext.createRequestContext(env, request);
        const response = await router.handleRequest(requestContext, request, new ServerResponse());
        sendResponse(nodeResponse, response, isHeadRequest);
    } catch (cause) {
        // The router emits 'error' events for logging, but a rejection here still
        // needs to terminate the socket or the client hangs until it times out.
        logger.error('unhandled error while handling request', null, cause);
        if (nodeResponse.headersSent) {
            nodeResponse.destroy(cause);
            return;
        }

        nodeResponse.statusCode = 500;
        nodeResponse.setHeader('content-type', 'text/plain; charset=utf-8');

        if (isHeadRequest) {
            nodeResponse.end();
        } else {
            nodeResponse.end('Internal Server Error\n');
        }
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
nodeServer.listen(port);

// Milliseconds to wait for in-flight requests to drain before forcing exit.
const SHUTDOWN_TIMEOUT_MS = 10000;

// Shut down on termination signals: stop accepting new connections, then exit.
//
// SIGTERM is the deploy/orchestrator path, so we drain — let in-flight requests
// finish before exiting, with the force-exit timer as a backstop for a stuck
// request. SIGINT is an interactive Ctrl-C, so we exit immediately and drop any
// in-flight requests; a developer expects Ctrl-C to be instant, not to block on
// a held-open connection.
function shutdown(signal, { force }) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    logger.info('received shutdown signal; closing server', { signal, force });

    const forceExit = setTimeout(() => {
        logger.error('graceful shutdown timed out; forcing exit', null);
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Don't let the timer itself keep the event loop alive once draining is done.
    forceExit.unref();

    nodeServer.close((cause) => {
        clearTimeout(forceExit);
        if (cause) {
            logger.error('error closing server during shutdown', null, cause);
            process.exit(1);
        }
        logger.info('server closed; exiting', { signal });
        process.exit(0);
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

process.on('SIGTERM', () => shutdown('SIGTERM', { force: false }));
process.on('SIGINT', () => shutdown('SIGINT', { force: true }));

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
