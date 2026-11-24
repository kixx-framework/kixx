import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
} from 'kixx-assert';

import ServerRequest from '../../../kixx/adapters/cloudflare/server-request/lib/server-request.js';
import ServerResponse from '../../../kixx/http-router/server-response.js';
import { createProbeHandler } from '../../../test-app/probe/probe-handler.js';


const PROBE_URL = 'https://target.test/probe';
const DEPLOY_KEY = 'deploy-key-5f0c2d9e7a';
const UNAUTHORIZED_BODY = '{"error":{"name":"UnauthenticatedError","message":"Unauthorized"}}';


// Registers five tests in three groups. Each test that runs adds its name to
// the `ran` list of whatever the factory returns.
function sampleSuite(describe, factory) {
    describe('outer', ({ describe, it }) => {
        it('passes', () => {
            factory().ran.push('passes');
        });

        describe('inner', ({ it }) => {
            it('throws', () => {
                factory().ran.push('throws');

                const error = new Error('thrown inside the test');
                error.name = 'SampleError';
                error.code = 'SAMPLE_CODE';
                throw error;
            });

            it('rejects', async () => {
                factory().ran.push('rejects');
                await Promise.resolve();
                throw new RangeError('rejected inside the test');
            });
        });

        it('comes last', async () => {
            await Promise.resolve();
            factory().ran.push('comes last');
        });
    });

    describe('second group', ({ it }) => {
        it('passes', () => {
            factory().ran.push('second passes');
        });
    });
}

// A probe over the sample suite that records every call a request could
// cause: the authorization check, the suite's collection, the factory
// builder, and the tests that ran.
function makeProbe(options) {
    const { authorize, suites, factories } = options ?? {};

    const calls = {
        authorize: [],
        collected: 0,
        factoryContexts: [],
        ran: [],
    };

    const handler = createProbeHandler({
        suites: suites ?? {
            sample(describeBlock, factory) {
                calls.collected += 1;
                sampleSuite(describeBlock, factory);
            },
            unconfigured: sampleSuite,
        },
        factories: factories ?? {
            sample(context) {
                calls.factoryContexts.push(context);
                return () => ({ ran: calls.ran });
            },
        },
        authorize(context, request) {
            calls.authorize.push({ context, request });
            return authorize ? authorize(context, request) : true;
        },
    });

    return { handler, calls };
}

function makeGetRequest(query) {
    return new ServerRequest(new Request(`${ PROBE_URL }${ query ?? '' }`, {
        headers: { authorization: `Bearer ${ DEPLOY_KEY }` },
    }));
}

