import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';
import HttpTarget from '../../lib/http-server/http-target.js';


describe('HttpTarget#constructor with valid input', ({ before, it }) => {
    const name = 'test-target';
    const allowedMethods = [ 'GET', 'POST' ];
    const middleware = [ sinon.spy(), sinon.spy() ];
    const errorHandlers = [ sinon.spy() ];

    let target;

    before(() => {
        target = new HttpTarget({ name, allowedMethods, middleware, errorHandlers });
    });

    it('sets the name property', () => {
        assertEqual(name, target.name);
    });

    it('sets the allowedMethods property', () => {
        assertEqual(2, target.allowedMethods.length);
        assertEqual('GET', target.allowedMethods[0]);
        assertEqual('POST', target.allowedMethods[1]);
    });

    it('makes name enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(target, 'name');
        assertEqual(true, descriptor.enumerable);
    });

    it('makes allowedMethods enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(target, 'allowedMethods');
        assertEqual(true, descriptor.enumerable);
    });
});


describe('HttpTarget#constructor creates a copy of allowedMethods', ({ before, it }) => {
    const allowedMethods = [ 'GET', 'POST' ];
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods,
            middleware: [],
            errorHandlers: [],
        });
    });

    it('does not reference the original array', () => {
        assertFalsy(target.allowedMethods === allowedMethods);
    });
});


describe('HttpTarget#constructor freezes allowedMethods', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET', 'POST' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('makes allowedMethods array frozen', () => {
        assertEqual(true, Object.isFrozen(target.allowedMethods));
    });

    it('prevents modification to allowedMethods', () => {
        let error;
        try {
            target.allowedMethods.push('DELETE');
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpTarget#constructor makes name non-writable', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('throws TypeError when attempting to modify name', () => {
        let error;
        try {
            target.name = 'new-name';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpTarget#constructor makes allowedMethods non-writable', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('throws TypeError when attempting to replace allowedMethods', () => {
        let error;
        try {
            target.allowedMethods = [ 'POST' ];
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('HttpTarget#isMethodAllowed() when method is allowed', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET', 'POST', 'PUT' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('returns true for GET', () => {
        assertEqual(true, target.isMethodAllowed('GET'));
    });

    it('returns true for POST', () => {
        assertEqual(true, target.isMethodAllowed('POST'));
    });

    it('returns true for PUT', () => {
        assertEqual(true, target.isMethodAllowed('PUT'));
    });
});


describe('HttpTarget#isMethodAllowed() when method is not allowed', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET', 'POST' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('returns false for DELETE', () => {
        assertEqual(false, target.isMethodAllowed('DELETE'));
    });

    it('returns false for PATCH', () => {
        assertEqual(false, target.isMethodAllowed('PATCH'));
    });
});


describe('HttpTarget#isMethodAllowed() is case-sensitive', ({ before, it }) => {
    let target;

    before(() => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });
    });

    it('returns false for lowercase method name', () => {
        assertEqual(false, target.isMethodAllowed('get'));
    });
});


describe('HttpTarget#invokeMiddleware() with single middleware', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const updatedResponse = { id: 'res-1', updated: true };

    const middleware = sinon.stub().resolves(updatedResponse);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware ],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls the middleware once', () => {
        assertEqual(1, middleware.callCount);
    });

    it('passes context as first argument', () => {
        assertEqual(context, middleware.getCall(0).args[0]);
    });

    it('passes request as second argument', () => {
        assertEqual(request, middleware.getCall(0).args[1]);
    });

    it('passes response as third argument', () => {
        assertEqual(response, middleware.getCall(0).args[2]);
    });

    it('passes skip function as fourth argument', () => {
        assertEqual('function', typeof middleware.getCall(0).args[3]);
    });

    it('returns the updated response from middleware', () => {
        assertEqual(updatedResponse, result);
    });
});


describe('HttpTarget#invokeMiddleware() with multiple middleware', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const response2 = { id: 'res-2' };
    const response3 = { id: 'res-3' };

    const middleware1 = sinon.stub().resolves(response2);
    const middleware2 = sinon.stub().resolves(response3);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware1, middleware2 ],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls first middleware', () => {
        assertEqual(1, middleware1.callCount);
    });

    it('calls second middleware', () => {
        assertEqual(1, middleware2.callCount);
    });

    it('calls middleware in order', () => {
        assert(middleware1.calledBefore(middleware2));
    });

    it('returns response from last middleware', () => {
        assertEqual(response3, result);
    });
});


