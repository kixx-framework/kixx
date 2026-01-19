import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import {
    assert,
    assertEqual,
    assertMatches
} from 'kixx-assert';

import HttpRoutesStore from '../../lib/http-routes-store/http-routes-store.js';
import HttpRouter from '../../lib/http-server/http-router.js';
import HttpServerRequest from '../../lib/http-server/http-server-request.js';
import HttpServerResponse from '../../lib/http-server/http-server-response.js';
import Context from '../../lib/application/context.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(THIS_DIR, 'routing-fixtures');


const app_directory = path.join(FIXTURE_DIR, 'nominal');
const routes_directory = path.join(app_directory, 'routes');

const routesStore = new HttpRoutesStore({
    app_directory,
    routes_directory,
});

describe('unexpected error handled by target handler', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://www.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('AuthenticationMiddleware', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const error = new Error('Unexpected Test Error');
    const publicViwProductHandler = sinon.spy(() => {
        throw error;
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    handlers.set('HyperviewHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    const productsErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('ProductsErrorHandler', () => {
        return productsErrorHandler;
    });

    const viewProductErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        return viewProductErrorHandler;
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('Unexpected Test Error', event.error.message);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(500, serverResponse.status);
    });

    it('does not call HttpCachingMiddleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });

    // Target error handler
    it('calls ViewProductErrorHandler', () => {
        assertEqual(1, viewProductErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = viewProductErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(viewProductErrorHandler.calledAfter(publicViwProductHandler));
    });

    // Mid route error handler
    it('does not call ProductsErrorHandler', () => {
        assertEqual(0, productsErrorHandler.callCount);
    });

    // Top level route error handler
    it('does not call HyperviewErrorHandler', () => {
        assertEqual(0, hyperviewErrorHandler.callCount);
    });
});

