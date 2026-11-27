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

    it('mounts the probe for GET and POST, and the environment for GET', () => {
        assertEqual('/environment,/probe', routes.routes.map(({ pattern }) => pattern).sort().join(','));
        assertEqual('GET,POST', findHandler('/probe').methods.join(','));
        assertEqual('GET', findHandler('/environment').methods.join(','));
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
