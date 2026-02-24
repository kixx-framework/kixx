import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFunction } from 'kixx-assert';
import HttpTarget from '../../../lib/http-router/http-target.js';

describe('HttpTarget constructor when options.name is not a non-empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpTarget({
                name: '',
                pattern: '/users',
                allowedMethods: [ 'GET' ],
                middleware: [],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget constructor when options.pattern is not a non-empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpTarget({
                name: 'test-target',
                pattern: 123,
                allowedMethods: [ 'GET' ],
                middleware: [],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget constructor when options.allowedMethods is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpTarget({
                name: 'test-target',
                pattern: '/users',
                allowedMethods: null,
                middleware: [],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget constructor when options.allowedMethods is empty', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpTarget({
                name: 'test-target',
                pattern: '/users',
                allowedMethods: [],
                middleware: [],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget constructor when options.tags is not an Array', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    it('sets a default empty Array for tags', () => {
        assertEqual(0, target.tags.length);
    });
});

describe('HttpTarget#hasTag() when it has the given tag', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET' ],
        tags: [ 'api', 'public' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns true', () => assertEqual(true, target.hasTag('api')));
});

describe('HttpTarget#hasTag() when it does *not* have the given tag', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET' ],
        tags: [ 'api', 'public' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns false', () => assertEqual(false, target.hasTag('private')));
});

describe('HttpTarget#isMethodAllowed() when it has the given method', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns true', () => assertEqual(true, target.isMethodAllowed('GET')));
});

describe('HttpTarget#isMethodAllowed() when it does *not* have the given method', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns false', () => assertEqual(false, target.isMethodAllowed('DELETE')));
});

describe('HttpTarget#invokeMiddleware()', ({ before, it }) => {
    const context = {};
    const request = {};
    const response = {};

    const middleware1 = sinon.fake.resolves({});
    const middleware2 = sinon.fake.resolves({});
    const middleware3 = sinon.fake.resolves({});

    before(async () => {
        const target = new HttpTarget({
            name: 'test-target',
            pattern: '/users',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware1, middleware2, middleware3 ],
            errorHandlers: [],
        });
        await target.invokeMiddleware(context, request, response);
    });

    it('invokes each middleware function in order', () => {
        assertEqual(true, middleware1.calledBefore(middleware2));
        assertEqual(true, middleware2.calledBefore(middleware3));
    });

    it('invokes each middleware function with context, request, response, and skip', () => {
        const call1 = middleware1.getCall(0);
        assertEqual(context, call1.args[0]);
        assertEqual(request, call1.args[1]);
        assertEqual(response, call1.args[2]);
        assertFunction(call1.args[3]);

        const call2 = middleware2.getCall(0);
        assertEqual(context, call2.args[0]);
        assertEqual(request, call2.args[1]);
        assertEqual(response, call2.args[2]);
        assertFunction(call2.args[3]);

        const call3 = middleware3.getCall(0);
        assertEqual(context, call3.args[0]);
        assertEqual(request, call3.args[1]);
        assertEqual(response, call3.args[2]);
        assertFunction(call3.args[3]);
    });
});

describe('HttpTarget#invokeMiddleware() when skip() is called by second of 3 middleware functions', ({ before, it }) => {
    const middleware1 = sinon.fake.resolves({});
    const middleware2 = sinon.fake(async (_ctx, _req, _res, skip) => {
        skip();
        return {};
    });
    const middleware3 = sinon.fake.resolves({});

    before(async () => {
        const target = new HttpTarget({
            name: 'test-target',
            pattern: '/users',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware1, middleware2, middleware3 ],
            errorHandlers: [],
        });
        await target.invokeMiddleware({}, {}, {});
    });

    it('invokes the first 2 middleware functions', () => {
        assertEqual(1, middleware1.callCount);
        assertEqual(1, middleware2.callCount);
    });

    it('does *not* invoke the 3rd middleware function', () => {
        assertEqual(0, middleware3.callCount);
    });
});

