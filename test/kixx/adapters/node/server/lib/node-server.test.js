import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import util from 'node:util';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import { startNodeServer } from '../../../../../../kixx/adapters/node/server/lib/node-server.js';
import ServerRequest from '../../../../../../kixx/adapters/node/server-request/lib/server-request.js';
import { NotFoundError, OperationalError } from '../../../../../../kixx/errors/mod.js';


const BASE_DIRECTORY = path.join(path.sep, 'project');
const CONFIG_FILEPATH = path.join(BASE_DIRECTORY, 'node-config.jsonc');

// Every fake process environment holds this value. No log entry and no error
// message may ever repeat it.
const SECRET_VALUE = 'a-secret-value-nothing-may-print';

const SOURCE_CONFIG = {
    name: 'node-server-test',
    environments: {
        test: {
            LOGGER: { level: 'DEBUG' },
            GREETING: { text: 'hello from the project' },
        },
    },
};

// Asks the server to close the connection after the response. Node.js keeps a
// connection that finishes a request during a drain open until the client lets
// go of it, so a request that is in flight when a drain begins sends this.
const CLOSE_CONNECTION = { connection: 'close' };


// A LoggerWriter class that keeps every entry it is given in `entries`.
function makeLoggerWriter(entries) {
    return class CapturingLoggerWriter {
        write(_name, _levelCode, level, message, info, error) {
            entries.push({ level, message, info, error });
        }
    };
}

// Stands in for node:process. exit() records its code and returns, and on()
// keeps each handler so a test can deliver a signal by calling it.
function makeProcess(options) {
    const {
        args = [ '--environment', 'test', '--port', '0' ],
        env = { SESSION_SECRET: SECRET_VALUE },
    } = options ?? {};

    const exitCodes = [];
    const handlers = new Map();
    let resolveExited;

    const exited = new Promise((resolve) => {
        resolveExited = resolve;
    });

    return {
        argv: [ 'node', 'node-server.js', ...args ],
        env,
        exit(code) {
            exitCodes.push(code);
            resolveExited(code);
        },
        on(name, handler) {
            handlers.set(name, handler);
        },
        // Resolves with the first exit code.
        exited,
        exitCodes,
        handlers,
    };
}

// Serves the config file from memory. Every other file doesn't exist.
function makeReadFile(sourceConfig) {
    return function readFile(filepath) {
        if (filepath === CONFIG_FILEPATH && sourceConfig) {
            return JSON.stringify(sourceConfig);
        }

        const error = new Error(`no such file: ${ filepath }`);
        error.code = 'ENOENT';
        throw error;
    };
}

function makeTarget(handler) {
    return { name: 'target', methods: [ 'GET', 'HEAD' ], requestHandlers: [ handler ] };
}

function makeRoute(pattern, handler) {
    return { pattern, targets: [ makeTarget(handler) ] };
}

// Builds the options for startNodeServer(), with the fakes a test may want to
// look at afterwards beside them.
function makeStartOptions(options) {
    const {
        // A virtual host must have a route.
        routes = [ makeRoute('/hello', (_context, _request, response) => response.respond(200, null, 'hello')) ],
        registry,
        app = {},
        args,
        env,
        sourceConfig = SOURCE_CONFIG,
    } = options ?? {};

    const logEntries = [];
    const fakeProcess = makeProcess({ args, env });

    const startOptions = {
        registry: Object.assign({
            LoggerWriter: makeLoggerWriter(logEntries),
            ServerRequest,
            plugins: new Map(),
            configDefaults: {},
            secrets: { required: [ 'SESSION_SECRET' ], optional: [] },
        }, registry),
        virtualHosts: [ { hostname: 'localhost', routes } ],
        app,
        baseDirectory: BASE_DIRECTORY,
        process: fakeProcess,
        readFile: makeReadFile(sourceConfig),
        hostname: '127.0.0.1',
    };

    return { startOptions, fakeProcess, logEntries };
}

