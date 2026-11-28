import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import { createFakeKVNamespace } from '../../fakes/workers-kv.js';
import KeyValueStore from '../../../kixx/adapters/cloudflare/key-value-store/lib/key-value-store.js';
import ServerRequest from '../../../kixx/adapters/cloudflare/server-request/lib/server-request.js';
import ServerResponse from '../../../kixx/http-router/server-response.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';
import routes from '../../../test-app/integration-probe/routes.js';


// Made up. Only its hash goes in the environment.
const DEPLOY_KEY = 'kxdk_0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

const PROBE_URL = 'https://target.test/integration-probe/probe';


// A request context of a production target. `built` counts the calls to
// each port's factory builder, and `made` the calls to the factories they
// return.
async function makeContext() {
    const namespace = createFakeKVNamespace();
    const keyValueStore = new KeyValueStore();
    const built = [];
    const made = [];

    const portFactories = {};

    for (const name of [ 'content-store', 'key-value-store', 'logger-writer', 'server-request' ]) {
        portFactories[name] = (requestContext) => {
            built.push(name);

            return () => {
                made.push(name);
                return { store: keyValueStore, context: requestContext, afterWrite: async () => {} };
            };
        };
    }

    const services = {
        KeyValueStore: keyValueStore,
        IntegrationProbe: { target: 'made-up-target', portFactories },
    };

    const context = {
        env: { KEY_VALUE_STORE: namespace, DEPLOY_KEY_HASH: await sha256Hex(DEPLOY_KEY) },
        config: { environment: 'production' },
        runtime: { build: { id: 'build-7' } },
        logger: {
            debug() {},
            info() {},
            warn() {},
            error() {},
            createChild() {
                return this;
            },
        },
        requestId: 'request-1',
        getService: (name) => services[name],
    };

    return { context, namespace, built, made };
}

function makeRequest({ method = 'GET', url = PROBE_URL, key = DEPLOY_KEY, body } = {}) {
    const headers = {};

    if (key) {
        headers.authorization = `Bearer ${ key }`;
    }

    if (body) {
        headers['content-type'] = 'application/json';
    }

    return new ServerRequest(new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined }));
}

function findHandler(pattern) {
    const route = routes.routes.find((candidate) => candidate.pattern === pattern);

    return { route, handler: route.targets[0].requestHandlers[0], methods: route.targets[0].methods };
}

