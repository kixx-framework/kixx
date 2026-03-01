import { describe } from 'kixx-test';
import { assert, assertEqual, doesMatch } from 'kixx-assert';
import sinon from 'sinon';
import HyperviewRequestHandler from '../../../lib/hyperview/request-handler.js';

const createRequestHandler = HyperviewRequestHandler;


function createMockLogger() {
    const child = { debug: sinon.fake(), info: sinon.fake(), warn: sinon.fake() };
    return { createChild: sinon.fake.returns(child) };
}

function createMockHyperviewService(overrides = {}) {
    return {
        getStaticFile: sinon.fake.resolves(null),
        getPageData: sinon.fake.resolves(null),
        getPageTemplate: sinon.fake.resolves(null),
        getPageMarkdown: sinon.fake.resolves({}),
        getBaseTemplate: sinon.fake.resolves(null),
        ...overrides,
    };
}

function createMockContext({ service, config } = {}) {
    return {
        logger: createMockLogger(),
        config: {
            getNamespace: sinon.fake.returns({
                pages: {},
                staticFiles: {},
                ...config,
            }),
        },
        getService: sinon.fake.returns(service || createMockHyperviewService()),
    };
}

function createMockRequest({ url, ...overrides } = {}) {
    return {
        url: {
            pathname: '/page',
            protocol: 'https:',
            host: 'example.com',
            href: 'https://example.com/page',
            ...url,
        },
        isJSONRequest: sinon.fake.returns(false),
        isHeadRequest: sinon.fake.returns(false),
        ifNoneMatch: null,
        ifModifiedSince: null,
        ...overrides,
    };
}

function createMockResponse(overrides = {}) {
    return {
        headers: { set: sinon.fake() },
        props: {},
        respond: sinon.fake.resolves({ status: 304 }),
        respondWithJSON: sinon.fake.resolves({ status: 200 }),
        respondWithUtf8: sinon.fake.resolves({ status: 200 }),
        respondWithStream: sinon.fake.resolves({ status: 200 }),
        ...overrides,
    };
}


// --- path validation ---

describe('HyperviewRequestHandler() with ".." path traversal', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        try {
            await handler(
                createMockContext(),
                createMockRequest({ url: { pathname: '/../etc/passwd' } }),
                createMockResponse()
            );
        } catch (err) {
            error = err;
        }
    });

    it('throws BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });

    it('includes the invalid path in the error message', () => {
        assert(doesMatch('/../etc/passwd', error.message));
    });
});

describe('HyperviewRequestHandler() with double slashes in path', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        try {
            await handler(
                createMockContext(),
                createMockRequest({ url: { pathname: '/blog//post' } }),
                createMockResponse()
            );
        } catch (err) {
            error = err;
        }
    });

    it('throws BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });
});

describe('HyperviewRequestHandler() with dot-prefixed path segment', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        try {
            await handler(
                createMockContext(),
                createMockRequest({ url: { pathname: '/.hidden' } }),
                createMockResponse()
            );
        } catch (err) {
            error = err;
        }
    });

    it('throws BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });
});

describe('HyperviewRequestHandler() with disallowed characters in path', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        try {
            await handler(
                createMockContext(),
                // Space is not in [a-z0-9_.-]
                createMockRequest({ url: { pathname: '/my page' } }),
                createMockResponse()
            );
        } catch (err) {
            error = err;
        }
    });

    it('throws BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });
});


// --- static file serving ---