// Starts a server on a free loopback port. The caller must await close().
async function startTestServer(options) {
    const { startOptions, fakeProcess, logEntries } = makeStartOptions(options);
    const started = await startNodeServer(startOptions);

    // A server that is already on its way out has no address.
    const port = started.server.address()?.port;

    return {
        ...started,
        fakeProcess,
        logEntries,
        port,
        origin: `http://127.0.0.1:${ port }`,

        // Forces a shutdown unless the test already caused one, waits for the
        // exit, and checks that the server is no longer listening.
        async close() {
            started.shutdown('test finished', { force: true });
            await fakeProcess.exited;

            assertFalsy(started.server.listening);
            assertNoSecretValue(logEntries);
        },
    };
}

async function withTestServer(options, fn) {
    const testServer = await startTestServer(options);

    try {
        await fn(testServer);
    } finally {
        await testServer.close();
    }
}

function assertNoSecretValue(value) {
    assertFalsy(util.inspect(value, { depth: 8 }).includes(SECRET_VALUE), 'a secret value was printed');
}

function findLogEntries(logEntries, message) {
    return logEntries.filter((entry) => entry.message === message);
}

// A promise a test settles by hand.
function makeDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });

    return { promise, resolve };
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

// Sends one raw HTTP/1.1 request and resolves with everything the server
// answers before it closes the connection. A raw socket can send what an HTTP
// client would refuse to.
function sendRawRequest(port, text) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let received = '';

        socket.setEncoding('latin1');
        socket.on('connect', () => socket.write(text));
        socket.on('error', reject);
        socket.on('data', (data) => {
            received += data;
        });
        socket.on('close', () => resolve(received));
    });
}

// A lifecycle module that records each hook it is given in `events`, and
// registers a service whose close() does the same.
function makeRecordingPlugin(name, events) {
    return {
        register(context) {
            events.push(`register:${ name }`);
            context.registerService(`${ name }Service`, {
                close() {
                    events.push(`close:${ name }Service`);
                },
            });
        },
        start() {
            events.push(`start:${ name }`);
        },
        stop() {
            events.push(`stop:${ name }`);
        },
    };
}


