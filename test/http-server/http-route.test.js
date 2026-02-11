import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray, assertNonEmptyString } from 'kixx-assert';
import HttpRoute from '../../lib/http-server/http-route.js';
import HttpTarget from '../../lib/http-server/http-target.js';


describe('HttpRoute#constructor with regular pattern', ({ before, it }) => {
    const name = 'test-route';
    const pattern = '/users/:id';
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const targets = [ target1 ];
    const errorHandlers = [ sinon.spy() ];

    let route;

    before(() => {
        route = new HttpRoute({ name, pattern, targets, errorHandlers });
    });

    it('sets the name property', () => {
        assertEqual(name, route.name);
    });

    it('sets the targets property', () => {
        assertEqual(1, route.targets.length);
        assertEqual(target1, route.targets[0]);
    });

    it('makes name enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(route, 'name');
        assertEqual(true, descriptor.enumerable);
    });

    it('makes targets enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(route, 'targets');
        assertEqual(true, descriptor.enumerable);
    });
});


describe('HttpRoute#constructor with wildcard pattern', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'wildcard-route',
            pattern: '*',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('sets the name property', () => {
        assertEqual('wildcard-route', route.name);
    });

    it('sets the targets property', () => {
        assertEqual(1, route.targets.length);
        assertEqual(target1, route.targets[0]);
    });
});


describe('HttpRoute#constructor makes name non-writable', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('throws TypeError when attempting to modify name', () => {
        let error;
        try {
            route.name = 'new-name';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpRoute#constructor makes targets non-writable', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('throws TypeError when attempting to replace targets', () => {
        let error;
        try {
            route.targets = [];
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpRoute#allowedMethods with single target', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let methods;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [],
        });
        methods = route.allowedMethods;
    });

    it('returns an array', () => {
        assertArray(methods);
    });

    it('includes GET method', () => {
        assert(methods.includes('GET'));
    });

    it('includes POST method', () => {
        assert(methods.includes('POST'));
    });

    it('returns 2 methods', () => {
        assertEqual(2, methods.length);
    });
});


describe('HttpRoute#allowedMethods with multiple targets', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'target2',
        allowedMethods: [ 'PUT', 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let methods;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1, target2 ],
            errorHandlers: [],
        });
        methods = route.allowedMethods;
    });

    it('aggregates methods from all targets', () => {
        assertEqual(4, methods.length);
        assert(methods.includes('GET'));
        assert(methods.includes('POST'));
        assert(methods.includes('PUT'));
        assert(methods.includes('DELETE'));
    });
});


describe('HttpRoute#allowedMethods with overlapping methods', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'target2',
        allowedMethods: [ 'POST', 'PUT' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let methods;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1, target2 ],
            errorHandlers: [],
        });
        methods = route.allowedMethods;
    });

    it('returns unique methods without duplicates', () => {
        assertEqual(3, methods.length);
        assert(methods.includes('GET'));
        assert(methods.includes('POST'));
        assert(methods.includes('PUT'));
    });
});


describe('HttpRoute#allowedMethods with no targets', ({ before, it }) => {
    let route;
    let methods;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [],
            errorHandlers: [],
        });
        methods = route.allowedMethods;
    });

    it('returns an empty array', () => {
        assertArray(methods);
        assertEqual(0, methods.length);
    });
});


describe('HttpRoute#matchPathname() with matching pathname', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/users/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.matchPathname('/users/123');
    });

    it('returns an object with params', () => {
        assert(result);
        assertEqual('object', typeof result);
    });

    it('extracts id parameter', () => {
        assertEqual('123', result.id);
    });
});


describe('HttpRoute#matchPathname() with non-matching pathname', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/users/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.matchPathname('/products/123');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('HttpRoute#matchPathname() with wildcard pattern', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'wildcard-route',
            pattern: '*',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('matches any pathname', () => {
        const result1 = route.matchPathname('/anything');
        const result2 = route.matchPathname('/users/123');
        const result3 = route.matchPathname('/');

        assert(result1);
        assert(result2);
        assert(result3);
    });

    it('returns empty params object', () => {
        const result = route.matchPathname('/anything');
        assertEqual('object', typeof result);
        assertEqual(0, Object.keys(result).length);
    });
});


describe('HttpRoute#matchPathname() with multiple parameters', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/users/:userId/posts/:postId',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.matchPathname('/users/42/posts/99');
    });

    it('extracts all parameters', () => {
        assertEqual('42', result.userId);
        assertEqual('99', result.postId);
    });
});


