import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
} from '../../../../../../src/app/presentation/lib/json-api.js';
import { putStaticAsset } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-static-asset.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';

// Mirrors MAX_ASSET_BYTES in the handler, which stays under the 25 MiB
// Cloudflare KV value cap.
const MAX_ASSET_BYTES = 24 * 1024 * 1024;


describe('putStaticAsset publishing API handler', ({ it }) => {

    it('writes the buffered bytes into the target build namespace', async () => {
        const store = makeStaticFileStore();
        const response = makeResponse();

        await putStaticAsset(
            makeContext({ store }),
            makeRequest({
                filepath: [ 'images', 'logo.png' ],
                body: bytes([ 1, 2, 3, 4 ]),
                contentType: 'image/png',
            }),
            response,
        );

        assertEqual(1, store.writes.length);
        assertEqual('images/logo.png', store.writes[0].key);
        assertEqual(TARGET_BUILD_ID, store.writes[0].namespace);
        assertEqual('image/png', store.writes[0].contentType);
        assertEqual(4, store.writes[0].body.byteLength);
    });

    it('responds with the committed JSON API resource parts', async () => {
        const store = makeStaticFileStore();
        const response = makeResponse();

        await putStaticAsset(
            makeContext({ store }),
            makeRequest({
                filepath: [ 'images', 'logo.png' ],
                body: bytes([ 1, 2, 3, 4 ]),
                contentType: 'image/png',
            }),
            response,
        );

        assertEqual(200, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('StaticAsset', response.document.data.type);
        assertEqual('images/logo.png', response.document.data.id);

        const { attributes } = response.document.data;
        assertEqual('images/logo.png', attributes.filepath);
        assertEqual(TARGET_BUILD_ID, attributes.buildId);
        assertEqual('image/png', attributes.contentType);
        assertEqual(4, attributes.contentLength);
        assertEqual('etag-images/logo.png', attributes.etag);
    });

    it('returns the response object so route outbound middleware still runs', async () => {
        const response = makeResponse();
        const returned = await putStaticAsset(
            makeContext({ store: makeStaticFileStore() }),
            makeRequest({ filepath: [ 'logo.png' ], body: bytes([ 1 ]) }),
            response,
        );

        assertEqual(response, returned);
    });

    it('reports the store\'s written key as the resource id', async () => {
        const store = makeStaticFileStore((args) => {
            return {
                key: `normalized/${ args.key }`,
                contentType: args.contentType,
                contentLength: args.body.byteLength,
                etag: 'etag-normalized',
            };
        });
        const response = makeResponse();

        await putStaticAsset(
            makeContext({ store }),
            makeRequest({ filepath: [ 'logo.png' ], body: bytes([ 1 ]) }),
            response,
        );

        assertEqual('normalized/logo.png', response.document.data.id);
        assertEqual('normalized/logo.png', response.document.data.attributes.filepath);
    });

    it('preserves the filepath case, which asset reads resolve verbatim', async () => {
        const store = makeStaticFileStore();

        await putStaticAsset(
            makeContext({ store }),
            makeRequest({ filepath: [ 'Images', 'Logo.png' ], body: bytes([ 1 ]) }),
            makeResponse(),
        );

        assertEqual('Images/Logo.png', store.writes[0].key);
    });

    it('rejects a missing static asset filepath', async () => {
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store: makeStaticFileStore() }),
                makeRequest({ body: bytes([ 1 ]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('StaticAssetFilepathRequired', caught.code);
    });

    it('rejects path traversal in the asset filepath', async () => {
        const store = makeStaticFileStore();
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({ filepath: [ '..', 'logo.png' ], body: bytes([ 1 ]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertMatches('Invalid pathname', caught.message);
        assertEqual(0, store.writes.length);
    });

    it('rejects an empty path segment, which would alias one asset to two store keys', async () => {
        const store = makeStaticFileStore();
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({ filepath: [ '', 'logo.png' ], body: bytes([ 1 ]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('EmptyPathSegment', caught.code);
        assertMatches('Static asset filepath', caught.message);
        assertEqual(0, store.writes.length);
    });

    it('rejects a trailing slash, which arrives as a trailing empty segment', async () => {
        const store = makeStaticFileStore();
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({ filepath: [ 'images', 'logo.png', '' ], body: bytes([ 1 ]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('EmptyPathSegment', caught.code);
        assertEqual(0, store.writes.length);
    });

    it('rejects a missing Content-Type as a malformed request, not an unsupported type', async () => {
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store: makeStaticFileStore() }),
                makeRequest({
                    filepath: [ 'logo.png' ],
                    body: bytes([ 1 ]),
                    contentType: '',
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('ContentTypeRequired', caught.code);
    });

    it('rejects an oversized upload from its declared Content-Length without touching the body', async () => {
        let bodyAccessCount = 0;
        const request = makeRequest({
            filepath: [ 'logo.png' ],
            body: bytes([ 1 ]),
            contentLength: MAX_ASSET_BYTES + 1,
            onBodyAccess() {
                bodyAccessCount += 1;
            },
        });
        const caught = await catchAsyncError(() => {
            return putStaticAsset(makeContext({ store: makeStaticFileStore() }), request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('PayloadTooLargeError', caught.name);
        assertEqual(413, caught.httpStatusCode);
        assertEqual(0, bodyAccessCount);
    });

    it('rejects an oversized upload whose Content-Length understated the body', async () => {
        const request = makeRequest({
            filepath: [ 'logo.png' ],
            body: new Uint8Array(MAX_ASSET_BYTES + 1),
            contentLength: 10,
        });
        const caught = await catchAsyncError(() => {
            return putStaticAsset(makeContext({ store: makeStaticFileStore() }), request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('PayloadTooLargeError', caught.name);
        assertEqual(413, caught.httpStatusCode);
    });

    it('rejects a bodyless request as a client error', async () => {
        const store = makeStaticFileStore();
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({ filepath: [ 'logo.png' ], body: null }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('StaticAssetSourceRequired', caught.code);
        assertEqual(0, store.writes.length);
    });

    it('rejects an empty request body as a client error', async () => {
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store: makeStaticFileStore() }),
                makeRequest({ filepath: [ 'logo.png' ], body: bytes([]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('StaticAssetSourceRequired', caught.code);
    });

    it('requires the build id header, which has no current-build fallback', async () => {
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store: makeStaticFileStore() }),
                makeRequest({ filepath: [ 'logo.png' ], body: bytes([ 1 ]), buildId: null }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('BuildIdRequired', caught.code);
    });

    it('refuses to write into the current build', async () => {
        const store = makeStaticFileStore();
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({
                    filepath: [ 'logo.png' ],
                    body: bytes([ 1 ]),
                    buildId: CURRENT_BUILD_ID,
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(0, store.writes.length);
    });

    it('allows staging assets before the site has any current build', async () => {
        const store = makeStaticFileStore();
        const response = makeResponse();

        await putStaticAsset(
            makeContext({ store, currentBuildId: null }),
            makeRequest({ filepath: [ 'logo.png' ], body: bytes([ 1 ]) }),
            response,
        );

        assertEqual(200, response.status);
        assertEqual(TARGET_BUILD_ID, store.writes[0].namespace);
    });

    it('wraps an unexpected store failure as an internal assertion error', async () => {
        const failure = new Error('store offline');
        const store = makeStaticFileStore(() => {
            throw failure;
        });
        const caught = await catchAsyncError(() => {
            return putStaticAsset(
                makeContext({ store }),
                makeRequest({ filepath: [ 'logo.png' ], body: bytes([ 1 ]) }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual(failure, caught.cause);
        assertMatches('writing a static asset', caught.message);
    });
});

function bytes(values) {
    return new Uint8Array(values);
}

function makeStaticFileStore(onWrite) {
    const store = {
        writes: [],
        async write(_context, args) {
            store.writes.push(args);
            if (onWrite) {
                return onWrite(args);
            }
            return {
                key: args.key,
                contentType: args.contentType,
                contentLength: args.body.byteLength,
                etag: `etag-${ args.key }`,
            };
        },
    };

    return store;
}

function makeContext(options) {
    const { store, currentBuildId = CURRENT_BUILD_ID } = options ?? {};

    return {
        runtime: { build: currentBuildId ? { id: currentBuildId } : null },
        getService(name) {
            assertEqual('StaticFileStore', name);
            return store;
        },
    };
}

function makeRequest(options) {
    const {
        filepath,
        body,
        contentType = 'image/png',
        buildId = TARGET_BUILD_ID,
        contentLength,
        onBodyAccess,
    } = options ?? {};

    const headers = new Headers();
    if (buildId) {
        headers.set(BUILD_ID_HEADER, buildId);
    }
    if (typeof contentLength === 'number') {
        headers.set('content-length', String(contentLength));
    } else if (body) {
        headers.set('content-length', String(body.byteLength));
    }

    let bodyStream = null;

    return {
        headers,
        pathnameParams: filepath ? { filepath } : {},
        // Built lazily so a test can prove the handler rejected the request
        // before it reached for the body stream at all. A bodyless request
        // (e.g. an empty PUT) has a null body stream.
        get body() {
            if (onBodyAccess) {
                onBodyAccess();
            }
            if (!body) {
                return null;
            }
            bodyStream = bodyStream || makeBodyStream(body);
            return bodyStream;
        },
        getContentMediaType() {
            return contentType;
        },
    };
}

function makeBodyStream(body) {
    return new ReadableStream({
        start(controller) {
            if (body.byteLength > 0) {
                controller.enqueue(body);
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