describe('HyperviewRequestHandler() when static file is found', ({ before, it }) => {
    const mockReadStream = {};
    const mockFile = {
        sizeBytes: 2048,
        contentType: 'text/css',
        modifiedDate: new Date('2024-06-01T00:00:00Z'),
        computeHash: sinon.fake.resolves(null),
        createReadStream: sinon.fake.returns(mockReadStream),
    };
    let response;

    before(async () => {
        const handler = createRequestHandler({});
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(mockFile),
        });
        const context = createMockContext({ service });
        const request = createMockRequest({ url: { pathname: '/static/style.css' } });
        response = createMockResponse();
        await handler(context, request, response);
    });

    it('returns the stream response', () => {
        assertEqual(1, response.respondWithStream.callCount);
    });

    it('sets the last-modified header', () => {
        const call = response.headers.set.getCalls()
            .find((c) => c.firstArg === 'last-modified');
        assert(call !== undefined, 'last-modified header should be set');
        assertEqual(mockFile.modifiedDate.toUTCString(), call.args[1]);
    });

    it('sets the cache-control header', () => {
        const call = response.headers.set.getCalls()
            .find((c) => c.firstArg === 'cache-control');
        assert(call !== undefined, 'cache-control header should be set');
    });

    it('passes content length to respondWithStream', () => {
        assertEqual(2048, response.respondWithStream.firstCall.args[2].contentLength);
    });
});

describe('HyperviewRequestHandler() static file with matching If-None-Match', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createRequestHandler({ useEtag: true });
        const mockFile = {
            sizeBytes: 512,
            contentType: 'text/css',
            modifiedDate: new Date(),
            computeHash: sinon.fake.resolves('abc123'),
            createReadStream: sinon.fake.returns({}),
        };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(mockFile),
        });
        const context = createMockContext({ service });
        const request = createMockRequest({
            url: { pathname: '/static/style.css' },
            ifNoneMatch: 'abc123',
        });
        response = createMockResponse();
        await handler(context, request, response);
    });

    it('responds with 304', () => {
        assertEqual(1, response.respond.callCount);
        assertEqual(304, response.respond.firstCall.firstArg);
    });

    it('does not stream the file body', () => {
        assertEqual(0, response.respondWithStream.callCount);
    });
});

describe('HyperviewRequestHandler() static file with If-Modified-Since not exceeded', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createRequestHandler({});
        const modifiedDate = new Date('2024-01-01T00:00:00Z');
        const mockFile = {
            sizeBytes: 512,
            contentType: 'text/css',
            modifiedDate,
            computeHash: sinon.fake.resolves(null),
            createReadStream: sinon.fake.returns({}),
        };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(mockFile),
        });
        const context = createMockContext({ service });
        // If-Modified-Since is AFTER modifiedDate, so resource has not changed
        const request = createMockRequest({
            url: { pathname: '/static/style.css' },
            ifModifiedSince: new Date('2024-06-01T00:00:00Z'),
        });
        response = createMockResponse();
        await handler(context, request, response);
    });

    it('responds with 304', () => {
        assertEqual(1, response.respond.callCount);
        assertEqual(304, response.respond.firstCall.firstArg);
    });
});

describe('HyperviewRequestHandler() directory path appends index file', ({ before, it }) => {
    let service;

    before(async () => {
        // No static file, no page → NotFoundError, but we only care about what
        // getStaticFile was called with
        const handler = createRequestHandler({});
        service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(null),
        });
        const context = createMockContext({ service });
        const request = createMockRequest({ url: { pathname: '/static/' } });
        try {
            await handler(context, request, createMockResponse());
        } catch {
            // NotFoundError expected — we only care about the static file pathname
        }
    });

    it('appends the default index filename to directory paths for static file lookup', () => {
        const staticPath = service.getStaticFile.firstCall.firstArg;
        assertEqual('/static/index.html', staticPath);
    });
});


// --- page rendering ---

describe('HyperviewRequestHandler() when no static file and page not found', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(null),
        });
        const context = createMockContext({ service });
        try {
            await handler(context, createMockRequest(), createMockResponse());
        } catch (err) {
            error = err;
        }
    });

    it('throws NotFoundError', () => {
        assertEqual('NotFoundError', error.name);
    });
});