describe('unexpected error handled by mid level routes handler', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://www.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('AuthenticationMiddleware', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const error = new Error('Unexpected Test Error');
    const publicViwProductHandler = sinon.spy(() => {
        throw error;
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    handlers.set('HyperviewHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    const productsErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('ProductsErrorHandler', () => {
        return productsErrorHandler;
    });

    const viewProductErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        return viewProductErrorHandler;
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('Unexpected Test Error', event.error.message);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(500, serverResponse.status);
    });

    it('does not call HttpCachingMiddleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });

    // Target error handler
    it('calls ViewProductErrorHandler', () => {
        assertEqual(1, viewProductErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = viewProductErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(viewProductErrorHandler.calledAfter(publicViwProductHandler));
        assert(viewProductErrorHandler.calledBefore(productsErrorHandler));
    });

    // Mid route error handler
    it('calls ProductsErrorHandler', () => {
        assertEqual(1, productsErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = productsErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(productsErrorHandler.calledAfter(viewProductErrorHandler));
    });

    // Top level route error handler
    it('does not call HyperviewErrorHandler', () => {
        assertEqual(0, hyperviewErrorHandler.callCount);
    });
});

describe('unexpected error handled by top level routes handler', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://www.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('AuthenticationMiddleware', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const error = new Error('Unexpected Test Error');
    const publicViwProductHandler = sinon.spy(() => {
        throw error;
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    handlers.set('HyperviewHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        return _res.respondWithUtf8(500, _err.message);
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    const productsErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('ProductsErrorHandler', () => {
        return productsErrorHandler;
    });

    const viewProductErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        return viewProductErrorHandler;
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('Unexpected Test Error', event.error.message);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(500, serverResponse.status);
    });

    it('does not call HttpCachingMiddleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });

    // Target error handler
    it('calls ViewProductErrorHandler', () => {
        assertEqual(1, viewProductErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = viewProductErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(viewProductErrorHandler.calledAfter(publicViwProductHandler));
        assert(viewProductErrorHandler.calledBefore(productsErrorHandler));
    });

    // Mid route error handler
    it('calls ProductsErrorHandler', () => {
        assertEqual(1, productsErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = productsErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(productsErrorHandler.calledAfter(viewProductErrorHandler));
        assert(productsErrorHandler.calledBefore(hyperviewErrorHandler));
    });

    // Top level route error handler
    it('calls HyperviewErrorHandler', () => {
        assertEqual(1, hyperviewErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = hyperviewErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(hyperviewErrorHandler.calledAfter(productsErrorHandler));
    });
});

describe('unexpected error handled by router error handler', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://www.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('AuthenticationMiddleware', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const publicViwProductHandler = sinon.spy(() => {
        throw new Error('Unexpected Test Error');
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    handlers.set('HyperviewHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    const productsErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('ProductsErrorHandler', () => {
        return productsErrorHandler;
    });

    const viewProductErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        return viewProductErrorHandler;
    });

    const routerErrorHandler = sinon.spy();

    let error;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        try {
            await router.handleHttpRequest(context, request, response);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('Unexpected Test Error', event.error.message);
    });

    it('throws the unexpected error', () => {
        assert(error);
        assertEqual('Unexpected Test Error', error.message);
    });

    it('does not call HttpCachingMiddleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });

    // Target error handler
    it('calls ViewProductErrorHandler', () => {
        assertEqual(1, viewProductErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = viewProductErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(viewProductErrorHandler.calledAfter(publicViwProductHandler));
        assert(viewProductErrorHandler.calledBefore(productsErrorHandler));
    });

    // Mid route error handler
    it('calls ProductsErrorHandler', () => {
        assertEqual(1, productsErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = productsErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(productsErrorHandler.calledAfter(viewProductErrorHandler));
        assert(productsErrorHandler.calledBefore(hyperviewErrorHandler));
    });

    // Top level route error handler
    it('calls HyperviewErrorHandler', () => {
        assertEqual(1, hyperviewErrorHandler.callCount);

        // The error is passed in as the 4th argument.
        const err = hyperviewErrorHandler.getCall(0).args[3];
        assertEqual(error, err);

        assert(hyperviewErrorHandler.calledAfter(productsErrorHandler));
    });
});

describe('with unhandled method error handled by primary error handler', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://catalog.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'POST',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const authenticationMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('AuthenticationMiddleware', () => {
        return authenticationMiddleware;
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const publicViwProductHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    // The Hyperview handler should not be called
    const hyperviewHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    handlers.set('HyperviewHandler', () => {
        return hyperviewHandler;
    });

    const hyperviewErrorHandler = sinon.spy((_ctx, _req, _res, _err) => {
        if (_err.name === 'MethodNotAllowedError') {
            return _res.respondWithUtf8(
                405,
                `HTTP method ${ _req.method } not allowed\n`,
                { contentType: 'text/plain' }
            );
        }
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('MethodNotAllowedError', event.error.name);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(405, serverResponse.status);
    });

    it('returns custom response from primary error handler', () => {
        assertMatches('HTTP method POST not allowed', serverResponse.body);
    });

    it('does not call the inbound authentication middleware', () => {
        assertEqual(0, authenticationMiddleware.callCount);
    });

    it('does not call the hyperview page handler', () => {
        assertEqual(0, hyperviewHandler.callCount);
    });

    it('does not call the public product page handler', () => {
        assertEqual(0, publicViwProductHandler.callCount);
    });

    it('calls the primary error handler', () => {
        assertEqual(1, hyperviewErrorHandler.callCount);
    });

    it('does not call the outbound httpCaching middleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });
});

describe('with unhandled method and primary error handler returns false', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://catalog.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'POST',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const authenticationMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('AuthenticationMiddleware', () => {
        return authenticationMiddleware;
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    const publicViwProductHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    // The Hyperview handler should not be called
    const hyperviewHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    handlers.set('HyperviewHandler', () => {
        return hyperviewHandler;
    });

    const hyperviewErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('emits a router error event', () => {
        assertEqual(1, routerErrorHandler.callCount);
        const event = routerErrorHandler.getCall(0).args[0];
        assertEqual('1', event.requestId);
        assertEqual('MethodNotAllowedError', event.error.name);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(405, serverResponse.status);
    });

    it('returns response from default error handler', () => {
        const body = JSON.parse(serverResponse.body);
        const [ error ] = body.errors;
        assertEqual(405, error.status);
        assertEqual('METHOD_NOT_ALLOWED_ERROR', error.code);
        assertEqual('MethodNotAllowedError', error.title);
        assertEqual('HTTP method POST not allowed on /products/cat-id-123/prod-id-123', error.detail);
    });

    it('does not call the inbound authentication middleware', () => {
        assertEqual(0, authenticationMiddleware.callCount);
    });

    it('does not call the hyperview page handler', () => {
        assertEqual(0, hyperviewHandler.callCount);
    });

    it('does not call the public product page handler', () => {
        assertEqual(0, publicViwProductHandler.callCount);
    });

    it('calls the hyperview error handler', () => {
        assertEqual(1, hyperviewErrorHandler.callCount);
    });

    it('does not call the outbound httpCaching middleware', () => {
        assertEqual(0, httpCachingMiddleware.callCount);
    });
});

describe('with matching hostname and pathname params', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://catalog.example.com/products/cat-id-123/prod-id-123');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    let hostnameParams;
    let pathnameParams;

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    middleware.set('AuthenticationMiddleware', () => {
        // A stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('HttpCachingMiddleware', () => {
        // A stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const publicViwProductHandler = sinon.spy((_ctx, _req, _res) => {
        hostnameParams = _req.hostnameParams;
        pathnameParams = _req.pathnameParams;
        return _res;
    });

    handlers.set('PublicViewProduct', () => {
        return publicViwProductHandler;
    });

    // The Hyperview handler should not be called
    const hyperviewHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });

    handlers.set('HyperviewHandler', () => {
        return hyperviewHandler;
    });

    errorHandlers.set('HyperviewErrorHandler', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('does not emit a router error event', () => {
        assertEqual(0, routerErrorHandler.callCount);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(200, serverResponse.status);
    });

    it('does not call the hyperview page handler', () => {
        assertEqual(0, hyperviewHandler.callCount);
    });

    it('calls the public product page handler', () => {
        assertEqual(1, publicViwProductHandler.callCount);
    });

    it('sets hostname params', () => {
        assertEqual('catalog', hostnameParams.subdomain);
    });

    it('sets pathname params', () => {
        assertEqual('cat-id-123', pathnameParams.category_id);
        assertEqual('prod-id-123', pathnameParams.product_id);
    });
});

