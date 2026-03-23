import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import ApplicationContext from '../../../lib/context/application-context.js';


function createSubject() {
    return new ApplicationContext({
        runtime: {},
        config: {},
        logger: {},
        utils: {},
    });
}


describe('ApplicationContext#getHttpRouterRegistries()', ({ it }) => {
    const subject = createSubject();
    const result = subject.getHttpRouterRegistries();

    it('returns middleware registry map', () => {
        assert(result.middleware instanceof Map);
    });

    it('returns request handlers registry map', () => {
        assert(result.requestHandlers instanceof Map);
    });

    it('returns error handlers registry map', () => {
        assert(result.errorHandlers instanceof Map);
    });

    it('does not expose public middleware property', () => {
        assertEqual(undefined, subject.middleware);
    });

    it('does not expose public requestHandlers property', () => {
        assertEqual(undefined, subject.requestHandlers);
    });

    it('does not expose public errorHandlers property', () => {
        assertEqual(undefined, subject.errorHandlers);
    });
});

describe('ApplicationContext#registerMiddleware()', ({ it }) => {
    const subject = createSubject();
    const middlewareFactory = () => {};
    subject.registerMiddleware('myapp.AuthMiddleware', middlewareFactory);
    const registries = subject.getHttpRouterRegistries();

    it('registers middleware in router registries', () => {
        assertEqual(middlewareFactory, registries.middleware.get('myapp.AuthMiddleware'));
    });
});

describe('ApplicationContext#registerRequestHandler()', ({ it }) => {
    const subject = createSubject();
    const requestHandlerFactory = () => {};
    subject.registerRequestHandler('myapp.UserHandler', requestHandlerFactory);
    const registries = subject.getHttpRouterRegistries();

    it('registers request handler in router registries', () => {
        assertEqual(requestHandlerFactory, registries.requestHandlers.get('myapp.UserHandler'));
    });
});

describe('ApplicationContext#registerErrorHandler()', ({ it }) => {
    const subject = createSubject();
    const errorHandlerFactory = () => {};
    subject.registerErrorHandler('myapp.NotFoundHandler', errorHandlerFactory);
    const registries = subject.getHttpRouterRegistries();

    it('registers error handler in router registries', () => {
        assertEqual(errorHandlerFactory, registries.errorHandlers.get('myapp.NotFoundHandler'));
    });
});
