import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual, assertArray, assertMatches } from 'kixx-assert';
import HttpRouter from '../../../lib/http-router/http-router.js';


function createRequest(overrides = {}) {
    const request = {
        id: 'test-request-id',
        method: 'GET',
        url: {
            hostname: 'www.example.com',
            pathname: '/users',
        },
        ...overrides,
    };
    request.setHostnameParams = sinon.stub().returns(request);
    request.setPathnameParams = sinon.stub().returns(request);
    return request;
}

function createResponse() {
    const jsonResponse = { _type: 'json-response' };
    return {
        _jsonResponse: jsonResponse,
        setHeader: sinon.stub().returnsThis(),
        respondWithJSON: sinon.stub().returns(jsonResponse),
    };
}

function createAppContext() {
    const requestContext = { _type: 'request-context' };
    return {
        _requestContext: requestContext,
        cloneToRequestContext: sinon.stub().returns(requestContext),
    };
}

function createStore(specs = []) {
    return {
        loadVirtualHosts: sinon.stub().resolves(specs),
    };
}

function createRouteSpec(overrides = {}) {
    return {
        name: 'users-route',
        pattern: '/users',
        inboundMiddleware: [],
        outboundMiddleware: [],
        errorHandlers: [],
        targets: [
            { name: 'get-users', methods: [ 'GET' ], handlers: [], errorHandlers: [] },
        ],
        ...overrides,
    };
}

function createVhostSpec(overrides = {}) {
    return {
        name: 'test-vhost',
        hostname: 'com.example.www',
        routes: [ createRouteSpec() ],
        ...overrides,
    };
}

function createRouter({ store, middleware, handlers, errorHandlers } = {}) {
    return new HttpRouter({
        store: store || createStore([ createVhostSpec() ]),
        middleware: middleware || new Map(),
        handlers: handlers || new Map(),
        errorHandlers: errorHandlers || new Map(),
    });
}


// ===========================================================================
// Constructor
// ===========================================================================

describe('HttpRouter constructor when store is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRouter({
                store: null,
                middleware: new Map(),
                handlers: new Map(),
                errorHandlers: new Map(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRouter constructor when middleware is not a Map', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRouter({
                store: createStore(),
                middleware: [],
                handlers: new Map(),
                errorHandlers: new Map(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRouter constructor when handlers is not a Map', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRouter({
                store: createStore(),
                middleware: new Map(),
                handlers: [],
                errorHandlers: new Map(),
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('HttpRouter constructor when errorHandlers is not a Map', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new HttpRouter({
                store: createStore(),
                middleware: new Map(),
                handlers: new Map(),
                errorHandlers: [],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});


// ===========================================================================
// handleRequest() - happy path
// ===========================================================================

describe('HttpRouter#handleRequest() successful request', ({ before, it }) => {
    const store = createStore([{
        name: 'test-vhost',
        pattern: 'com.example.:subdomain',
        routes: [ createRouteSpec({ pattern: '/users/:id' }) ],
    }]);

    const appContext = createAppContext();
    const request = createRequest({ url: { hostname: 'api.example.com', pathname: '/users/abc123' } });
    const response = createResponse();
    let result;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        result = await router.handleRequest(appContext, request, response);
    });

    it('calls store.loadVirtualHosts() to load routes', () => {
        assertEqual(1, store.loadVirtualHosts.callCount);
    });

    it('sets hostname params from the matched virtual host', () => {
        assertEqual('api', request.setHostnameParams.getCall(0).firstArg.subdomain);
    });

    it('sets pathname params from the matched route', () => {
        assertEqual('abc123', request.setPathnameParams.getCall(0).firstArg.id);
    });

    it('clones the app context with the matched virtual host routes', () => {
        assertArray(appContext.cloneToRequestContext.getCall(0).firstArg);
    });

    it('returns the response', () => assertEqual(response, result));
});


// ===========================================================================
// handleRequest() - route caching
// ===========================================================================

describe('HttpRouter#handleRequest() caches loaded routes across requests', ({ before, it }) => {
    const store = createStore([ createVhostSpec() ]);

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        await router.handleRequest(createAppContext(), createRequest(), createResponse());
        await router.handleRequest(createAppContext(), createRequest(), createResponse());
    });

    it('only calls store.loadVirtualHosts() once across multiple requests', () => {
        assertEqual(1, store.loadVirtualHosts.callCount);
    });
});


