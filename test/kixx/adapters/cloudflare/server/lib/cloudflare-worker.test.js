import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches, isFunction } from 'kixx-assert';

import { createWorker } from '../../../../../../kixx/adapters/cloudflare/server/lib/cloudflare-worker.js';
import ServerRequest from '../../../../../../kixx/adapters/cloudflare/server-request/lib/server-request.js';
import { NotFoundError, OperationalError } from '../../../../../../kixx/errors/mod.js';


const SOURCE_CONFIG = {
    name: 'worker-test',
    environments: {
        development: {
            LOGGER: { level: 'DEBUG' },
            GREETING: { text: 'hello from development' },
        },
        production: {
            LOGGER: { level: 'DEBUG' },
            GREETING: { text: 'hello from production' },
        },
    },
};


// A LoggerWriter class that keeps every entry it is given in `entries`.
function makeLoggerWriter(entries) {
    return class CapturingLoggerWriter {
        write(_name, _levelCode, level, message, info, error) {
            entries.push({ level, message, info, error });
        }
    };
}

function makeTarget(handler) {
    return { name: 'target', methods: [ 'GET' ], requestHandlers: [ handler ] };
}

function makeVirtualHosts(routes) {
    return [ { hostname: 'localhost', routes } ];
}

// Builds a worker around one handler mounted at /test. Everything a test may
// want to look at afterwards is returned beside the worker.
function makeWorker(options) {
    const {
        handler = (_context, _request, response) => response.respondWithJSON(200, { ok: true }),
        env = {},
        registry,
        app = {},
        wait,
    } = options ?? {};

    const logEntries = [];

    const worker = createWorker({
        env,
        sourceConfig: SOURCE_CONFIG,
        registry: Object.assign({
            LoggerWriter: makeLoggerWriter(logEntries),
            ServerRequest,
            plugins: new Map(),
            configDefaults: {},
            secrets: { required: [], optional: [] },
        }, registry),
        virtualHosts: makeVirtualHosts([ { pattern: '/test', targets: [ makeTarget(handler) ] } ]),
        app,
        wait,
    });

    return { worker, logEntries };
}

// The `cloudflare` argument of fetch(): it records what waitUntil() is given.
// A handler is attached at once, so a rejection is never left unhandled.
function makeExecutionContext() {
    const promises = [];

    return {
        promises,
        waitUntil(promise) {
            promises.push(promise);
            promise.catch(() => {});
        },
    };
}

// A wait function a test settles by hand, recording what it was called with.
function makeWait() {
    const calls = [];
    let finish;
    const promise = new Promise((resolve) => {
        finish = resolve;
    });

    return {
        calls,
        finish,
        wait(milliseconds) {
            calls.push(milliseconds);
            return promise;
        },
    };
}