// A string body is sent as it is, so a test can send text that isn't JSON.
function makePostRequest(body) {
    return new ServerRequest(new Request(PROBE_URL, {
        method: 'POST',
        headers: {
            'authorization': `Bearer ${ DEPLOY_KEY }`,
            'content-type': 'application/json',
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
}

async function send(handler, request, context) {
    const response = await handler(context ?? {}, request, new ServerResponse());

    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        text: response.body,
        body: JSON.parse(response.body),
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


describe('createProbeHandler', ({ describe, it }) => {

    it('refuses to be created without an authorize function', () => {
        let caught = null;

        try {
            createProbeHandler({ suites: {}, factories: {} });
        } catch (error) {
            caught = error;
        }

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('authorize must be a function', caught.message);
    });

    it('refuses suites or factories that are not plain objects', () => {
        const messages = [];

        for (const options of [
            { factories: {}, authorize: () => true },
            { suites: {}, authorize: () => true },
        ]) {
            try {
                createProbeHandler(options);
            } catch (error) {
                messages.push(`${ error.name }: ${ error.message }`);
            }
        }

        assertEqual(2, messages.length);
        assertMatches('AssertionError: createProbeHandler: suites must be a plain object', messages[0]);
        assertMatches('AssertionError: createProbeHandler: factories must be a plain object', messages[1]);
    });

    describe('listing a suite', ({ it }) => {
        it('lists every test path in registration order, through nested describes', async () => {
            const { handler } = makeProbe();

            const { status, contentType, body } = await send(handler, makeGetRequest('?suite=sample'));

            assertEqual(200, status);
            assertEqual('application/json; charset=utf-8', contentType);
            assertEqual('sample', body.suite);
            assertEqual(JSON.stringify([
                [ 'outer', 'passes' ],
                [ 'outer', 'inner', 'throws' ],
                [ 'outer', 'inner', 'rejects' ],
                [ 'outer', 'comes last' ],
                [ 'second group', 'passes' ],
            ]), JSON.stringify(body.tests));
        });

        it('builds no factory and runs no test', async () => {
            const { handler, calls } = makeProbe();

            await send(handler, makeGetRequest('?suite=sample'));

            assertEqual(1, calls.collected);
            assertEqual(0, calls.factoryContexts.length);
            assertEqual(0, calls.ran.length);
        });

        it('lists a suite that has no factory on this target', async () => {
            const { handler } = makeProbe();

            const { status, body } = await send(handler, makeGetRequest('?suite=unconfigured'));

            assertEqual(200, status);
            assertEqual(5, body.tests.length);
        });

        it('answers 400 when the suite parameter is missing', async () => {
            const { handler, calls } = makeProbe();

            const { status, body } = await send(handler, makeGetRequest());

            assertEqual(400, status);
            assertEqual('BadRequestError', body.error.name);
            assertMatches('suite query parameter', body.error.message);
            assertEqual('error', Object.keys(body).join(','));
            assertEqual(0, calls.collected);
        });

        it('answers 400 when the suite parameter is given twice', async () => {
            const { handler } = makeProbe();

            const { status, body } = await send(handler, makeGetRequest('?suite=sample&suite=unconfigured'));

            assertEqual(400, status);
            assertEqual('BadRequestError', body.error.name);
        });

        it('answers 404 for an unknown suite', async () => {
            const { handler, calls } = makeProbe();

            const { status, body } = await send(handler, makeGetRequest('?suite=missing'));

            assertEqual(404, status);
            assertEqual('NotFoundError', body.error.name);
            assertEqual('No suite has that name', body.error.message);
            assertEqual('name,message', Object.keys(body.error).join(','));
            assertEqual(0, calls.collected);
        });

        it('answers 404 for a name every object inherits', async () => {
            const { handler } = makeProbe();

            const first = await send(handler, makeGetRequest('?suite=constructor'));
            const second = await send(handler, makeGetRequest('?suite=toString'));

            assertEqual(404, first.status);
            assertEqual(404, second.status);
        });
    });

    describe('collecting a suite', ({ it }) => {
        // Each of these suites uses something kixx-test offers and the probe
        // doesn't. Collection must fail, never skip it quietly.
        const UNSUPPORTED = [
            [ 'calls before()', (describeBlock) => {
                describeBlock('group', ({ before, it }) => {
                    before(() => {});
                    it('runs', () => {});
                });
            } ],
            [ 'calls xit()', (describeBlock) => {
                describeBlock('group', ({ xit }) => {
                    xit('is skipped', () => {});
                });
            } ],
            [ 'passes block options to it()', (describeBlock) => {
                describeBlock('group', ({ it }) => {
                    it('runs', () => {}, { timeout: 50 });
                });
            } ],
            [ 'passes block options to describe()', (describeBlock) => {
                describeBlock('group', ({ it }) => {
                    it('runs', () => {});
                }, { disabled: true });
            } ],
            [ 'registers a test with no function', (describeBlock) => {
                describeBlock('group', ({ it }) => {
                    it('is disabled');
                });
            } ],
            [ 'registers a group with no function', (describeBlock) => {
                describeBlock('group');
            } ],
            [ 'registers a callback-style test', (describeBlock) => {
                describeBlock('group', ({ it }) => {
                    it('calls back', (done) => {
                        done();
                    });
                });
            } ],
        ];

        for (const [ name, suite ] of UNSUPPORTED) {
            it(`fails with a TypeError for a suite that ${ name }`, async () => {
                const { handler } = makeProbe({ suites: { unsupported: suite } });

                const caught = await catchAsyncError(() => send(handler, makeGetRequest('?suite=unsupported')));

                assert(caught, 'expected collection to fail');
                assertEqual('TypeError', caught.name);
            });
        }

        it('fails for a suite that registers two tests at one path', async () => {
            const { handler } = makeProbe({
                suites: {
                    duplicate(describeBlock) {
                        describeBlock('group', ({ it }) => {
                            it('same name', () => {});
                            it('other name', () => {});
                            it('same name', () => {});
                        });
                    },
                },
            });

            const caught = await catchAsyncError(() => send(handler, makeGetRequest('?suite=duplicate')));

            assert(caught, 'expected collection to fail');
            assertEqual('Error', caught.name);
            assertEqual('The suite registers two tests at the path "group > same name"', caught.message);
        });

        it('keeps apart two paths that only look the same when joined', async () => {
            const { handler } = makeProbe({
                suites: {
                    alike(describeBlock) {
                        describeBlock('a', ({ describe, it }) => {
                            it('b","c', () => {});

                            describe('b', ({ it }) => {
                                it('c', () => {});
                            });
                        });
                    },
                },
            });

            const { status, body } = await send(handler, makeGetRequest('?suite=alike'));

            assertEqual(200, status);
            assertEqual(2, body.tests.length);
        });

        it('fails for a suite that calls its factory while registering tests', async () => {
            const { handler } = makeProbe({
                suites: {
                    eager(describeBlock, factory) {
                        const subject = factory();

                        describeBlock('group', ({ it }) => {
                            it('uses the subject', () => subject);
                        });
                    },
                },
            });

            const caught = await catchAsyncError(() => send(handler, makeGetRequest('?suite=eager')));

            assert(caught, 'expected collection to fail');
            assertMatches('never while registering tests', caught.message);
        });
    });

    describe('running a test', ({ it }) => {
        it('reports a test that returns as passed', async () => {
            const { handler } = makeProbe();

            const { status, body } = await send(handler, makePostRequest({
                suite: 'sample',
                path: [ 'outer', 'passes' ],
            }));

            assertEqual(200, status);
            assertEqual('suite,path,status', Object.keys(body).join(','));
            assertEqual('sample', body.suite);
            assertEqual('outer,passes', body.path.join(','));
            assertEqual('passed', body.status);
        });

        it('waits for an async test before it reports', async () => {
            const { handler, calls } = makeProbe();

            const { body } = await send(handler, makePostRequest({
                suite: 'sample',
                path: [ 'outer', 'comes last' ],
            }));

            assertEqual('passed', body.status);
            assertEqual('comes last', calls.ran.join(','));
        });

        it('reports a test that throws as failed, with a 200', async () => {
            const { handler } = makeProbe();

            const { status, body } = await send(handler, makePostRequest({
                suite: 'sample',
                path: [ 'outer', 'inner', 'throws' ],
            }));

            assertEqual(200, status);
            assertEqual('suite,path,status,error', Object.keys(body).join(','));
            assertEqual('failed', body.status);
            assertEqual('name,message,code', Object.keys(body.error).join(','));
            assertEqual('SampleError', body.error.name);
            assertEqual('thrown inside the test', body.error.message);
            assertEqual('SAMPLE_CODE', body.error.code);
        });

        it('reports a test whose promise rejects as failed', async () => {
            const { handler } = makeProbe();

            const { status, body } = await send(handler, makePostRequest({
                suite: 'sample',
                path: [ 'outer', 'inner', 'rejects' ],
            }));

            assertEqual(200, status);
            assertEqual('failed', body.status);
            assertEqual('name,message', Object.keys(body.error).join(','));
            assertEqual('RangeError', body.error.name);
            assertEqual('rejected inside the test', body.error.message);
        });

        it('builds the factory from the request context and runs only the named test', async () => {
            const { handler, calls } = makeProbe();
            const context = { env: {} };

            await send(handler, makePostRequest({ suite: 'sample', path: [ 'second group', 'passes' ] }), context);

            assertEqual(1, calls.factoryContexts.length);
            assertEqual(context, calls.factoryContexts[0]);
            assertEqual('second passes', calls.ran.join(','));
        });

        it('answers 400 for a body that is not JSON', async () => {
            const { handler, calls } = makeProbe();

            const { status, body } = await send(handler, makePostRequest('{ not json'));

            assertEqual(400, status);
            assertEqual('BadRequestError', body.error.name);
            assertEqual('error', Object.keys(body).join(','));
            assertEqual(0, calls.collected);
        });

        const MALFORMED_BODIES = [
            [ 'an array', [ 'sample' ] ],
            [ 'null', null ],
            [ 'no suite', { path: [ 'outer', 'passes' ] } ],
            [ 'a suite that is not a string', { suite: 7, path: [ 'outer', 'passes' ] } ],
            [ 'an empty suite', { suite: '', path: [ 'outer', 'passes' ] } ],
            [ 'no path', { suite: 'sample' } ],
            [ 'a path that is not an array', { suite: 'sample', path: 'outer > passes' } ],
            [ 'a path that holds a non-string', { suite: 'sample', path: [ 'outer', 1 ] } ],
        ];

        for (const [ name, malformed ] of MALFORMED_BODIES) {
            it(`answers 400 for a body with ${ name }`, async () => {
                const { handler, calls } = makeProbe();

                const { status, body } = await send(handler, makePostRequest(malformed));

                assertEqual(400, status);
                assertEqual('BadRequestError', body.error.name);
                assertMatches('a suite (a string) and a path (an array of strings)', body.error.message);
                assertEqual(0, calls.collected);
                assertEqual(0, calls.factoryContexts.length);
            });
        }

        it('answers 404 for an unknown suite', async () => {
            const { handler, calls } = makeProbe();

            const { status, body } = await send(handler, makePostRequest({ suite: 'missing', path: [ 'a', 'b' ] }));

            assertEqual(404, status);
            assertEqual('NotFoundError', body.error.name);
            assertEqual('No suite has that name', body.error.message);
            assertEqual(0, calls.factoryContexts.length);
        });

        it('answers 404 for a suite with no factory on this target', async () => {
            const { handler, calls } = makeProbe();

            const { status, body } = await send(handler, makePostRequest({
                suite: 'unconfigured',
                path: [ 'outer', 'passes' ],
            }));

            assertEqual(404, status);
            assertEqual('NotFoundError', body.error.name);
            assertEqual('No factory is configured for that suite on this target', body.error.message);
            assertEqual(0, calls.ran.length);
        });

        it('answers 404 for a path the suite does not have', async () => {
            const { handler, calls } = makeProbe();

            const unknown = await send(handler, makePostRequest({ suite: 'sample', path: [ 'outer', 'missing' ] }));
            const group = await send(handler, makePostRequest({ suite: 'sample', path: [ 'outer' ] }));
            const empty = await send(handler, makePostRequest({ suite: 'sample', path: [] }));

            assertEqual(404, unknown.status);
            assertEqual('NotFoundError', unknown.body.error.name);
            assertEqual('The suite has no test at that path', unknown.body.error.message);
            assertEqual(404, group.status);
            assertEqual(404, empty.status);
            assertEqual(0, calls.ran.length);
        });
    });

    describe('error results', ({ it }) => {
        function makeThrowingProbe(thrown) {
            return makeProbe({
                suites: {
                    throwing(describeBlock) {
                        describeBlock('group', ({ it }) => {
                            it('throws', () => {
                                throw thrown;
                            });
                        });
                    },
                },
                factories: { throwing: () => () => ({}) },
            });
        }

        const RUN = { suite: 'throwing', path: [ 'group', 'throws' ] };

        it('returns only the name, the code, and a truncated message', async () => {
            const error = new Error('m'.repeat(5000), { cause: new Error('cause-detail-1c7e') });
            error.name = 'LeakyError';
            error.code = 'LEAKY';
            error.token = 'token-value-93ab';
            error.stack = 'LeakyError: at /srv/app/secret-path-44d0.js:1:1';
            const { handler } = makeThrowingProbe(error);

            const { status, text, body } = await send(handler, makePostRequest(RUN));

            assertEqual(200, status);
            assertEqual('failed', body.status);
            assertEqual('name,message,code', Object.keys(body.error).join(','));
            assertEqual('LeakyError', body.error.name);
            assertEqual('LEAKY', body.error.code);
            assertEqual('m'.repeat(2000), body.error.message);
            assertNotMatches('cause-detail-1c7e', text);
            assertNotMatches('token-value-93ab', text);
            assertNotMatches('secret-path-44d0', text);
            assertNotMatches('stack', text);
        });

        it('truncates a long name and a long code', async () => {
            const error = new Error('long fields');
            error.name = 'N'.repeat(300);
            error.code = 'C'.repeat(300);
            const { handler } = makeThrowingProbe(error);

            const { body } = await send(handler, makePostRequest(RUN));

            assertEqual('N'.repeat(100), body.error.name);
            assertEqual('C'.repeat(100), body.error.code);
        });

        it('leaves out a code that is not a string', async () => {
            const error = new Error('numeric code');
            error.code = 404;
            const { handler } = makeThrowingProbe(error);

            const { body } = await send(handler, makePostRequest(RUN));

            assertEqual('name,message', Object.keys(body.error).join(','));
        });

        it('falls back when the name or the message is not a string', async () => {
            const error = new Error('replaced');
            error.name = { toString: () => 'object-name-7d21' };
            error.message = { toString: () => 'object-message-88f3' };
            const { handler } = makeThrowingProbe(error);

            const { text, body } = await send(handler, makePostRequest(RUN));

            assertEqual('Error', body.error.name);
            assertEqual('', body.error.message);
            assertNotMatches('object-name-7d21', text);
            assertNotMatches('object-message-88f3', text);
        });

        it('never turns a thrown non-Error value into a string', async () => {
            for (const thrown of [ 'thrown-string-2b6f', { secret: 'thrown-object-5e90' }, null, undefined ]) {
                const { handler } = makeThrowingProbe(thrown);

                const { status, text, body } = await send(handler, makePostRequest(RUN));

                assertEqual(200, status);
                assertEqual('failed', body.status);
                assertEqual('{"name":"Error","message":"A non-Error value was thrown"}', JSON.stringify(body.error));
                assertNotMatches('thrown-string-2b6f', text);
                assertNotMatches('thrown-object-5e90', text);
            }
        });
    });

    describe('authorization', ({ it }) => {
        const RUN = { suite: 'sample', path: [ 'outer', 'passes' ] };

        const REFUSALS = [
            [ 'false', () => false ],
            [ 'undefined', () => undefined ],
            [ 'null', () => null ],
            [ 'the number 1', () => 1 ],
            [ 'the string "true"', () => 'true' ],
            [ 'an object', () => ({ authorized: true }) ],
            [ 'a promise of a truthy value', () => Promise.resolve('yes') ],
            [ 'a promise of false', () => Promise.resolve(false) ],
        ];

        function assertRefused({ status, text }, calls) {
            assertEqual(401, status);
            assertEqual(`${ UNAUTHORIZED_BODY }\n`, text);
            assertEqual(1, calls.authorize.length);
            assertEqual(0, calls.collected);
            assertEqual(0, calls.factoryContexts.length);
            assertEqual(0, calls.ran.length);
        }

        for (const [ name, authorize ] of REFUSALS) {
            it(`refuses a listing and a run when authorize returns ${ name }`, async () => {
                const listing = makeProbe({ authorize });
                const run = makeProbe({ authorize });

                assertRefused(await send(listing.handler, makeGetRequest('?suite=sample')), listing.calls);
                assertRefused(await send(run.handler, makePostRequest(RUN)), run.calls);
            });
        }

        it('refuses a listing and a run when authorize throws', async () => {
            function authorize() {
                throw new Error('authorize failed');
            }

            const listing = makeProbe({ authorize });
            const run = makeProbe({ authorize });

            assertRefused(await send(listing.handler, makeGetRequest('?suite=sample')), listing.calls);
            assertRefused(await send(run.handler, makePostRequest(RUN)), run.calls);
        });

        it('refuses a listing and a run when authorize rejects', async () => {
            const authorize = () => Promise.reject(new Error('authorize failed'));

            const listing = makeProbe({ authorize });
            const run = makeProbe({ authorize });

            assertRefused(await send(listing.handler, makeGetRequest('?suite=sample')), listing.calls);
            assertRefused(await send(run.handler, makePostRequest(RUN)), run.calls);
        });

        it('refuses before it looks at the request, so a bad request is a 401 too', async () => {
            const { handler, calls } = makeProbe({ authorize: () => false });

            assertRefused(await send(handler, makePostRequest('{ not json')), calls);
        });

        it('passes the context and the request to authorize, and lets true through', async () => {
            const { handler, calls } = makeProbe({ authorize: () => Promise.resolve(true) });
            const context = { env: {} };
            const request = makeGetRequest('?suite=sample');

            const { status } = await send(handler, request, context);

            assertEqual(200, status);
            assertEqual(1, calls.authorize.length);
            assertEqual(context, calls.authorize[0].context);
            assertEqual(request, calls.authorize[0].request);
        });

        it('never puts the Authorization header in a response body', async () => {
            // An authorize that fails with the credential in its message is
            // the likeliest way for one to leak.
            function leakyAuthorize(_context, request) {
                throw new Error(`rejected ${ request.getAuthorizationBearer() }`);
            }

            const open = makeProbe();
            const closed = makeProbe({ authorize: leakyAuthorize });

            const responses = [
                await send(open.handler, makeGetRequest('?suite=sample')),
                await send(open.handler, makeGetRequest('?suite=missing')),
                await send(open.handler, makeGetRequest()),
                await send(open.handler, makePostRequest(RUN)),
                await send(open.handler, makePostRequest({ suite: 'sample', path: [ 'outer', 'inner', 'throws' ] })),
                await send(open.handler, makePostRequest({ suite: 'sample', path: [ 'missing' ] })),
                await send(open.handler, makePostRequest({ suite: 'unconfigured', path: [ 'outer', 'passes' ] })),
                await send(open.handler, makePostRequest('{ not json')),
                await send(closed.handler, makeGetRequest('?suite=sample')),
                await send(closed.handler, makePostRequest(RUN)),
            ];

            assertEqual('200,404,400,200,200,404,404,400,401,401', responses.map(({ status }) => status).join(','));

            for (const { text } of responses) {
                assertNotMatches(DEPLOY_KEY, text);
                assertNotMatches('Bearer', text);
                assertNotMatches(/authorization/i, text);
            }
        });
    });
});