// ===========================================================================
// handleRequest() - virtual host fallback
// ===========================================================================

describe('HttpRouter#handleRequest() when hostname does not match any virtual host', ({ before, it }) => {
    // Single vhost with a specific hostname that won't match the request
    const store = createStore([
        createVhostSpec({ hostname: 'com.example.specific' }),
    ]);
    const response = createResponse();
    let result;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        // Hostname does not match 'specific.example.com', but /users route exists in the first vhost
        const request = createRequest({ url: { hostname: 'unrelated.example.com', pathname: '/users' } });
        result = await router.handleRequest(createAppContext(), request, response);
    });

    it('falls back to the first virtual host and handles the request', () => {
        assertEqual(response, result);
    });
});


// ===========================================================================
// handleRequest() - no route found
// ===========================================================================

describe('HttpRouter#handleRequest() when no route matches the pathname', ({ before, it }) => {
    const request = createRequest({ url: { hostname: 'www.example.com', pathname: '/nonexistent' } });
    const response = createResponse();
    let capturedEvent;
    let result;

    before(async () => {
        const router = createRouter();
        router.on('error', (event) => {
            capturedEvent = event;
        });
        result = await router.handleRequest(createAppContext(), request, response);
    });

    it('emits an error event with a NotFoundError', () => {
        assertEqual('NotFoundError', capturedEvent.error.name);
    });

    it('includes the request id in the error event', () => {
        assertEqual(request.id, capturedEvent.requestId);
    });

    it('returns a JSON error response', () => assertEqual(response._jsonResponse, result));

    it('responds with status 404', () => {
        assertEqual(404, response.respondWithJSON.getCall(0).args[0]);
    });
});


// ===========================================================================
// handleRequest() - method not allowed
// ===========================================================================

describe('HttpRouter#handleRequest() when HTTP method is not allowed', ({ before, it }) => {
    // Route exists for /users but only allows GET; request uses DELETE
    const request = createRequest({ method: 'DELETE', url: { hostname: 'www.example.com', pathname: '/users' } });
    const response = createResponse();
    let capturedEvent;
    let result;

    before(async () => {
        const router = createRouter();
        router.on('error', (event) => {
            capturedEvent = event;
        });
        result = await router.handleRequest(createAppContext(), request, response);
    });

    it('emits an error event with a MethodNotAllowedError', () => {
        assertEqual('MethodNotAllowedError', capturedEvent.error.name);
    });

    it('returns a JSON error response', () => assertEqual(response._jsonResponse, result));

    it('responds with status 405', () => {
        assertEqual(405, response.respondWithJSON.getCall(0).args[0]);
    });

    it('sets the Allow response header', () => {
        assertEqual('allow', response.setHeader.getCall(0).args[0]);
        assertMatches('GET', response.setHeader.getCall(0).args[1]);
    });
});

describe('HttpRouter#handleRequest() when method is not allowed and the route has an error handler', ({ before, it }) => {
    const routeHandledResponse = { _type: 'route-handled-response' };
    const routeErrorHandler = sinon.fake.resolves(routeHandledResponse);

    const store = createStore([
        createVhostSpec({
            routes: [ createRouteSpec({ errorHandlers: [ routeErrorHandler ] }) ],
        }),
    ]);

    let result;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        router.on('error', () => {});
        // POST is not allowed — only GET is registered
        const request = createRequest({ method: 'POST', url: { hostname: 'www.example.com', pathname: '/users' } });
        result = await router.handleRequest(createAppContext(), request, createResponse());
    });

    it('invokes the route-level error handler', () => assertEqual(1, routeErrorHandler.callCount));

    it('returns the response from the route error handler', () => assertEqual(routeHandledResponse, result));
});


// ===========================================================================
// handleRequest() - middleware error, target handles it
// ===========================================================================