describe('HttpRoute#matchPathname() with exact match pattern', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/about',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('matches exact pathname', () => {
        const result = route.matchPathname('/about');
        assert(result);
    });

    it('does not match similar pathname', () => {
        const result = route.matchPathname('/about/team');
        assertEqual(null, result);
    });

    it('returns empty params object for exact match', () => {
        const result = route.matchPathname('/about');
        assertEqual(0, Object.keys(result).length);
    });
});


describe('HttpRoute#findTargetForRequest() with matching target', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'target2',
        allowedMethods: [ 'PUT', 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1, target2 ],
            errorHandlers: [],
        });
        result = route.findTargetForRequest({ method: 'GET' });
    });

    it('returns the matching target', () => {
        assertEqual(target1, result);
    });
});


describe('HttpRoute#findTargetForRequest() with no matching target', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.findTargetForRequest({ method: 'DELETE' });
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('HttpRoute#findTargetForRequest() returns first matching target', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'target2',
        allowedMethods: [ 'GET', 'PUT' ],
        middleware: [],
        errorHandlers: [],
    });

    const target3 = new HttpTarget({
        name: 'target3',
        allowedMethods: [ 'GET', 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1, target2, target3 ],
            errorHandlers: [],
        });
        result = route.findTargetForRequest({ method: 'GET' });
    });

    it('returns the first target that allows the method', () => {
        assertEqual(target1, result);
    });
});


describe('HttpRoute#findTargetForRequest() with multiple methods', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET', 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'target2',
        allowedMethods: [ 'PUT', 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1, target2 ],
            errorHandlers: [],
        });
    });

    it('finds target1 for GET', () => {
        const result = route.findTargetForRequest({ method: 'GET' });
        assertEqual(target1, result);
    });

    it('finds target1 for POST', () => {
        const result = route.findTargetForRequest({ method: 'POST' });
        assertEqual(target1, result);
    });

    it('finds target2 for PUT', () => {
        const result = route.findTargetForRequest({ method: 'PUT' });
        assertEqual(target2, result);
    });

    it('finds target2 for DELETE', () => {
        const result = route.findTargetForRequest({ method: 'DELETE' });
        assertEqual(target2, result);
    });
});


describe('HttpRoute#handleError() with single error handler', ({ before, after, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler = sinon.stub().resolves(errorResponse);
    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [ errorHandler ],
        });

        result = await route.handleError(context, request, response, error);
    });

    after(() => {
        sinon.restore();
    });

    it('calls the error handler once', () => {
        assertEqual(1, errorHandler.callCount);
    });

    it('passes context as first argument', () => {
        assertEqual(context, errorHandler.getCall(0).args[0]);
    });

    it('passes request as second argument', () => {
        assertEqual(request, errorHandler.getCall(0).args[1]);
    });

    it('passes response as third argument', () => {
        assertEqual(response, errorHandler.getCall(0).args[2]);
    });

    it('passes error as fourth argument', () => {
        assertEqual(error, errorHandler.getCall(0).args[3]);
    });

    it('returns the response from error handler', () => {
        assertEqual(errorResponse, result);
    });
});


describe('HttpRoute#handleError() with multiple error handlers', ({ before, after, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler1 = sinon.stub().resolves(false);
    const errorHandler2 = sinon.stub().resolves(errorResponse);
    const errorHandler3 = sinon.stub().resolves({ id: 'res-never-reached' });
    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await route.handleError(context, request, response, error);
    });

    after(() => {
        sinon.restore();
    });

    it('calls first error handler', () => {
        assertEqual(1, errorHandler1.callCount);
    });

    it('calls second error handler', () => {
        assertEqual(1, errorHandler2.callCount);
    });

    it('does not call third error handler', () => {
        assertEqual(0, errorHandler3.callCount);
    });

    it('calls handlers in order', () => {
        assert(errorHandler1.calledBefore(errorHandler2));
    });

    it('returns response from first handler that returns truthy value', () => {
        assertEqual(errorResponse, result);
    });
});


describe('HttpRoute#handleError() when no handler can process error', ({ before, after, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    const errorHandler1 = sinon.stub().resolves(false);
    const errorHandler2 = sinon.stub().resolves(null);
    const errorHandler3 = sinon.stub().resolves(undefined);
    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await route.handleError(context, request, response, error);
    });

    after(() => {
        sinon.restore();
    });

    it('calls all error handlers', () => {
        assertEqual(1, errorHandler1.callCount);
        assertEqual(1, errorHandler2.callCount);
        assertEqual(1, errorHandler3.callCount);
    });

    it('returns false when no handler processes the error', () => {
        assertEqual(false, result);
    });
});


