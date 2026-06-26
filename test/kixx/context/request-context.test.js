import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import RequestContext from '../../../src/kixx/context/request-context.js';


function makeRequestContext(options) {
    const {
        config = { name: 'test-app' },
        env = {},
        runtime = { mode: 'server' },
        services = new Map(),
        collections = new Map(),
        logger = { name: 'test-logger' },
        requestId,
    } = options ?? {};

    return new RequestContext({ config, env, runtime, services, collections, logger, requestId });
}

function makeTarget(name, tags) {
    const tagList = tags ?? [];
    return {
        name,
        hasTag(tag) {
            return tagList.includes(tag);
        },
    };
}

function makeRoute(targets) {
    return { targets };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('RequestContext', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('assigns config, env, logger, runtime, and requestId as enumerable properties', () => {
            const config = { name: 'req-app' };
            const env = { REQUEST_ID: 'abc' };
            const logger = { name: 'req' };
            const runtime = { mode: 'server' };
            const context = makeRequestContext({ config, env, logger, runtime, requestId: 'req-1' });

            assertEqual(config, context.config);
            assertEqual(env, context.env);
            assertEqual(logger, context.logger);
            assertEqual(runtime, context.runtime);
            assertEqual('req-1', context.requestId);
            assert(Object.keys(context).includes('config'), 'expected config to be enumerable');
        });

        it('leaves requestId undefined when omitted', () => {
            const context = makeRequestContext();

            assertUndefined(context.requestId);
        });

        it('exposes the properties as non-writable', () => {
            const context = makeRequestContext();

            const caught = catchError(() => {
                context.config = {};
            });

            assert(caught, 'expected reassigning config to throw');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('user', ({ it }) => {
        it('defaults to null', () => {
            const context = makeRequestContext();

            assertEqual(null, context.user);
        });

        it('stores the user set by setUser', () => {
            const context = makeRequestContext();
            const user = { id: 'u1' };

            context.setUser(user);

            assertEqual(user, context.user);
        });

        it('clears the user when set to null', () => {
            const context = makeRequestContext();

            context.setUser({ id: 'u1' });
            context.setUser(null);

            assertEqual(null, context.user);
        });
    });

    describe('getService', ({ it }) => {
        it('returns a registered service', () => {
            const service = { id: 'datastore' };
            const context = makeRequestContext({ services: new Map([[ 'svc', service ]]) });

            assertEqual(service, context.getService('svc'));
        });

        it('throws an AssertionError for an empty name', () => {
            const context = makeRequestContext();

            const caught = catchError(() => context.getService(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for an unregistered service', () => {
            const context = makeRequestContext();

            const caught = catchError(() => context.getService('missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('missing', caught.message);
        });
    });

    describe('getCollection', ({ it }) => {
        it('returns a registered collection', () => {
            const collection = { name: 'User' };
            const context = makeRequestContext({ collections: new Map([[ 'app.User', collection ]]) });

            assertEqual(collection, context.getCollection('app.User'));
        });

        it('throws an AssertionError for an empty name', () => {
            const context = makeRequestContext();

            const caught = catchError(() => context.getCollection(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for an unregistered collection', () => {
            const context = makeRequestContext();

            const caught = catchError(() => context.getCollection('missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('missing', caught.message);
        });
    });

    describe('useRoutes', ({ it }) => {
        it('returns this for method chaining', () => {
            const context = makeRequestContext();

            assertEqual(context, context.useRoutes([]));
        });

        it('copies the routes so later caller mutation does not affect lookups', () => {
            const context = makeRequestContext();
            const routes = [ makeRoute([ makeTarget('A/one') ]) ];

            context.useRoutes(routes);

            // Mutating the original array after useRoutes must not change lookups.
            routes.push(makeRoute([ makeTarget('B/two') ]));

            const targets = context.getAllHttpTargets();
            assertEqual(1, targets.length);
            assertEqual('A/one', targets[0].name);
        });
    });

    describe('getAllHttpTargets', ({ it }) => {
        it('flattens targets across routes in iteration order', () => {
            const context = makeRequestContext();
            context.useRoutes([
                makeRoute([ makeTarget('A/one'), makeTarget('A/two') ]),
                makeRoute([ makeTarget('B/one') ]),
            ]);

            const names = context.getAllHttpTargets().map((target) => target.name);

            assertEqual(3, names.length);
            assertEqual('A/one', names[0]);
            assertEqual('A/two', names[1]);
            assertEqual('B/one', names[2]);
        });
    });

    describe('getHttpTarget', ({ it }) => {
        it('returns the target matching the fully-qualified name', () => {
            const target = makeTarget('A/two');
            const context = makeRequestContext();
            context.useRoutes([ makeRoute([ makeTarget('A/one'), target ]) ]);

            assertEqual(target, context.getHttpTarget('A/two'));
        });

        it('returns the first match when names collide', () => {
            const first = makeTarget('A/dup');
            const second = makeTarget('A/dup');
            const context = makeRequestContext();
            context.useRoutes([ makeRoute([ first ]), makeRoute([ second ]) ]);

            assertEqual(first, context.getHttpTarget('A/dup'));
        });

        it('throws an AssertionError for an empty name', () => {
            const context = makeRequestContext();
            context.useRoutes([]);

            const caught = catchError(() => context.getHttpTarget(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when no target matches', () => {
            const context = makeRequestContext();
            context.useRoutes([ makeRoute([ makeTarget('A/one') ]) ]);

            const caught = catchError(() => context.getHttpTarget('A/missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('A/missing', caught.message);
        });
    });

    describe('getHttpTargetsByTag', ({ it }) => {
        it('returns only targets declaring the tag, in route order', () => {
            const context = makeRequestContext();
            context.useRoutes([
                makeRoute([ makeTarget('A/one', [ 'api' ]), makeTarget('A/two', [ 'html' ]) ]),
                makeRoute([ makeTarget('B/one', [ 'api' ]) ]),
            ]);

            const names = context.getHttpTargetsByTag('api').map((target) => target.name);

            assertEqual(2, names.length);
            assertEqual('A/one', names[0]);
            assertEqual('B/one', names[1]);
        });

        it('returns an empty array when no target matches', () => {
            const context = makeRequestContext();
            context.useRoutes([ makeRoute([ makeTarget('A/one', [ 'api' ]) ]) ]);

            assertEqual(0, context.getHttpTargetsByTag('missing').length);
        });

        it('throws an AssertionError for an empty tag', () => {
            const context = makeRequestContext();
            context.useRoutes([]);

            const caught = catchError(() => context.getHttpTargetsByTag(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('BaseContext env accessors via RequestContext', ({ describe }) => {

        describe('getEnvString', ({ it }) => {
            it('returns the string value when present', () => {
                const context = makeRequestContext({ env: { NAME: 'kixx' } });

                assertEqual('kixx', context.getEnvString('NAME'));
            });

            it('returns undefined for an empty string when not required', () => {
                const context = makeRequestContext({ env: { NAME: '' } });

                assertUndefined(context.getEnvString('NAME'));
            });

            it('throws an AssertionError when required and missing', () => {
                const context = makeRequestContext();

                const caught = catchError(() => context.getEnvString('MISSING', { required: true }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });
        });

        describe('getEnvInteger', ({ it }) => {
            it('parses a base-10 integer string', () => {
                const context = makeRequestContext({ env: { PORT: '8080' } });

                assertEqual(8080, context.getEnvInteger('PORT'));
            });

            it('throws an AssertionError for a float value', () => {
                const context = makeRequestContext({ env: { PORT: 1.5 } });

                const caught = catchError(() => context.getEnvInteger('PORT'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });

            it('returns undefined when missing and not required', () => {
                const context = makeRequestContext();

                assertUndefined(context.getEnvInteger('PORT'));
            });
        });

        describe('getEnvFloat', ({ it }) => {
            it('parses a float string', () => {
                const context = makeRequestContext({ env: { RATE: '1.5' } });

                assertEqual(1.5, context.getEnvFloat('RATE'));
            });

            it('throws an AssertionError for an unparseable string', () => {
                const context = makeRequestContext({ env: { RATE: 'abc' } });

                const caught = catchError(() => context.getEnvFloat('RATE'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });
        });

        describe('getEnvBoolean', ({ it }) => {
            it('returns true for recognized truthy values', () => {
                assertEqual(true, makeRequestContext({ env: { F: 'true' } }).getEnvBoolean('F'));
                assertEqual(true, makeRequestContext({ env: { F: 1 } }).getEnvBoolean('F'));
            });

            it('returns false for recognized falsy values', () => {
                assertEqual(false, makeRequestContext({ env: { F: 'false' } }).getEnvBoolean('F'));
                assertEqual(false, makeRequestContext({ env: { F: 0 } }).getEnvBoolean('F'));
            });

            it('returns false for missing or unrecognized values', () => {
                assertEqual(false, makeRequestContext().getEnvBoolean('MISSING'));
                assertEqual(false, makeRequestContext({ env: { F: 'maybe' } }).getEnvBoolean('F'));
            });
        });
    });
});