async function send(handler, context, request) {
    const response = await handler(context, request, new ServerResponse());

    return { status: response.status, body: JSON.parse(response.body) };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('integration-probe: routes', ({ describe, it }) => {

    it('puts the deploy key check on the mount, before every route', async () => {
        const { context } = await makeContext();
        const [ requireDeployKey, ...rest ] = routes.inboundMiddleware;

        assertEqual(0, rest.length);

        const response = new ServerResponse();

        assertEqual(response, await requireDeployKey(context, makeRequest(), response));

        const error = await catchAsyncError(() => requireDeployKey(context, makeRequest({ key: null }), response));

        assert(error, 'expected a request without the key to be refused');
        assertEqual(401, error.httpStatusCode);
        assertEqual('DeployKeyRequired', error.code);
    });

    it('mounts the probe for GET and POST, a platform check for POST, and every other route for GET', () => {
        assertEqual(
            '/environment,/hold,/key-value-keys,/platform-checks/:name,/probe,/unexpected-error',
            routes.routes.map(({ pattern }) => pattern).sort().join(','),
        );
        assertEqual('GET,POST', findHandler('/probe').methods.join(','));
        assertEqual('POST', findHandler('/platform-checks/:name').methods.join(','));

        for (const pattern of [ '/environment', '/hold', '/key-value-keys', '/unexpected-error' ]) {
            assertEqual('GET', findHandler(pattern).methods.join(','), pattern);
        }
    });

    describe('/probe', ({ it }) => {
        const { handler } = findHandler('/probe');

        it('answers 401 without the deploy key, by its own check', async () => {
            const { context, built } = await makeContext();
            const result = await send(handler, context, makeRequest({ url: `${ PROBE_URL }?suite=key-value-store`, key: null }));

            assertEqual(401, result.status);
            assertEqual('UnauthenticatedError', result.body.error.name);
            assertEqual(0, built.length);
        });

        it('lists a suite\'s tests with the key, building no factory and touching no storage', async () => {
            const { context, namespace, built, made } = await makeContext();
            const result = await send(handler, context, makeRequest({ url: `${ PROBE_URL }?suite=key-value-store` }));

            assertEqual(200, result.status);
            assertEqual('key-value-store', result.body.suite);
            assert(result.body.tests.length > 0);
            assertEqual(0, built.length);
            assertEqual(0, made.length);
            assertEqual(0, namespace.calls.length);
        });

        it('lists all six suites', async () => {
            const { context } = await makeContext();
            const names = [ 'content-compiler', 'content-store', 'format-date', 'key-value-store', 'logger-writer', 'server-request' ];

            for (const name of names) {
                const result = await send(handler, context, makeRequest({ url: `${ PROBE_URL }?suite=${ name }` }));

                assertEqual(200, result.status);
                assert(result.body.tests.length > 0, `${ name } lists no test`);
            }
        });

        it('runs a port test through the factory the target\'s service builds for that request', async () => {
            const { context, built, made } = await makeContext();
            const tests = (await send(handler, context, makeRequest({ url: `${ PROBE_URL }?suite=key-value-store` }))).body.tests;
            const path = tests.find((candidate) => candidate.at(-1) === 'resolves null for a missing key');

            const result = await send(handler, context, makeRequest({
                method: 'POST',
                body: { suite: 'key-value-store', path },
            }));

            assertEqual(200, result.status);
            assertEqual('passed', result.body.status);
            assertEqual('key-value-store', built.join(','));
            assertEqual('key-value-store', made.join(','));
        });

        it('runs a built-in suite\'s test with no port factory', async () => {
            const { context, built } = await makeContext();
            const [ path ] = (await send(handler, context, makeRequest({ url: `${ PROBE_URL }?suite=format-date` }))).body.tests;

            const result = await send(handler, context, makeRequest({
                method: 'POST',
                body: { suite: 'format-date', path },
            }));

            assertEqual('passed', result.body.status);
            assertEqual(0, built.length);
        });
    });

    describe('/hold', ({ it }) => {
        const { handler } = findHandler('/hold');
        const url = 'https://target.test/integration-probe/hold';

        it('answers after the wait it was asked for', async () => {
            const { context } = await makeContext();
            const start = Date.now();
            const result = await send(handler, context, makeRequest({ url: `${ url }?ms=40` }));

            assertEqual(200, result.status);
            assertEqual(40, result.body.held);

            // A timer may fire a millisecond early.
            assert(Date.now() - start >= 35, 'the answer came before the wait was over');
        });

        it('answers at once with no wait, a negative one, or one that is no number', async () => {
            const { context } = await makeContext();

            for (const query of [ '', '?ms=-5', '?ms=soon' ]) {
                const result = await send(handler, context, makeRequest({ url: `${ url }${ query }` }));

                assertEqual(0, result.body.held, query);
            }
        });

        it('never waits longer than five seconds', async () => {
            const { context } = await makeContext();
            const waits = [];
            const realSetTimeout = globalThis.setTimeout;

            // Only for this call: the handler's wait is read, not waited out.
            globalThis.setTimeout = (fn, milliseconds) => {
                waits.push(milliseconds);
                return realSetTimeout(fn, 0);
            };

            let result;

            try {
                result = await send(handler, context, makeRequest({ url: `${ url }?ms=60000` }));
            } finally {
                globalThis.setTimeout = realSetTimeout;
            }

            assertEqual(5000, result.body.held);
            assertEqual('5000', waits.join(','));
        });
    });

    describe('/unexpected-error', ({ it }) => {
        const { handler } = findHandler('/unexpected-error');

        it('throws an error nothing expects, so a server treats it as a bug', async () => {
            const { context } = await makeContext();
            const error = await catchAsyncError(() => handler(context, makeRequest(), new ServerResponse()));

            assertEqual('Error', error.name);
            assertFalsy(error.expected);
            assertFalsy(error.httpStatusCode);
        });
    });

    describe('/key-value-keys', ({ it }) => {
        const { handler } = findHandler('/key-value-keys');
        const url = 'https://target.test/integration-probe/key-value-keys';

        it('answers the count the target\'s service gives for the prefix', async () => {
            const { context } = await makeContext();
            const prefixes = [];

            context.getService('IntegrationProbe').countKeyValueKeys = (prefix) => {
                prefixes.push(prefix);
                return 3;
            };

            const result = await send(handler, context, makeRequest({ url: `${ url }?prefix=cache%23` }));

            assertEqual(200, result.status);
            assertEqual(JSON.stringify({ prefix: 'cache#', count: 3 }), JSON.stringify(result.body));
            assertEqual('cache#', prefixes.join(','));
        });

        it('refuses a request with no prefix', async () => {
            const { context } = await makeContext();

            context.getService('IntegrationProbe').countKeyValueKeys = () => 0;

            const error = await catchAsyncError(() => handler(context, makeRequest({ url }), new ServerResponse()));

            assertEqual(400, error.httpStatusCode);
        });

        it('answers 404 on a target that can\'t count', async () => {
            const { context } = await makeContext();
            const error = await catchAsyncError(() => {
                return handler(context, makeRequest({ url: `${ url }?prefix=cache` }), new ServerResponse());
            });

            assertEqual(404, error.httpStatusCode);
        });
    });

    describe('/platform-checks/:name', ({ it }) => {
        const { handler } = findHandler('/platform-checks/:name');

        function makeCheckRequest(name) {
            return makeRequest({ method: 'POST', url: `https://target.test/integration-probe/platform-checks/${ name }` })
                .setPathnameParams({ name });
        }

        it('runs the named check with the request\'s context and answers what it observed', async () => {
            const { context } = await makeContext();
            const contexts = [];

            context.getService('IntegrationProbe').platformChecks = {
                'made-up-check': async (requestContext) => {
                    contexts.push(requestContext);
                    return { outcome: 'rejected', errorName: 'Error', message: 'no' };
                },
            };

            const result = await send(handler, context, makeCheckRequest('made-up-check'));

            assertEqual(200, result.status);
            assertEqual(
                JSON.stringify({ name: 'made-up-check', observation: { outcome: 'rejected', errorName: 'Error', message: 'no' } }),
                JSON.stringify(result.body),
            );
            assertEqual(context, contexts[0]);
        });

        it('answers 404 for a name that is no check, an inherited property included', async () => {
            const { context } = await makeContext();

            context.getService('IntegrationProbe').platformChecks = { 'made-up-check': async () => ({}) };

            for (const name of [ 'another-check', 'toString', 'constructor' ]) {
                const error = await catchAsyncError(() => handler(context, makeCheckRequest(name), new ServerResponse()));

                assertEqual(404, error.httpStatusCode, name);
            }
        });

        it('answers 404 on a target with no platform checks', async () => {
            const { context } = await makeContext();
            const error = await catchAsyncError(() => {
                return handler(context, makeCheckRequest('kv-get-empty-array'), new ServerResponse());
            });

            assertEqual(404, error.httpStatusCode);
        });
    });

    describe('/environment', ({ it }) => {
        const { handler } = findHandler('/environment');

        it('answers the target, the environment, and the build id, and nothing else', async () => {
            const { context } = await makeContext();
            const result = await send(handler, context, makeRequest({ url: 'https://target.test/integration-probe/environment' }));

            assertEqual(200, result.status);
            assertEqual(
                JSON.stringify({ target: 'made-up-target', environment: 'production', buildId: 'build-7' }),
                JSON.stringify(result.body),
            );
        });

        it('answers a null build id for a target with none', async () => {
            const { context } = await makeContext();

            context.runtime = {};

            const result = await send(handler, context, makeRequest());

            assertEqual(null, result.body.buildId);
            assertFalsy(JSON.stringify(result.body).includes(context.env.DEPLOY_KEY_HASH));
        });
    });
});