describe('HttpRouter#handleRequest() when middleware throws and the target handles the error', ({ before, it }) => {
    const targetHandledResponse = { _type: 'target-handled-response' };
    const targetErrorHandler = sinon.fake.resolves(targetHandledResponse);
    const throwingHandler = sinon.fake.rejects(
        Object.assign(new Error('handler error'), { httpError: true, httpStatusCode: 500 })
    );

    const store = createStore([
        createVhostSpec({
            routes: [
                createRouteSpec({
                    targets: [
                        { name: 'get-users', methods: [ 'GET' ], handlers: [ throwingHandler ], errorHandlers: [ targetErrorHandler ] },
                    ],
                }),
            ],
        }),
    ]);

    let result;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        router.on('error', () => {});
        result = await router.handleRequest(createAppContext(), createRequest(), createResponse());
    });

    it('invokes the target error handler', () => assertEqual(1, targetErrorHandler.callCount));

    it('returns the response from the target error handler', () => assertEqual(targetHandledResponse, result));
});


// ===========================================================================
// handleRequest() - middleware error, router handles it
// ===========================================================================

describe('HttpRouter#handleRequest() when middleware throws an HTTP error and no custom error handler handles it', ({ before, it }) => {
    const throwingHandler = sinon.fake.rejects(
        Object.assign(new Error('not found'), {
            httpError: true,
            httpStatusCode: 404,
            code: 'NOT_FOUND',
            name: 'NotFoundError',
        })
    );

    const store = createStore([
        createVhostSpec({
            routes: [
                createRouteSpec({
                    targets: [
                        { name: 'get-users', methods: [ 'GET' ], handlers: [ throwingHandler ], errorHandlers: [] },
                    ],
                }),
            ],
        }),
    ]);

    const response = createResponse();
    let result;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        router.on('error', () => {});
        result = await router.handleRequest(createAppContext(), createRequest(), response);
    });

    it('returns a JSON error response from the router', () => assertEqual(response._jsonResponse, result));

    it('responds with the error status code', () => {
        assertEqual(404, response.respondWithJSON.getCall(0).args[0]);
    });
});


// ===========================================================================
// handleRequest() - unexpected error rethrown
// ===========================================================================

describe('HttpRouter#handleRequest() when an unexpected (non-HTTP) error occurs', ({ before, it }) => {
    const unexpectedError = new Error('database crashed'); // No httpError or expected flag
    const throwingHandler = sinon.fake.rejects(unexpectedError);

    const store = createStore([
        createVhostSpec({
            routes: [
                createRouteSpec({
                    targets: [
                        { name: 'get-users', methods: [ 'GET' ], handlers: [ throwingHandler ], errorHandlers: [] },
                    ],
                }),
            ],
        }),
    ]);

    let caughtError;

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        router.on('error', () => {});
        try {
            await router.handleRequest(createAppContext(), createRequest(), createResponse());
        } catch (err) {
            caughtError = err;
        }
    });

    it('rethrows the unexpected error to the caller', () => assertEqual(unexpectedError, caughtError));
});


// ===========================================================================
// reloadRoutesAndHandleRequest()
// ===========================================================================

describe('HttpRouter#reloadRoutesAndHandleRequest() always reloads routes', ({ before, it }) => {
    const store = createStore([ createVhostSpec() ]);

    before(async () => {
        const router = new HttpRouter({
            store,
            middleware: new Map(),
            handlers: new Map(),
            errorHandlers: new Map(),
        });
        // Prime the route cache with a first request
        await router.handleRequest(createAppContext(), createRequest(), createResponse());
        // Reload should force a fresh load even though routes are cached
        await router.reloadRoutesAndHandleRequest(createAppContext(), createRequest(), createResponse());
    });

    it('calls store.loadVirtualHosts() again even when routes are already cached', () => {
        assertEqual(2, store.loadVirtualHosts.callCount);
    });
});


// ===========================================================================
// handleError()
// ===========================================================================

describe('HttpRouter#handleError() when error has neither httpError nor expected flag', ({ it }) => {
    it('returns false', () => {
        const router = createRouter();
        const error = new Error('unexpected internal error');
        const result = router.handleError({}, {}, createResponse(), error);
        assertEqual(false, result);
    });
});

describe('HttpRouter#handleError() when error has the httpError flag', ({ before, it }) => {
    const router = createRouter();
    const response = createResponse();
    const error = Object.assign(new Error('not found'), {
        httpError: true,
        httpStatusCode: 404,
        code: 'NOT_FOUND',
        name: 'NotFoundError',
        source: null,
    });
    let result;

    before(() => {
        result = router.handleError({}, {}, response, error);
    });

    it('returns the JSON response', () => assertEqual(response._jsonResponse, result));

    it('responds with the error status code', () => {
        assertEqual(404, response.respondWithJSON.getCall(0).args[0]);
    });
});

