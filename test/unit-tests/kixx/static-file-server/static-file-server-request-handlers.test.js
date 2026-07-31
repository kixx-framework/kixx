import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    StaticAssetRequestHandler,
    StaticFileRequestHandler,
} from '../../../../src/kixx/static-file-server/static-file-server-request-handlers.js';

import ServerResponse from '../../../../src/kixx/http-router/server-response.js';
import { NO_BUILD_ID_SEGMENT } from '../../../../src/kixx/utils/build-id.js';


function makeContext(store, buildId = 'current-build') {
    return {
        runtime: buildId === undefined ? {} : { build: { id: buildId } },
        getService(name) {
            assertEqual('StaticFileStore', name);
            return store;
        },
    };
}

function makeContextWithoutBuild(store) {
    return {
        runtime: {},
        getService(name) {
            assertEqual('StaticFileStore', name);
            return store;
        },
    };
}

function makeStore(result) {
    const tracker = new MockTracker();
    const store = {
        read: tracker.fn(() => Promise.resolve(result)),
    };
    return { store, tracker };
}

function makeRequest(pathname, options) {
    const {
        ifModifiedSince = null,
        ifNoneMatch = null,
        isHead = false,
        pathnameParams = null,
    } = options ?? {};

    return {
        ifModifiedSince,
        ifNoneMatch,
        pathnameParams,
        url: { pathname },
        isHeadRequest() {
            return isHead;
        },
    };
}

function makeResponse() {
    return new ServerResponse();
}

