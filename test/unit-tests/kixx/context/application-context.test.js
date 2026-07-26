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

async function catchAsyncError(fn) {
    try {
        await fn();
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
            assert(Object.keys(context).includes('env'), 'expected env to be enumerable');
            assert(Object.keys(context).includes('logger'), 'expected logger to be enumerable');
            assert(Object.keys(context).includes('runtime'), 'expected runtime to be enumerable');
        });

        it('leaves config undefined when omitted', () => {
            const context = new ApplicationContext({ logger: {}, env: {}, runtime: {} });

            assertUndefined(context.config);
            assert(Object.keys(context).includes('config'), 'expected config to be enumerable');
        });
    });

    describe('registerService / getService', ({ it }) => {
        it('registers a service and returns this for chaining', () => {
            const context = makeApplicationContext();
            const service = { id: 'datastore' };

            assertEqual(context, context.registerService('kixx.Datastore', service));
            assertEqual(service, context.getService('kixx.Datastore'));
        });

        it('replaces a service registered under the same name', () => {
            const context = makeApplicationContext();
            const replacement = { id: 'replacement' };

            context.registerService('svc', { id: 'original' });
            context.registerService('svc', replacement);

            assertEqual(replacement, context.getService('svc'));
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

        it('throws an AssertionError when registering a null service', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerService('svc', null));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when registering a primitive service', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerService('svc', 'service'));

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

        it('replaces a collection registered under the same name', () => {
            const context = makeApplicationContext();
            const replacement = { name: 'Replacement' };

            context.registerCollection('app.User', { name: 'Original' });
            context.registerCollection('app.User', replacement);

            assertEqual(replacement, context.getCollection('app.User'));
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

        it('throws an AssertionError when registering a null collection', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerCollection('app.User', null));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when registering a primitive collection', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.registerCollection('app.User', 'collection'));

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

        it('throws an AssertionError when getting with an empty name', () => {
            const context = makeApplicationContext();

            const caught = catchError(() => context.getCollection(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('createRequestContext', ({ it }) => {
        it('returns a RequestContext sharing the application config, logger, and runtime', () => {
            const config = { name: 'request-app' };
            const context = makeApplicationContext({ config });

            const requestContext = context.createRequestContext({}, null);

            assert(requestContext instanceof RequestContext, 'expected a RequestContext');
            assertEqual(config, requestContext.config);
            assertEqual(context.logger, requestContext.logger);
            assertEqual(context.runtime, requestContext.runtime);
        });

        it('uses the same application config for every request context', () => {
            const config = { name: 'fresh-app' };
            const context = makeApplicationContext({ config });

            const firstContext = context.createRequestContext({}, { id: 'req-123' });
            const secondContext = context.createRequestContext({}, { id: 'req-456' });

            assertEqual(config, firstContext.config);
            assertEqual(config, secondContext.config);
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

    describe('close', ({ it }) => {
        it('calls close() on each registered service that exposes one', async () => {
            const context = makeApplicationContext();
            let closedA = false;
            let closedB = false;
            context.registerService('A', { close() {
                closedA = true;
            } });
            context.registerService('B', { close() {
                closedB = true;
            } });

            await context.close();

            assert(closedA, 'expected service A to be closed');
            assert(closedB, 'expected service B to be closed');
        });

        it('skips services that do not expose a close method', async () => {
            const context = makeApplicationContext();
            // A service with no close() must be passed over without throwing.
            context.registerService('plain', { id: 1 });

            const caught = await catchAsyncError(() => context.close());

            assert(!caught, 'expected close() not to throw');
        });

        it('closes services in reverse registration order', async () => {
            const context = makeApplicationContext();
            const order = [];
            context.registerService('first', { close() {
                order.push('first');
            } });
            context.registerService('second', { close() {
                order.push('second');
            } });
            context.registerService('third', { close() {
                order.push('third');
            } });

            await context.close();

            assertEqual('third', order[0]);
            assertEqual('second', order[1]);
            assertEqual('first', order[2]);
        });

        it('awaits an async close before resolving', async () => {
            const context = makeApplicationContext();
            let resolved = false;
            context.registerService('async', {
                close() {
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            resolved = true;
                            resolve();
                        }, 10);
                    });
                },
            });

            await context.close();

            assert(resolved, 'expected the async close to complete before close() resolved');
        });

        it('isolates a failing close and continues closing the rest', async () => {
            const errors = [];
            const logger = {
                name: 'test',
                error(message) {
                    errors.push(message);
                },
            };
            const context = makeApplicationContext({ logger });
            const order = [];
            // Registered first, so closed last: proves the sweep continued past
            // the throwing service registered after it.
            context.registerService('survivor', { close() {
                order.push('survivor');
            } });
            context.registerService('broken', {
                close() {
                    throw new Error('boom');
                },
            });

            const caught = await catchAsyncError(() => context.close());

            assert(!caught, 'expected close() to swallow the service error');
            assert(order.includes('survivor'), 'expected the remaining service to still close');
            assertEqual(1, errors.length);
        });

        it('logs the service name and cause for a rejected async close', async () => {
            const errors = [];
            const logger = {
                error(...args) {
                    errors.push(args);
                },
            };
            const context = makeApplicationContext({ logger });
            const cause = new Error('async boom');
            context.registerService('broken', {
                async close() {
                    throw cause;
                },
            });

            await context.close();

            assertEqual(1, errors.length);
            assertEqual('error closing service during shutdown', errors[0][0]);
            assertEqual('broken', errors[0][1].name);
            assertEqual(cause, errors[0][2]);
        });

        it('is a no-op when called more than once', async () => {
            const context = makeApplicationContext();
            let closeCount = 0;
            context.registerService('counter', { close() {
                closeCount += 1;
            } });

            await context.close();
            await context.close();

            assertEqual(1, closeCount);
        });

        it('does not close services more than once across concurrent calls', async () => {
            const context = makeApplicationContext();
            let closeCount = 0;
            let finishClose;
            const closePromise = new Promise((resolve) => {
                finishClose = resolve;
            });
            context.registerService('counter', {
                async close() {
                    closeCount += 1;
                    await closePromise;
                },
            });

            const firstClose = context.close();
            const secondClose = context.close();
            finishClose();
            await Promise.all([ firstClose, secondClose ]);

            assertEqual(1, closeCount);
        });
    });
});