describe('HttpRoute#handleError() with synchronous error handler', ({ before, after, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler = sinon.stub().returns(errorResponse);
    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [ errorHandler ],
        });

        result = await route.handleError(context, request, response, error);
    });

    after(() => {
        sinon.restore();
    });

    it('calls the synchronous error handler', () => {
        assertEqual(1, errorHandler.callCount);
    });

    it('returns the response from synchronous error handler', () => {
        assertEqual(errorResponse, result);
    });
});


describe('HttpRoute#handleError() with no error handlers', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [],
        });

        result = await route.handleError(context, request, response, error);
    });

    it('returns false when no error handlers are present', () => {
        assertEqual(false, result);
    });
});


describe('HttpRoute#handleError() distinguishes between falsy values', ({ before, after, it }) => {
    const target1 = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    // Handler that returns 0 (falsy but could be valid)
    const errorHandler1 = sinon.stub().resolves(0);
    // Handler that returns empty string (falsy but could be valid)
    const errorHandler2 = sinon.stub().resolves('');
    const errorHandler3 = sinon.stub().resolves({ id: 'res-success' });
    let route;
    let result;

    before(async () => {
        route = new HttpRoute({
            name: 'test-route',
            pattern: '/test',
            targets: [ target1 ],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await route.handleError(context, request, response, error);
    });

    after(() => {
        sinon.restore();
    });

    it('calls first handler', () => {
        assertEqual(1, errorHandler1.callCount);
    });

    it('calls second handler when first returns 0', () => {
        assertEqual(1, errorHandler2.callCount);
    });

    it('calls third handler when second returns empty string', () => {
        assertEqual(1, errorHandler3.callCount);
    });

    it('returns first truthy response', () => {
        assertEqual('res-success', result.id);
    });
});


describe('HttpRoute#compileTargetPathname() with valid target and params', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ViewContext',
        allowedMethods: [ 'HEAD', 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'Contexts',
            pattern: '/contexts/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.compileTargetPathname('ViewContext', { id: '2026-02-08T10-17-42' });
    });

    it('returns an object with method property', () => {
        assertNonEmptyString(result.method);
    });

    it('returns an object with pathname property', () => {
        assertNonEmptyString(result.pathname);
    });

    it('returns the compiled pathname with params substituted', () => {
        assertEqual('/contexts/2026-02-08T10-17-42', result.pathname);
    });

    it('returns GET as the preferred method (over HEAD)', () => {
        assertEqual('GET', result.method);
    });
});


describe('HttpRoute#compileTargetPathname() with multiple targets', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ViewContext',
        allowedMethods: [ 'HEAD', 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const target2 = new HttpTarget({
        name: 'UpdateContext',
        allowedMethods: [ 'POST' ],
        middleware: [],
        errorHandlers: [],
    });

    const target3 = new HttpTarget({
        name: 'DeleteContext',
        allowedMethods: [ 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'Contexts',
            pattern: '/contexts/:id',
            targets: [ target1, target2, target3 ],
            errorHandlers: [],
        });
    });

    it('finds ViewContext target and returns GET method', () => {
        const result = route.compileTargetPathname('ViewContext', { id: 'abc' });
        assertEqual('GET', result.method);
        assertEqual('/contexts/abc', result.pathname);
    });

    it('finds UpdateContext target and returns POST method', () => {
        const result = route.compileTargetPathname('UpdateContext', { id: 'abc' });
        assertEqual('POST', result.method);
        assertEqual('/contexts/abc', result.pathname);
    });

    it('finds DeleteContext target and returns DELETE method', () => {
        const result = route.compileTargetPathname('DeleteContext', { id: 'abc' });
        assertEqual('DELETE', result.method);
        assertEqual('/contexts/abc', result.pathname);
    });
});


describe('HttpRoute#compileTargetPathname() method priority with POST and PUT', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ModifyResource',
        allowedMethods: [ 'POST', 'PUT' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'Resources',
            pattern: '/resources/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.compileTargetPathname('ModifyResource', { id: '123' });
    });

    it('returns POST as the preferred method (over PUT)', () => {
        assertEqual('POST', result.method);
    });
});


describe('HttpRoute#compileTargetPathname() with single method', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'DeleteItem',
        allowedMethods: [ 'DELETE' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'Items',
            pattern: '/items/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.compileTargetPathname('DeleteItem', { id: '456' });
    });

    it('returns the single method', () => {
        assertEqual('DELETE', result.method);
    });

    it('returns the compiled pathname', () => {
        assertEqual('/items/456', result.pathname);
    });
});


