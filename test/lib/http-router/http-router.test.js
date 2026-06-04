import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import HttpRouter from '../../../lib/http-router/http-router.js';
import ServerResponse from '../../../lib/http-router/server-response.js';
import { MethodNotAllowedError, NotFoundError } from '../../../lib/errors/mod.js';


function makeContext() {
    return {
        routes: null,
        useRoutes(routes) {
            this.routes = routes;
            return this;
        },
    };
}

function makeRequest(overrides) {
    const opts = Object.assign({
        id: 'req-1',
        method: 'GET',
        hostname: 'www.example.com',
        pathname: '/',
    }, overrides);

    return {
        id: opts.id,
        method: opts.method,
        url: { hostname: opts.hostname, pathname: opts.pathname },
        hostnameParams: null,
        pathnameParams: null,
        setHostnameParams(params) {
            this.hostnameParams = params;
            return this;
        },
        setPathnameParams(params) {
            this.pathnameParams = params;
            return this;
        },
    };
}

function makeTargetSpec(overrides) {
    return Object.assign({
        name: 'target',
        methods: [ 'GET' ],
        requestHandlers: [ (_ctx, _req, res) => res ],
    }, overrides);
}

function makeRouter(routeSpecs) {
    const router = new HttpRouter([ { hostname: 'www.example.com', routes: routeSpecs } ]);
    // The router emits 'error' before running its cascade, and the EventEmitter
    // throws the payload when 'error' has no listener. Subscribe like the
    // platform server does so the cascade under test can run.
    router.on('error', () => {});
    return router;
}

