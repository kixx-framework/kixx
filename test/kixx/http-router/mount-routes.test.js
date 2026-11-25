import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import { mountRoutes } from '../../../kixx/http-router/mount-routes.js';
import VirtualHost from '../../../kixx/http-router/virtual-host.js';


function makeLeafRouteSpec(pattern, overrides) {
    return Object.assign({
        pattern,
        targets: [ { name: 'get', methods: [ 'GET' ], requestHandlers: [ () => {} ] } ],
    }, overrides);
}

function mount(overrides) {
    return mountRoutes(Object.assign({
        plugin: 'visits',
        module: './routes.js',
        mount: '/visits',
        name: 'visits',
        routes: [ makeLeafRouteSpec('/') ],
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

function assertShapeError(caught, matcher) {
    assert(caught, 'expected an error to be thrown');
    assertEqual('AssertionError', caught.name);
    assertMatches('plugin "visits" routes module ./routes.js', caught.message);
    assertMatches(matcher, caught.message);
}


describe('mountRoutes', ({ describe }) => {

    describe('without a mount', ({ it }) => {
        it('returns the Array of route specifications as it is', () => {
            const routes = [ makeLeafRouteSpec('/a'), makeLeafRouteSpec('/b') ];

            const result = mount({ mount: undefined, name: undefined, routes });

            assertEqual(routes, result);
        });

        it('throws when the default export is not an Array', () => {
            const notArrays = [
                undefined,
                null,
                'routes',
                () => [],
                { routes: [ makeLeafRouteSpec('/a') ] },
            ];

            for (const routes of notArrays) {
                const caught = catchError(() => mount({ mount: undefined, name: undefined, routes }));

                assertShapeError(caught, 'must export default an Array of route specifications');
            }
        });
    });

    describe('with a mount and an Array', ({ it }) => {
        it('returns one route that nests the Array under the mount', () => {
            const routes = [ makeLeafRouteSpec('/a'), makeLeafRouteSpec('/b') ];

            const result = mount({ routes });

            assertEqual(1, result.length);
            assertEqual('/visits', result[0].pattern);
            assertEqual('visits', result[0].name);
            assertEqual(routes, result[0].routes);
            assertEqual('name,pattern,routes', Object.keys(result[0]).sort().join(','));
        });
    });

    describe('with a mount and an Object', ({ it }) => {
        it('nests the routes list under the mount', () => {
            const routes = [ makeLeafRouteSpec('/a') ];

            const result = mount({ routes: { routes } });

            assertEqual(1, result.length);
            assertEqual('/visits', result[0].pattern);
            assertEqual('visits', result[0].name);
            assertEqual(routes, result[0].routes);
            assertEqual('name,pattern,routes', Object.keys(result[0]).sort().join(','));
        });

        it('carries over inboundMiddleware', () => {
            const inboundMiddleware = [ () => {} ];

            const [ route ] = mount({ routes: { routes: [ makeLeafRouteSpec('/a') ], inboundMiddleware } });

            assertEqual(inboundMiddleware, route.inboundMiddleware);
            assertEqual('inboundMiddleware,name,pattern,routes', Object.keys(route).sort().join(','));
        });

        it('carries over outboundMiddleware', () => {
            const outboundMiddleware = [ () => {} ];

            const [ route ] = mount({ routes: { routes: [ makeLeafRouteSpec('/a') ], outboundMiddleware } });

            assertEqual(outboundMiddleware, route.outboundMiddleware);
            assertEqual('name,outboundMiddleware,pattern,routes', Object.keys(route).sort().join(','));
        });

        it('carries over errorHandlers', () => {
            const errorHandlers = [ () => {} ];

            const [ route ] = mount({ routes: { routes: [ makeLeafRouteSpec('/a') ], errorHandlers } });

            assertEqual(errorHandlers, route.errorHandlers);
            assertEqual('errorHandlers,name,pattern,routes', Object.keys(route).sort().join(','));
        });

        it('does not mutate the default export', () => {
            const exported = Object.freeze({
                routes: Object.freeze([ Object.freeze(makeLeafRouteSpec('/a')) ]),
                inboundMiddleware: Object.freeze([ () => {} ]),
            });

            const [ route ] = mount({ routes: exported });

            assert(route !== exported, 'expected a new route specification');
            assertEqual('inboundMiddleware,routes', Object.keys(exported).sort().join(','));
        });

        it('throws when the default export is neither an Array nor an Object', () => {
            for (const routes of [ undefined, null, 'routes', () => [] ]) {
                const caught = catchError(() => mount({ routes }));

                assertShapeError(caught, 'or an Object with a routes Array');
            }
        });

        it('throws when the Object has no routes Array', () => {
            for (const routes of [ {}, { routes: 'routes' }, { inboundMiddleware: [] } ]) {
                const caught = catchError(() => mount({ routes }));

                assertShapeError(caught, 'must have a routes Array');
            }
        });

        it('throws when the Object has any other key', () => {
            for (const key of [ 'pattern', 'name', 'targets' ]) {
                const caught = catchError(() => {
                    mount({ routes: { routes: [ makeLeafRouteSpec('/a') ], [key]: 'x' } });
                });

                assertShapeError(caught, `unexpected key "${ key }"`);
            }
        });
    });

    describe('in a router', ({ it }) => {
        function mark(order, label) {
            return (_context, _request, response) => {
                order.push(label);
                return response;
            };
        }

        it('appends each child pattern and name to the mount', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    ...mount({ routes: [ makeLeafRouteSpec('/', { name: 'index' }), makeLeafRouteSpec('/:id') ] }),
                ],
            });

            assertEqual(2, vhost.routes.length);
            assertEqual('/visits/', vhost.routes[0].pattern);
            assertEqual('visits/index', vhost.routes[0].name);
            assertEqual('/visits/:id', vhost.routes[1].pattern);
            assertEqual('7', vhost.routes[1].matchPathname('/visits/7').id);
        });

        it('runs mount-level inbound middleware before a child route', async () => {
            const order = [];

            const routes = {
                inboundMiddleware: [ mark(order, 'mountIn') ],
                outboundMiddleware: [ mark(order, 'mountOut') ],
                routes: [
                    {
                        pattern: '/:id',
                        inboundMiddleware: [ mark(order, 'childIn') ],
                        outboundMiddleware: [ mark(order, 'childOut') ],
                        targets: [
                            { name: 'get', methods: [ 'GET' ], requestHandlers: [ mark(order, 'handler') ] },
                        ],
                    },
                ],
            };

            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [ ...mount({ routes }) ],
            });

            await vhost.routes[0].targets[0].invokeMiddleware({}, {}, { label: 'res' });

            assertEqual('mountIn,childIn,handler,childOut,mountOut', order.join(','));
        });

        it('tries a child error handler before the mount-level one', async () => {
            const order = [];

            const routes = {
                errorHandlers: [ mark(order, 'mountError') ],
                routes: [ makeLeafRouteSpec('/:id', { errorHandlers: [ mark(order, 'childError') ] }) ],
            };

            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [ ...mount({ routes }) ],
            });

            // Neither handler returns a response, so the route tries both in order.
            await vhost.routes[0].handleError({}, {}, null, new Error('test'));

            assertEqual('childError,mountError', order.join(','));
        });

        it('leaves unmounted routes where the plugin put them', () => {
            const vhost = VirtualHost.fromSpecification({
                hostname: 'example.com',
                routes: [
                    ...mount({ mount: undefined, name: undefined, routes: [ makeLeafRouteSpec('/visits/:id') ] }),
                ],
            });

            assertEqual('/visits/:id', vhost.routes[0].pattern);
        });
    });
});