describe('HttpTarget#handleError() when the first error handler returns a response', ({ before, it }) => {
    const context = {};
    const request = {};
    const response = {};
    const error = new Error('test error');
    const handledResponse = {};

    const errorHandler1 = sinon.fake.resolves(handledResponse);
    const errorHandler2 = sinon.fake.resolves({});

    let result;

    before(async () => {
        const target = new HttpTarget({
            name: 'test-target',
            pattern: '/users',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        result = await target.handleError(context, request, response, error);
    });

    it('returns the response', () => assertEqual(handledResponse, result));
    it('does *not* invoke the second error handler', () => assertEqual(0, errorHandler2.callCount));
});

describe('HttpTarget#handleError() when the first error handler returns false', ({ before, it }) => {
    const errorHandler1 = sinon.fake.resolves(false);
    const errorHandler2 = sinon.fake.resolves({});

    before(async () => {
        const target = new HttpTarget({
            name: 'test-target',
            pattern: '/users',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        await target.handleError({}, {}, {}, new Error('test error'));
    });

    it('invokes the second error handler', () => assertEqual(1, errorHandler2.callCount));
});

describe('HttpTarget#handleError() when no error handler returns a response', ({ before, it }) => {
    const context = {};
    const request = {};
    const response = {};
    const error = new Error('test error');

    const errorHandler1 = sinon.fake.resolves(false);
    const errorHandler2 = sinon.fake.resolves(false);

    let result;

    before(async () => {
        const target = new HttpTarget({
            name: 'test-target',
            pattern: '/users',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        result = await target.handleError(context, request, response, error);
    });

    it('invokes each error handler in order', () => {
        assertEqual(true, errorHandler1.calledBefore(errorHandler2));
    });

    it('invokes each error handler with context, request, response, and error', () => {
        const call1 = errorHandler1.getCall(0);
        assertEqual(context, call1.args[0]);
        assertEqual(request, call1.args[1]);
        assertEqual(response, call1.args[2]);
        assertEqual(error, call1.args[3]);

        const call2 = errorHandler2.getCall(0);
        assertEqual(context, call2.args[0]);
        assertEqual(request, call2.args[1]);
        assertEqual(response, call2.args[2]);
        assertEqual(error, call2.args[3]);
    });

    it('returns false', () => assertEqual(false, result));
});

describe('HttpTarget#compilePathname() when the pattern is a wildcard', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '*',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    it('throws an Error', () => {
        let error;
        try {
            target.compilePathname({});
        } catch (err) {
            error = err;
        }
        assertEqual('Error', error.name);
        assertEqual('Cannot compile pathname for wildcard route pattern', error.message);
    });
});

describe('HttpTarget#compilePathname() with a static pattern', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns the pathname', () => {
        assertEqual('/users', target.compilePathname({}).pathname);
    });

    it('returns the preferred HTTP method', () => {
        assertEqual('GET', target.compilePathname({}).method);
    });
});

describe('HttpTarget#compilePathname() with a parameterized pattern', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users/:id/posts/:postId',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns the pathname with params substituted', () => {
        assertEqual('/users/abc123/posts/456', target.compilePathname({ id: 'abc123', postId: '456' }).pathname);
    });
});

describe('HttpTarget#compilePathname() when GET is not in allowedMethods', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'DELETE', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns the next preferred method', () => {
        assertEqual('POST', target.compilePathname({}).method);
    });
});

