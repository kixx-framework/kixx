import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { assertNonEmptyString, isFunction, isNonEmptyString } from './kixx/assertions/mod.js';
import { OperationalError } from './kixx/errors/mod.js';
import Logger from './kixx/logger/logger.js';
import ApplicationContext from './kixx/context/application-context.js';
import AppRuntime from './kixx/context/app-runtime.js';
import HttpRouter from './kixx/http-router/http-router.js';
import LoggerWriter from './plugins/node-logger-writer/lib/logger-writer.js';
import ServerRequest from './plugins/node-server-request/lib/server-request.js';
import ServerResponse from './kixx/http-router/server-response.js';
import sourceConfig from './node-config.js';
import * as app from './app/app.js';
import generalPlugins from './plugins/general.js';
import nodePlugins from './plugins/node.js';
import { readConfig } from './kixx/config/read-config.js';
import virtualHosts from './virtual-hosts.js';


const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));


// Parse CLI options.
const { values: cliOptions } = util.parseArgs({
    args: process.argv.slice(2),
    options: {
        environment: { type: 'string', short: 'e' },
        port: { type: 'string', short: 'p' },
        secrets: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
});

// The environment selects a section of the config module's `environments` map;
// default to development when --environment or NODE_ENV is not provided.
let environment = isNonEmptyString(cliOptions.environment)
    ? cliOptions.environment
    : process.env.NODE_ENV;

if (!environment) {
    environment = 'development';
}

const secretsFile = isNonEmptyString(cliOptions.secrets)
    ? path.resolve(cliOptions.secrets)
    : path.join(THIS_DIRECTORY, `.secrets.${ environment }`);

let env;

try {
    env = parseDotEnvFile(secretsFile);
} catch (error) {
    if (error.code === 'ENOENT') {
        // If the secrets file does not exist, use the env vars read at startup.
        env = process.env;
    } else {
        throw error;
    }
}

const config = readConfig(sourceConfig, environment, {
    resolveFilepath,
});

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

const name = env.APP_NAME || 'kixx-app';

const runtime = new AppRuntime({
    build: { id: env.BUILD_ID },
    server: { name },
});

const logger = new Logger({
    name,
    level: env.LOG_LEVEL || 'debug',
    writer: new LoggerWriter(),
});

const appContext = new ApplicationContext({
    env,
    config,
    runtime,
    logger,
});

// Whether to trust the X-Forwarded-For header when resolving a request's client
// IP. Enable only when running behind a trusted reverse proxy that sets it;
// otherwise a directly-connected client could spoof its own IP address.
const trustProxy = appContext.getEnvBoolean('TRUST_PROXY');

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
            shutdown('fatal router error', { force: false, exitCode: 1 });
        }
    }
});


async function handleRequest(nodeRequest, nodeResponse) {
    let isHeadRequest = false;

    try {
        const request = new ServerRequest(nodeRequest, { trustProxy });
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
            shutdown('fatal request error', { force: false, exitCode: 1 });
            return;
        }

        nodeResponse.statusCode = 500;
        nodeResponse.setHeader('content-type', 'text/plain; charset=utf-8');

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

// Shut down the process: stop accepting new connections, then exit.
//
// SIGTERM is the deploy/orchestrator path, so we drain — let in-flight requests
// finish before exiting, with the force-exit timer as a backstop for a stuck
// request. SIGINT is an interactive Ctrl-C, so we exit immediately and drop any
// in-flight requests; a developer expects Ctrl-C to be instant, not to block on
// a held-open connection.
function shutdown(reason, options) {
    const { force, exitCode = 0 } = options ?? {};

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

function parseDotEnvFile(filepath) {
    let source;
    try {
        source = fs.readFileSync(filepath, 'utf8');
    } catch (cause) {
        throw new OperationalError(`Unable to read secrets file from ${ filepath }`, { cause });
    }

    try {
        return util.parseEnv(source);
    } catch (cause) {
        throw new OperationalError(`Unable to parse secrets file from ${ filepath }`, { cause });
    }
}

function resolveFilepath(relativeFilepath) {
    assertNonEmptyString(relativeFilepath, 'resolveFilepath requires a relative filepath');

    // Config file paths are POSIX-style so deployment config stays portable.
    // Rejoin the pieces with node:path to return an OS-native absolute path.
    return path.join(THIS_DIRECTORY, ...relativeFilepath.split('/'));
}
