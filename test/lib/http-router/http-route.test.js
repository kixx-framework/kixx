import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray } from 'kixx-assert';
import HttpRoute from '../../../lib/http-router/http-route.js';
import HttpTarget from '../../../lib/http-router/http-target.js';


function createMockTarget(methods) {
    return {
        allowedMethods: methods,
        isMethodAllowed(method) {
            return methods.includes(method);
        },
    };
}

function createRouteSpec(overrides = {}) {
    return {
        name: 'test-route',
        pattern: '/users',
        inboundMiddleware: [],
        outboundMiddleware: [],
        errorHandlers: [],
        targets: [],
        ...overrides,
    };
}


describe('HttpRoute constructor', ({ it }) => {
    const target1 = createMockTarget([ 'GET' ]);
    const target2 = createMockTarget([ 'POST' ]);

    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ target1, target2 ],
        errorHandlers: [],
    });

    it('sets the name property', () => assertEqual('test-route', route.name));

    it('sets the targets property', () => {
        assertArray(route.targets);
        assertEqual(2, route.targets.length);
        assertEqual(target1, route.targets[0]);
        assertEqual(target2, route.targets[1]);
    });
});

describe('HttpRoute constructor when options.name is not a non-empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRoute({
                name: '',
                pattern: '/users',
                targets: [ createMockTarget([ 'GET' ]) ],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute constructor when options.pattern is not a non-empty string', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRoute({
                name: 'test-route',
                pattern: 123,
                targets: [ createMockTarget([ 'GET' ]) ],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute constructor when options.targets is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRoute({
                name: 'test-route',
                pattern: '/users',
                targets: null,
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute constructor when options.targets is an empty Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRoute({
                name: 'test-route',
                pattern: '/users',
                targets: [],
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute constructor when options.errorHandlers is not an Array', ({ before, it }) => {
    let result;

    before(async () => {
        const route = new HttpRoute({
            name: 'test-route',
            pattern: '/users',
            targets: [ createMockTarget([ 'GET' ]) ],
            errorHandlers: null,
        });
        result = await route.handleError({}, {}, {}, new Error('test'));
    });

    it('sets a default empty Array for #errorHandlers', () => assertEqual(false, result));
});

describe('HttpRoute#matchPathname() with wildcard pattern', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '*',
        targets: [ createMockTarget([ 'GET' ]) ],
        errorHandlers: [],
    });

    it('returns empty params for any pathname', () => {
        const params = route.matchPathname('/anything/at/all');
        assertEqual(0, Object.keys(params).length);
    });

    it('returns empty params for the root pathname', () => {
        const params = route.matchPathname('/');
        assertEqual(0, Object.keys(params).length);
    });
});

describe('HttpRoute#matchPathname() with pattern that matches', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ createMockTarget([ 'GET' ]) ],
        errorHandlers: [],
    });

    it('returns an empty params object', () => {
        const params = route.matchPathname('/users');
        assertEqual(0, Object.keys(params).length);
    });
});

describe('HttpRoute#matchPathname() with pattern that does not match', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ createMockTarget([ 'GET' ]) ],
        errorHandlers: [],
    });

    it('returns null', () => assertEqual(null, route.matchPathname('/posts')));
});

describe('HttpRoute#allowedMethods with a single target', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ createMockTarget([ 'GET', 'POST' ]) ],
        errorHandlers: [],
    });

    it('returns all methods from the target', () => {
        const methods = route.allowedMethods;
        assertArray(methods);
        assertEqual(true, methods.includes('GET'));
        assertEqual(true, methods.includes('POST'));
    });
});

describe('HttpRoute#allowedMethods with multiple targets having overlapping methods', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [
            createMockTarget([ 'GET', 'POST' ]),
            createMockTarget([ 'POST', 'DELETE' ]),
        ],
        errorHandlers: [],
    });

    it('returns unique methods from all targets', () => {
        const methods = route.allowedMethods;
        assertArray(methods);
        assertEqual(3, methods.length);
        assertEqual(true, methods.includes('GET'));
        assertEqual(true, methods.includes('POST'));
        assertEqual(true, methods.includes('DELETE'));
    });
});

