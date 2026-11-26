import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
    assertUndefined,
} from 'kixx-assert';

import { createFakeKVNamespace } from '../../fakes/workers-kv.js';
import KeyValueStore from '../../../kixx/adapters/cloudflare/key-value-store/lib/key-value-store.js';
import ServerRequest from '../../../kixx/adapters/cloudflare/server-request/lib/server-request.js';
import ServerResponse from '../../../kixx/http-router/server-response.js';
import Logger from '../../../kixx/logger/logger.js';
import { createProbeClient, describeProbeSuite } from '../../../test-app/probe/probe-client.js';
import { createProbeHandler } from '../../../test-app/probe/probe-handler.js';
import { BUILT_IN_FACTORIES, PROBE_SUITES } from '../../../test-app/probe/probe-suites.js';


const PROBE_URL = 'https://target.test/probe';
const DEPLOY_KEY = 'deploy-key-8c41e7b2d6';


function sampleSuite(describe, factory) {
    describe('group', ({ describe, it }) => {
        it('passes', () => {
            factory();
        });

        describe('nested', ({ it }) => {
            it('fails', () => {
                factory();

                const error = new Error('expected 1 to equal 2');
                error.name = 'AssertionError';
                error.code = 'ASSERTION_ERROR';
                throw error;
            });
        });
    });
}

// A target: the probe handler behind a deploy key, reached through a fetch
// that stands in for the network. It turns each call into a request to the
// handler, the way a server would, and the handler's response into a web
// Response. Every call is recorded.
function makeTarget(options) {
    const { suites, factories } = options ?? {};
    const calls = [];

    const handler = createProbeHandler({
        suites: suites ?? { sample: sampleSuite },
        factories: factories ?? { sample: () => () => ({}) },
        authorize: (_context, request) => request.getAuthorizationBearer() === DEPLOY_KEY,
    });

    async function fetchTarget(input, init) {
        calls.push({ input, init });

        const request = new ServerRequest(new Request(input, init));
        const response = await handler({}, request, new ServerResponse());

        return new Response(response.body, { status: response.status, headers: response.headers });
    }

    return { fetch: fetchTarget, calls };
}

function makeClient(target, deployKey) {
    return createProbeClient({
        url: PROBE_URL,
        deployKey: deployKey === undefined ? DEPLOY_KEY : deployKey,
        fetch: target.fetch,
    });
}

// A client whose every request gets the one given response.
function makeClientAnswered(body, init) {
    return createProbeClient({
        url: PROBE_URL,
        deployKey: DEPLOY_KEY,
        fetch: async () => new Response(body, init),
    });
}

// Lists a suite and runs every test in it, one request each, as the
// integration suite does.
async function runSuite(client, suite) {
    const tests = await client.listTests(suite);
    const failures = [];

    for (const path of tests) {
        const result = await client.runTest(suite, path);

        if (result.status !== 'passed') {
            failures.push(`${ path.join(' > ') }: ${ result.error.name }: ${ result.error.message }`);
        }
    }

    return { count: tests.length, failures };
}

