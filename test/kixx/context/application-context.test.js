import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import ApplicationContext from '../../../src/kixx/context/application-context.js';
import RequestContext from '../../../src/kixx/context/request-context.js';


function makeApplicationContext(options) {
    const {
        config = { name: 'test-app' },
        logger = { name: 'test-logger' },
        env = {},
        runtime = { mode: 'server' },
    } = options ?? {};

    return new ApplicationContext({ config, logger, env, runtime });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('ApplicationContext', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('assigns config, env, logger, and runtime as enumerable read-only properties', () => {
            const config = { name: 'app' };
            const logger = { name: 'app' };
            const env = { NODE_ENV: 'test' };
            const runtime = { mode: 'server' };
            const context = new ApplicationContext({ config, logger, env, runtime });

            assertEqual(config, context.config);
            assertEqual(env, context.env);
            assertEqual(logger, context.logger);
            assertEqual(runtime, context.runtime);
            assert(Object.keys(context).includes('config'), 'expected config to be enumerable');
        });

        it('exposes the properties as non-writable', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => {
                context.config = { name: 'other' };
            });

            assert(caught, 'expected reassigning config to throw');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('registerService / getService', ({ it }) => {
        it('registers a service and returns this for chaining', () => {
            const context = makeApplicationContext();
            const service = { id: 'datastore' };

            assertEqual(context, context.registerService('kixx.Datastore', service));
            assertEqual(service, context.getService('kixx.Datastore'));
        });

        it('throws an AssertionError when registering with an empty name', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerService('', {}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when registering an undefined service', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerService('svc', undefined));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when getting an unregistered service', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.getService('missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('missing', caught.message);
        });

        it('throws an AssertionError when getting with an empty name', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.getService(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('registerCollection / getCollection', ({ it }) => {
        it('registers a collection and returns this for chaining', () => {
            const context = makeApplicationContext();
            const collection = { name: 'User' };

            assertEqual(context, context.registerCollection('app.User', collection));
            assertEqual(collection, context.getCollection('app.User'));
        });

        it('throws an AssertionError when registering with an empty name', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerCollection('', {}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when registering an undefined collection', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerCollection('app.User', undefined));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when getting an unregistered collection', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.getCollection('missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('missing', caught.message);
        });
    });

    describe('createRequestContext', ({ it }) => {
        it('returns a RequestContext sharing the config, logger, and runtime', () => {
            const context = makeApplicationContext();

            const requestContext = context.createRequestContext({});

            assert(requestContext instanceof RequestContext, 'expected a RequestContext');
            assertEqual(context.config, requestContext.config);
            assertEqual(context.logger, requestContext.logger);
            assertEqual(context.runtime, requestContext.runtime);
        });

        it('uses the request config when one is provided', () => {
            const context = makeApplicationContext({ config: { name: 'startup-app' } });
            const requestConfig = { name: 'fresh-app' };

            const requestContext = context.createRequestContext({}, { id: 'req-123' }, requestConfig);

            assertEqual(requestConfig, requestContext.config);
            assertEqual('startup-app', context.config.name);
        });

        it('gives the request context its own request-scoped env', () => {
            const context = makeApplicationContext({ env: { APP_ONLY: 'yes' } });

            const requestContext = context.createRequestContext({ REQUEST_ONLY: 'yes' });

            assertEqual('yes', requestContext.env.REQUEST_ONLY);
            assertUndefined(requestContext.env.APP_ONLY);
        });

        it('uses the request id as the context requestId', () => {
            const context = makeApplicationContext();

            const requestContext = context.createRequestContext({}, { id: 'req-123' });

            assertEqual('req-123', requestContext.requestId);
        });

        it('leaves requestId undefined when no request is provided', () => {
            const context = makeApplicationContext();

            const requestContext = context.createRequestContext({});

            assertUndefined(requestContext.requestId);
        });

        it('shares the service registry by reference, including later registrations', () => {
            const context = makeApplicationContext();
            const requestContext = context.createRequestContext({});

            // Registered after the request context was created; the shared Map
            // reference makes it visible without re-creating the context.
            context.registerService('svc', { id: 1 });

            assertEqual(1, requestContext.getService('svc').id);
        });

        it('shares the collection registry by reference, including later registrations', () => {
            const context = makeApplicationContext();
            const requestContext = context.createRequestContext({});

            context.registerCollection('app.User', { name: 'User' });

            assertEqual('User', requestContext.getCollection('app.User').name);
        });
    });

    describe('BaseContext env accessors via ApplicationContext', ({ describe }) => {

        describe('getEnvString', ({ it }) => {
            it('returns the string value when present', () => {
                const context = makeApplicationContext({ env: { NAME: 'kixx' } });

                assertEqual('kixx', context.getEnvString('NAME'));
            });

            it('returns undefined when missing and not required', () => {
                const context = makeApplicationContext();

                assertUndefined(context.getEnvString('MISSING'));
            });

            it('throws an AssertionError when required and missing', () => {
                const context = makeApplicationContext();

                const caught = catchError(() => context.getEnvString('MISSING', { required: true }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('required', caught.message);
            });
        });

        describe('getEnvInteger', ({ it }) => {
            it('parses a base-10 integer string', () => {
                const context = makeApplicationContext({ env: { PORT: '8080' } });

                assertEqual(8080, context.getEnvInteger('PORT'));
            });

            it('returns a number value already stored as an integer', () => {
                const context = makeApplicationContext({ env: { PORT: 3000 } });

                assertEqual(3000, context.getEnvInteger('PORT'));
            });

            it('throws an AssertionError for a float value', () => {
                const context = makeApplicationContext({ env: { PORT: 1.5 } });

                const caught = catchError(() => context.getEnvInteger('PORT'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });

            it('throws an AssertionError for an unparseable string', () => {
                const context = makeApplicationContext({ env: { PORT: 'abc' } });

                const caught = catchError(() => context.getEnvInteger('PORT'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });

            it('returns undefined when missing and not required', () => {
                const context = makeApplicationContext();

                assertUndefined(context.getEnvInteger('PORT'));
            });
        });

        describe('getEnvFloat', ({ it }) => {
            it('parses a float string', () => {
                const context = makeApplicationContext({ env: { RATE: '1.5' } });

                assertEqual(1.5, context.getEnvFloat('RATE'));
            });

            it('returns a number value already stored as a float', () => {
                const context = makeApplicationContext({ env: { RATE: 2.25 } });

                assertEqual(2.25, context.getEnvFloat('RATE'));
            });

            it('throws an AssertionError for an unparseable string', () => {
                const context = makeApplicationContext({ env: { RATE: 'abc' } });

                const caught = catchError(() => context.getEnvFloat('RATE'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            });
        });

        describe('getEnvBoolean', ({ it }) => {
            it('returns true for recognized truthy values', () => {
                assertEqual(true, makeApplicationContext({ env: { F: true } }).getEnvBoolean('F'));
                assertEqual(true, makeApplicationContext({ env: { F: 1 } }).getEnvBoolean('F'));
                assertEqual(true, makeApplicationContext({ env: { F: 'true' } }).getEnvBoolean('F'));
                assertEqual(true, makeApplicationContext({ env: { F: '1' } }).getEnvBoolean('F'));
            });

            it('returns false for recognized falsy values', () => {
                assertEqual(false, makeApplicationContext({ env: { F: false } }).getEnvBoolean('F'));
                assertEqual(false, makeApplicationContext({ env: { F: 0 } }).getEnvBoolean('F'));
                assertEqual(false, makeApplicationContext({ env: { F: 'false' } }).getEnvBoolean('F'));
                assertEqual(false, makeApplicationContext({ env: { F: '0' } }).getEnvBoolean('F'));
            });

            it('returns false for missing or unrecognized values', () => {
                assertEqual(false, makeApplicationContext().getEnvBoolean('MISSING'));
                assertEqual(false, makeApplicationContext({ env: { F: 'maybe' } }).getEnvBoolean('F'));
            });
        });
    });
});
