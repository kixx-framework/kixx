import sinon from 'sinon';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertFunction
} from 'kixx-assert';

import HttpRouter from '../../lib/http-server/http-router.js';
import VirtualHost from '../../lib/http-server/virtual-host.js';
import HttpRoute from '../../lib/http-server/http-route.js';
import HttpTarget from '../../lib/http-server/http-target.js';
import HttpServerRequest from '../../lib/http-server/http-server-request.js';
import HttpServerResponse from '../../lib/http-server/http-server-response.js';
import ApplicationContext from '../../lib/application/application-context.js';
import { NotFoundError, MethodNotAllowedError } from '../../lib/errors/mod.js';


function createApplicationContext() {
    return new ApplicationContext({
        runtime: { server: { name: 'test' } },
        config: {},
        paths: {},
        logger: {},
    });
}

function createRequest(id, url, options = {}) {
    const req = {
        method: options.method || 'GET',
        headers: options.headers || {},
    };
    return new HttpServerRequest(req, url, id);
}

function createMinimalRouterFixture() {
    const middleware = sinon.stub().callsFake((_ctx, _req, res) => res);
    const target = new HttpTarget({
        name: 'test-target',
        allowedMethods: [ 'GET' ],
        middleware: [ middleware ],
        errorHandlers: [],
    });
    const route = new HttpRoute({
        name: 'test-route',
        pattern: '/users/:id',
        targets: [ target ],
        errorHandlers: [],
    });
    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: '*',
        routes: [ route ],
    });
    return { vhost, route, target, middleware };
}


describe('HttpRouter#constructor with no arguments', ({ before, it }) => {
    let router;

    before(() => {
        router = new HttpRouter();
    });

    it('creates an instance', () => {
        assert(router);
    });

    it('extends EventEmitter', () => {
        assertFunction(router.emit);
        assertFunction(router.on);
    });
});


describe('HttpRouter#constructor with virtualHosts array', ({ before, it }) => {
    const vhost = new VirtualHost({
        name: 'test',
        hostname: '*',
        routes: [],
    });
    let router;

    before(() => {
        router = new HttpRouter([ vhost ]);
    });

    it('accepts virtual hosts in constructor', async () => {
        const url = new URL('http://www.example.com/');
        const request = createRequest('1', url);
        const response = new HttpServerResponse('1');
        const context = createApplicationContext();

        const target = new HttpTarget({
            name: 't',
            allowedMethods: [ 'GET' ],
            middleware: [ (_c, _r, res) => res ],
            errorHandlers: [],
        });
        const route = new HttpRoute({
            name: 'r',
            pattern: '/',
            targets: [ target ],
            errorHandlers: [],
        });
        vhost.routes.push(route);

        const result = await router.handleHttpRequest(context, request, response);
        assertEqual(response, result);
    });
});


describe('HttpRouter#constructor with non-array virtualHosts', ({ before, it }) => {
    let router;

    before(() => {
        router = new HttpRouter({ not: 'an array' });
    });

    it('throws when handling request with no virtual hosts', async () => {
        const url = new URL('http://www.example.com/foo');
        const request = createRequest('1', url);
        const response = new HttpServerResponse('1');
        const context = createApplicationContext();

        let error;
        try {
            await router.handleHttpRequest(context, request, response);
        } catch (err) {
            error = err;
        }
        assert(error);
    });
});


describe('HttpRouter#resetVirtualHosts', ({ before, it }) => {
    const vhost1 = new VirtualHost({
        name: 'vhost1',
        hostname: '*',
        routes: [],
    });
    const vhost2 = new VirtualHost({
        name: 'vhost2',
        hostname: '*',
        routes: [],
    });
    let router;

    before(() => {
        router = new HttpRouter([ vhost1 ]);
        router.resetVirtualHosts([ vhost2 ]);
    });

    it('replaces virtual hosts', async () => {
        const target = new HttpTarget({
            name: 't',
            allowedMethods: [ 'GET' ],
            middleware: [ (_c, _r, res) => res ],
            errorHandlers: [],
        });
        const route = new HttpRoute({
            name: 'r',
            pattern: '/',
            targets: [ target ],
            errorHandlers: [],
        });
        vhost2.routes.push(route);

        const url = new URL('http://www.example.com/');
        const request = createRequest('1', url);
        const response = new HttpServerResponse('1');
        const context = createApplicationContext();

        const result = await router.handleHttpRequest(context, request, response);
        assertEqual(response, result);
    });
});