describe('HyperviewRequestHandler() when page is found and renders', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createRequestHandler({});
        const page = {
            baseTemplate: 'layouts/base.html',
            title: 'Test Page',
            canonicalURL: 'https://example.com/page',
            href: 'https://example.com/page',
            openGraph: {},
        };
        const pageTemplate = sinon.fake.returns('<main>page body</main>');
        const baseTemplate = sinon.fake.returns('<html><main>page body</main></html>');
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(page),
            getPageTemplate: sinon.fake.resolves(pageTemplate),
            getPageMarkdown: sinon.fake.resolves({ body: '<p>content</p>' }),
            getBaseTemplate: sinon.fake.resolves(baseTemplate),
        });
        const context = createMockContext({ service });
        response = createMockResponse();
        await handler(context, createMockRequest(), response);
    });

    it('responds with UTF-8', () => {
        assertEqual(1, response.respondWithUtf8.callCount);
    });

    it('uses status 200', () => {
        assertEqual(200, response.respondWithUtf8.firstCall.args[0]);
    });

    it('passes rendered hypertext to respondWithUtf8', () => {
        assertEqual('<html><main>page body</main></html>', response.respondWithUtf8.firstCall.args[1]);
    });
});

describe('HyperviewRequestHandler() with JSON request and allowJSON enabled', ({ before, it }) => {
    let response;

    before(async () => {
        const handler = createRequestHandler({ allowJSON: true });
        const page = {
            baseTemplate: 'layouts/base.html',
            title: 'Test Page',
        };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(page),
        });
        const context = createMockContext({ service });
        const request = createMockRequest({ isJSONRequest: sinon.fake.returns(true) });
        response = createMockResponse();
        await handler(context, request, response);
    });

    it('responds with JSON', () => {
        assertEqual(1, response.respondWithJSON.callCount);
    });

    it('passes status 200', () => {
        assertEqual(200, response.respondWithJSON.firstCall.args[0]);
    });
});

describe('HyperviewRequestHandler() when page template is missing', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        const page = { baseTemplate: 'layouts/base.html' };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(page),
            getPageTemplate: sinon.fake.resolves(null),
            getPageMarkdown: sinon.fake.resolves({}),
            getBaseTemplate: sinon.fake.resolves(sinon.fake.returns('<html/>')),
        });
        const context = createMockContext({ service });
        try {
            await handler(context, createMockRequest(), createMockResponse());
        } catch (err) {
            error = err;
        }
    });

    it('throws AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });
});

describe('HyperviewRequestHandler() when base template is missing', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        const page = { baseTemplate: 'layouts/base.html' };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(page),
            getPageTemplate: sinon.fake.resolves(sinon.fake.returns('<main/>')),
            getPageMarkdown: sinon.fake.resolves({}),
            getBaseTemplate: sinon.fake.resolves(null),
        });
        const context = createMockContext({ service });
        try {
            await handler(context, createMockRequest(), createMockResponse());
        } catch (err) {
            error = err;
        }
    });

    it('throws AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });
});

describe('HyperviewRequestHandler() when baseTemplate is not configured', ({ before, it }) => {
    let error;

    before(async () => {
        const handler = createRequestHandler({});
        // Page data has no baseTemplate, no options.baseTemplate, no config.baseTemplate
        const page = { title: 'Test' };
        const service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(page),
        });
        const context = createMockContext({ service });
        try {
            await handler(context, createMockRequest(), createMockResponse());
        } catch (err) {
            error = err;
        }
    });

    it('throws AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });

    it('error message mentions baseTemplate', () => {
        assert(doesMatch('baseTemplate', error.message));
    });
});

describe('HyperviewRequestHandler() normalizes index file paths', ({ before, it }) => {
    let service;

    before(async () => {
        const handler = createRequestHandler({});
        service = createMockHyperviewService({
            getStaticFile: sinon.fake.resolves(null),
            getPageData: sinon.fake.resolves(null),
        });
        const context = createMockContext({ service });
        // /blog/index.html should resolve to the /blog/ page
        const request = createMockRequest({ url: { pathname: '/blog/index.html' } });
        try {
            await handler(context, request, createMockResponse());
        } catch {
            // NotFoundError expected
        }
    });

    it('strips the index filename from the pathname before page lookup', () => {
        const pathname = service.getPageData.firstCall.args[2];
        assertEqual('/blog/', pathname);
    });
});
