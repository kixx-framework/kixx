import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import HttpTarget from '../../../src/kixx/http-router/http-target.js';

function makeTarget(overrides) {
    return new HttpTarget(Object.assign({
        name: 'route/target',
        pattern: '/users/:id',
        allowedMethods: [ 'GET' ],
    }, overrides));
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


describe('HttpTarget', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('exposes name, allowedMethods, and tags', () => {
            const target = makeTarget({ allowedMethods: [ 'GET', 'POST' ], tags: [ 'api' ] });

            assertEqual('route/target', target.name);
            assertEqual('GET,POST', target.allowedMethods.join(','));
            assertEqual('api', target.tags.join(','));
        });

        it('defaults tags to an empty array', () => {
            const target = makeTarget();

            assertEqual(0, target.tags.length);
        });

        it('freezes a copy of allowedMethods so callers cannot mutate it', () => {
            const methods = [ 'GET' ];
            const target = makeTarget({ allowedMethods: methods });

            methods.push('POST');

            assertEqual(1, target.allowedMethods.length);

            const caught = catchError(() => {
                target.allowedMethods.push('DELETE');
            });
            assertEqual('TypeError', caught.name);
        });

        it('throws an AssertionError when name is missing', () => {
            const caught = catchError(() => makeTarget({ name: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when pattern is missing', () => {
            const caught = catchError(() => makeTarget({ pattern: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when allowedMethods is empty', () => {
            const caught = catchError(() => makeTarget({ allowedMethods: [] }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('hasTag', ({ it }) => {
        it('reports declared tags', () => {
            const target = makeTarget({ tags: [ 'api', 'public' ] });

            assert(target.hasTag('api'));
            assertEqual(false, target.hasTag('admin'));
        });
    });

    describe('isMethodAllowed', ({ it }) => {
        it('reports handled methods', () => {
            const target = makeTarget({ allowedMethods: [ 'GET', 'HEAD' ] });

            assert(target.isMethodAllowed('GET'));
            assertEqual(false, target.isMethodAllowed('POST'));
        });
    });

    describe('invokeMiddleware', ({ it }) => {
        it('returns the passed-in response unchanged when there is no middleware', async () => {
            const response = { label: 'initial' };
            const target = makeTarget({ middleware: [] });

            const result = await target.invokeMiddleware({}, {}, response);

            assertEqual(response, result);
        });

        it('runs middleware in registration order', async () => {
            const order = [];
            const target = makeTarget({
                middleware: [
                    (_ctx, _req, res) => {
                        order.push('first');
                        return res;
                    },
                    (_ctx, _req, res) => {
                        order.push('second');
                        return res;
                    },
                ],
            });

            await target.invokeMiddleware({}, {}, { label: 'res' });

            assertEqual('first,second', order.join(','));
        });

        it('threads each middleware return value into the next middleware', async () => {
            const responseA = { label: 'A' };
            const responseB = { label: 'B' };
            let seenBySecond = null;
            const target = makeTarget({
                middleware: [
                    () => responseB,
                    (_ctx, _req, res) => {
                        seenBySecond = res;
                        return res;
                    },
                ],
            });

            const result = await target.invokeMiddleware({}, {}, responseA);

            assertEqual(responseB, seenBySecond);
            assertEqual(responseB, result);
        });

        it('keeps the current response when a middleware returns nothing', async () => {
            const responseA = { label: 'A' };
            let seenBySecond = null;
            const target = makeTarget({
                middleware: [
                    () => undefined,
                    (_ctx, _req, res) => {
                        seenBySecond = res;
                        return res;
                    },
                ],
            });

            const result = await target.invokeMiddleware({}, {}, responseA);

            assertEqual(responseA, seenBySecond);
            assertEqual(responseA, result);
        });

        it('halts the chain after a middleware calls skip', async () => {
            const order = [];
            const target = makeTarget({
                middleware: [
                    (_ctx, _req, res, skip) => {
                        order.push('first');
                        skip();
                        return res;
                    },
                    (_ctx, _req, res) => {
                        order.push('second');
                        return res;
                    },
                ],
            });

            const responseA = { label: 'A' };
            const result = await target.invokeMiddleware({}, {}, responseA);

            assertEqual('first', order.join(','));
            assertEqual(responseA, result);
        });

        it('returns the skipping middleware threaded response', async () => {
            const responseA = { label: 'A' };
            const responseB = { label: 'B' };
            const target = makeTarget({
                middleware: [
                    (_ctx, _req, _res, skip) => {
                        skip();
                        return responseB;
                    },
                ],
            });

            const result = await target.invokeMiddleware({}, {}, responseA);

            assertEqual(responseB, result);
        });

        it('awaits asynchronous middleware', async () => {
            const responseB = { label: 'B' };
            const target = makeTarget({
                middleware: [
                    async () => {
                        await Promise.resolve();
                        return responseB;
                    },
                ],
            });

            const result = await target.invokeMiddleware({}, {}, { label: 'A' });

            assertEqual(responseB, result);
        });
    });

    describe('handleError', ({ it }) => {
        it('returns false when there are no error handlers', async () => {
            const target = makeTarget();

            assertEqual(false, await target.handleError({}, {}, {}, new Error('boom')));
        });

        it('returns the first truthy response and stops', async () => {
            const order = [];
            const handled = { label: 'handled' };
            const target = makeTarget({
                errorHandlers: [
                    () => {
                        order.push('first');
                        return false;
                    },
                    () => {
                        order.push('second');
                        return handled;
                    },
                    () => {
                        order.push('third');
                        return { label: 'late' };
                    },
                ],
            });

            const result = await target.handleError({}, {}, {}, new Error('boom'));

            assertEqual(handled, result);
            assertEqual('first,second', order.join(','));
        });

        it('returns false when every handler declines', async () => {
            const target = makeTarget({
                errorHandlers: [ () => false, () => false ],
            });

            assertEqual(false, await target.handleError({}, {}, {}, new Error('boom')));
        });
    });

    describe('compilePathname', ({ it }) => {
        it('substitutes params into the route pattern', () => {
            const target = makeTarget({ pattern: '/users/:id' });

            const { pathname } = target.compilePathname({ id: '42' });

            assertEqual('/users/42', pathname);
        });

        it('prefers GET over other methods', () => {
            const target = makeTarget({ allowedMethods: [ 'POST', 'GET', 'DELETE' ] });

            assertEqual('GET', target.compilePathname({ id: '1' }).method);
        });

        it('falls back to the highest-priority available method', () => {
            const target = makeTarget({ allowedMethods: [ 'DELETE', 'PUT' ] });

            assertEqual('PUT', target.compilePathname({ id: '1' }).method);
        });

        it('throws when the pattern is a wildcard', () => {
            const target = makeTarget({ pattern: '*' });

            const caught = catchError(() => target.compilePathname({}));

            assert(caught, 'expected an error to be thrown');
            assertMatches('wildcard', caught.message);
        });
    });

    describe('validateSpecification', ({ it }) => {
        function makeSpec(overrides) {
            return Object.assign({
                name: 'getUser',
                methods: [ 'GET' ],
                requestHandlers: [ () => {} ],
            }, overrides);
        }

        it('accepts a valid specification', () => {
            const caught = catchError(() => HttpTarget.validateSpecification(makeSpec(), 'route'));

            assertEqual(null, caught);
        });

        it('accepts "*" as the methods value', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ methods: '*' }), 'route');
            });

            assertEqual(null, caught);
        });

        it('throws an AssertionError when routeName is missing', () => {
            const caught = catchError(() => HttpTarget.validateSpecification(makeSpec(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws a ValidationError when name is missing', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ name: '' }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws a ValidationError when methods is neither an Array nor "*"', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ methods: 'GET' }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('.methods', caught.message);
        });

        it('throws a ValidationError for an unrecognized HTTP method', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ methods: [ 'FETCH' ] }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('invalid HTTP method', caught.message);
        });

        it('throws a ValidationError when tags is not an Array', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ tags: 'api' }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws a ValidationError when requestHandlers is missing', () => {
            const spec = makeSpec();
            delete spec.requestHandlers;

            const caught = catchError(() => HttpTarget.validateSpecification(spec, 'route'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws a ValidationError when a requestHandler is not a function', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ requestHandlers: [ 'nope' ] }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws a ValidationError when an errorHandler is not a function', () => {
            const caught = catchError(() => {
                HttpTarget.validateSpecification(makeSpec({ errorHandlers: [ 'nope' ] }), 'route');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });
    });

    describe('fromSpecification', ({ it }) => {
        function makeRouteSpec(overrides) {
            return Object.assign({
                name: 'users',
                pattern: '/users/:id',
                inboundMiddleware: [],
                outboundMiddleware: [],
            }, overrides);
        }

        it('builds a hierarchical name and collapses duplicate slashes', () => {
            const target = HttpTarget.fromSpecification(
                makeRouteSpec({ name: '/api/' }),
                { name: '/getUser', methods: [ 'GET' ], requestHandlers: [ () => {} ] },
            );

            assertEqual('/api/getUser', target.name);
        });

        it('expands "*" methods to the full HTTP method list', () => {
            const target = HttpTarget.fromSpecification(
                makeRouteSpec(),
                { name: 'all', methods: '*', requestHandlers: [ () => {} ] },
            );

            const httpMethods = 'GET HEAD POST PUT PATCH DELETE'.split(' ');
            assertEqual(httpMethods.join(','), target.allowedMethods.join(','));
        });

        it('assembles middleware as inbound, then handlers, then outbound', async () => {
            const order = [];
            const make = (label) => (_ctx, _req, res) => {
                order.push(label);
                return res;
            };

            const target = HttpTarget.fromSpecification(
                makeRouteSpec({ inboundMiddleware: [ make('in') ], outboundMiddleware: [ make('out') ] }),
                { name: 'handler', methods: [ 'GET' ], requestHandlers: [ make('handler') ] },
            );

            await target.invokeMiddleware({}, {}, { label: 'res' });

            assertEqual('in,handler,out', order.join(','));
        });

        it('carries tags onto the target', () => {
            const target = HttpTarget.fromSpecification(
                makeRouteSpec(),
                { name: 'tagged', methods: [ 'GET' ], requestHandlers: [ () => {} ], tags: [ 'api' ] },
            );

            assert(target.hasTag('api'));
        });

        it('uses target-level error handlers without merging route handlers', async () => {
            const handled = { label: 'handled' };
            const target = HttpTarget.fromSpecification(
                makeRouteSpec(),
                {
                    name: 'handler',
                    methods: [ 'GET' ],
                    requestHandlers: [ () => {} ],
                    errorHandlers: [ () => handled ],
                },
            );

            const result = await target.handleError({}, {}, {}, new Error('boom'));

            assertEqual(handled, result);
        });
    });

    describe('async error propagation', ({ it }) => {
        it('rejects when a middleware throws', async () => {
            const target = makeTarget({
                middleware: [
                    () => {
                        throw new Error('middleware failure');
                    },
                ],
            });

            const caught = await catchAsyncError(() => target.invokeMiddleware({}, {}, {}));

            assert(caught, 'expected an error to be thrown');
            assertMatches('middleware failure', caught.message);
        });
    });
});
