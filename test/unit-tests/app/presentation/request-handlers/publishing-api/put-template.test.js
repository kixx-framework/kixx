import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
} from '../../../../../../src/app/presentation/lib/json-api.js';
import {
    putBaseTemplate,
    putPageTemplate,
    putPartialTemplate,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-template.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';

// Each handler is bound to one template kind, which selects the Hyperview
// service method and is echoed in the response attributes.
const HANDLERS = [
    { kind: 'base', handler: putBaseTemplate, method: 'putBaseTemplate' },
    { kind: 'page', handler: putPageTemplate, method: 'putPageTemplate' },
    { kind: 'partial', handler: putPartialTemplate, method: 'putPartial' },
];


describe('putTemplate publishing API handlers', ({ describe, it }) => {

    for (const { kind, handler, method } of HANDLERS) {
        describe(`${ kind } template handler`, ({ it }) => {

            it('writes through the kind-specific service method', async () => {
                const service = makeHyperviewService();
                const response = makeResponse();

                await handler(
                    makeContext({ service }),
                    makeRequest({ filepath: [ 'website.html' ], source: '<h1></h1>' }),
                    response,
                );

                assertEqual(1, service.writes.length);
                assertEqual(method, service.writes[0].method);
                assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
                assertEqual('website.html', service.writes[0].filepath);
                assertEqual('<h1></h1>', service.writes[0].source);
            });

            it('responds with a committed JSON API resource naming its kind', async () => {
                const response = makeResponse();

                await handler(
                    makeContext({ service: makeHyperviewService() }),
                    makeRequest({ filepath: [ 'website.html' ], source: 'source' }),
                    response,
                );

                assertEqual(200, response.status);
                assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
                assertEqual('Template', response.document.data.type);
                assertEqual('website.html', response.document.data.id);
                assertEqual(kind, response.document.data.attributes.kind);
                assertEqual('website.html', response.document.data.attributes.filepath);
                assertEqual(TARGET_BUILD_ID, response.document.data.attributes.buildId);
            });
        });
    }

    it('returns the response object so route outbound middleware still runs', async () => {
        const response = makeResponse();
        const returned = await putBaseTemplate(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ filepath: [ 'website.html' ], source: 'source' }),
            response,
        );

        assertEqual(response, returned);
    });

    it('joins nested wildcard segments into the logical filepath', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPartialTemplate(
            makeContext({ service }),
            makeRequest({ filepath: [ 'blog', 'byline.html' ], source: 'source' }),
            response,
        );

        assertEqual('blog/byline.html', service.writes[0].filepath);
        assertEqual('blog/byline.html', response.document.data.id);
    });

    it('reports the prefix-less URL filepath, not the store\'s prefixed key', async () => {
        // The store returns `base/website.html` because that is how Hyperview
        // resolves template names internally, but the API contract already
        // encodes the kind in the URL path.
        const service = makeHyperviewService(() => {
            return { filepath: 'base/website.html' };
        });
        const response = makeResponse();

        await putBaseTemplate(
            makeContext({ service }),
            makeRequest({ filepath: [ 'website.html' ], source: 'source' }),
            response,
        );

        assertEqual('website.html', response.document.data.id);
        assertEqual('website.html', response.document.data.attributes.filepath);
    });

    it('folds the filepath case to the key Hyperview stores it under', async () => {
        // HyperviewService#normalizeTemplateId folds every template id on reads
        // *and* writes, so the store never sees the case the client sent. Folding
        // here does not change where the template lands; it keeps the reported
        // filepath naming the key that was actually written. Reporting the raw URL
        // wildcard would hand the client a filepath matching no stored key.
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPageTemplate(
            makeContext({ service }),
            makeRequest({ filepath: [ 'Blog', 'MainPage.HTML' ], source: 'source' }),
            response,
        );

        assertEqual('blog/mainpage.html', service.writes[0].filepath);
        assertEqual('blog/mainpage.html', response.document.data.id);
        assertEqual('blog/mainpage.html', response.document.data.attributes.filepath);
    });

    it('rejects a media type other than text/plain', async () => {
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({
                    filepath: [ 'website.html' ],
                    source: 'source',
                    contentType: 'text/html',
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
        assertEqual('text/plain', caught.accept[0]);
    });

    it('rejects a missing template filepath', async () => {
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ source: 'source' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('TemplateFilepathRequired', caught.code);
    });

    it('rejects an empty path segment so one template has exactly one URL', async () => {
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ filepath: [ 'website.html', '' ], source: 'source' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('EmptyPathSegment', caught.code);
    });

    it('rejects path traversal in the template filepath', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service }),
                makeRequest({ filepath: [ '..', 'website.html' ], source: 'source' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertMatches('Invalid pathname', caught.message);
        assertEqual(0, service.writes.length);
    });

    it('rejects an empty request body as a client error', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service }),
                makeRequest({ filepath: [ 'website.html' ], source: '' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('TemplateSourceRequired', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('requires the build id header, which has no current-build fallback', async () => {
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service: makeHyperviewService() }),
                makeRequest({ filepath: [ 'website.html' ], source: 'source', buildId: null }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('BuildIdRequired', caught.code);
    });

    it('refuses to write into the current build', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service }),
                makeRequest({
                    filepath: [ 'website.html' ],
                    source: 'source',
                    buildId: CURRENT_BUILD_ID,
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('allows staging templates before the site has any current build', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putBaseTemplate(
            makeContext({ service, currentBuildId: null }),
            makeRequest({ filepath: [ 'website.html' ], source: 'source' }),
            response,
        );

        assertEqual(200, response.status);
        assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
    });

    it('wraps an unexpected service failure as an internal assertion error', async () => {
        const failure = new Error('store offline');
        const service = makeHyperviewService(() => {
            throw failure;
        });
        const caught = await catchAsyncError(() => {
            return putBaseTemplate(
                makeContext({ service }),
                makeRequest({ filepath: [ 'website.html' ], source: 'source' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual(failure, caught.cause);
        assertMatches('writing a template', caught.message);
    });
});

function makeHyperviewService(onWrite) {
    const service = { writes: [] };

    for (const { method } of HANDLERS) {
        service[method] = async (_context, buildId, filepath, source) => {
            service.writes.push({
                method,
                buildId,
                filepath,
                source,
            });
            if (onWrite) {
                return onWrite();
            }
            return { filepath };
        };
    }

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