// The key/value suite's factory, over the Workers KV fake and the Cloudflare
// adapter. KV allows one write per second to a key, and the fake keeps that
// rule by its clock, so afterWrite() moves the clock on a second.
function makeKeyValueStoreFactory(options) {
    const { movesClock } = options ?? {};

    return () => {
        let now = Date.now();
        const kvStore = createFakeKVNamespace({ now: () => now });

        return {
            store: new KeyValueStore(),
            context: {
                logger: new Logger({ name: 'Test', level: 'NONE' }),
                env: { KEY_VALUE_STORE: kvStore },
            },
            async afterWrite() {
                if (movesClock) {
                    now += 1000;
                }
            },
        };
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Stands in for a test runner's `describe`: records the blocks and tests
// registered through it.
function makeDescribeRecorder() {
    const blocks = [];

    function describeBlock(name, fn) {
        const block = { name, tests: [] };
        blocks.push(block);

        fn({
            it(testName, testFn) {
                block.tests.push({ name: testName, fn: testFn });
            },
        });
    }

    return { describe: describeBlock, blocks };
}


describe('probe client', ({ describe }) => {

    describe('createProbeClient', ({ it }) => {
        it('lists the tests of a suite through the handler', async () => {
            const client = makeClient(makeTarget());

            const tests = await client.listTests('sample');

            assertEqual(
                JSON.stringify([ [ 'group', 'passes' ], [ 'group', 'nested', 'fails' ] ]),
                JSON.stringify(tests),
            );
        });

        it('runs a passing test through the handler', async () => {
            const client = makeClient(makeTarget());

            const result = await client.runTest('sample', [ 'group', 'passes' ]);

            assertEqual('passed', result.status);
            assertEqual('sample', result.suite);
            assertEqual('group,passes', result.path.join(','));
            assertUndefined(result.error);
        });

        it('resolves the result of a failing test', async () => {
            const client = makeClient(makeTarget());

            const result = await client.runTest('sample', [ 'group', 'nested', 'fails' ]);

            assertEqual('failed', result.status);
            assertEqual('AssertionError', result.error.name);
            assertEqual('expected 1 to equal 2', result.error.message);
            assertEqual('ASSERTION_ERROR', result.error.code);
        });

        it('sends the deploy key as a bearer token, and never follows a redirect', async () => {
            const target = makeTarget();
            const client = makeClient(target);

            await client.listTests('sample');
            await client.runTest('sample', [ 'group', 'passes' ]);

            assertEqual(2, target.calls.length);

            const [ listing, run ] = target.calls;

            assertEqual(`${ PROBE_URL }?suite=sample`, listing.input);
            assertEqual('GET', listing.init.method);
            assertEqual(`Bearer ${ DEPLOY_KEY }`, listing.init.headers.authorization);
            assertEqual('manual', listing.init.redirect);

            assertEqual(PROBE_URL, run.input);
            assertEqual('POST', run.init.method);
            assertEqual(`Bearer ${ DEPLOY_KEY }`, run.init.headers.authorization);
            assertEqual('application/json', run.init.headers['content-type']);
            assertEqual('{"suite":"sample","path":["group","passes"]}', run.init.body);
            assertEqual('manual', run.init.redirect);
        });

        it('keeps the query the probe URL already has', async () => {
            const target = makeTarget();
            const client = createProbeClient({
                url: `${ PROBE_URL }?target=a`,
                deployKey: DEPLOY_KEY,
                fetch: target.fetch,
            });

            await client.listTests('sample');

            assertEqual(`${ PROBE_URL }?target=a&suite=sample`, target.calls[0].input);
        });

        it('sends no Authorization header without a deploy key, and reports the 401', async () => {
            const target = makeTarget();
            const client = makeClient(target, null);

            const caught = await catchAsyncError(() => client.listTests('sample'));

            assertUndefined(target.calls[0].init.headers.authorization);
            assert(caught, 'expected the request to be refused');
            assertEqual('ProbeRequestError', caught.name);
            assertEqual(401, caught.status);
            assertEqual('The probe answered 401: Unauthorized', caught.message);
        });

        it('reports a 401 for a wrong deploy key without repeating the key', async () => {
            const wrongKey = 'wrong-key-3e9a5d';
            const client = makeClient(makeTarget(), wrongKey);

            const listing = await catchAsyncError(() => client.listTests('sample'));
            const run = await catchAsyncError(() => client.runTest('sample', [ 'group', 'passes' ]));

            for (const caught of [ listing, run ]) {
                assert(caught, 'expected the request to be refused');
                assertEqual('ProbeRequestError', caught.name);
                assertEqual(401, caught.status);
                assertNotMatches(wrongKey, caught.message);
                assertNotMatches(wrongKey, caught.stack);
                assertNotMatches(wrongKey, JSON.stringify(Object.entries(caught)));
                assertNotMatches('Bearer', caught.message);
            }
        });

        it('reports a 404 for an unknown suite and for an unknown path', async () => {
            const client = makeClient(makeTarget());

            const suite = await catchAsyncError(() => client.listTests('missing'));
            const path = await catchAsyncError(() => client.runTest('sample', [ 'group', 'missing' ]));

            assert(suite, 'expected the listing to fail');
            assertEqual('ProbeRequestError', suite.name);
            assertEqual(404, suite.status);
            assertEqual('The probe answered 404: No suite has that name', suite.message);

            assert(path, 'expected the run to fail');
            assertEqual('ProbeRequestError', path.name);
            assertEqual(404, path.status);
            assertEqual('The probe answered 404: The suite has no test at that path', path.message);
        });

        it('reports a failed response that is not JSON', async () => {
            const client = makeClientAnswered('<html>Bad Gateway</html>', { status: 502 });

            const caught = await catchAsyncError(() => client.listTests('sample'));

            assert(caught, 'expected the request to fail');
            assertEqual('ProbeRequestError', caught.name);
            assertEqual(502, caught.status);
            assertEqual('The probe answered 502: the response held no error message', caught.message);
        });

        it('reports a redirect as a failed request', async () => {
            const client = makeClientAnswered(null, { status: 302, headers: { location: 'https://elsewhere.test/' } });

            const caught = await catchAsyncError(() => client.runTest('sample', [ 'group', 'passes' ]));

            assert(caught, 'expected the request to fail');
            assertEqual('ProbeRequestError', caught.name);
            assertEqual(302, caught.status);
        });

        // Some other server at the URL may answer 200. That must never read
        // as an empty suite or a passed test.
        it('rejects a 200 that is not a test listing', async () => {
            for (const body of [ '{}', '{"tests":"none"}', '{"tests":[["a"],"b"]}', '<html></html>' ]) {
                const client = makeClientAnswered(body, { status: 200 });

                const caught = await catchAsyncError(() => client.listTests('sample'));

                assert(caught, `expected ${ body } to be rejected`);
                assertEqual('ProbeRequestError', caught.name);
                assertEqual('The probe answered 200: the response is not a list of test paths', caught.message);
            }
        });

        it('rejects a 200 that is not a test result', async () => {
            for (const body of [ '{}', '{"status":"ok"}', '{"status":"failed"}', '<html></html>' ]) {
                const client = makeClientAnswered(body, { status: 200 });

                const caught = await catchAsyncError(() => client.runTest('sample', [ 'group', 'passes' ]));

                assert(caught, `expected ${ body } to be rejected`);
                assertEqual('ProbeRequestError', caught.name);
                assertEqual('The probe answered 200: the response is not a test result', caught.message);
            }
        });

        it('refuses a deploy key of the wrong type without showing it', () => {
            let caught = null;

            try {
                createProbeClient({ url: PROBE_URL, deployKey: { key: 'object-key-77b0' } });
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('deployKey must be a non-empty string when given', caught.message);
            assertNotMatches('object-key-77b0', caught.message);
        });
    });

    describe('describeProbeSuite', ({ it }) => {
        it('registers one block named for the suite, with one test per path in order', () => {
            const recorder = makeDescribeRecorder();
            const client = makeClient(makeTarget());

            describeProbeSuite(recorder.describe, {
                client,
                suite: 'sample',
                tests: [ [ 'group', 'passes' ], [ 'group', 'nested', 'fails' ] ],
            });

            assertEqual(1, recorder.blocks.length);
            assertEqual('sample', recorder.blocks[0].name);
            assertEqual(
                'group > passes|group > nested > fails',
                recorder.blocks[0].tests.map(({ name }) => name).join('|'),
            );
        });

        it('registers tests that take no arguments, so no runner reads them as callback-style', () => {
            const recorder = makeDescribeRecorder();

            describeProbeSuite(recorder.describe, {
                client: makeClient(makeTarget()),
                suite: 'sample',
                tests: [ [ 'group', 'passes' ] ],
            });

            assertEqual(0, recorder.blocks[0].tests[0].fn.length);
        });

        it('makes no request until a registered test runs', async () => {
            const recorder = makeDescribeRecorder();
            const target = makeTarget();

            describeProbeSuite(recorder.describe, {
                client: makeClient(target),
                suite: 'sample',
                tests: [ [ 'group', 'passes' ] ],
            });

            assertEqual(0, target.calls.length);

            await recorder.blocks[0].tests[0].fn();

            assertEqual(1, target.calls.length);
        });

        it('fails a registered test with the remote name, message, and code', async () => {
            const recorder = makeDescribeRecorder();

            describeProbeSuite(recorder.describe, {
                client: makeClient(makeTarget()),
                suite: 'sample',
                tests: [ [ 'group', 'passes' ], [ 'group', 'nested', 'fails' ] ],
            });

            const [ passes, fails ] = recorder.blocks[0].tests;

            assertEqual(null, await catchAsyncError(passes.fn));

            const caught = await catchAsyncError(fails.fn);

            assert(caught, 'expected the registered test to fail');
            assert(caught instanceof Error, 'expected an Error');
            assertEqual('AssertionError', caught.name);
            assertEqual('expected 1 to equal 2', caught.message);
            assertEqual('ASSERTION_ERROR', caught.code);
        });

        it('fails a registered test when the request fails', async () => {
            const recorder = makeDescribeRecorder();

            describeProbeSuite(recorder.describe, {
                client: makeClient(makeTarget()),
                suite: 'sample',
                tests: [ [ 'group', 'gone' ] ],
            });

            const caught = await catchAsyncError(recorder.blocks[0].tests[0].fn);

            assert(caught, 'expected the registered test to fail');
            assertEqual('ProbeRequestError', caught.name);
            assertEqual(404, caught.status);
        });

        it('refuses an empty list of tests, which would pass by running nothing', () => {
            const recorder = makeDescribeRecorder();
            let caught = null;

            try {
                describeProbeSuite(recorder.describe, {
                    client: makeClient(makeTarget()),
                    suite: 'sample',
                    tests: [],
                });
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('tests must be a non-empty list of test paths', caught.message);
            assertEqual(0, recorder.blocks.length);
        });
    });

    describe('the registered suites', ({ it }) => {
        it('registers the four port suites and the two golden suites', () => {
            assertEqual(
                'content-compiler,content-store,format-date,key-value-store,logger-writer,server-request',
                Object.keys(PROBE_SUITES).sort().join(','),
            );
            assert(Object.isFrozen(PROBE_SUITES), 'expected PROBE_SUITES to be frozen');
            assertEqual('content-compiler,format-date', Object.keys(BUILT_IN_FACTORIES).join(','));
        });

        // Listing collects each suite with describe() and it() only, and with
        // a factory that throws. So this fails if a registered suite uses a
        // hook or a block option, or calls its factory while registering.
        for (const name of Object.keys(PROBE_SUITES)) {
            it(`lists the ${ name } suite through the client and handler`, async () => {
                const client = makeClient(makeTarget({ suites: PROBE_SUITES, factories: BUILT_IN_FACTORIES }));

                const tests = await client.listTests(name);

                assert(tests.length > 0, 'expected the suite to hold tests');

                for (const path of tests) {
                    assert(path.length >= 2, `expected a group and a test name in ${ path.join(' > ') }`);
                }

                assertEqual(tests.length, new Set(tests.map((path) => JSON.stringify(path))).size);
            });
        }

        it('runs every format-date test through the client and handler', async () => {
            const client = makeClient(makeTarget({ suites: PROBE_SUITES, factories: BUILT_IN_FACTORIES }));

            const { count, failures } = await runSuite(client, 'format-date');

            assertEqual('', failures.join('\n'));
            assert(count > 0, 'expected the suite to hold tests');
        });

        // The compiler, its vendored parser, and its hashing, run one test per
        // request, as they will inside each target.
        it('runs every content-compiler test through the client and handler', async () => {
            const client = makeClient(makeTarget({ suites: PROBE_SUITES, factories: BUILT_IN_FACTORIES }));

            const { count, failures } = await runSuite(client, 'content-compiler');

            assertEqual('', failures.join('\n'));
            assert(count > 0, 'expected the suite to hold tests');
        });

        it('runs the key-value-store suite over the Workers KV fake and the Cloudflare adapter', async () => {
            const client = makeClient(makeTarget({
                suites: PROBE_SUITES,
                factories: {
                    ...BUILT_IN_FACTORIES,
                    'key-value-store': () => makeKeyValueStoreFactory({ movesClock: true }),
                },
            }));

            const { count, failures } = await runSuite(client, 'key-value-store');

            assertEqual('', failures.join('\n'));
            assert(count > 0, 'expected the suite to hold tests');
        });

        // The other side of the run above: a failure inside a port suite
        // comes back through the probe as that test's result.
        it('reports the write-rate failure when afterWrite() does not move the clock', async () => {
            const client = makeClient(makeTarget({
                suites: PROBE_SUITES,
                factories: { 'key-value-store': () => makeKeyValueStoreFactory({ movesClock: false }) },
            }));

            const { failures } = await runSuite(client, 'key-value-store');

            assert(failures.length > 0, 'expected the suite to fail');

            for (const failure of failures) {
                assertMatches('Error: KV PUT failed: 429 Too Many Requests', failure);
            }
        });

        it('cannot run a port suite on a target that gives it no factory', async () => {
            const client = makeClient(makeTarget({ suites: PROBE_SUITES, factories: BUILT_IN_FACTORIES }));
            const [ path ] = await client.listTests('content-store');

            const caught = await catchAsyncError(() => client.runTest('content-store', path));

            assert(caught, 'expected the run to fail');
            assertEqual('ProbeRequestError', caught.name);
            assertEqual(404, caught.status);
            assertMatches('No factory is configured for that suite on this target', caught.message);
        });
    });
});
