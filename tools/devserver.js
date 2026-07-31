import process from 'node:process';
import http from 'node:http';
import util from 'node:util';
import { isNonEmptyString } from '../src/kixx/assertions/mod.js';
import { OperationalError } from '../src/kixx/errors/mod.js';
import AppServerProcess from './devserver/app-server-process.js';
import { serveSourceFile } from './devserver/source-file-handler.js';


// Mirrors src/node-server.js's CLI surface so this script is a drop-in
// replacement for it. --port is the one exception: here it selects the
// devserver's own public listen port, not the child app server's port.
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

const DEFAULT_PORT = '2026';

const portValue = isNonEmptyString(cliOptions.port) ? cliOptions.port : DEFAULT_PORT;
const port = parsePort(portValue);

if (port === null) {
    throw new OperationalError(
        'The dev server port must be a valid integer from 0 to 65535',
    );
}

// Forward the app server's own flags to the child process unchanged; only
// --port is withheld here since the child is always given a dynamically
// discovered port instead of the value the developer passed to devserver.js.
const forwardedAppServerArgs = [];

if (isNonEmptyString(cliOptions.environment)) {
    forwardedAppServerArgs.push('--environment', cliOptions.environment);
}

if (isNonEmptyString(cliOptions.dotenv)) {
    forwardedAppServerArgs.push('--dotenv', cliOptions.dotenv);
}

const appServerProcess = new AppServerProcess({ forwardedArgs: forwardedAppServerArgs });

const devServer = http.createServer((request, response) => {
    handleRequest(request, response).catch((cause) => {
        // handleRequest() does not normally reject (proxy failures are
        // handled via event listeners in proxyRequest()), but a rejection
        // here would otherwise hang the client until it times out.
        logDevServerError('unhandled error while proxying request', cause);
        if (response.headersSent) {
            response.destroy();
        } else {
            respondUnavailable(response);
        }
    });
});

async function handleRequest(request, response) {
    // Retain dot segments for the source-file handlers' validation rather than
    // letting URL normalization collapse a traversal attempt before it reaches
    // their shared path-safety guard.
    const pathname = request.url.split(/[?#]/)[0];
    const assetPathname = pathname.replace(/^\/assets\/[^/]+(?=\/)/, '');
    const sourcePathname = assetPathname === pathname ? pathname : assetPathname;

    // Browser CSS and JavaScript are not copied into public/ by a development
    // build step, so serve recognized paths directly from their source roots.
    if (await serveSourceFile(request, response, sourcePathname)) {
        return;
    }

    try {
        await appServerProcess.ensureFresh();
    } catch (cause) {
        // ensureFresh() only rejects when a triggered restart's replacement
        // child failed to come up; it leaves the previous, still-healthy
        // child as current in that case, so this request can still be served
        // from it rather than failing outright.
        logDevServerError('idle restart failed; continuing to serve from the previous app server', cause);
    }

    const targetPort = appServerProcess.port;

    if (!targetPort) {
        respondUnavailable(response);
        return;
    }

    proxyRequest(request, response, targetPort);
}

function proxyRequest(request, response, targetPort) {
    response.on('close', () => appServerProcess.markActivity());

    // Forwarding request.headers as-is preserves the original Host header
    // value on the outgoing request; Node's http.request() only derives a
    // Host header from `host`/`port` when one is not already present in
    // `headers`. Preserving it keeps virtual-hosts.js hostname-based routing
    // working the same as if the client had reached the app server directly.
    const requestOptions = {
        host: '127.0.0.1',
        port: targetPort,
        method: request.method,
        path: request.url,
        headers: request.headers,
    };

    const proxyReq = http.request(requestOptions, (proxyRes) => {
        response.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(response);
    });

    proxyReq.on('error', (cause) => {
        logDevServerError('proxy request failed', cause);
        if (response.headersSent) {
            response.destroy();
        } else {
            respondUnavailable(response);
        }
    });

    request.on('error', () => proxyReq.destroy());

    request.pipe(proxyReq);
}

function respondUnavailable(response) {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad Gateway: app server is not currently reachable\n');
}

function logDevServerError(message, cause) {
    // eslint-disable-next-line no-console
    console.error(`[devserver] ${ message }`, cause);
}

devServer.on('error', (cause) => {
    logDevServerError('failed to start', cause);
    appServerProcess.stop().finally(() => process.exit(1));
});

await appServerProcess.start();

devServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[devserver] listening on http://localhost:${ port }, proxying to app server on port ${ appServerProcess.port }`);
});

let isShuttingDown = false;

function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;

    // eslint-disable-next-line no-console
    console.log(`[devserver] received ${ signal }; shutting down...`);

    devServer.close();
    appServerProcess.stop().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// node-server.js does not export parsePort(), and these are two independent
// CLI entry points, so the validation logic is intentionally duplicated here
// rather than coupling the two scripts together.
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
