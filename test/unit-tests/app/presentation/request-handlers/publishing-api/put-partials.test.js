import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
} from '../../../../../../src/app/presentation/lib/json-api.js';
import { putPartials } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-partials.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';

// Mirrors MAX_PARTIALS_BYTES in the handler.
const MAX_PARTIALS_BYTES = 25 * 1024 * 1024;


describe('putPartials publishing API handler', ({ it }) => {

    it('writes the normalized batch through HyperviewService.putPartials', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPartials(
            makeContext({ service }),
            makeRequest({
                partials: [
                    { filepath: 'nav.html', source: '<nav/>' },
                    { filepath: 'footer.html', source: '<footer/>' },
                ],
            }),
            response,
        );

        assertEqual(1, service.writes.length);
        assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
        assertEqual(2, service.writes[0].partials.length);
        assertEqual('nav.html', service.writes[0].partials[0].filepath);
        assertEqual('<nav/>', service.writes[0].partials[0].source);
    });

    it('responds with a committed JSON API PartialTemplateSet resource', async () => {
        const response = makeResponse();

        await putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ partials: [ { filepath: 'nav.html', source: '<nav/>' } ] }),
            response,
        );

        assertEqual(200, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('PartialTemplateSet', response.document.data.type);
        assertEqual(`partials/${ TARGET_BUILD_ID }`, response.document.data.id);
        assertEqual(TARGET_BUILD_ID, response.document.data.attributes.buildId);
        assertEqual(1, response.document.data.attributes.partials.length);
        assertEqual('partials/nav.html', response.document.data.attributes.partials[0].filepath);
        assertEqual(undefined, response.document.data.attributes.partials[0].source);
    });

    it('returns the response object so route outbound middleware still runs', async () => {
        const response = makeResponse();
        const returned = await putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ partials: [] }),
            response,
        );

        assertEqual(response, returned);
    });

    it('accepts and forwards a complete empty set', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPartials(makeContext({ service }), makeRequest({ partials: [] }), response);

        assertEqual(1, service.writes.length);
        assertEqual(0, service.writes[0].partials.length);
        assertEqual(0, response.document.data.attributes.partials.length);
    });

    it('accepts a matching data.id and echoes it back', async () => {
        const response = makeResponse();

        await putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ id: `partials/${ TARGET_BUILD_ID }`, partials: [] }),
            response,
        );

        assertEqual(`partials/${ TARGET_BUILD_ID }`, response.document.data.id);
    });

    it('rejects a data.id that does not match partials/<buildId>', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service }),
            makeRequest({ id: 'partials/some-other-build', partials: [] }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('JsonApiResourceIdMismatch', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('rejects a resource type other than PartialTemplateSet', async () => {
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ type: 'Template', partials: [] }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('JsonApiResourceTypeMismatch', caught.code);
    });

    it('rejects a media type other than application/vnd.api+json', async () => {
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ partials: [], contentType: 'application/json' }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
    });

    it('rejects a missing Content-Length with a 411 before touching the body', async () => {
        let bodyAccessCount = 0;
        const request = makeRequest({
            partials: [],
            omitContentLength: true,
            onBodyAccess() {
                bodyAccessCount += 1;
            },
        });
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            request,
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(411, caught.httpStatusCode);
        assertEqual('ContentLengthRequired', caught.code);
        assertEqual(0, bodyAccessCount);
    });

    it('rejects a malformed Content-Length with a 400 before touching the body', async () => {
        let bodyAccessCount = 0;
        const request = makeRequest({
            partials: [],
            contentLength: 'twelve',
            onBodyAccess() {
                bodyAccessCount += 1;
            },
        });
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            request,
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('ContentLengthInvalid', caught.code);
        assertEqual(0, bodyAccessCount);
    });

    it('rejects a negative Content-Length as malformed', async () => {
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ partials: [], contentLength: '-5' }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('ContentLengthInvalid', caught.code);
    });

    it('rejects a declared Content-Length above 25 MiB without touching the body', async () => {
        let bodyAccessCount = 0;
        const request = makeRequest({
            partials: [],
            contentLength: MAX_PARTIALS_BYTES + 1,
            onBodyAccess() {
                bodyAccessCount += 1;
            },
        });
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            request,
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('PayloadTooLargeError', caught.name);
        assertEqual(413, caught.httpStatusCode);
        assertEqual(0, bodyAccessCount);
    });

    it('rejects an oversized body whose Content-Length understated the actual bytes', async () => {
        // The size cap is enforced against streamed bytes before JSON parsing, so
        // the oversized body does not need to be well-formed JSON:API.
        const oversizedBody = new Uint8Array(MAX_PARTIALS_BYTES + 1);
        const request = makeRawRequest(oversizedBody, { contentLength: 10 });
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            request,
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('PayloadTooLargeError', caught.name);
        assertEqual(413, caught.httpStatusCode);
    });

    it('rejects a malformed JSON body using the same contract as request.json()', async () => {
        const request = makeRawRequest(new TextEncoder().encode('{ not valid json'));
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            request,
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertMatches('Invalid JSON in request body', caught.message);
    });

    it('rejects an invalid partial entry via the Form, without writing', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service }),
            makeRequest({ partials: [ { filepath: '../escape.html', source: '<nav/>' } ] }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(0, service.writes.length);
    });

    it('requires the build id header, which has no current-build fallback', async () => {
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service: makeHyperviewService() }),
            makeRequest({ partials: [], buildId: null }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('BuildIdRequired', caught.code);
    });

    it('refuses to write into the current build', async () => {
        const service = makeHyperviewService();
        const caught = await catchAsyncError(() => putPartials(
            makeContext({ service }),
            makeRequest({ partials: [], buildId: CURRENT_BUILD_ID }),
            makeResponse(),
        ));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(0, service.writes.length);
    });

    it('allows staging partials before the site has any current build', async () => {
        const service = makeHyperviewService();
        const response = makeResponse();

        await putPartials(
            makeContext({ service, currentBuildId: null }),
            makeRequest({ partials: [] }),
            response,
        );

        assertEqual(200, response.status);
        assertEqual(TARGET_BUILD_ID, service.writes[0].buildId);
    });
});