function fetchTest(worker, requestEnvironment, executionContext) {
    return worker.fetch(
        new Request('https://localhost/test'),
        requestEnvironment ?? {},
        executionContext ?? makeExecutionContext(),
    );
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('cloudflare worker', ({ describe }) => {

    describe('createWorker()', ({ it }) => {
        it('returns a fetch handler without calling it', () => {
            let handled = 0;
            const { worker } = makeWorker({
                handler(_context, _request, response) {
                    handled += 1;
                    return response;
                },
            });

            assert(isFunction(worker.fetch));
            assertEqual('fetch', Object.keys(worker).join(','));
            assertEqual(0, handled);
        });

        it('selects the config section named by ENVIRONMENT', async () => {
            const { worker } = makeWorker({
                env: { ENVIRONMENT: 'production' },
                handler(context, _request, response) {
                    return response.respondWithJSON(200, {
                        environment: context.config.environment,
                        text: context.config.env.GREETING.text,
                    });
                },
            });

            const body = await (await fetchTest(worker)).json();

            assertEqual('production', body.environment);
            assertEqual('hello from production', body.text);
        });

        it('selects the development section when ENVIRONMENT is absent or empty', async () => {
            for (const env of [ {}, { ENVIRONMENT: '' } ]) {
                const { worker } = makeWorker({
                    env,
                    handler(context, _request, response) {
                        return response.respondWithJSON(200, {
                            environment: context.config.environment,
                            text: context.config.env.GREETING.text,
                        });
                    },
                });

                const body = await (await fetchTest(worker)).json();

                assertEqual('development', body.environment);
                assertEqual('hello from development', body.text);
            }
        });

        it('fails when the config has no section for the environment', () => {
            const caught = catchError(() => makeWorker({ env: { ENVIRONMENT: 'staging' } }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('staging', caught.message);
        });

        it('merges the registry\'s config defaults under the selected section', async () => {
            const { worker } = makeWorker({
                env: { ENVIRONMENT: 'production' },
                registry: {
                    configDefaults: {
                        GREETING: { text: 'the default', punctuation: '!' },
                        VISITS: { store: 'memory' },
                    },
                },
                handler(context, _request, response) {
                    return response.respondWithJSON(200, context.config.env);
                },
            });

            const body = await (await fetchTest(worker)).json();

            assertEqual('hello from production', body.GREETING.text);
            assertEqual('!', body.GREETING.punctuation);
            assertEqual('memory', body.VISITS.store);
        });

        it('throws when a declared secret is missing, naming it and no value', () => {
            const caught = catchError(() => makeWorker({
                env: { SESSION_SECRET: 'value-that-must-not-leak', ENVIRONMENT: 'production' },
                registry: {
                    secrets: { required: [ 'SESSION_SECRET', 'SIGNING_SECRET', 'CURSOR_SECRET' ], optional: [ 'DEBUG_TOKEN' ] },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(
                'Missing required environment secrets: CURSOR_SECRET, SIGNING_SECRET. Every declared secret is listed in example.env.secrets.',
                caught.message,
            );
            assertFalsy(caught.message.includes('value-that-must-not-leak'));
        });

        it('boots when every declared secret is in the module-scope environment', async () => {
            const { worker } = makeWorker({
                env: { SIGNING_SECRET: 'a-secret' },
                registry: { secrets: { required: [ 'SIGNING_SECRET' ], optional: [ 'DEBUG_TOKEN' ] } },
            });

            assertEqual(200, (await fetchTest(worker)).status);
        });

        it('registers and initializes lifecycle modules, and never starts or stops them', async () => {
            const calls = [];
            const record = (name) => () => calls.push(name);

            const { worker } = makeWorker({
                registry: {
                    plugins: new Map([
                        [ 'kixx:./a.js', { register: record('a.register'), initialize: record('a.initialize'), start: record('a.start'), stop: record('a.stop') } ],
                        [ 'visits:./plugin.js', { register: record('b.register'), start: record('b.start'), stop: record('b.stop') } ],
                    ]),
                },
                app: { initialize: record('app.initialize'), start: record('app.start'), stop: record('app.stop') },
            });

            await fetchTest(worker);
            await fetchTest(worker);

            assertEqual('a.register,b.register,a.initialize,app.initialize', calls.join(','));
        });

        it('requires an environment, a registry, and a wait function', () => {
            const registry = { LoggerWriter: makeLoggerWriter([]), ServerRequest, plugins: new Map(), configDefaults: {}, secrets: { required: [], optional: [] } };
            const base = { env: {}, sourceConfig: SOURCE_CONFIG, registry, virtualHosts: makeVirtualHosts([]), app: {} };

            const cases = [
                Object.assign({}, base, { env: undefined }),
                Object.assign({}, base, { registry: undefined }),
                Object.assign({}, base, { registry: Object.assign({}, registry, { ServerRequest: undefined }) }),
                Object.assign({}, base, { wait: 1000 }),
            ];

            for (const options of cases) {
                const caught = catchError(() => createWorker(options));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });
    });

    describe('fetch()', ({ it }) => {
        it('returns a Response with the handler\'s status, headers, and body', async () => {
            const { worker } = makeWorker({
                handler(_context, request, response) {
                    response.setHeader('x-handled-by', 'test-handler');
                    return response.respondWithJSON(201, { pathname: request.url.pathname });
                },
            });
            const executionContext = makeExecutionContext();

            const response = await fetchTest(worker, {}, executionContext);

            assert(response instanceof Response);
            assertEqual(201, response.status);
            assertEqual('test-handler', response.headers.get('x-handled-by'));
            assertMatches('application/json', response.headers.get('content-type'));
            assertEqual('/test', (await response.json()).pathname);
            assertEqual(0, executionContext.promises.length);
        });

        it('gives a handler the per-request environment, not the module-scope one', async () => {
            const { worker } = makeWorker({
                env: { WHO: 'module scope' },
                handler(context, _request, response) {
                    return response.respondWithJSON(200, { who: context.env.WHO });
                },
            });

            const response = await fetchTest(worker, { WHO: 'this request' });

            assertEqual('this request', (await response.json()).who);
        });

        it('lets the router answer an expected HTTP error, and reports nothing', async () => {
            const { worker, logEntries } = makeWorker({
                handler() {
                    throw new NotFoundError('no such visit');
                },
            });
            const executionContext = makeExecutionContext();

            const response = await fetchTest(worker, {}, executionContext);

            assertEqual(404, response.status);
            assertMatches('application/vnd.api+json', response.headers.get('content-type'));
            assertEqual('no-store', response.headers.get('cache-control'));
            assertEqual(0, executionContext.promises.length);
            assertEqual(0, logEntries.filter((entry) => entry.level === 'ERROR' || entry.level === 'WARN').length);
        });

        it('answers 404 for a pathname no route matches', async () => {
            const { worker } = makeWorker();
            const executionContext = makeExecutionContext();

            const response = await worker.fetch(new Request('https://localhost/nowhere'), {}, executionContext);

            assertEqual(404, response.status);
            assertEqual(0, executionContext.promises.length);
        });

        it('logs an operational error the router answers, and reports nothing', async () => {
            const failure = new OperationalError('the store is down');
            const { worker, logEntries } = makeWorker({
                handler() {
                    throw failure;
                },
            });
            const executionContext = makeExecutionContext();

            const response = await fetchTest(worker, {}, executionContext);

            assertEqual(500, response.status);
            assertEqual(0, executionContext.promises.length);

            const warnings = logEntries.filter((entry) => entry.level === 'WARN');

            assertEqual(1, warnings.length);
            assertEqual('operational error while routing request', warnings[0].message);
            assertEqual(failure, warnings[0].error);
        });

        it('answers an unexpected error with a JSON:API 500 that hides its message', async () => {
            const { worker, logEntries } = makeWorker({
                wait: makeWait().wait,
                handler() {
                    throw new TypeError('internal detail that must not leak');
                },
            });

            const response = await fetchTest(worker);
            const text = await response.text();

            assertEqual(500, response.status);
            assertEqual('application/vnd.api+json', response.headers.get('content-type'));
            assertEqual('no-store', response.headers.get('cache-control'));
            assertFalsy(text.includes('internal detail that must not leak'));
            assertEqual(1, JSON.parse(text).errors.length);

            const errors = logEntries.filter((entry) => entry.level === 'ERROR').map((entry) => entry.message);

            assertEqual('unexpected error while routing request,worker fetch error', errors.join(','));
        });

        it('reports an unexpected error through waitUntil, rejecting after the wait', async () => {
            const bug = new TypeError('a bug');
            const controlledWait = makeWait();
            const { worker } = makeWorker({
                wait: controlledWait.wait,
                handler() {
                    throw bug;
                },
            });
            const executionContext = makeExecutionContext();

            await fetchTest(worker, {}, executionContext);

            assertEqual(1, executionContext.promises.length);
            assert(executionContext.promises[0] instanceof Promise);
            assertEqual('1000', controlledWait.calls.join(','));

            // Until the wait is over, the promise is still pending.
            let hasSettled = false;
            executionContext.promises[0].catch(() => {
                hasSettled = true;
            });

            await Promise.resolve();
            await Promise.resolve();

            assertEqual(false, hasSettled);

            controlledWait.finish();

            assertEqual(bug, await catchRejection(executionContext.promises[0]));
        });

        it('answers the next request after an unexpected error', async () => {
            let count = 0;
            const { worker } = makeWorker({
                wait: makeWait().wait,
                handler(_context, _request, response) {
                    count += 1;

                    if (count === 1) {
                        throw new Error('first request fails');
                    }

                    return response.respondWithJSON(200, { count });
                },
            });

            assertEqual(500, (await fetchTest(worker)).status);
            assertEqual(200, (await fetchTest(worker)).status);
        });
    });
});