describe('HttpRouter#handleError() when error has the expected flag', ({ before, it }) => {
    const router = createRouter();
    const response = createResponse();
    const error = Object.assign(new Error('expected issue'), {
        expected: true,
        httpStatusCode: 400,
        source: null,
    });
    let result;

    before(() => {
        result = router.handleError({}, {}, response, error);
    });

    it('returns the JSON response', () => assertEqual(response._jsonResponse, result));

    it('responds with the error status code', () => {
        assertEqual(400, response.respondWithJSON.getCall(0).args[0]);
    });
});

describe('HttpRouter#handleError() when status is 405 and allowedMethods is present', ({ before, it }) => {
    const router = createRouter();
    const response = createResponse();
    const error = Object.assign(new Error('method not allowed'), {
        httpError: true,
        httpStatusCode: 405,
        allowedMethods: [ 'GET', 'POST' ],
        source: null,
    });

    before(() => {
        router.handleError({}, {}, response, error);
    });

    it('sets the Allow header', () => {
        assertEqual('allow', response.setHeader.getCall(0).args[0]);
    });

    it('includes all allowed methods in the Allow header', () => {
        assertEqual('GET, POST', response.setHeader.getCall(0).args[1]);
    });
});

describe('HttpRouter#handleError() when status is 405 but allowedMethods is not present', ({ before, it }) => {
    const router = createRouter();
    const response = createResponse();
    const error = Object.assign(new Error('method not allowed'), {
        httpError: true,
        httpStatusCode: 405,
        source: null,
        // No allowedMethods
    });

    before(() => {
        router.handleError({}, {}, response, error);
    });

    it('does not set the Allow header', () => assertEqual(0, response.setHeader.callCount));
});

describe('HttpRouter#handleError() when error has an errors array', ({ before, it }) => {
    const router = createRouter();
    const response = createResponse();
    const error = Object.assign(new Error('validation failed'), {
        httpError: true,
        httpStatusCode: 422,
        errors: [
            { httpError: true, httpStatusCode: 422, code: 'REQUIRED', name: 'ValidationError', message: 'Field required', source: null },
            { httpError: true, httpStatusCode: 422, code: 'TOO_SHORT', name: 'ValidationError', message: 'Value too short', source: null },
        ],
        source: null,
    });

    before(() => {
        router.handleError({}, {}, response, error);
    });

    it('responds with the error status code', () => {
        assertEqual(422, response.respondWithJSON.getCall(0).args[0]);
    });

    it('maps all child errors into the response body', () => {
        const body = response.respondWithJSON.getCall(0).args[1];
        assertArray(body.errors);
        assertEqual(2, body.errors.length);
    });
});


// ===========================================================================
// mapErrorToJsonError()
// ===========================================================================

describe('HttpRouter.mapErrorToJsonError() with an httpError', ({ it }) => {
    const error = {
        httpError: true,
        httpStatusCode: 403,
        code: 'FORBIDDEN',
        name: 'ForbiddenError',
        message: 'Access denied',
        source: { pointer: '/data/id' },
    };

    const result = HttpRouter.mapErrorToJsonError(error);

    it('uses the error status code', () => assertEqual(403, result.status));
    it('uses the error code', () => assertEqual('FORBIDDEN', result.code));
    it('uses the error name as title', () => assertEqual('ForbiddenError', result.title));
    it('uses the error message as detail', () => assertEqual('Access denied', result.detail));
    it('passes through the error source', () => assertEqual(error.source, result.source));
});

describe('HttpRouter.mapErrorToJsonError() with a non-HTTP error', ({ it }) => {
    const error = {
        httpError: false,
        httpStatusCode: null,
        code: 'SOME_INTERNAL_CODE',
        name: 'TypeError',
        message: 'Cannot read property x of undefined',
        source: null,
    };

    const result = HttpRouter.mapErrorToJsonError(error);

    it('uses status 500', () => assertEqual(500, result.status));
    it('uses INTERNAL_SERVER_ERROR code', () => assertEqual('INTERNAL_SERVER_ERROR', result.code));
    it('uses InternalServerError as title', () => assertEqual('InternalServerError', result.title));
    it('uses a generic detail message', () => assertEqual('Internal server error', result.detail));
    it('passes through the source', () => assertEqual(null, result.source));
});
