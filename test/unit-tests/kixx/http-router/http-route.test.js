import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import HttpRoute from '../../../src/kixx/http-router/http-route.js';


function makeTargetDouble(name, methods) {
    const allowedMethods = methods ?? [ 'GET' ];
    return {
        name,
        allowedMethods,
        isMethodAllowed(method) {
            return allowedMethods.includes(method);
        },
    };
}

function makeRoute(overrides) {
    return new HttpRoute(Object.assign({
        name: 'users',
        pattern: '/users/:id',
        targets: [ makeTargetDouble('users/get', [ 'GET' ]) ],
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


describe('HttpRoute', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('exposes name, pattern, and targets', () => {
            const target = makeTargetDouble('users/get');
            const route = makeRoute({ targets: [ target ] });

            assertEqual('users', route.name);
            assertEqual('/users/:id', route.pattern);
            assertEqual(1, route.targets.length);
            assertEqual(target, route.targets[0]);
        });

        it('freezes a copy of targets', () => {
            const targets = [ makeTargetDouble('users/get') ];
            const route = makeRoute({ targets });

            targets.push(makeTargetDouble('users/post'));
            assertEqual(1, route.targets.length);

            const caught = catchError(() => {
                route.targets.push(makeTargetDouble('extra'));
            });
            assertEqual('TypeError', caught.name);
        });

        it('throws an AssertionError when name is missing', () => {
            const caught = catchError(() => makeRoute({ name: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when pattern is missing', () => {
            const caught = catchError(() => makeRoute({ pattern: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when targets is empty', () => {
            const caught = catchError(() => makeRoute({ targets: [] }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('allowedMethods', ({ it }) => {
        it('aggregates unique methods across all targets', () => {
            const route = makeRoute({
                targets: [
                    makeTargetDouble('a', [ 'GET', 'HEAD' ]),
                    makeTargetDouble('b', [ 'POST', 'GET' ]),
                ],
            });

            assertEqual('GET,HEAD,POST', route.allowedMethods.join(','));
        });
    });

    describe('matchPathname', ({ it }) => {
        it('returns extracted params on a match', () => {
            const route = makeRoute({ pattern: '/users/:id' });

            const params = route.matchPathname('/users/42');

            assertEqual('42', params.id);
        });

        it('returns null when the pathname does not match', () => {
            const route = makeRoute({ pattern: '/users/:id' });

            assertEqual(null, route.matchPathname('/posts/42'));
        });

        it('matches any pathname for the "*" wildcard pattern', () => {
            const route = makeRoute({ pattern: '*' });

            const params = route.matchPathname('/anything/at/all');

            assert(params, 'expected wildcard to match');
            assertEqual(0, Object.keys(params).length);
        });
    });

    describe('findTargetForRequest', ({ it }) => {
        it('returns the first target handling the request method', () => {
            const getTarget = makeTargetDouble('get', [ 'GET' ]);
            const postTarget = makeTargetDouble('post', [ 'POST' ]);
            const route = makeRoute({ targets: [ getTarget, postTarget ] });

            assertEqual(postTarget, route.findTargetForRequest({ method: 'POST' }));
        });

        it('returns null when no target handles the method', () => {
            const route = makeRoute({ targets: [ makeTargetDouble('get', [ 'GET' ]) ] });

            assertEqual(null, route.findTargetForRequest({ method: 'DELETE' }));
        });
    });

    describe('handleError', ({ it }) => {
        it('returns false when there are no error handlers', async () => {
            const route = makeRoute();

            assertEqual(false, await route.handleError({}, {}, {}, new Error('boom')));
        });

        it('returns the first truthy response and stops', async () => {
            const order = [];
            const handled = { label: 'handled' };
            const route = makeRoute({
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

            const result = await route.handleError({}, {}, {}, new Error('boom'));

            assertEqual(handled, result);
            assertEqual('first,second', order.join(','));
        });

        it('returns false when every handler declines', async () => {
            const route = makeRoute({ errorHandlers: [ () => false ] });

            assertEqual(false, await route.handleError({}, {}, {}, new Error('boom')));
        });
    });

    describe('validateSpecification', ({ it }) => {
        function makeSpec(overrides) {
            return Object.assign({
                pattern: '/users/:id',
                targets: [ { name: 'get', methods: [ 'GET' ], requestHandlers: [ () => {} ] } ],
            }, overrides);
        }

        it('accepts a valid leaf specification', () => {
            const caught = catchError(() => HttpRoute.validateSpecification(makeSpec()));

            assertEqual(null, caught);
        });

        it('throws when the spec is not an object', () => {
            const caught = catchError(() => HttpRoute.validateSpecification(null));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when pattern is missing', () => {
            const caught = catchError(() => HttpRoute.validateSpecification(makeSpec({ pattern: '' })));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when inboundMiddleware is not an Array', () => {
            const caught = catchError(() => {
                HttpRoute.validateSpecification(makeSpec({ inboundMiddleware: 'nope' }));
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when a middleware entry is not a function', () => {
            const caught = catchError(() => {
                HttpRoute.validateSpecification(makeSpec({ inboundMiddleware: [ 'nope' ] }));
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when neither routes nor targets are defined', () => {
            const spec = makeSpec();
            delete spec.targets;

            const caught = catchError(() => HttpRoute.validateSpecification(spec));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('routes or route.targets', caught.message);
        });

        it('throws when both routes and targets are defined', () => {
            const caught = catchError(() => {
                HttpRoute.validateSpecification(makeSpec({ routes: [ makeSpec() ] }));
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('both', caught.message);
        });

        it('recurses into nested child routes', () => {
            const spec = {
                pattern: '/api',
                routes: [ { pattern: '/users', targets: [ { name: 'get', methods: 'BAD', requestHandlers: [] } ] } ],
            };

            const caught = catchError(() => HttpRoute.validateSpecification(spec));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when nested routes is empty', () => {
            const caught = catchError(() => {
                HttpRoute.validateSpecification({ pattern: '/api', routes: [] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });
    });

    describe('fromSpecification', ({ it }) => {
        function makeSpec(overrides) {
            return Object.assign({
                name: 'users',
                pattern: '/users/:id',
                targets: [ { name: 'get', methods: [ 'GET' ], requestHandlers: [ () => {} ] } ],
            }, overrides);
        }

        it('builds a route with compiled targets', () => {
            const route = HttpRoute.fromSpecification(makeSpec());

            assertEqual('users', route.name);
            assertEqual('/users/:id', route.pattern);
            assertEqual('users/get', route.targets[0].name);
            assertEqual('GET', route.allowedMethods.join(','));
        });

        it('defaults the route name to the pattern', () => {
            const spec = makeSpec();
            delete spec.name;

            const route = HttpRoute.fromSpecification(spec);

            assertEqual('/users/:id', route.name);
        });

        it('attaches route-level error handlers', async () => {
            const handled = { label: 'handled' };
            const route = HttpRoute.fromSpecification(makeSpec({ errorHandlers: [ () => handled ] }));

            const result = await route.handleError({}, {}, {}, new Error('boom'));

            assertEqual(handled, result);
        });
    });
});