describe('bare domain (redirects to www subdomain)', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://example.com/some-subpage-which-exists');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    const redirectHandler = sinon.spy((_ctx, _req, _res) => {
        const u = new URL(_req.url);
        u.protocol = 'https:';
        u.hostname = 'www.example.com';
        return _res.respondWithRedirect(301, url);
    });
    handlers.set('RedirectToWWW', () => {
        return redirectHandler;
    });

    middleware.set('AuthenticationMiddleware', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    middleware.set('HttpCachingMiddleware', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    handlers.set('HyperviewHandler', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    handlers.set('PublicViewProduct', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });
    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('does not emit a router error event', () => {
        assertEqual(0, routerErrorHandler.callCount);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(301, serverResponse.status);
        assertEqual('http://example.com/some-subpage-which-exists', serverResponse.headers.get('location'));
    });

    it('calls the redirect handler', () => {
        assertEqual(1, redirectHandler.callCount);
    });
});

describe('routing with no matching route (uses default route)', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://www.example.com/some-subpage-which-exists');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const authenticationMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });

    middleware.set('AuthenticationMiddleware', () => {
        return authenticationMiddleware;
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });

    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    handlers.set('PublicViewProduct', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });

    handlers.set('HyperviewHandler', () => {
        return hyperviewHandler;
    });

    const hyperviewErrorHandler = sinon.spy(() => {
        return false;
    });

    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('does not emit a router error event', () => {
        assertEqual(0, routerErrorHandler.callCount);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(200, serverResponse.status);
    });

    it('calls the inbound authentication middleware', () => {
        assertEqual(1, authenticationMiddleware.callCount);
        assert(authenticationMiddleware.calledBefore(hyperviewHandler));
    });

    it('calls the hyperview page handler', () => {
        assertEqual(1, hyperviewHandler.callCount);
        assert(hyperviewHandler.calledBefore(httpCachingMiddleware));
    });

    it('does not call the hyperview error handler', () => {
        assertEqual(0, hyperviewErrorHandler.callCount);
    });

    it('calls the outbound httpCaching middleware', () => {
        assertEqual(1, httpCachingMiddleware.callCount);
    });
});

describe('routing with no matching hostname (uses default virtual host)', ({ before, after, it }) => {

    const router = new HttpRouter();

    const url = new URL('http://localhost:8080');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    handlers.set('RedirectToWWW', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const authenticationMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('AuthenticationMiddleware', () => {
        return authenticationMiddleware;
    });

    const httpCachingMiddleware = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    middleware.set('HttpCachingMiddleware', () => {
        return httpCachingMiddleware;
    });

    handlers.set('PublicViewProduct', () => {
        // Never called We just need a stub to pass validation.
        return sinon.spy((_ctx, _req, _res) => {
            return _res;
        });
    });

    const hyperviewHandler = sinon.spy((_ctx, _req, _res) => {
        return _res;
    });
    handlers.set('HyperviewHandler', () => {
        return hyperviewHandler;
    });

    const hyperviewErrorHandler = sinon.spy(() => {
        return false;
    });
    errorHandlers.set('HyperviewErrorHandler', () => {
        return hyperviewErrorHandler;
    });

    errorHandlers.set('ProductsErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });
    errorHandlers.set('ViewProductErrorHandler', () => {
        // Stub to pass validation for this test.
        return sinon.spy(() => {
            return false;
        });
    });

    const routerErrorHandler = sinon.spy();

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('does not emit a router error event', () => {
        assertEqual(0, routerErrorHandler.callCount);
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
        assertEqual(200, serverResponse.status);
    });

    it('calls the inbound authentication middleware', () => {
        assertEqual(1, authenticationMiddleware.callCount);
        assert(authenticationMiddleware.calledBefore(hyperviewHandler));
    });

    it('calls the hyperview page handler', () => {
        assertEqual(1, hyperviewHandler.callCount);
        assert(hyperviewHandler.calledBefore(httpCachingMiddleware));
    });

    it('does not call the hyperview error handler', () => {
        assertEqual(0, hyperviewErrorHandler.callCount);
    });

    it('calls the outbound httpCaching middleware', () => {
        assertEqual(1, httpCachingMiddleware.callCount);
    });
});

function createApplicationContext() {
    const runtime = { server: { name: 'test' } };
    const config = {};
    const paths = {};
    const logger = {};

    return new Context({
        runtime,
        config,
        paths,
        logger,
    });
}

function createRequest(id, url, options) {
    return new HttpServerRequest(options, url, id);
}