describe('HttpTarget#invokeMiddleware() with skip() called', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const stoppedResponse = { id: 'res-stopped' };

    let middleware1;
    let middleware2;
    let target;
    let result;

    before(async () => {
        middleware1 = sinon.stub().callsFake((ctx, req, res, skip) => {
            skip();
            return stoppedResponse;
        });
        middleware2 = sinon.stub().resolves({ id: 'res-2' });

        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware1, middleware2 ],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls first middleware', () => {
        assertEqual(1, middleware1.callCount);
    });

    it('does not call second middleware', () => {
        assertEqual(0, middleware2.callCount);
    });

    it('returns response from middleware that called skip()', () => {
        assertEqual(stoppedResponse, result);
    });
});


describe('HttpTarget#invokeMiddleware() with skip() called in second middleware', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const response2 = { id: 'res-2' };
    const stoppedResponse = { id: 'res-stopped' };

    let middleware1;
    let middleware2;
    let middleware3;
    let target;
    let result;

    before(async () => {
        middleware1 = sinon.stub().resolves(response2);
        middleware2 = sinon.stub().callsFake((ctx, req, res, skip) => {
            skip();
            return stoppedResponse;
        });
        middleware3 = sinon.stub().resolves({ id: 'res-3' });

        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware1, middleware2, middleware3 ],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls first middleware', () => {
        assertEqual(1, middleware1.callCount);
    });

    it('calls second middleware', () => {
        assertEqual(1, middleware2.callCount);
    });

    it('does not call third middleware', () => {
        assertEqual(0, middleware3.callCount);
    });

    it('returns response from middleware that called skip()', () => {
        assertEqual(stoppedResponse, result);
    });
});


describe('HttpTarget#invokeMiddleware() with synchronous middleware', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const updatedResponse = { id: 'res-updated' };

    const middleware = sinon.stub().returns(updatedResponse);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [ middleware ],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls the middleware', () => {
        assertEqual(1, middleware.callCount);
    });

    it('returns the response from synchronous middleware', () => {
        assertEqual(updatedResponse, result);
    });
});


describe('HttpTarget#invokeMiddleware() with no middleware', ({ before, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };

    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        result = await target.invokeMiddleware(context, request, response);
    });

    it('returns undefined when no middleware is present', () => {
        assertEqual(undefined, result);
    });
});


describe('HttpTarget#handleError() with single error handler', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler = sinon.stub().resolves(errorResponse);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler ],
        });

        result = await target.handleError(context, request, response, error);
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


describe('HttpTarget#handleError() with multiple error handlers', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler1 = sinon.stub().resolves(false);
    const errorHandler2 = sinon.stub().resolves(errorResponse);
    const errorHandler3 = sinon.stub().resolves({ id: 'res-never-reached' });
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await target.handleError(context, request, response, error);
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


describe('HttpTarget#handleError() when no handler can process error', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    const errorHandler1 = sinon.stub().resolves(false);
    const errorHandler2 = sinon.stub().resolves(null);
    const errorHandler3 = sinon.stub().resolves(undefined);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await target.handleError(context, request, response, error);
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


describe('HttpTarget#handleError() with synchronous error handler', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');
    const errorResponse = { id: 'res-error', status: 500 };

    const errorHandler = sinon.stub().returns(errorResponse);
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler ],
        });

        result = await target.handleError(context, request, response, error);
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


describe('HttpTarget#handleError() with no error handlers', ({ before, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        result = await target.handleError(context, request, response, error);
    });

    it('returns false when no error handlers are present', () => {
        assertEqual(false, result);
    });
});


describe('HttpTarget#handleError() distinguishes between falsy values', ({ before, after, it }) => {
    const context = { config: {} };
    const request = { id: 'req-1' };
    const response = { id: 'res-1' };
    const error = new Error('Test error');

    // Handler that returns 0 (falsy but could be valid)
    const errorHandler1 = sinon.stub().resolves(0);
    // Handler that returns empty string (falsy but could be valid)
    const errorHandler2 = sinon.stub().resolves('');
    const errorHandler3 = sinon.stub().resolves({ id: 'res-never-reached' });
    let target;
    let result;

    before(async () => {
        target = new HttpTarget({
            name: 'test-target',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [ errorHandler1, errorHandler2, errorHandler3 ],
        });

        result = await target.handleError(context, request, response, error);
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
        assertEqual('res-never-reached', result.id);
    });
});