describe('HttpRouter#getHttpRequestHandler', ({ before, it }) => {
    let router;
    let handler;

    before(() => {
        router = new HttpRouter();
        handler = router.getHttpRequestHandler();
    });

    it('returns a function', () => {
        assertFunction(handler);
    });

    it('returns function with same length as handleHttpRequest', () => {
        assertEqual(router.handleHttpRequest.length, handler.length);
    });
});


describe('HttpRouter#handleHttpRequest when route matches successfully', ({ before, after, it }) => {
    const { vhost, middleware } = createMinimalRouterFixture();
    const router = new HttpRouter([ vhost ]);
    const url = new URL('http://www.example.com/users/123');
    const request = createRequest('1', url);
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();

    let result;

    before(async () => {
        result = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the response', () => {
        assertEqual(response, result);
    });

    it('calls target middleware', () => {
        assertEqual(1, middleware.callCount);
    });

    it('sets pathname params on request', () => {
        assertEqual('123', request.pathnameParams.id);
    });

    it('sets hostname params on request', () => {
        assertEqual('object', typeof request.hostnameParams);
        assertEqual(0, Object.keys(request.hostnameParams).length);
    });
});


describe('HttpRouter#handleHttpRequest when no route matches pathname', ({ before, it }) => {
    const { vhost } = createMinimalRouterFixture();
    const router = new HttpRouter([ vhost ]);
    const url = new URL('http://www.example.com/nonexistent/path');
    const request = createRequest('1', url);
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();

    let result;
    let errorEvent;

    before(async () => {
        router.once('error', (ev) => {
            errorEvent = ev;
        });
        result = await router.handleHttpRequest(context, request, response);
    });

    it('returns error response', () => {
        assertEqual(404, response.status);
    });

    it('emits error event', () => {
        assert(errorEvent);
        assertEqual('NotFoundError', errorEvent.error.name);
        assertEqual('1', errorEvent.requestId);
    });

    it('includes pathname in error message', () => {
        assert(result.body.includes('/nonexistent/path'));
    });
});


describe('HttpRouter#handleHttpRequest when method not allowed', ({ before, it }) => {
    const { vhost } = createMinimalRouterFixture();
    const router = new HttpRouter([ vhost ]);
    const url = new URL('http://www.example.com/users/123');
    const request = createRequest('1', url, { method: 'DELETE' });
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();

    let errorEvent;

    before(async () => {
        router.once('error', (ev) => {
            errorEvent = ev;
        });
        await router.handleHttpRequest(context, request, response);
    });

    it('returns 405 response', () => {
        assertEqual(405, response.status);
    });

    it('emits error event', () => {
        assert(errorEvent);
        assertEqual('MethodNotAllowedError', errorEvent.error.name);
    });

    it('sets Allow header', () => {
        assertEqual('GET', response.headers.get('allow'));
    });
});


describe('HttpRouter#handleHttpRequest falls back to first vhost when hostname unmatched', ({ before, it }) => {
    const vhost = new VirtualHost({
        name: 'fallback',
        hostname: 'com.example.www',
        routes: [],
    });
    const target = new HttpTarget({
        name: 't',
        allowedMethods: [ 'GET' ],
        middleware: [ (_c, _r, res) => res ],
        errorHandlers: [],
    });
    const route = new HttpRoute({
        name: 'r',
        pattern: '/',
        targets: [ target ],
        errorHandlers: [],
    });
    vhost.routes.push(route);

    const router = new HttpRouter([ vhost ]);
    const url = new URL('http://unknown.host.com/');
    const request = createRequest('1', url);
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();

    let result;

    before(async () => {
        result = await router.handleHttpRequest(context, request, response);
    });

    it('uses first vhost as fallback', () => {
        assertEqual(response, result);
        assertEqual(200, response.status);
    });
});


