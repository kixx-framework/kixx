import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
} from '../../../../../../src/app/presentation/lib/json-api.js';
import { putPageInclude } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-page-include.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putPageInclude publishing API handler', ({ it }) => {

    it('writes the include source and responds with a committed JSON API resource', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageInclude(
            makeContext({ service }),
            makeRequest({
                filepath: [ 'blog', 'hello', 'body.md' ],
                source: '# Hello',
            }),
            response,
        );

        assertEqual(1, service.writes.length);
        assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
        assertEqual('/blog/hello', service.writes[0].pathname);
        assertEqual('body.md', service.writes[0].filename);
        assertEqual('# Hello', service.writes[0].source);

        assertEqual(200, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('Include', response.document.data.type);
        assertEqual('blog/hello/body.md', response.document.data.id);
        assertEqual('/blog/hello', response.document.data.attributes.pathname);
        assertEqual('body.md', response.document.data.attributes.filename);
        assertEqual(TARGET_BUILD_ID, response.document.data.attributes.buildId);
    });

    it('returns the response object so route outbound middleware still runs', async () => {
        const response = makeResponse();
        const returned = await putPageInclude(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ filepath: [ 'body.md' ], source: 'text' }),
            response,
        );

        assertEqual(response, returned);
    });

    it('writes a root page include under the "/" pathname', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageInclude(
            makeContext({ service }),
            makeRequest({ filepath: [ 'body.md' ], source: 'text' }),
            response,
        );

        assertEqual('/', service.writes[0].pathname);
        assertEqual('body.md', response.document.data.id);
    });

    it('folds directory segments but writes the filename verbatim', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageInclude(
            makeContext({ service }),
            makeRequest({ filepath: [ 'Blog', 'MainBody.md' ], source: 'text' }),
            response,
        );

        assertEqual('/blog', service.writes[0].pathname);
        assertEqual('MainBody.md', service.writes[0].filename);
        assertEqual('blog/MainBody.md', response.document.data.id);
    });

    it('accepts any text/* media type', async () => {
        const response = makeResponse();

        await putPageInclude(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({
                filepath: [ 'body.md' ],
                source: 'text',
                contentType: 'text/markdown',
            }),
            response,
        );

        assertEqual(200, response.status);
    });

    it('falls back to the current build id when no build header is sent', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageInclude(
            makeContext({ service }),
            makeRequest({ filepath: [ 'body.md' ], source: 'text', buildId: null }),
            response,
        );

        assertEqual(CURRENT_BUILD_ID, service.writes[0].buildId);
        assertEqual(CURRENT_BUILD_ID, response.document.data.attributes.buildId);
    });

    it('rejects a non-text media type', async () => {
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({
                    filepath: [ 'body.md' ],
                    source: 'text',
                    contentType: 'application/json',
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
        assertEqual('text/*', caught.accept[0]);
    });

    it('rejects a missing Content-Type header', async () => {
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ filepath: [ 'body.md' ], source: 'text', contentType: '' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
    });

    it('rejects a missing include filepath', async () => {
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ source: 'text' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('IncludeFilepathRequired', caught.code);
    });

    it('rejects a malformed include filepath before touching the service', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service }),
                makeRequest({ filepath: [ '..', 'body.md' ], source: 'text' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(0, service.writes.length);
    });

    it('rejects an empty request body as a client error', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service }),
                makeRequest({ filepath: [ 'body.md' ], source: '' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('IncludeSourceRequired', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('reports a missing current build as a conflict when no build header is sent', async () => {
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service: makeHyperviewService(), currentBuildId: null }),
                makeRequest({ filepath: [ 'body.md' ], source: 'text', buildId: null }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('CurrentBuildIdRequired', caught.code);
    });

    it('wraps an unexpected service failure as an internal assertion error', async () => {
        const failure = new Error('store offline');
        const service = makeHyperviewService(() => {
            throw failure;
        });
        const caught = await catchAsyncError(() => {
            return putPageInclude(
                makeContext({ service }),
                makeRequest({ filepath: [ 'body.md' ], source: 'text' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual(failure, caught.cause);
        assertMatches('writing include content', caught.message);
    });
});

function makeHyperviewService(onWrite) {
    const service = {
        writes: [],
        async putIncludeContent(_context, buildId, pathname, filename, source) {
            service.writes.push({
                buildId,
                pathname,
                filename,
                source,
            });
            if (onWrite) {
                return onWrite();
            }
            return { filepath: `${ pathname }/${ filename }` };
        },
    };

    return service;
}

function makeContext(options) {
    const { service, currentBuildId = CURRENT_BUILD_ID } = options ?? {};

    return {
        runtime: { build: currentBuildId ? { id: currentBuildId } : null },
        getService(name) {
            assertEqual('Hyperview', name);
            return service;
        },
    };
}

function makeRequest(options) {
    const {
        filepath,
        source,
        contentType = 'text/plain',
        buildId = TARGET_BUILD_ID,
    } = options ?? {};

    const headers = new Headers();
    if (buildId) {
        headers.set(BUILD_ID_HEADER, buildId);
    }

    return {
        headers,
        pathnameParams: filepath ? { filepath } : {},
        getContentMediaType() {
            return contentType;
        },
        async text() {
            return source;
        },
    };
}

function makeResponse() {
    return {
        respondWithJSON(status, document, options) {
            this.status = status;
            this.document = document;
            this.options = options;
            return this;
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
