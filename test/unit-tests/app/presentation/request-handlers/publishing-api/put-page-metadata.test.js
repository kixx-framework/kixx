import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
} from '../../../../../../src/app/presentation/lib/json-api.js';
import { putPageMetadata } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-page-metadata.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putPageMetadata publishing API handler', ({ it }) => {

    it('writes the metadata bag and responds with a committed JSON API resource', async () => {
        const service = makeHyperviewService();
        const context = makeContext({ service });
        const response = makeResponse();

        await putPageMetadata(
            context,
            makeRequest({
                pathname: [ 'blog', 'hello' ],
                attributes: { version: '3', title: 'Hello' },
            }),
            response,
        );

        assertEqual(1, service.writes.length);
        assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
        assertEqual('/blog/hello', service.writes[0].pathname);
        assertEqual('3', service.writes[0].metadata.version);
        assertEqual('Hello', service.writes[0].metadata.title);

        assertEqual(200, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('PageMetadata', response.document.data.type);
        assertEqual('/blog/hello', response.document.data.id);
        assertEqual('3', response.document.data.attributes.version);
        assertEqual('Hello', response.document.data.attributes.title);
        assertEqual(TARGET_BUILD_ID, response.document.data.meta.buildId);
    });

    it('returns the response object so route outbound middleware still runs', async () => {
        const response = makeResponse();
        const returned = await putPageMetadata(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ pathname: [ 'index' ], attributes: { version: '1' } }),
            response,
        );

        assertEqual(response, returned);
    });

    it('writes the case-folded pathname the authorization URN described', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageMetadata(
            makeContext({ service }),
            makeRequest({ pathname: [ 'Blog', 'Hello' ], attributes: { version: '1' } }),
            response,
        );

        assertEqual('/blog/hello', service.writes[0].pathname);
        assertEqual('/blog/hello', response.document.data.id);
    });

    it('stores a canonical includes map without rewriting the metadata', async () => {
        const service = makeHyperviewService();
        const attributes = {
            version: '1',
            includes: {
                hero: {
                    filename: 'content/hero.md',
                    template: true,
                },
            },
        };
        const response = makeResponse();

        await putPageMetadata(
            makeContext({ service }),
            makeRequest({ pathname: [ 'Blog' ], attributes }),
            response,
        );

        assertEqual('content/hero.md', service.writes[0].metadata.includes.hero.filename);
        assertEqual(true, service.writes[0].metadata.includes.hero.template);
        assertEqual('content/hero.md', response.document.data.attributes.includes.hero.filename);
    });

    it('rejects a non-canonical include filename as a client error naming the include key', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service }),
                makeRequest({
                    pathname: [ 'blog' ],
                    attributes: {
                        version: '1',
                        includes: { hero: { filename: 'Hero.md' } },
                    },
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertMatches('includes[hero].filename', caught.message);
        assertEqual(0, service.writes.length);
    });

    it('rejects an invalid include filename as a client error naming the include key', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service }),
                makeRequest({
                    pathname: [ 'blog' ],
                    attributes: {
                        version: '1',
                        includes: { body: { filename: '../body.md' } },
                    },
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertMatches('includes[body].filename', caught.message);
        assertEqual(0, service.writes.length);
    });

    it('writes the site root when the wildcard pathname is absent', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageMetadata(
            makeContext({ service }),
            makeRequest({ attributes: { version: '1' } }),
            response,
        );

        assertEqual('/', service.writes[0].pathname);
        assertEqual('/', response.document.data.id);
    });

    it('falls back to the current build id when no build header is sent', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageMetadata(
            makeContext({ service }),
            makeRequest({
                pathname: [ 'index' ],
                attributes: { version: '1' },
                buildId: null,
            }),
            response,
        );

        assertEqual(CURRENT_BUILD_ID, service.writes[0].buildId);
        assertEqual(CURRENT_BUILD_ID, response.document.data.meta.buildId);
    });

    it('rejects a request body which is not JSON API', async () => {
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({
                    pathname: [ 'index' ],
                    attributes: { version: '1' },
                    contentType: 'application/json',
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
        assertEqual(JSON_API_CONTENT_TYPE, caught.accept[0]);
    });

    it('rejects a JSON API resource of the wrong type', async () => {
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({
                    pathname: [ 'index' ],
                    attributes: { version: '1' },
                    type: 'Include',
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('JsonApiResourceTypeMismatch', caught.code);
    });

    it('rejects metadata without a version', async () => {
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ pathname: [ 'index' ], attributes: { title: 'No version' } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(422, caught.httpStatusCode);
    });

    it('rejects a malformed page pathname before touching the service', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service }),
                makeRequest({ pathname: [ 'blog', '..' ], attributes: { version: '1' } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual(0, service.writes.length);
    });

    it('reports a missing current build as a conflict when no build header is sent', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service, currentBuildId: null }),
                makeRequest({
                    pathname: [ 'index' ],
                    attributes: { version: '1' },
                    buildId: null,
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('CurrentBuildIdRequired', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('wraps an unexpected service failure as an internal assertion error', async () => {
        const failure = new Error('store offline');
        const service = makeHyperviewService(() => {
            throw failure;
        });
        const caught = await catchAsyncError(() => {
            return putPageMetadata(
                makeContext({ service }),
                makeRequest({ pathname: [ 'index' ], attributes: { version: '1' } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual(failure, caught.cause);
        assertMatches('writing page metadata', caught.message);
    });
});

function makeHyperviewService(onWrite) {
    const service = {
        writes: [],
        async putPageMetadata(_context, buildId, pathname, metadata) {
            service.writes.push({ buildId, pathname, metadata });
            if (onWrite) {
                return onWrite();
            }
            return { filepath: `${ pathname }/page.json` };
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
        pathname,
        attributes,
        type = 'PageMetadata',
        contentType = JSON_API_CONTENT_TYPE,
        buildId = TARGET_BUILD_ID,
    } = options ?? {};

    const headers = new Headers();
    if (buildId) {
        headers.set(BUILD_ID_HEADER, buildId);
    }

    return {
        headers,
        pathnameParams: pathname ? { pathname } : {},
        getContentMediaType() {
            return contentType;
        },
        async json() {
            return { data: { type, attributes } };
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