describe('node server', ({ describe }) => {

    describe('requests', ({ before, after, it }) => {
        let testServer;

        before(async () => {
            const encoder = new TextEncoder();

            testServer = await startTestServer({
                env: {
                    SESSION_SECRET: SECRET_VALUE,
                    TRUST_PROXY: 'true',
                    SITE_LABEL: 'from the process environment',
                },
                registry: {
                    configDefaults: {
                        GREETING: { text: 'the default', punctuation: '!' },
                        VISITS: { store: 'memory' },
                    },
                },
                routes: [
                    makeRoute('/hello', (_context, _request, response) => {
                        return response.respond(201, { 'content-type': 'text/plain; charset=utf-8', 'x-test': 'yes' }, 'hello');
                    }),
                    makeRoute('/cookies', (_context, _request, response) => {
                        response.setCookie('first', '1');
                        response.setCookie('second', '2');
                        return response.respond(200, null, 'ok');
                    }),
                    makeRoute('/web-stream', (_context, _request, response) => {
                        const stream = new ReadableStream({
                            start(controller) {
                                controller.enqueue(encoder.encode('first, '));
                                controller.enqueue(encoder.encode('second'));
                                controller.close();
                            },
                        });

                        return response.respondWithStream(200, stream, { contentType: 'text/plain' });
                    }),
                    makeRoute('/node-stream', (_context, _request, response) => {
                        return response.respondWithStream(200, Readable.from([ 'first, ', 'second' ]), { contentType: 'text/plain' });
                    }),
                    makeRoute('/context', (context, request, response) => {
                        return response.respondWithJSON(200, {
                            environment: context.config.environment,
                            greeting: context.config.env.GREETING,
                            visits: context.config.env.VISITS,
                            siteLabel: context.getEnvString('SITE_LABEL'),
                            ip: request.ip,
                        });
                    }),
                    makeRoute('/not-found', () => {
                        throw new NotFoundError('no such thing');
                    }),
                    makeRoute('/operational', () => {
                        throw new OperationalError('the store is away');
                    }),
                ],
            });
        });

        after(async () => {
            await testServer.close();
        });

        it('answers with the handler\'s status, headers, and body', async () => {
            const response = await fetch(`${ testServer.origin }/hello`);

            assertEqual(201, response.status);
            assertEqual('text/plain; charset=utf-8', response.headers.get('content-type'));
            assertEqual('yes', response.headers.get('x-test'));
            assertEqual('hello', await response.text());
        });

        it('answers a HEAD request with the headers and no body', async () => {
            const response = await fetch(`${ testServer.origin }/hello`, { method: 'HEAD' });

            assertEqual(201, response.status);
            assertEqual('yes', response.headers.get('x-test'));
            assertEqual('', await response.text());
        });

        it('sends two Set-Cookie values as two headers', async () => {
            const response = await fetch(`${ testServer.origin }/cookies`);
            const cookies = response.headers.getSetCookie();

            await response.text();

            assertEqual(2, cookies.length);
            assertMatches(/^first=1/, cookies[0]);
            assertMatches(/^second=2/, cookies[1]);
        });

        it('delivers a ReadableStream body', async () => {
            const response = await fetch(`${ testServer.origin }/web-stream`);

            assertEqual(200, response.status);
            assertEqual('first, second', await response.text());
        });

        it('delivers a Node.js stream body', async () => {
            const response = await fetch(`${ testServer.origin }/node-stream`);

            assertEqual(200, response.status);
            assertEqual('first, second', await response.text());
        });

        it('gives a handler the registry\'s config defaults under the project\'s config', async () => {
            const response = await fetch(`${ testServer.origin }/context`);
            const body = await response.json();

            assertEqual('test', body.environment);
            // The project's value wins; the default beside it stays.
            assertEqual('hello from the project', body.greeting.text);
            assertEqual('!', body.greeting.punctuation);
            // A section the project doesn't mention comes from the defaults.
            assertEqual('memory', body.visits.store);
        });

        it('gives a handler the process environment', async () => {
            const response = await fetch(`${ testServer.origin }/context`);
            const body = await response.json();

            assertEqual('from the process environment', body.siteLabel);
        });

        it('trusts X-Forwarded-For when TRUST_PROXY is set', async () => {
            const response = await fetch(`${ testServer.origin }/context`, {
                headers: { 'x-forwarded-for': '203.0.113.9' },
            });
            const body = await response.json();

            assertEqual('203.0.113.9', body.ip);
        });

        it('lets the router answer an expected HttpError and keeps running', async () => {
            const response = await fetch(`${ testServer.origin }/not-found`);

            await response.text();

            assertEqual(404, response.status);

            const next = await fetch(`${ testServer.origin }/hello`);

            assertEqual('hello', await next.text());
            assertEqual(0, testServer.fakeProcess.exitCodes.length);
            assertEqual(0, testServer.logEntries.filter((entry) => entry.level === 'ERROR').length);
        });

        it('logs an expected error that is not an HttpError and keeps running', async () => {
            const response = await fetch(`${ testServer.origin }/operational`);

            await response.text();

            assertEqual(500, response.status);

            const [ entry ] = findLogEntries(testServer.logEntries, 'operational error while routing request');

            assertEqual('WARN', entry.level);
            assertEqual('the store is away', entry.error.message);
            assertEqual(0, testServer.fakeProcess.exitCodes.length);
        });

        it('answers 400 to a malformed request target and keeps running', async () => {
            const answer = await sendRawRequest(
                testServer.port,
                'GET / HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n',
            );

            assertMatches(/^HTTP\/1\.1 400 /, answer);
            assertMatches(/cache-control: no-store/i, answer);
            assertMatches(/\r\n\r\nBad Request\n$/, answer);

            const [ entry ] = findLogEntries(testServer.logEntries, 'bad request target');

            assertEqual('WARN', entry.level);

            const next = await fetch(`${ testServer.origin }/hello`);

            assertEqual('hello', await next.text());
            assertEqual(0, testServer.fakeProcess.exitCodes.length);
        });

        it('logs the address it listens on', () => {
            const [ entry ] = findLogEntries(testServer.logEntries, 'node.js server running');

            assertEqual('127.0.0.1', entry.info.address);
            assertEqual(testServer.port, entry.info.port);
        });

        it('registers a SIGTERM and a SIGINT handler and no other', () => {
            assertEqual('SIGINT,SIGTERM', [ ...testServer.fakeProcess.handlers.keys() ].sort().join(','));
        });
    });

    describe('before the server listens', ({ it }) => {
        it('rejects when a declared secret is missing', async () => {
            const events = [];
            let writerCount = 0;

            const { startOptions, fakeProcess } = makeStartOptions({
                env: { SESSION_SECRET: SECRET_VALUE, EMPTY_SECRET: '' },
                registry: {
                    LoggerWriter: class CountingLoggerWriter {
                        constructor() {
                            writerCount += 1;
                        }

                        write() {}
                    },
                    plugins: new Map([ [ 'recorder', makeRecordingPlugin('recorder', events) ] ]),
                    secrets: {
                        required: [ 'SESSION_SECRET', 'ZEBRA_SECRET', 'EMPTY_SECRET' ],
                        optional: [ 'OPTIONAL_SECRET' ],
                    },
                },
            });

            const caught = await catchRejection(startNodeServer(startOptions));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertEqual(
                'Missing required environment secrets: EMPTY_SECRET, ZEBRA_SECRET. '
                + 'Every declared secret is listed in example.env.secrets.',
                caught.message,
            );
            assertNoSecretValue(caught);

            // Nothing was built, so nothing can be listening.
            assertEqual(0, writerCount);
            assertEqual(0, events.length);
            assertEqual(0, fakeProcess.handlers.size);
            assertEqual(0, fakeProcess.exitCodes.length);
        });

        it('rejects when --port is not a valid port', async () => {
            for (const port of [ 'abc', '65536', '-1', '80.5' ]) {
                const events = [];

                const { startOptions, fakeProcess } = makeStartOptions({
                    args: [ '--environment', 'test', `--port=${ port }` ],
                    registry: {
                        plugins: new Map([ [ 'recorder', makeRecordingPlugin('recorder', events) ] ]),
                    },
                });

                // eslint-disable-next-line no-await-in-loop
                const caught = await catchRejection(startNodeServer(startOptions));

                assert(caught, `expected a rejection for port ${ port }`);
                assertEqual('OperationalError', caught.name);
                assertEqual('The server port must be a valid integer from 0 to 65535', caught.message);
                assertEqual(0, events.length);
                assertEqual(0, fakeProcess.handlers.size);
            }
        });

        it('rejects when PORT is not a valid port and --port is absent', async () => {
            const { startOptions } = makeStartOptions({
                args: [ '--environment', 'test' ],
                env: { SESSION_SECRET: SECRET_VALUE, PORT: '70000' },
            });

            const caught = await catchRejection(startNodeServer(startOptions));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertEqual('The server port must be a valid integer from 0 to 65535', caught.message);
            assertNoSecretValue(caught);
        });

        it('rejects when the config file is missing', async () => {
            const { startOptions, fakeProcess } = makeStartOptions({ sourceConfig: null });

            const caught = await catchRejection(startNodeServer(startOptions));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertEqual(`Unable to read config file from ${ CONFIG_FILEPATH }`, caught.message);
            assertEqual(0, fakeProcess.handlers.size);
        });

        it('rejects when the config has no section for the environment', async () => {
            const { startOptions } = makeStartOptions({ args: [ '-e', 'staging', '-p', '0' ] });

            const caught = await catchRejection(startNodeServer(startOptions));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertMatches('staging', caught.message);
        });

        it('selects the development environment when neither --environment nor NODE_ENV is given', async () => {
            const { startOptions } = makeStartOptions({ args: [ '--port', '0' ] });

            const caught = await catchRejection(startNodeServer(startOptions));

            // The test config has no development section.
            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertMatches('development', caught.message);
        });

        it('rejects and exits 1 when the port can\'t be bound', async () => {
            const occupant = http.createServer();

            occupant.listen(0, '127.0.0.1');
            await once(occupant, 'listening');

            try {
                const { startOptions, fakeProcess, logEntries } = makeStartOptions({
                    args: [ '--environment', 'test', '--port', String(occupant.address().port) ],
                });

                const caught = await catchRejection(startNodeServer(startOptions));

                assert(caught, 'expected a rejection');
                assertEqual('EADDRINUSE', caught.code);
                assertEqual('1', fakeProcess.exitCodes.join(','));
                assertEqual(0, fakeProcess.handlers.size);

                const [ entry ] = findLogEntries(logEntries, 'node.js server error event');

                assertEqual('ERROR', entry.level);
                assertEqual(caught, entry.error);
            } finally {
                occupant.close();
                await once(occupant, 'close');
            }
        });
    });

    describe('environment selection', ({ it }) => {
        it('reads NODE_ENV when --environment is absent', async () => {
            const options = {
                args: [ '--port', '0' ],
                env: { SESSION_SECRET: SECRET_VALUE, NODE_ENV: 'test' },
            };

            await withTestServer(options, ({ appContext }) => {
                assertEqual('test', appContext.config.environment);
            });
        });

        it('listens on PORT when --port is absent', async () => {
            const options = {
                args: [ '--environment', 'test' ],
                env: { SESSION_SECRET: SECRET_VALUE, PORT: '0' },
            };

            await withTestServer(options, ({ server }) => {
                assert(server.listening);
            });
        });
    });

    describe('lifecycle hooks', ({ it }) => {
        it('runs start hooks once the server listens, and stop hooks in reverse before services close', async () => {
            const events = [];

            class RecordingLoggerWriter {
                write(_name, _levelCode, _level, message) {
                    if (message === 'node.js server running') {
                        events.push('listening');
                    }
                }
            }

            const options = {
                registry: {
                    LoggerWriter: RecordingLoggerWriter,
                    plugins: new Map([
                        [ 'first', makeRecordingPlugin('first', events) ],
                        [ 'second', makeRecordingPlugin('second', events) ],
                    ]),
                },
                app: {
                    start() {
                        events.push('start:app');
                    },
                    stop() {
                        events.push('stop:app');
                    },
                },
            };

            await withTestServer(options, async ({ shutdown, fakeProcess }) => {
                assertEqual(
                    'register:first,register:second,listening,start:first,start:second,start:app',
                    events.join(','),
                );

                events.length = 0;
                shutdown('test', { force: false });

                assertEqual(0, await fakeProcess.exited);
                assertEqual(
                    'stop:app,stop:second,stop:first,close:secondService,close:firstService',
                    events.join(','),
                );
            });
        });

        it('exits 1 after a plugin reports an unexpected error', async () => {
            const events = [];
            const failure = new Error('the job loop broke');
            let reportUnexpectedError;

            const plugin = makeRecordingPlugin('worker', events);

            plugin.start = (_context, { onUnexpectedError }) => {
                reportUnexpectedError = onUnexpectedError;
            };

            const options = { registry: { plugins: new Map([ [ 'worker', plugin ] ]) } };

            await withTestServer(options, async ({ fakeProcess, logEntries }) => {
                assertEqual(0, fakeProcess.exitCodes.length);

                reportUnexpectedError(failure);

                assertEqual(1, await fakeProcess.exited);
                assertEqual('register:worker,stop:worker,close:workerService', events.join(','));

                const [ entry ] = findLogEntries(logEntries, 'unexpected error reported by a plugin');

                assertEqual('ERROR', entry.level);
                assertEqual(failure, entry.error);

                const [ closing ] = findLogEntries(logEntries, 'closing server');

                assertEqual('fatal plugin error', closing.info.reason);
                assertEqual(false, closing.info.force);
            });
        });

        it('exits 1 when a start hook fails, and still resolves', async () => {
            const events = [];
            const failure = new Error('the job loop would not start');

            const plugin = makeRecordingPlugin('worker', events);

            plugin.start = () => {
                throw failure;
            };

            const options = {
                registry: { plugins: new Map([ [ 'worker', plugin ] ]) },
                app: {
                    start() {
                        events.push('start:app');
                    },
                },
            };

            await withTestServer(options, async ({ fakeProcess, logEntries }) => {
                assertEqual(1, await fakeProcess.exited);

                // The app's start hook never ran; the stop sweep still did.
                assertEqual('register:worker,stop:worker,close:workerService', events.join(','));

                const [ entry ] = findLogEntries(logEntries, 'error starting a plugin');

                assertEqual('ERROR', entry.level);
                assertEqual(failure, entry.error);

                const [ closing ] = findLogEntries(logEntries, 'closing server');

                assertEqual('fatal start error', closing.info.reason);
            });
        });

        it('logs a failing stop hook and still closes services and exits', async () => {
            const events = [];
            const failure = new Error('the job loop would not stop');

            const plugin = makeRecordingPlugin('worker', events);

            plugin.stop = () => {
                throw failure;
            };

            const options = { registry: { plugins: new Map([ [ 'worker', plugin ] ]) } };

            await withTestServer(options, async ({ shutdown, fakeProcess, logEntries }) => {
                shutdown('test', { force: false });

                assertEqual(0, await fakeProcess.exited);
                assertEqual('register:worker,start:worker,close:workerService', events.join(','));

                const [ entry ] = findLogEntries(logEntries, 'error stopping plugin during shutdown');

                assertEqual('worker', entry.info.name);
                assertEqual(failure, entry.error);
            });
        });
    });

    describe('unexpected errors', ({ it }) => {
        it('answers 500 without the error\'s message, then exits 1', async () => {
            const events = [];

            const options = {
                registry: { plugins: new Map([ [ 'recorder', makeRecordingPlugin('recorder', events) ] ]) },
                routes: [
                    makeRoute('/broken', () => {
                        throw new TypeError('an internal detail');
                    }),
                ],
            };

            await withTestServer(options, async ({ origin, fakeProcess, logEntries }) => {
                const response = await fetch(`${ origin }/broken`, { headers: CLOSE_CONNECTION });

                assertEqual(500, response.status);
                assertEqual('no-store', response.headers.get('cache-control'));
                assertEqual('text/plain; charset=utf-8', response.headers.get('content-type'));
                assertEqual('Internal Server Error\n', await response.text());

                assertEqual(1, await fakeProcess.exited);
                assertEqual('1', fakeProcess.exitCodes.join(','));
                assertEqual('register:recorder,start:recorder,stop:recorder,close:recorderService', events.join(','));

                const [ routing ] = findLogEntries(logEntries, 'unexpected error while routing request');
                const [ handling ] = findLogEntries(logEntries, 'unhandled error while handling request');
                const [ closing ] = findLogEntries(logEntries, 'closing server');

                assertEqual('ERROR', routing.level);
                assertEqual('an internal detail', routing.error.message);
                assertEqual('ERROR', handling.level);
                assertEqual('fatal router error', closing.info.reason);
                assertEqual(false, closing.info.force);
                assertEqual(1, closing.info.exitCode);
            });
        });

        it('answers a HEAD request with 500 and no body', async () => {
            const options = {
                routes: [
                    makeRoute('/broken', () => {
                        throw new TypeError('an internal detail');
                    }),
                ],
            };

            await withTestServer(options, async ({ origin, fakeProcess }) => {
                const response = await fetch(`${ origin }/broken`, { method: 'HEAD', headers: CLOSE_CONNECTION });

                assertEqual(500, response.status);
                assertEqual('no-store', response.headers.get('cache-control'));
                assertEqual('', await response.text());
                assertEqual(1, await fakeProcess.exited);
            });
        });
    });

    describe('signals', ({ it }) => {
        // One request that stays in flight until the test releases it.
        function makeHeldRoute(events) {
            const entered = makeDeferred();
            const release = makeDeferred();

            const route = makeRoute('/held', async (_context, _request, response) => {
                entered.resolve();
                await release.promise;
                events.push('request finished');
                return response.respond(200, null, 'late');
            });

            return { route, entered, release };
        }

        it('drains on SIGTERM: an in-flight request finishes, then the server exits 0', async () => {
            const events = [];
            const held = makeHeldRoute(events);

            const options = {
                registry: { plugins: new Map([ [ 'recorder', makeRecordingPlugin('recorder', events) ] ]) },
                routes: [ held.route, makeRoute('/hello', (_context, _request, response) => response.respond(200, null, 'hello')) ],
            };

            await withTestServer(options, async ({ origin, fakeProcess, logEntries }) => {
                // Leaves an idle keep-alive connection behind, which a drain
                // must close for the server to exit.
                await (await fetch(`${ origin }/hello`)).text();

                const pending = fetch(`${ origin }/held`, { headers: CLOSE_CONNECTION });

                await held.entered.promise;
                events.length = 0;

                fakeProcess.handlers.get('SIGTERM')();
                held.release.resolve();

                const response = await pending;

                assertEqual(200, response.status);
                assertEqual('late', await response.text());
                assertEqual(0, await fakeProcess.exited);

                // Plugins stop and services close only after the request is done.
                assertEqual('request finished,stop:recorder,close:recorderService', events.join(','));

                const [ closing ] = findLogEntries(logEntries, 'closing server');

                assertEqual('SIGTERM', closing.info.reason);
                assertEqual(false, closing.info.force);

                const [ closed ] = findLogEntries(logEntries, 'server closed; exiting');

                assertEqual(0, closed.info.exitCode);
            });
        });

        it('forces on SIGINT: an in-flight request is dropped and the server exits 0', async () => {
            const events = [];
            const held = makeHeldRoute(events);

            const options = {
                registry: { plugins: new Map([ [ 'recorder', makeRecordingPlugin('recorder', events) ] ]) },
                routes: [ held.route ],
            };

            await withTestServer(options, async ({ origin, fakeProcess, logEntries }) => {
                const pending = catchRejection(fetch(`${ origin }/held`));

                await held.entered.promise;
                events.length = 0;

                fakeProcess.handlers.get('SIGINT')();

                assertEqual(0, await fakeProcess.exited);
                assert(await pending, 'expected the in-flight request to be dropped');

                // The handler is never released: a real process is gone by now.
                assertEqual('stop:recorder,close:recorderService', events.join(','));

                const [ closing ] = findLogEntries(logEntries, 'closing server');

                assertEqual('SIGINT', closing.info.reason);
                assertEqual(true, closing.info.force);
            });
        });

        it('ignores a second signal while it is shutting down', async () => {
            await withTestServer({}, async ({ fakeProcess, logEntries }) => {
                fakeProcess.handlers.get('SIGTERM')();
                fakeProcess.handlers.get('SIGINT')();

                assertEqual(0, await fakeProcess.exited);
                assertEqual(1, findLogEntries(logEntries, 'closing server').length);
                assertEqual('0', fakeProcess.exitCodes.join(','));
            });
        });
    });
});