function makeBasicRouter() {
    return makeRouter([ { pattern: '*', targets: [ makeTargetSpec() ] } ]);
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


describe('HttpRouter', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('throws an AssertionError when config is not an Array', () => {
            const caught = catchError(() => new HttpRouter('nope'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when config is empty', () => {
            const caught = catchError(() => new HttpRouter([]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('on', ({ it }) => {
        it('returns this for chaining', () => {
            const router = makeBasicRouter();

            assertEqual(router, router.on('error', () => {}));
        });
    });

    describe('handleRequest routing', ({ it }) => {
        it('routes a matching request to its target middleware', async () => {
            const handler = (_ctx, _req, res) => res.respondWithJSON(200, { ok: true });
            const router = makeRouter([
                { pattern: '/users/:id', targets: [ makeTargetSpec({ requestHandlers: [ handler ] }) ] },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ pathname: '/users/42' }), new ServerResponse());

            assertEqual(200, response.status);
            assertEqual(true, JSON.parse(response.body).ok);
        });

        it('attaches hostname and pathname params before middleware runs', async () => {
            let seen = null;
            const handler = (_ctx, req, res) => {
                seen = req.pathnameParams;
                return res;
            };
            const router = makeRouter([
                { pattern: '/users/:id', targets: [ makeTargetSpec({ requestHandlers: [ handler ] }) ] },
            ]);
            const request = makeRequest({ pathname: '/users/42' });

            await router.handleRequest(makeContext(), request, new ServerResponse());

            assertEqual('42', seen.id);
            assertEqual('42', request.pathnameParams.id);
        });

        it('injects the matched virtual host routes into the context', async () => {
            const context = makeContext();
            const router = makeRouter([
                { pattern: '/', targets: [ makeTargetSpec() ] },
            ]);

            await router.handleRequest(context, makeRequest({ pathname: '/' }), new ServerResponse());

            assert(context.routes, 'expected routes to be injected');
            assertEqual(1, context.routes.length);
        });

        it('serves a request with an unmatched hostname using the first virtual host', async () => {
            const router = new HttpRouter([
                {
                    hostname: 'first.example.com',
                    routes: [ { pattern: '*', targets: [ makeTargetSpec({ requestHandlers: [ (_ctx, _req, res) => res.respondWithJSON(200, { host: 'default' }) ] }) ] } ],
                },
                {
                    hostname: 'second.example.com',
                    routes: [ { pattern: '*', targets: [ makeTargetSpec() ] } ],
                },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ hostname: 'unknown.test' }), new ServerResponse());

            assertEqual('default', JSON.parse(response.body).host);
        });
    });

    describe('handleRequest error handling', ({ it }) => {
        it('returns a JSON 404 when no route matches', async () => {
            const router = makeRouter([
                { pattern: '/users/:id', targets: [ makeTargetSpec() ] },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ pathname: '/missing' }), new ServerResponse());

            assertEqual(404, response.status);
            assertEqual('404', JSON.parse(response.body).errors[0].status);
        });

        it('returns a JSON 405 with an Allow header when the method is not allowed', async () => {
            const router = makeRouter([
                { pattern: '/users', targets: [ makeTargetSpec({ methods: [ 'GET' ] }) ] },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ method: 'POST', pathname: '/users' }), new ServerResponse());

            assertEqual(405, response.status);
            assertMatches('GET', response.headers.get('allow'));
            assertEqual('405', JSON.parse(response.body).errors[0].status);
        });

        it('emits an error event carrying the request id', async () => {
            let event = null;
            const router = makeRouter([
                { pattern: '/users/:id', targets: [ makeTargetSpec() ] },
            ]);
            router.on('error', (payload) => {
                event = payload;
            });

            await router.handleRequest(makeContext(), makeRequest({ pathname: '/missing' }), new ServerResponse());

            assert(event, 'expected an error event');
            assertEqual('req-1', event.requestId);
            assertEqual('NotFoundError', event.error.name);
        });

        it('lets a target error handler resolve the error first', async () => {
            const boom = () => {
                throw new Error('boom');
            };
            const targetHandler = (_ctx, _req, res) => res.respondWithJSON(503, { by: 'target' });
            const router = makeRouter([
                {
                    pattern: '/x',
                    targets: [ makeTargetSpec({ requestHandlers: [ boom ], errorHandlers: [ targetHandler ] }) ],
                },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ pathname: '/x' }), new ServerResponse());

            assertEqual(503, response.status);
            assertEqual('target', JSON.parse(response.body).by);
        });

        it('falls through to a route error handler when the target declines', async () => {
            const boom = () => {
                throw new Error('boom');
            };
            const routeHandler = (_ctx, _req, res) => res.respondWithJSON(503, { by: 'route' });
            const router = makeRouter([
                {
                    pattern: '/x',
                    errorHandlers: [ routeHandler ],
                    targets: [ makeTargetSpec({ requestHandlers: [ boom ], errorHandlers: [ () => false ] }) ],
                },
            ]);

            const response = await router.handleRequest(makeContext(), makeRequest({ pathname: '/x' }), new ServerResponse());

            assertEqual('route', JSON.parse(response.body).by);
        });

        it('re-throws an unexpected error when no handler produces a response', async () => {
            const boom = () => {
                throw new Error('unexpected failure');
            };
            const router = makeRouter([
                { pattern: '/x', targets: [ makeTargetSpec({ requestHandlers: [ boom ] }) ] },
            ]);

            const caught = await catchAsyncError(() => {
                return router.handleRequest(makeContext(), makeRequest({ pathname: '/x' }), new ServerResponse());
            });

            assert(caught, 'expected an error to be thrown');
            assertMatches('unexpected failure', caught.message);
        });
    });

    describe('handleError', ({ it }) => {
        it('returns false for a non-HTTP, non-expected error', () => {
            const router = makeBasicRouter();

            assertEqual(false, router.handleError({}, {}, new ServerResponse(), new Error('boom')));
        });

        it('produces a JSON response for an expected HTTP error', () => {
            const router = makeBasicRouter();

            const response = router.handleError({}, {}, new ServerResponse(), new NotFoundError('missing'));

            assertEqual(404, response.status);
            assertEqual('404', JSON.parse(response.body).errors[0].status);
        });

        it('sets the Allow header for a 405 error with allowedMethods', () => {
            const router = makeBasicRouter();
            const error = new MethodNotAllowedError('nope', { allowedMethods: [ 'GET', 'POST' ] });

            const response = router.handleError({}, {}, new ServerResponse(), error);

            assertEqual(405, response.status);
            assertEqual('GET, POST', response.headers.get('allow'));
        });
    });

    describe('mapErrorToJsonError', ({ it }) => {
        it('maps an HTTP error to its public fields', () => {
            const json = HttpRouter.mapErrorToJsonError(new NotFoundError('missing'));

            assertEqual('404', json.status);
            assertEqual('NOT_FOUND_ERROR', json.code);
            assertEqual('NotFoundError', json.title);
            assertEqual('missing', json.detail);
        });

        it('hides internal details for a non-HTTP error', () => {
            const json = HttpRouter.mapErrorToJsonError(new Error('secret internals'));

            assertEqual('500', json.status);
            assertEqual('INTERNAL_SERVER_ERROR', json.code);
            assertEqual('InternalServerError', json.title);
            assertEqual('Internal server error', json.detail);
        });
    });
});
