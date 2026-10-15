import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { AppProcess, canConnect } from '../../../lib/devserver/app-process.js';
import { DevServer } from '../../../lib/devserver/dev-server.js';
import captureOutput from '../../helpers/capture-output.js';


// Real processes, watchers, and sockets: each case spawns the runtime at least
// once, and restarts wait on file watcher latency.
const TIMEOUT = 20000;

const WAIT_DEADLINE_MS = 5000;
const POLL_INTERVAL_MS = 50;
const FIXTURE_SETTLE_MS = 200;

// Uses only node: modules, so it runs under both Node.js and Deno.
const FIXTURE_SERVER = `
import http from 'node:http';
import process from 'node:process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: { port: { type: 'string' }, environment: { type: 'string' } },
    strict: false,
});

const { default: message } = await import('./message.js');

const server = http.createServer((req, res) => {
    const body = JSON.stringify({ message, host: req.headers.host, environment: values.environment, pid: process.pid });

    res.setHeader('content-type', 'application/json');
    res.end(body, () => {
        if (req.url === '/crash') {
            process.exit(1);
        }
    });
});

process.on('SIGTERM', () => process.exit(0));

server.listen(Number(values.port));
`;


async function withDevServer(fn) {
    const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-devserver-')));

    await fsp.writeFile(path.join(directory, 'node-server.js'), FIXTURE_SERVER);
    await fsp.writeFile(path.join(directory, 'message.js'), 'export default \'v1\';\n');
    await fsp.writeFile(path.join(directory, 'package.json'), '{ "type": "module" }\n');

    // macOS FSEvents replays changes made just before a watch starts, which
    // would restart the app once at an unpredictable time. A setup-only wait
    // lets the fixture writes age out of that window.
    await sleep(FIXTURE_SETTLE_MS);

    const logs = [];
    const log = (message) => logs.push(message);
    const stdout = captureOutput();
    const stderr = captureOutput();

    // Built the same way as the dev start command builds it.
    const appProcess = new AppProcess({ projectDirectory: directory, environment: 'development', stdout, stderr, log });
    const devServer = new DevServer({ projectDirectory: directory, port: 0, appProcess, log });

    try {
        await devServer.start();
        await fn({ directory, devServer, logs });
    } finally {
        await devServer.stop();
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

function get(port, requestPath, headers) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port,
            path: requestPath || '/',
            headers: headers || {},
            agent: false,
        }, (response) => {
            const chunks = [];

            response.setEncoding('utf8');
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                resolve({ statusCode: response.statusCode, headers: response.headers, body: chunks.join('') });
            });
        });

        request.on('error', reject);
        request.end();
    });
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// Repeats GET until the predicate accepts the response. Watcher latency
// varies by platform, so tests poll rather than sleep a fixed time.
async function waitForResponse(port, predicate, requestPath) {
    const deadline = Date.now() + WAIT_DEADLINE_MS;
    let response;

    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        response = await get(port, requestPath);

        if (predicate(response, parseJson(response.body))) {
            return response;
        }

        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`timed out waiting for a matching response; last: ${ response?.statusCode } ${ response?.body }`);
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function countLines(logs, prefix) {
    return logs.filter((line) => line.startsWith(prefix)).length;
}


describe('DevServer integration', ({ it }) => {

    it('serves the app with the client Host header', async () => {
        await withDevServer(async ({ devServer }) => {
            const response = await get(devServer.port, '/', { host: 'app.example.test' });
            const body = JSON.parse(response.body);

            assertEqual(200, response.statusCode);
            assertEqual('v1', body.message);
            assertEqual('app.example.test', body.host);
            assertEqual('development', body.environment);
        });
    }, { timeout: TIMEOUT });

    it('restarts after a server-side file changes', async () => {
        await withDevServer(async ({ directory, devServer }) => {
            const first = JSON.parse((await get(devServer.port)).body);

            await fsp.writeFile(path.join(directory, 'message.js'), 'export default \'v2\';\n');

            const response = await waitForResponse(devServer.port, (_response, body) => body?.message === 'v2');

            assertNotEqual(first.pid, JSON.parse(response.body).pid);
        });
    }, { timeout: TIMEOUT });

    it('shows the error page after a broken edit and recovers after a fix', async () => {
        await withDevServer(async ({ directory, devServer, logs }) => {
            await get(devServer.port);

            await fsp.writeFile(path.join(directory, 'message.js'), 'export default \'v3;\n');

            const failed = await waitForResponse(devServer.port, (response) => response.statusCode === 502);

            assertMatches('text/html', failed.headers['content-type']);
            assertEqual('no-store', failed.headers['cache-control']);
            assertMatches('SyntaxError', failed.body);

            // A further request without a change must not spawn again.
            const failedStarts = countLines(logs, 'app server failed to start');
            const starts = countLines(logs, 'starting app server');
            const again = await get(devServer.port);

            assertEqual(502, again.statusCode);
            assertEqual(failedStarts, countLines(logs, 'app server failed to start'));
            assertEqual(starts, countLines(logs, 'starting app server'));

            await fsp.writeFile(path.join(directory, 'message.js'), 'export default \'v3\';\n');

            await waitForResponse(devServer.port, (_response, body) => body?.message === 'v3');
        });
    }, { timeout: TIMEOUT });

    it('starts a new app server on the next request after a crash', async () => {
        await withDevServer(async ({ devServer }) => {
            const crashed = JSON.parse((await get(devServer.port, '/crash')).body);

            const response = await waitForResponse(devServer.port, (_response, body) => {
                return Boolean(body) && body.pid !== crashed.pid;
            });

            assertEqual('v1', JSON.parse(response.body).message);
        });
    }, { timeout: TIMEOUT });

    it('ignores changes in excluded directories', async () => {
        await withDevServer(async ({ directory, devServer, logs }) => {
            const before = JSON.parse((await get(devServer.port)).body);

            await fsp.mkdir(path.join(directory, 'pages'));
            await fsp.mkdir(path.join(directory, '.kixx'));
            await fsp.writeFile(path.join(directory, 'pages', 'x.js'), 'export default 1;\n');
            await fsp.writeFile(path.join(directory, '.kixx', 'x.js'), 'export default 1;\n');

            // Proving that nothing happens needs a bounded settle time longer
            // than watcher latency; the only other fixed wait is fixture setup.
            await sleep(500);

            const after = JSON.parse((await get(devServer.port)).body);

            assertEqual(before.pid, after.pid);
            assertEqual(0, countLines(logs, 'change detected'));
        });
    }, { timeout: TIMEOUT });

    it('stops the app server and closes the port', async () => {
        await withDevServer(async ({ devServer }) => {
            const port = devServer.port;
            const { pid } = JSON.parse((await get(port)).body);

            assert(isProcessAlive(pid), 'expected the app server to be running');

            await devServer.stop();

            assertEqual(false, isProcessAlive(pid));
            assertEqual(false, await canConnect(port));
        });
    }, { timeout: TIMEOUT });
});
