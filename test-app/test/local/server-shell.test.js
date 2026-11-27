/**
 * The Node.js server shell as a real process, on the runtime the runner
 * runs on: boot, a request, a drain on SIGTERM, a forced exit on SIGINT, the
 * exit codes, and a bind failure.
 *
 * Every test starts a server of its own on a free port, and stops it.
 */
import http from 'node:http';
import process from 'node:process';
import { assert, assertEqual } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { report, sleep, startLocalServer, tail } from '../test-helpers/local-server.js';


const ENVIRONMENT_PATHNAME = '/integration-probe/environment';
const HOLD_PATHNAME = '/integration-probe/hold';
const UNEXPECTED_ERROR_PATHNAME = '/integration-probe/unexpected-error';

// How long a request is given to reach the server and enter its handler
// before a signal is sent.
const IN_FLIGHT_MS = 500;

// A drain must exit this soon after the held response is done. Before the
// fix (S07 OP11) Node.js waited about 3,000 ms for the client to let go.
const DRAIN_LIMIT_MS = 2000;

const RUNTIME = process.versions.deno ? `Deno ${ process.versions.deno }` : `Node.js ${ process.versions.node }`;


describeOnTarget([ 'local' ], 'local: server shell', ({ it }) => {
    it('boots, answers a request, and exits 0 on SIGTERM with no request in flight', async () => {
        const server = await startLocalServer();

        try {
            const response = await server.fetch(ENVIRONMENT_PATHNAME);
            const body = await response.json();

            assertEqual(200, response.status);
            assertEqual('node', body.target);
            assertEqual('production', body.environment);
            assertEqual(server.buildId, body.buildId);

            server.signal('SIGTERM');

            const exit = await server.exitWithin(5000);

            assert(exit, 'the server did not exit within 5 seconds of SIGTERM');
            assertEqual(0, exit.code, tail(exit.output));
            assertEqual(null, exit.signal);
        } finally {
            await server.close();
        }
    });

    // S07 OP11. The request is on a keep-alive connection, which Node.js
    // once kept open after the response until the client let go.
    it('lets a request in flight finish on SIGTERM, then exits 0 promptly', async () => {
        const server = await startLocalServer();
        const agent = new http.Agent({ keepAlive: true });

        try {
            // Opens the connection the held request then reuses.
            const first = await get(agent, `${ server.origin }${ ENVIRONMENT_PATHNAME }`, server.headers());

            assertEqual(200, first.status);
            assert(first.headers.connection !== 'close', 'a response before a drain keeps its connection');

            const exitedAt = server.exited.then(() => Date.now());
            const pending = get(agent, `${ server.origin }${ HOLD_PATHNAME }?ms=1500`, server.headers());

            await sleep(IN_FLIGHT_MS);
            server.signal('SIGTERM');

            const held = await pending;
            const exit = await server.exitWithin(DRAIN_LIMIT_MS + 1000);

            assertEqual(200, held.status);
            assertEqual(1500, JSON.parse(held.body).held);

            // Proof the drain had begun when the response was written.
            assertEqual('close', held.headers.connection);

            assert(exit, `the server was still running ${ DRAIN_LIMIT_MS + 1000 } ms after the held response`);
            assertEqual(0, exit.code, tail(exit.output));

            const elapsed = await exitedAt - held.endedAt;

            report(`[local: server shell] drain on ${ RUNTIME }: the exit came ${ elapsed } ms after the held response`);

            assert(elapsed < DRAIN_LIMIT_MS, `the exit came ${ elapsed } ms after the held response`);
        } finally {
            agent.destroy();
            await server.close();
        }
    });

    it('drops a request in flight on SIGINT and exits 0 at once', async () => {
        const server = await startLocalServer();

        try {
            // Held for longer than the test waits for the exit.
            const pending = server.fetch(`${ HOLD_PATHNAME }?ms=5000`).then(
                async (response) => {
                    await response.arrayBuffer();
                    return { status: response.status };
                },
                (error) => ({ error }),
            );

            await sleep(IN_FLIGHT_MS);

            const signalledAt = Date.now();

            server.signal('SIGINT');

            const exit = await server.exitWithin(2000);

            assert(exit, 'the server was still running 2 seconds after SIGINT');
            assertEqual(0, exit.code, tail(exit.output));

            report(`[local: server shell] SIGINT on ${ RUNTIME }: the exit came ${ Date.now() - signalledAt } ms after the signal`);

            const result = await pending;

            assert(result.error, `expected the held request to be dropped, got status ${ result.status }`);
        } finally {
            await server.close();
        }
    });

    it('exits 1 when its port is taken, and leaves the server that has it running', async () => {
        const first = await startLocalServer();

        try {
            const second = await startLocalServer({ port: first.port, wait: false });

            try {
                const exit = await second.exitWithin(6000);

                assert(exit, 'the second server was still running after 6 seconds');
                assertEqual(1, exit.code, tail(exit.output));
            } finally {
                await second.close();
            }

            const response = await first.fetch(ENVIRONMENT_PATHNAME);

            await response.arrayBuffer();

            assertEqual(200, response.status);
        } finally {
            await first.close();
        }
    });

    it('answers 500 for an unexpected error, then exits 1', async () => {
        const server = await startLocalServer();

        try {
            const response = await server.fetch(UNEXPECTED_ERROR_PATHNAME);

            await response.arrayBuffer();

            assertEqual(500, response.status);

            const exit = await server.exitWithin(5000);

            assert(exit, 'the server was still running 5 seconds after the error');
            assertEqual(1, exit.code, tail(exit.output));
        } finally {
            await server.close();
        }
    });
});


// fetch() doesn't show the Connection response header, and gives no say
// over the connection. `endedAt` is when the whole response had arrived.
function get(agent, url, headers) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { agent, headers }, (response) => {
            let body = '';

            response.setEncoding('utf8');

            response.on('data', (chunk) => {
                body += chunk;
            });

            response.on('end', () => {
                resolve({ status: response.statusCode, headers: response.headers, body, endedAt: Date.now() });
            });

            response.on('error', reject);
        });

        request.on('error', reject);
    });
}