describe('HttpRoute#compileTargetPathname() with optional path segments', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ViewContext',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;

    before(() => {
        route = new HttpRoute({
            name: 'Contexts',
            pattern: '/contexts/:id{.json}',
            targets: [ target1 ],
            errorHandlers: [],
        });
    });

    it('compiles pathname including optional segment', () => {
        // path-to-regexp compile() includes optional groups by default
        const result = route.compileTargetPathname('ViewContext', { id: 'abc' });
        assertEqual('/contexts/abc.json', result.pathname);
    });
});


describe('HttpRoute#compileTargetPathname() with multiple path params', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ViewComment',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'Comments',
            pattern: '/posts/:postId/comments/:commentId',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.compileTargetPathname('ViewComment', { postId: '42', commentId: '99' });
    });

    it('compiles pathname with all params substituted', () => {
        assertEqual('/posts/42/comments/99', result.pathname);
    });
});


describe('HttpRoute#compileTargetPathname() with no params required', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ListItems',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let result;

    before(() => {
        route = new HttpRoute({
            name: 'Items',
            pattern: '/items',
            targets: [ target1 ],
            errorHandlers: [],
        });
        result = route.compileTargetPathname('ListItems', {});
    });

    it('compiles pathname without params', () => {
        assertEqual('/items', result.pathname);
    });
});


describe('HttpRoute#compileTargetPathname() when target not found', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'ViewContext',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let error;

    before(() => {
        route = new HttpRoute({
            name: 'Contexts',
            pattern: '/contexts/:id',
            targets: [ target1 ],
            errorHandlers: [],
        });

        try {
            route.compileTargetPathname('NonExistentTarget', { id: 'abc' });
        } catch (err) {
            error = err;
        }
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });

    it('includes target name in error message', () => {
        assert(error.message.includes('NonExistentTarget'));
    });

    it('includes route name in error message', () => {
        assert(error.message.includes('Contexts'));
    });
});


describe('HttpRoute#compileTargetPathname() with wildcard pattern', ({ before, it }) => {
    const target1 = new HttpTarget({
        name: 'CatchAll',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    let route;
    let error;

    before(() => {
        route = new HttpRoute({
            name: 'Fallback',
            pattern: '*',
            targets: [ target1 ],
            errorHandlers: [],
        });

        try {
            route.compileTargetPathname('CatchAll', {});
        } catch (err) {
            error = err;
        }
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });

    it('includes wildcard explanation in error message', () => {
        assert(error.message.includes('wildcard'));
    });
});


describe('HttpRoute#compileTargetPathname() method priority order', ({ it }) => {
    // Test the full priority order: GET > POST > PUT > PATCH > DELETE > HEAD > OPTIONS

    function createRouteWithMethods(methods) {
        const target = new HttpTarget({
            name: 'TestTarget',
            allowedMethods: methods,
            middleware: [],
            errorHandlers: [],
        });

        return new HttpRoute({
            name: 'TestRoute',
            pattern: '/test',
            targets: [ target ],
            errorHandlers: [],
        });
    }

    it('prefers GET over all other methods', () => {
        const route = createRouteWithMethods([ 'HEAD', 'OPTIONS', 'DELETE', 'PATCH', 'PUT', 'POST', 'GET' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('GET', result.method);
    });

    it('prefers POST when GET is not available', () => {
        const route = createRouteWithMethods([ 'HEAD', 'OPTIONS', 'DELETE', 'PATCH', 'PUT', 'POST' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('POST', result.method);
    });

    it('prefers PUT when GET and POST are not available', () => {
        const route = createRouteWithMethods([ 'HEAD', 'OPTIONS', 'DELETE', 'PATCH', 'PUT' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('PUT', result.method);
    });

    it('prefers PATCH when GET, POST, and PUT are not available', () => {
        const route = createRouteWithMethods([ 'HEAD', 'OPTIONS', 'DELETE', 'PATCH' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('PATCH', result.method);
    });

    it('prefers DELETE when only DELETE, HEAD, and OPTIONS are available', () => {
        const route = createRouteWithMethods([ 'HEAD', 'OPTIONS', 'DELETE' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('DELETE', result.method);
    });

    it('prefers HEAD when only HEAD and OPTIONS are available', () => {
        const route = createRouteWithMethods([ 'OPTIONS', 'HEAD' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('HEAD', result.method);
    });

    it('returns OPTIONS when it is the only method', () => {
        const route = createRouteWithMethods([ 'OPTIONS' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('OPTIONS', result.method);
    });

    it('falls back to first method for unknown methods', () => {
        const route = createRouteWithMethods([ 'CUSTOM', 'WEIRD' ]);
        const result = route.compileTargetPathname('TestTarget', {});
        assertEqual('CUSTOM', result.method);
    });
});