function makeHyperviewService(onWrite) {
    const service = { writes: [] };

    service.putPartials = async (_context, buildId, partials) => {
        service.writes.push({ buildId, partials });
        if (onWrite) {
            return onWrite();
        }
        return partials.map(({ filepath }) => ({ filepath: `partials/${ filepath }` }));
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
        id,
        type = 'PartialTemplateSet',
        partials,
        contentType = JSON_API_CONTENT_TYPE,
        buildId = TARGET_BUILD_ID,
        contentLength,
        omitContentLength = false,
        onBodyAccess,
    } = options ?? {};

    const data = { type, attributes: { partials } };
    if (id) {
        data.id = id;
    }

    const bodyBytes = new TextEncoder().encode(JSON.stringify({ data }));

    return makeRawRequest(bodyBytes, {
        contentType,
        buildId,
        contentLength,
        omitContentLength,
        onBodyAccess,
    });
}

function makeRawRequest(bodyBytes, options) {
    const {
        contentType = JSON_API_CONTENT_TYPE,
        buildId = TARGET_BUILD_ID,
        contentLength,
        omitContentLength = false,
        onBodyAccess,
    } = options ?? {};

    const headers = new Headers();
    if (buildId) {
        headers.set(BUILD_ID_HEADER, buildId);
    }
    if (!omitContentLength) {
        const declared = typeof contentLength !== 'undefined' ? contentLength : bodyBytes.byteLength;
        headers.set('content-length', String(declared));
    }

    let bodyStream = null;

    return {
        headers,
        // Built lazily so a test can prove the handler rejected the request
        // before it reached for the body stream at all.
        get body() {
            if (onBodyAccess) {
                onBodyAccess();
            }
            bodyStream = bodyStream || makeBodyStream(bodyBytes);
            return bodyStream;
        },
        getContentMediaType() {
            return contentType;
        },
    };
}

function makeBodyStream(bytes) {
    return new ReadableStream({
        start(controller) {
            if (bytes.byteLength > 0) {
                controller.enqueue(bytes);
            }
            controller.close();
        },
    });
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
