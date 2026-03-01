import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import HyperviewErrorHandler from '../../../lib/hyperview/error-handler.js';

const createErrorHandler = HyperviewErrorHandler;


function createMockLogger() {
    const child = { debug: sinon.fake(), info: sinon.fake(), warn: sinon.fake() };
    return { createChild: sinon.fake.returns(child) };
}

function createMockHyperview(overrides = {}) {
    return {
        getPageData: sinon.fake.resolves(null),
        getPageTemplate: sinon.fake.resolves(null),
        getBaseTemplate: sinon.fake.resolves(null),
        ...overrides,
    };
}

function createMockContext({ service, config } = {}) {
    return {
        logger: createMockLogger(),
        config: {
            getNamespace: sinon.fake.returns({
                errorHandler: {},
                pages: {},
                ...config,
            }),
        },
        getService: sinon.fake.returns(service || createMockHyperview()),
    };
}

function createMockRequest({ isJSONRequest } = {}) {
    return {
        url: { pathname: '/page', protocol: 'https:', host: 'example.com', href: 'https://example.com/page' },
        isJSONRequest: isJSONRequest || sinon.fake.returns(false),
    };
}

function createMockResponse(overrides = {}) {
    return {
        headers: { set: sinon.fake() },
        props: {},
        updateProps: sinon.fake(),
        respondWithJSON: sinon.fake.resolves({ status: 200 }),
        respondWithUtf8: sinon.fake.resolves({ status: 200 }),
        respondWithStream: sinon.fake.resolves({ status: 200 }),
        ...overrides,
    };
}

function createExpectedError(overrides = {}) {
    return {
        name: 'NotFoundError',
        code: 'NOT_FOUND_ERROR',
        message: 'Page not found',
        expected: true,
        httpStatusCode: 404,
        stack: 'Error: Page not found\n    at test',
        ...overrides,
    };
}

function createUnexpectedError(overrides = {}) {
    return {
        name: 'Error',
        code: undefined,
        message: 'Something broke',
        expected: false,
        httpStatusCode: undefined,
        stack: 'Error: Something broke\n    at test',
        ...overrides,
    };
}


// --- handleUnexpectedErrors flag ---

describe('HyperviewErrorHandler() with unexpected error and handleUnexpectedErrors=false', ({ before, it }) => {
    let result;

    before(async () => {
        const handler = createErrorHandler({ handleUnexpectedErrors: false });
        const context = createMockContext();
        result = await handler(context, createMockRequest(), createMockResponse(), createUnexpectedError());
    });

    it('returns false to defer to the next error handler', () => {
        assertEqual(false, result);
    });
});

describe('HyperviewErrorHandler() with unexpected error and handleUnexpectedErrors=true (default)', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({ handleUnexpectedErrors: true });
        const pageTemplate = sinon.fake.returns('<p>error page</p>');
        const baseTemplate = sinon.fake.returns('<html>error</html>');
        const service = createMockHyperview({
            getPageData: sinon.fake.resolves({ baseTemplate: 'layouts/base.html' }),
            getPageTemplate: sinon.fake.resolves(pageTemplate),
            getBaseTemplate: sinon.fake.resolves(baseTemplate),
        });
        const context = createMockContext({ service });
        response = createMockResponse();
        await handler(context, createMockRequest(), response, createUnexpectedError({ httpStatusCode: 500 }));
    });

    it('does not return false', () => {
        assertEqual(0, response.respondWithJSON.callCount, 'should not fall back to JSON');
        assertEqual(1, response.respondWithUtf8.callCount);
    });
});


// --- JSON response fallback ---

describe('HyperviewErrorHandler() with a JSON request', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({});
        const context = createMockContext();
        const request = createMockRequest({ isJSONRequest: sinon.fake.returns(true) });
        response = createMockResponse();
        await handler(context, request, response, createExpectedError());
    });

    it('responds with JSON', () => {
        assertEqual(1, response.respondWithJSON.callCount);
    });

    it('uses the error HTTP status code', () => {
        assertEqual(404, response.respondWithJSON.firstCall.args[0]);
    });
});

describe('HyperviewErrorHandler() when no template is found for any pathname', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({});
        // No page template for either the status code page or the 'error' fallback
        const service = createMockHyperview({
            getPageData: sinon.fake.resolves({ baseTemplate: 'layouts/base.html' }),
            getPageTemplate: sinon.fake.resolves(null),
        });
        const context = createMockContext({ service });
        response = createMockResponse();
        await handler(context, createMockRequest(), response, createExpectedError());
    });

    it('falls back to JSON', () => {
        assertEqual(1, response.respondWithJSON.callCount);
    });

    it('uses the error HTTP status code', () => {
        assertEqual(404, response.respondWithJSON.firstCall.args[0]);
    });
});