describe('HttpTarget#compilePathname() when only DELETE is in allowedMethods', ({ it }) => {
    const target = new HttpTarget({
        name: 'test-target',
        pattern: '/users',
        allowedMethods: [ 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    it('returns the next preferred method', () => {
        assertEqual('DELETE', target.compilePathname({}).method);
    });
});

describe('HttpTarget.fromSpecification()', ({ it }) => {
    const result = HttpTarget.fromSpecification(
        {
            name: 'test-route',
            pattern: '/users',
            inboundMiddleware: [],
            outboundMiddleware: [],
            errorHandlers: [],
        },
        {
            name: 'test-target',
            methods: [ 'GET', 'POST' ],
            tags: [ 'api', 'public' ],
            handlers: [],
            errorHandlers: [],
        }
    );

    it('returns an HttpTarget instance', () => assert(result instanceof HttpTarget));

    it('sets name from targetSpec', () => assertEqual('test-target', result.name));

    it('sets allowedMethods from targetSpec.methods', () => {
        assertEqual(2, result.allowedMethods.length);
        assertEqual('GET', result.allowedMethods[0]);
        assertEqual('POST', result.allowedMethods[1]);
    });

    it('sets tags from targetSpec.tags', () => {
        assertEqual(2, result.tags.length);
        assertEqual('api', result.tags[0]);
        assertEqual('public', result.tags[1]);
    });

    it('sets pattern from routeSpec', () => {
        assertEqual('/users', result.compilePathname({}).pathname);
    });
});

describe('HttpTarget.fromSpecification() when route.inboundMiddleware is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpTarget.fromSpecification(
                { name: 'test-route', pattern: '/users', inboundMiddleware: null, outboundMiddleware: [], errorHandlers: [] },
                { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: [] }
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget.fromSpecification() when route.outboundMiddleware is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpTarget.fromSpecification(
                { name: 'test-route', pattern: '/users', inboundMiddleware: [], outboundMiddleware: null, errorHandlers: [] },
                { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: [] }
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget.fromSpecification() when target.handlers is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpTarget.fromSpecification(
                { name: 'test-route', pattern: '/users', inboundMiddleware: [], outboundMiddleware: [], errorHandlers: [] },
                { name: 'test-target', methods: [ 'GET' ], handlers: null, errorHandlers: [] }
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget.fromSpecification() when route.errorHandlers is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpTarget.fromSpecification(
                { name: 'test-route', pattern: '/users', inboundMiddleware: [], outboundMiddleware: [], errorHandlers: null },
                { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: [] }
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget.fromSpecification() when target.errorHandlers is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpTarget.fromSpecification(
                { name: 'test-route', pattern: '/users', inboundMiddleware: [], outboundMiddleware: [], errorHandlers: [] },
                { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: null }
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpTarget.fromSpecification() middleware order', ({ before, it }) => {
    const inbound = sinon.fake.resolves({});
    const handler = sinon.fake.resolves({});
    const outbound = sinon.fake.resolves({});

    before(async () => {
        const target = HttpTarget.fromSpecification(
            {
                name: 'test-route',
                pattern: '/users',
                inboundMiddleware: [ inbound ],
                outboundMiddleware: [ outbound ],
                errorHandlers: [],
            },
            {
                name: 'test-target',
                methods: [ 'GET' ],
                handlers: [ handler ],
                errorHandlers: [],
            }
        );
        await target.invokeMiddleware({}, {}, {});
    });

    it('invokes inbound middleware before target handlers', () => {
        assertEqual(true, inbound.calledBefore(handler));
    });

    it('invokes target handlers before outbound middleware', () => {
        assertEqual(true, handler.calledBefore(outbound));
    });
});

describe('HttpTarget.fromSpecification() error handler order', ({ before, it }) => {
    const targetErrorHandler = sinon.fake.resolves(false);
    const routeErrorHandler = sinon.fake.resolves(false);

    before(async () => {
        const target = HttpTarget.fromSpecification(
            {
                name: 'test-route',
                pattern: '/users',
                inboundMiddleware: [],
                outboundMiddleware: [],
                errorHandlers: [ routeErrorHandler ],
            },
            {
                name: 'test-target',
                methods: [ 'GET' ],
                handlers: [],
                errorHandlers: [ targetErrorHandler ],
            }
        );
        await target.handleError({}, {}, {}, new Error('test'));
    });

    it('invokes target error handlers before route-level error handlers', () => {
        assertEqual(true, targetErrorHandler.calledBefore(routeErrorHandler));
    });
});