describe('HttpRoute#findTargetForRequest() when the method matches the first target', ({ it }) => {
    const target1 = createMockTarget([ 'GET' ]);
    const target2 = createMockTarget([ 'POST' ]);

    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ target1, target2 ],
        errorHandlers: [],
    });

    it('returns the first matching target', () => {
        const result = route.findTargetForRequest({ method: 'GET' });
        assertEqual(target1, result);
    });
});

describe('HttpRoute#findTargetForRequest() when the method matches the second target only', ({ it }) => {
    const target1 = createMockTarget([ 'GET' ]);
    const target2 = createMockTarget([ 'POST' ]);

    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [ target1, target2 ],
        errorHandlers: [],
    });

    it('returns the second target', () => {
        const result = route.findTargetForRequest({ method: 'POST' });
        assertEqual(target2, result);
    });
});

describe('HttpRoute#findTargetForRequest() when no target handles the method', ({ it }) => {
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users',
        targets: [
            createMockTarget([ 'GET' ]),
            createMockTarget([ 'POST' ]),
        ],
        errorHandlers: [],
    });

    it('returns null', () => {
        const result = route.findTargetForRequest({ method: 'DELETE' });
        assertEqual(null, result);
    });
});

describe('HttpRoute#handleError() when the first handler returns a response', ({ before, it }) => {
    const context = {};
    const request = {};
    const response = {};
    const error = new Error('test error');
    const handledResponse = {};

    const errorHandler1 = sinon.fake.resolves(handledResponse);
    const errorHandler2 = sinon.fake.resolves({});

    let result;

    before(async () => {
        const route = new HttpRoute({
            name: 'test-route',
            pattern: '/users',
            targets: [ createMockTarget([ 'GET' ]) ],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        result = await route.handleError(context, request, response, error);
    });

    it('returns the response from the first handler', () => assertEqual(handledResponse, result));

    it('does *not* invoke the second handler', () => assertEqual(0, errorHandler2.callCount));
});

describe('HttpRoute#handleError() when the first handler returns false', ({ before, it }) => {
    const errorHandler1 = sinon.fake.resolves(false);
    const errorHandler2 = sinon.fake.resolves({});

    before(async () => {
        const route = new HttpRoute({
            name: 'test-route',
            pattern: '/users',
            targets: [ createMockTarget([ 'GET' ]) ],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        await route.handleError({}, {}, {}, new Error('test'));
    });

    it('invokes the second handler', () => assertEqual(1, errorHandler2.callCount));
});

describe('HttpRoute#handleError() when no handler returns a response', ({ before, it }) => {
    const context = {};
    const request = {};
    const response = {};
    const error = new Error('test error');

    const errorHandler1 = sinon.fake.resolves(false);
    const errorHandler2 = sinon.fake.resolves(false);

    let result;

    before(async () => {
        const route = new HttpRoute({
            name: 'test-route',
            pattern: '/users',
            targets: [ createMockTarget([ 'GET' ]) ],
            errorHandlers: [ errorHandler1, errorHandler2 ],
        });
        result = await route.handleError(context, request, response, error);
    });

    it('invokes handlers in order', () => {
        assertEqual(true, errorHandler1.calledBefore(errorHandler2));
    });

    it('invokes each handler with context, request, response, and error', () => {
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

describe('HttpRoute.fromSpecification()', ({ it }) => {
    const result = HttpRoute.fromSpecification(
        createRouteSpec({
            name: 'users-route',
            pattern: '/users/:id',
            targets: [
                { name: 'get-user', methods: [ 'GET' ], tags: [ 'api' ], handlers: [], errorHandlers: [] },
            ],
        }),
        new Map(),
        new Map(),
        new Map()
    );

    it('returns an HttpRoute instance', () => assert(result instanceof HttpRoute));

    it('sets the name from routeSpec', () => assertEqual('users-route', result.name));

    it('creates targets from target specs', () => {
        assertArray(result.targets);
        assertEqual(1, result.targets.length);
        assert(result.targets[0] instanceof HttpTarget);
    });

    it('creates targets with the correct methods', () => {
        assertEqual(true, result.targets[0].isMethodAllowed('GET'));
    });

    it('the route pattern is used for pathname matching', () => {
        const params = result.matchPathname('/users/abc123');
        assertEqual('abc123', params.id);
    });
});

describe('HttpRoute.fromSpecification() when an unknown inbound middleware name is referenced', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpRoute.fromSpecification(
                createRouteSpec({ inboundMiddleware: [ [ 'unknown-middleware', {}] ] }),
                new Map(),
                new Map(),
                new Map()
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute.fromSpecification() when an unknown outbound middleware name is referenced', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpRoute.fromSpecification(
                createRouteSpec({ outboundMiddleware: [ [ 'unknown-middleware', {}] ] }),
                new Map(),
                new Map(),
                new Map()
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute.fromSpecification() when an unknown route error handler name is referenced', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpRoute.fromSpecification(
                createRouteSpec({ errorHandlers: [ [ 'unknown-handler', {}] ] }),
                new Map(),
                new Map(),
                new Map()
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute.fromSpecification() when an unknown request handler name is referenced', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpRoute.fromSpecification(
                createRouteSpec({
                    targets: [
                        { name: 'test-target', methods: [ 'GET' ], handlers: [ [ 'unknown-handler', {}] ], errorHandlers: [] },
                    ],
                }),
                new Map(),
                new Map(),
                new Map()
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute.fromSpecification() when an unknown target error handler name is referenced', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            HttpRoute.fromSpecification(
                createRouteSpec({
                    targets: [
                        { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: [ [ 'unknown-handler', {}] ] },
                    ],
                }),
                new Map(),
                new Map(),
                new Map()
            );
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRoute.fromSpecification() with tuple-based middleware and handlers', ({ before, it }) => {
    const inboundFn = sinon.fake.resolves({});
    const outboundFn = sinon.fake.resolves({});
    const handlerFn = sinon.fake.resolves({});

    const inboundFactory = sinon.fake.returns(inboundFn);
    const outboundFactory = sinon.fake.returns(outboundFn);
    const handlerFactory = sinon.fake.returns(handlerFn);

    before(async () => {
        const middlewareMap = new Map([ [ 'inbound-mw', inboundFactory ], [ 'outbound-mw', outboundFactory ] ]);
        const handlersMap = new Map([ [ 'get-handler', handlerFactory ] ]);
        const route = HttpRoute.fromSpecification(
            createRouteSpec({
                inboundMiddleware: [ [ 'inbound-mw', { option: 1 }] ],
                outboundMiddleware: [ [ 'outbound-mw', {}] ],
                targets: [
                    { name: 'test-target', methods: [ 'GET' ], handlers: [ [ 'get-handler', { option: 2 }] ], errorHandlers: [] },
                ],
            }),
            middlewareMap,
            handlersMap,
            new Map()
        );
        await route.targets[0].invokeMiddleware({}, {}, {});
    });

    it('invokes the inbound middleware factory with options', () => {
        assertEqual(1, inboundFactory.callCount);
        assertEqual(1, inboundFactory.getCall(0).firstArg.option);
    });

    it('invokes the handler factory with options', () => {
        assertEqual(1, handlerFactory.callCount);
        assertEqual(2, handlerFactory.getCall(0).firstArg.option);
    });

    it('invokes inbound middleware before handler', () => {
        assertEqual(true, inboundFn.calledBefore(handlerFn));
    });

    it('invokes handler before outbound middleware', () => {
        assertEqual(true, handlerFn.calledBefore(outboundFn));
    });
});

describe('HttpRoute.fromSpecification() with function references in middleware and handlers', ({ before, it }) => {
    const inboundFn = sinon.fake.resolves({});
    const handlerFn = sinon.fake.resolves({});

    before(async () => {
        const route = HttpRoute.fromSpecification(
            createRouteSpec({
                inboundMiddleware: [ inboundFn ],
                targets: [
                    { name: 'test-target', methods: [ 'GET' ], handlers: [ handlerFn ], errorHandlers: [] },
                ],
            }),
            new Map(),
            new Map(),
            new Map()
        );
        await route.targets[0].invokeMiddleware({}, {}, {});
    });

    it('invokes the inbound function directly', () => assertEqual(1, inboundFn.callCount));

    it('invokes the handler function directly', () => assertEqual(1, handlerFn.callCount));
});