// --- error page rendering ---

describe('HyperviewErrorHandler() renders the status-code error page', ({ before, it }) => {
    let service;
    let response;

    before(async () => {
        const handler = createErrorHandler({});
        const pageTemplate = sinon.fake.returns('<p>404 error page</p>');
        const baseTemplate = sinon.fake.returns('<html>404</html>');
        service = createMockHyperview({
            getPageData: sinon.fake.resolves({ baseTemplate: 'layouts/base.html' }),
            getPageTemplate: sinon.fake.resolves(pageTemplate),
            getBaseTemplate: sinon.fake.resolves(baseTemplate),
        });
        const context = createMockContext({ service });
        response = createMockResponse();
        await handler(context, createMockRequest(), response, createExpectedError());
    });

    it('looks up the page using the HTTP status code as pathname', () => {
        assertEqual('404', service.getPageData.firstCall.args[2]);
        assertEqual('404', service.getPageTemplate.firstCall.args[0]);
    });

    it('responds with the rendered error page', () => {
        assertEqual(1, response.respondWithUtf8.callCount);
        assertEqual('<html>404</html>', response.respondWithUtf8.firstCall.args[1]);
    });

    it('uses the error HTTP status code', () => {
        assertEqual(404, response.respondWithUtf8.firstCall.args[0]);
    });
});

describe('HyperviewErrorHandler() falls back to "error" pathname when status code page not found', ({ before, it }) => {
    let service;

    before(async () => {
        const handler = createErrorHandler({});
        const pageTemplate = sinon.fake.returns('<p>generic error</p>');
        const baseTemplate = sinon.fake.returns('<html>error</html>');

        // Return null for '404' page template, return valid template for 'error' page
        service = createMockHyperview({
            getPageData: sinon.fake.resolves({ baseTemplate: 'layouts/base.html' }),
            getPageTemplate: sinon.stub()
                .onFirstCall().resolves(null) // '404' page has no template
                .onSecondCall().resolves(pageTemplate), // 'error' fallback does
            getBaseTemplate: sinon.fake.resolves(baseTemplate),
        });
        const context = createMockContext({ service });
        await handler(context, createMockRequest(), createMockResponse(), createExpectedError());
    });

    it('first attempts the status code pathname', () => {
        assertEqual('404', service.getPageTemplate.firstCall.args[0]);
    });

    it('then falls back to the "error" pathname', () => {
        assertEqual('error', service.getPageTemplate.secondCall.args[0]);
    });

    it('reloads page data for the "error" pathname', () => {
        assertEqual('error', service.getPageData.secondCall.args[2]);
    });
});


// --- exposeErrorDetails ---

describe('HyperviewErrorHandler() with exposeErrorDetails=true', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({ exposeErrorDetails: true });
        const context = createMockContext();
        response = createMockResponse();
        await handler(context, createMockRequest(), response, createExpectedError());
    });

    it('calls response.updateProps with the error details', () => {
        assertEqual(1, response.updateProps.callCount);
    });

    it('includes the error name in the props', () => {
        const { error } = response.updateProps.firstCall.firstArg;
        assertEqual('NotFoundError', error.name);
    });

    it('includes the HTTP status code in the props', () => {
        const { error } = response.updateProps.firstCall.firstArg;
        assertEqual(404, error.httpStatusCode);
    });
});

describe('HyperviewErrorHandler() with exposeErrorDetails=false (default)', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({ exposeErrorDetails: false });
        const context = createMockContext();
        response = createMockResponse();
        await handler(context, createMockRequest(), response, createExpectedError());
    });

    it('does not call response.updateProps', () => {
        assertEqual(0, response.updateProps.callCount);
    });
});


// --- 405 Allow header ---

describe('HyperviewErrorHandler() with 405 MethodNotAllowed error', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({});
        const methodNotAllowedError = createExpectedError({
            name: 'MethodNotAllowedError',
            httpStatusCode: 405,
            allowedMethods: [ 'GET', 'HEAD' ],
        });
        response = createMockResponse();
        await handler(createMockContext(), createMockRequest(), response, methodNotAllowedError);
    });

    it('sets the Allow response header', () => {
        const call = response.headers.set.getCalls()
            .find((c) => c.firstArg === 'Allow');
        assert(call !== undefined, 'Allow header should be set');
        assertEqual('GET, HEAD', call.args[1]);
    });
});

describe('HyperviewErrorHandler() with non-405 error does not set Allow header', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createErrorHandler({});
        response = createMockResponse();
        await handler(createMockContext(), createMockRequest(), response, createExpectedError());
    });

    it('does not set the Allow header', () => {
        const call = response.headers.set.getCalls()
            .find((c) => c.firstArg === 'Allow');
        assertEqual(undefined, call);
    });
});