describe('HttpRouter#handleHttpRequest when middleware throws', ({ before, after, it }) => {
    const middlewareError = new Error('Middleware failed');
    const middleware = sinon.stub().rejects(middlewareError);
    const errorHandler = sinon.stub().callsFake((_ctx, _req, res) => {
        return res.respondWithUtf8(500, 'Internal error');
    });
    const target = new HttpTarget({
        name: 't',
        allowedMethods: [ 'GET' ],
        middleware: [ middleware ],
        errorHandlers: [ errorHandler ],
    });
    const route = new HttpRoute({
        name: 'r',
        pattern: '/',
        targets: [ target ],
        errorHandlers: [],
    });
    const vhost = new VirtualHost({
        name: 'test',
        hostname: '*',
        routes: [ route ],
    });
    const router = new HttpRouter([ vhost ]);
    const url = new URL('http://www.example.com/');
    const request = createRequest('1', url);
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();

    let errorEvent;

    before(async () => {
        router.once('error', (ev) => {
            errorEvent = ev;
        });
        await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('emits error event', () => {
        assert(errorEvent);
        assertEqual('Middleware failed', errorEvent.error.message);
        assertEqual('1', errorEvent.requestId);
    });

    it('returns error response from target error handler', () => {
        assertEqual(500, response.status);
    });
});


describe('HttpRouter#handleError when error has isHttpError flag', ({ before, it }) => {
    const router = new HttpRouter();
    const request = createRequest('1', new URL('http://x/'));
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();
    const error = new NotFoundError('Not found');

    let handleResult;

    before(() => {
        handleResult = router.handleError(context, request, response, error);
    });

    it('returns response', () => {
        assert(handleResult);
        assertEqual(response, handleResult);
    });

    it('sets status code', () => {
        assertEqual(404, response.status);
    });

    it('includes error in JSON body', () => {
        const body = JSON.parse(handleResult.body);
        assertEqual(1, body.errors.length);
        assertEqual(404, body.errors[0].status);
        assertEqual('NotFoundError', body.errors[0].title);
    });
});


describe('HttpRouter#handleError when error has expected flag', ({ before, it }) => {
    const router = new HttpRouter();
    const request = createRequest('1', new URL('http://x/'));
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();
    const error = new Error('Expected error');
    error.expected = true;
    error.httpStatusCode = 400;

    let handleResult;

    before(() => {
        handleResult = router.handleError(context, request, response, error);
    });

    it('returns response', () => {
        assert(handleResult);
    });

    it('sanitizes error detail for non-http errors', () => {
        const body = JSON.parse(handleResult.body);
        assertEqual('Internal server error', body.errors[0].detail);
    });
});


describe('HttpRouter#handleError when error has neither isHttpError nor expected', ({ before, it }) => {
    const router = new HttpRouter();
    const request = createRequest('1', new URL('http://x/'));
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();
    const error = new Error('Unexpected');

    let handleResult;

    before(() => {
        handleResult = router.handleError(context, request, response, error);
    });

    it('returns false', () => {
        assertFalsy(handleResult);
    });
});


describe('HttpRouter#handleError sets Allow header for 405', ({ before, it }) => {
    const router = new HttpRouter();
    const request = createRequest('1', new URL('http://x/'));
    const response = new HttpServerResponse('1');
    const context = createApplicationContext();
    const error = new MethodNotAllowedError('Method not allowed', {
        allowedMethods: [ 'GET', 'POST' ],
    });

    before(() => {
        router.handleError(context, request, response, error);
    });

    it('sets Allow header', () => {
        assertEqual('GET, POST', response.headers.get('allow'));
    });
});


describe('HttpRouter.mapErrorToJsonError for HttpError', ({ it }) => {
    const error = new NotFoundError('Resource not found');

    let result;

    it('returns JSON:API error structure', () => {
        result = HttpRouter.mapErrorToJsonError(error);
        assertEqual(404, result.status);
        assertEqual('NotFoundError', result.title);
        assertEqual('Resource not found', result.detail);
    });
});


describe('HttpRouter.mapErrorToJsonError for unexpected error', ({ it }) => {
    const error = new Error('Internal secret message');

    let result;

    it('sanitizes detail message', () => {
        result = HttpRouter.mapErrorToJsonError(error);
        assertEqual('Internal server error', result.detail);
    });

    it('uses generic code and title', () => {
        assertEqual('INTERNAL_SERVER_ERROR', result.code);
        assertEqual('InternalServerError', result.title);
    });
});
