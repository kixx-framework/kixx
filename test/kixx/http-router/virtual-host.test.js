import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import VirtualHost from '../../../src/kixx/http-router/virtual-host.js';


function makeVirtualHost(overrides) {
    return new VirtualHost(Object.assign({
        name: 'example',
        hostname: 'com.example.www',
        routes: [ { id: 'route-1' } ],
    }, overrides));
}

function makeTargetSpec(name, methods) {
    return { name, methods: methods ?? [ 'GET' ], requestHandlers: [ () => {} ] };
}

function makeLeafRouteSpec(pattern, overrides) {
    return Object.assign({ pattern, targets: [ makeTargetSpec('get') ] }, overrides);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('VirtualHost', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('exposes name and a frozen copy of routes', () => {
            const routes = [ { id: 'route-1' } ];
            const vhost = makeVirtualHost({ routes });

            assertEqual('example', vhost.name);

            routes.push({ id: 'route-2' });
            assertEqual(1, vhost.routes.length);

            const caught = catchError(() => {
                vhost.routes.push({ id: 'extra' });
            });
            assertEqual('TypeError', caught.name);
        });

        it('throws when neither hostname nor pattern is provided', () => {
            const caught = catchError(() => makeVirtualHost({ hostname: undefined }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when both hostname and pattern are provided', () => {
            const caught = catchError(() => makeVirtualHost({ pattern: 'com.example.:sub' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when name is missing', () => {
            const caught = catchError(() => makeVirtualHost({ name: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when routes is empty', () => {
            const caught = catchError(() => makeVirtualHost({ routes: [] }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('matchHostname', ({ it }) => {
        it('returns an empty params object on an exact reversed match', () => {
            const vhost = makeVirtualHost({ hostname: 'com.example.www' });

            const params = vhost.matchHostname('www.example.com');

            assert(params, 'expected a match');
            assertEqual(0, Object.keys(params).length);
        });

        it('returns null when the hostname does not match', () => {
            const vhost = makeVirtualHost({ hostname: 'com.example.www' });

            assertEqual(null, vhost.matchHostname('www.other.com'));
        });

        it('matches any hostname for the "*" wildcard', () => {
            const vhost = makeVirtualHost({ hostname: '*' });

            assert(vhost.matchHostname('anything.test'));
            assert(vhost.matchHostname('www.example.com'));
        });

        it('returns captured params for a pattern match', () => {
            const vhost = makeVirtualHost({ hostname: undefined, pattern: 'com.example.:sub' });

            const params = vhost.matchHostname('acme.example.com');

            assertEqual('acme', params.sub);
        });

        it('returns null for a non-matching pattern', () => {
            const vhost = makeVirtualHost({ hostname: undefined, pattern: 'com.example.:sub' });

            assertEqual(null, vhost.matchHostname('acme.other.com'));
        });
    });

    describe('fromSpecification', ({ it }) => {
        it('throws when neither hostname nor pattern is provided', () => {
            const caught = catchError(() => {
                VirtualHost.fromSpecification({ routes: [ makeLeafRouteSpec('/') ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when both hostname and pattern are provided', () => {
            const caught = catchError(() => {
                VirtualHost.fromSpecification({
                    hostname: 'example.com',
                    pattern: ':sub.example.com',
                    routes: [ makeLeafRouteSpec('/') ],
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when routes is not an Array', () => {
            const caught = catchError(() => {
                VirtualHost.fromSpecification({ hostname: 'example.com', routes: 'nope' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('throws when routes is empty', () => {
            const caught = catchError(() => {
                VirtualHost.fromSpecification({ hostname: 'example.com', routes: [] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
        });

        it('reverses the exact hostname so matching accepts the normal form', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'www.example.com',
                routes: [ makeLeafRouteSpec('/users/:id') ],
            });

            assert(vhost.matchHostname('www.example.com'), 'expected the configured host to match');
            assertEqual(null, vhost.matchHostname('www.other.com'));
        });

        it('defaults the name to the hostname', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'www.example.com',
                routes: [ makeLeafRouteSpec('/') ],
            });

            assertEqual('www.example.com', vhost.name);
        });

        it('flattens nested routes and joins parent and child patterns', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    { pattern: '/api', routes: [ makeLeafRouteSpec('/users/:id') ] },
                ],
            });

            assertEqual(1, vhost.routes.length);
            assertEqual('/api/users/:id', vhost.routes[0].pattern);
            assert(vhost.routes[0].matchPathname('/api/users/9'), 'expected the joined pattern to match');
        });

        it('joins parent and child names with a single slash', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    { pattern: '/api', routes: [ makeLeafRouteSpec('/users/:id') ] },
                ],
            });

            assertEqual('/api/users/:id', vhost.routes[0].name);
        });

        it('appends a wildcard segment when a child pattern is "*"', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    { pattern: '/api', routes: [ makeLeafRouteSpec('*') ] },
                ],
            });

            assertEqual('/api{/*path}', vhost.routes[0].pattern);
            assert(vhost.routes[0].matchPathname('/api/anything'), 'expected the wildcard to match');
        });

        it('does not constrain a child pattern when the parent pattern is "*"', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    { pattern: '*', routes: [ makeLeafRouteSpec('/users/:id') ] },
                ],
            });

            assertEqual('/users/:id', vhost.routes[0].pattern);
        });

        it('produces one flattened route per leaf', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [ makeLeafRouteSpec('/a'), makeLeafRouteSpec('/b') ],
            });

            assertEqual(2, vhost.routes.length);
            assertEqual('/a', vhost.routes[0].pattern);
            assertEqual('/b', vhost.routes[1].pattern);
        });

        it('composes middleware outside-in inbound and inside-out outbound', async () => {
            const order = [];
            const mark = (label) => (_ctx, _req, res) => {
                order.push(label);
                return res;
            };

            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    {
                        pattern: '/api',
                        inboundMiddleware: [ mark('parentIn') ],
                        outboundMiddleware: [ mark('parentOut') ],
                        routes: [
                            {
                                pattern: '/users',
                                inboundMiddleware: [ mark('childIn') ],
                                outboundMiddleware: [ mark('childOut') ],
                                targets: [ { name: 'get', methods: [ 'GET' ], requestHandlers: [ mark('handler') ] } ],
                            },
                        ],
                    },
                ],
            });

            await vhost.routes[0].targets[0].invokeMiddleware({}, {}, { label: 'res' });

            assertEqual('parentIn,childIn,handler,childOut,parentOut', order.join(','));
        });

        it('runs composed outbound middleware even when a handler calls skip', async () => {
            const order = [];
            const mark = (label) => (_ctx, _req, res) => {
                order.push(label);
                return res;
            };
            const skippingHandler = (_ctx, _req, res, skip) => {
                order.push('handler');
                skip();
                return res;
            };

            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    {
                        pattern: '/api',
                        inboundMiddleware: [ mark('parentIn') ],
                        outboundMiddleware: [ mark('parentOut') ],
                        routes: [
                            {
                                pattern: '/users',
                                inboundMiddleware: [ mark('childIn') ],
                                outboundMiddleware: [ mark('childOut') ],
                                targets: [
                                    {
                                        name: 'get',
                                        methods: [ 'GET' ],
                                        requestHandlers: [ skippingHandler, mark('unreached') ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            await vhost.routes[0].targets[0].invokeMiddleware({}, {}, { label: 'res' });

            // skip() stops the second handler, but the full composed outbound
            // chain (inside-out: childOut then parentOut) still runs.
            assertEqual('parentIn,childIn,handler,childOut,parentOut', order.join(','));
        });

        it('validates nested target specifications', () => {
            const caught = catchError(() => {
                VirtualHost.fromSpecification({
                    hostname: 'example.com',
                    routes: [ { pattern: '/users', targets: [ { name: 'get', methods: 'BAD', requestHandlers: [] } ] } ],
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertMatches('.methods', caught.message);
        });
    });
});