function makeResult(options) {
    const tracker = new MockTracker();
    const body = { cancel: tracker.fn(() => Promise.resolve()) };
    const result = {
        body,
        contentLength: 42,
        contentType: 'text/css',
        etag: '"asset-etag"',
        lastModified: new Date('2026-01-02T03:04:05.900Z'),
        ...options,
    };
    return { body, result, tracker };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertError(error, name, code) {
    assert(error, 'expected an error to be thrown');
    assertEqual(name, error.name);
    assertEqual(code, error.code);
}


describe('static-file-server-request-handlers', ({ describe }) => {
    describe('StaticFileRequestHandler', ({ it }) => {
        it('reads the leading-slash-stripped pathname in the current build namespace', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticFileRequestHandler()(makeContext(store), makeRequest('/styles/main.css'), makeResponse());

            const options = store.read.mock.getCall(0).arguments[1];
            assertEqual('styles/main.css', options.key);
            assertEqual('current-build', options.namespace);
        });

        it('uses a null namespace when the runtime has no build', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticFileRequestHandler()(makeContextWithoutBuild(store), makeRequest('/site.css'), makeResponse());

            assertEqual(null, store.read.mock.getCall(0).arguments[1].namespace);
        });

        it('forwards the computeEtag option to the store', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticFileRequestHandler({ computeEtag: false })(makeContext(store), makeRequest('/site.css'), makeResponse());

            assertEqual(false, store.read.mock.getCall(0).arguments[1].computeEtag);
        });

        it('treats the root pathname as a miss without reading the store', async () => {
            const { store } = makeStore(null);
            const error = await catchAsyncError(() => StaticFileRequestHandler()(makeContext(store), makeRequest('/'), makeResponse()));

            assertError(error, 'NotFoundError', 'NOT_FOUND_ERROR');
            assertEqual(0, store.read.mock.callCount());
        });

        it('returns the untouched response for a root miss when configured to fall through', async () => {
            const { store } = makeStore(null);
            const response = makeResponse();

            const result = await StaticFileRequestHandler({ throwNotFound: false })(makeContext(store), makeRequest('/'), response);

            assertEqual(response, result);
            assertEqual(0, store.read.mock.callCount());
        });

        it('throws on a store miss, or falls through when configured', async () => {
            const first = makeStore(null);
            const error = await catchAsyncError(() => StaticFileRequestHandler()(makeContext(first.store), makeRequest('/missing'), makeResponse()));
            assertError(error, 'NotFoundError', 'NOT_FOUND_ERROR');

            const second = makeStore(null);
            const response = makeResponse();
            const result = await StaticFileRequestHandler({ throwNotFound: false })(makeContext(second.store), makeRequest('/missing'), response);
            assertEqual(response, result);
        });

        it('uses the pathname option instead of the request pathname', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticFileRequestHandler({ pathname: '/rewritten.css' })(makeContext(store), makeRequest('/original.css'), makeResponse());

            assertEqual('rewritten.css', store.read.mock.getCall(0).arguments[1].key);
        });

        it('uses an explicit content type over the store value', async () => {
            const { result } = makeResult({ contentType: 'text/plain' });
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler({ contentType: 'text/css' })(makeContext(store), makeRequest('/site.css'), makeResponse());

            assertEqual('text/css', response.headers.get('content-type'));
        });

        it('uses the store content type when no override is configured', async () => {
            const { result } = makeResult({ contentType: 'text/plain' });
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.txt'), makeResponse());

            assertEqual('text/plain', response.headers.get('content-type'));
        });

        it('sets the revalidation cache policy by default and honors an override', async () => {
            const first = makeStore(makeResult().result);
            const defaultResponse = await StaticFileRequestHandler()(makeContext(first.store), makeRequest('/site.css'), makeResponse());
            assertEqual('public, max-age=0, must-revalidate', defaultResponse.headers.get('cache-control'));

            const second = makeStore(makeResult().result);
            const customResponse = await StaticFileRequestHandler({ cacheControl: 'public, max-age=60' })(makeContext(second.store), makeRequest('/site.css'), makeResponse());
            assertEqual('public, max-age=60', customResponse.headers.get('cache-control'));
        });

        it('skips later handlers only when configured after finding a file', async () => {
            const first = makeStore(makeResult().result);
            const skip = new MockTracker().fn();
            await StaticFileRequestHandler({ skipWhenFound: true })(makeContext(first.store), makeRequest('/site.css'), makeResponse(), skip);
            assertEqual(1, skip.mock.callCount());

            const second = makeStore(makeResult().result);
            const noSkip = new MockTracker().fn();
            await StaticFileRequestHandler({ skipWhenFound: false })(makeContext(second.store), makeRequest('/site.css'), makeResponse(), noSkip);
            assertEqual(0, noSkip.mock.callCount());
        });

        it('rejects an unsafe pathname before reading the store', async () => {
            const { store } = makeStore(null);
            const error = await catchAsyncError(() => StaticFileRequestHandler()(makeContext(store), makeRequest('/../secret'), makeResponse()));

            assertError(error, 'BadRequestError', 'BAD_REQUEST_ERROR');
            assertEqual(0, store.read.mock.callCount());
        });

        it('responds with the file body and response headers', async () => {
            const { body, result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.css'), makeResponse());

            assertEqual(200, response.status);
            assertEqual(body, response.body);
            assertEqual('text/css', response.headers.get('content-type'));
            assertEqual('42', response.headers.get('content-length'));
            assertEqual('"asset-etag"', response.headers.get('etag'));
            assertEqual('Fri, 02 Jan 2026 03:04:05 GMT', response.headers.get('last-modified'));
        });

        it('returns 304 for a matching ETag and cancels the body', async () => {
            const { body, result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.css', { ifNoneMatch: 'asset-etag' }), makeResponse());

            assertEqual(304, response.status);
            assertEqual(null, response.body);
            assertEqual(null, response.headers.get('content-length'));
            assertEqual('"asset-etag"', response.headers.get('etag'));
            assertEqual(1, body.cancel.mock.callCount());
        });

        it('gives If-None-Match precedence over If-Modified-Since', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.css', {
                ifModifiedSince: new Date('2026-01-03T00:00:00Z'),
                ifNoneMatch: 'different-etag',
            }), makeResponse());

            assertEqual(200, response.status);
        });

        it('returns 304 when If-Modified-Since matches at HTTP date precision', async () => {
            const { body, result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.css', {
                ifModifiedSince: new Date('2026-01-02T03:04:05.000Z'),
            }), makeResponse());

            assertEqual(304, response.status);
            assertEqual(1, body.cancel.mock.callCount());
        });

        it('returns headers without a body for HEAD and cancels the source stream', async () => {
            const { body, result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticFileRequestHandler()(makeContext(store), makeRequest('/site.css', { isHead: true }), makeResponse());

            assertEqual(200, response.status);
            assertEqual(null, response.body);
            assertEqual('42', response.headers.get('content-length'));
            assertEqual(1, body.cancel.mock.callCount());
        });
    });

    describe('StaticAssetRequestHandler', ({ it }) => {
        it('reads the namespace and joined key from pathname params, ignoring the runtime build', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticAssetRequestHandler()(makeContext(store, 'current-build'), makeRequest('/assets/previous-build/styles/main.css', {
                pathnameParams: { build_id: 'previous-build', pathname: [ 'styles', 'main.css' ] },
            }), makeResponse());

            const options = store.read.mock.getCall(0).arguments[1];
            assertEqual('previous-build', options.namespace);
            assertEqual('styles/main.css', options.key);
        });

        it('serves a stale Build ID and preserves case in the key', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticAssetRequestHandler()(makeContext(store, 'current-build'), makeRequest('/assets/old/CSS/Main.CSS', {
                pathnameParams: { build_id: 'old', pathname: [ 'CSS', 'Main.CSS' ] },
            }), makeResponse());

            assertEqual(200, response.status);
            assertEqual('old', store.read.mock.getCall(0).arguments[1].namespace);
            assertEqual('CSS/Main.CSS', store.read.mock.getCall(0).arguments[1].key);
        });

        it('maps only the no-build placeholder to the flat-root namespace', async () => {
            const first = makeStore(makeResult().result);
            await StaticAssetRequestHandler()(makeContext(first.store), makeRequest('/assets/dev/site.css', {
                pathnameParams: { build_id: NO_BUILD_ID_SEGMENT, pathname: [ 'site.css' ] },
            }), makeResponse());
            assertEqual(null, first.store.read.mock.getCall(0).arguments[1].namespace);

            const second = makeStore(makeResult().result);
            await StaticAssetRequestHandler()(makeContext(second.store), makeRequest('/assets/development/site.css', {
                pathnameParams: { build_id: 'development', pathname: [ 'site.css' ] },
            }), makeResponse());
            assertEqual('development', second.store.read.mock.getCall(0).arguments[1].namespace);
        });

        it('rejects missing and empty Build ID params before reading the store', async () => {
            for (const buildId of [ undefined, '' ]) {
                const { store } = makeStore(null);
                const error = await catchAsyncError(() => StaticAssetRequestHandler()(makeContext(store), makeRequest('/assets', {
                    pathnameParams: { build_id: buildId, pathname: [ 'site.css' ] },
                }), makeResponse()));
                assertError(error, 'BadRequestError', 'BAD_REQUEST_ERROR');
                assertEqual(0, store.read.mock.callCount());
            }
        });

        it('rejects unsafe Build ID params before reading the store', async () => {
            for (const buildId of [ '..', '.hidden', 'bad id', 'bad@id' ]) {
                const { store } = makeStore(null);
                const error = await catchAsyncError(() => StaticAssetRequestHandler()(makeContext(store), makeRequest('/assets', {
                    pathnameParams: { build_id: buildId, pathname: [ 'site.css' ] },
                }), makeResponse()));
                assertError(error, 'BadRequestError', 'BAD_REQUEST_ERROR');
                assertEqual(0, store.read.mock.callCount());
            }
        });

        it('rejects missing, empty, and unsafe asset pathname params before reading the store', async () => {
            for (const pathname of [ undefined, [], [ '' ], [ 'css', '', 'site.css' ], [ '..', 'site.css' ] ]) {
                const { store } = makeStore(null);
                const error = await catchAsyncError(() => StaticAssetRequestHandler()(makeContext(store), makeRequest('/assets', {
                    pathnameParams: { build_id: 'build-1', pathname },
                }), makeResponse()));
                assertError(error, 'BadRequestError', 'BAD_REQUEST_ERROR');
                assertEqual(0, store.read.mock.callCount());
            }
        });

        it('throws NotFoundError for a well-formed store miss', async () => {
            const { store } = makeStore(null);
            const error = await catchAsyncError(() => StaticAssetRequestHandler()(makeContext(store), makeRequest('/assets/build-1/missing.css', {
                pathnameParams: { build_id: 'build-1', pathname: [ 'missing.css' ] },
            }), makeResponse()));

            assertError(error, 'NotFoundError', 'NOT_FOUND_ERROR');
        });

        it('uses the immutable cache policy by default and honors an override', async () => {
            const first = makeStore(makeResult().result);
            const defaultResponse = await StaticAssetRequestHandler()(makeContext(first.store), makeRequest('/assets/build-1/site.css', {
                pathnameParams: { build_id: 'build-1', pathname: [ 'site.css' ] },
            }), makeResponse());
            assertEqual('public, max-age=31536000, immutable', defaultResponse.headers.get('cache-control'));

            const second = makeStore(makeResult().result);
            const customResponse = await StaticAssetRequestHandler({ cacheControl: 'public, max-age=60' })(makeContext(second.store), makeRequest('/assets/build-1/site.css', {
                pathnameParams: { build_id: 'build-1', pathname: [ 'site.css' ] },
            }), makeResponse());
            assertEqual('public, max-age=60', customResponse.headers.get('cache-control'));
        });

        it('honors custom pathname parameter names', async () => {
            const { result } = makeResult();
            const { store } = makeStore(result);

            await StaticAssetRequestHandler({ buildIdParam: 'release', pathnameParam: 'file' })(makeContext(store), makeRequest('/assets/release/site.css', {
                pathnameParams: { release: 'release-1', file: [ 'site.css' ] },
            }), makeResponse());

            const options = store.read.mock.getCall(0).arguments[1];
            assertEqual('release-1', options.namespace);
            assertEqual('site.css', options.key);
        });

        it('uses the shared conditional response mapping for matching ETags', async () => {
            const { body, result } = makeResult();
            const { store } = makeStore(result);

            const response = await StaticAssetRequestHandler()(makeContext(store), makeRequest('/assets/build-1/site.css', {
                ifNoneMatch: 'asset-etag',
                pathnameParams: { build_id: 'build-1', pathname: [ 'site.css' ] },
            }), makeResponse());

            assertEqual(304, response.status);
            assertEqual(null, response.body);
            assertEqual(1, body.cancel.mock.callCount());
        });
    });
});
