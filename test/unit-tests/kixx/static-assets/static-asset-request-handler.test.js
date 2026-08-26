import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import StaticAssetRequestHandler from '../../../../src/kixx/static-assets/static-asset-request-handler.js';
import ServerResponse from '../../../../src/kixx/http-router/server-response.js';

const HASH = 'ny2axhh7wn5jrhffittlw6akfq';

function makeContext(store) {
    return {
        getService(name) {
            assertEqual('ContentAddressableStore', name);
            return store;
        },
    };
}

function makeRequest(pathname, options) {
    const {
        ifNoneMatch = null,
        isHead = false,
        pathnameParams = {},
    } = options ?? {};

    return {
        ifNoneMatch,
        pathnameParams,
        url: { pathname },
        isHeadRequest() {
            return isHead;
        },
    };
}

function makeStream() {
    const tracker = new MockTracker();
    return {
        stream: { cancel: tracker.fn(async () => {}) },
        tracker,
    };
}

function makeStore(options) {
    const {
        asset = null,
        directStream = null,
        stat = null,
    } = options ?? {};
    const tracker = new MockTracker();
    const snapshot = {
        statStaticAsset: tracker.fn(() => stat),
        getStaticAsset: tracker.fn(async () => asset),
    };
    const store = {
        normalizePathname: tracker.fn((pathname) => pathname
            .split('/')
            .filter(Boolean)
            .join('/')
            .toLowerCase()
            .replace(/^/, '/')),
        isValidPathname: tracker.fn((pathname) => pathname !== '/' && !pathname.includes('%') && !pathname.includes('..') && pathname === pathname.toLowerCase()),
        openSnapshot: tracker.fn(async () => snapshot),
        getStaticAssetByHash: tracker.fn(async () => directStream),
    };
    return { store, snapshot, tracker };
}

function makeStat(options) {
    return {
        hash: HASH,
        size: 42,
        ...options,
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

function assertError(error, name) {
    assert(error, 'expected an error');
    assertEqual(name, error.name);
}

describe('StaticAssetRequestHandler', ({ describe }) => {
    describe('fingerprinted mode', ({ it }) => {
        it('serves the URL-addressed blob with immutable caching and no content length', async () => {
            const body = makeStream();
            const { store } = makeStore({ directStream: body.stream });
            const response = await StaticAssetRequestHandler({ fingerprinted: true })(
                makeContext(store),
                makeRequest(`/assets/${ HASH }/css/main.css`, {
                    pathnameParams: { hash: HASH, pathname: [ 'css', 'main.css' ] },
                }),
                new ServerResponse(),
            );

            assertEqual(200, response.status);
            assertEqual(body.stream, response.body);
            assertEqual('public, max-age=31536000, immutable', response.headers.get('cache-control'));
            assertEqual(`"${ HASH }"`, response.headers.get('etag'));
            assertEqual('text/css; charset=utf-8', response.headers.get('content-type'));
            assertEqual(null, response.headers.get('content-length'));
            assertEqual(null, response.headers.get('last-modified'));
            assertEqual('/css/main.css', store.getStaticAssetByHash.mock.getCall(0).arguments[1]);
        });

        it('answers a matching ETag before reading the store', async () => {
            const { store } = makeStore();
            const response = await StaticAssetRequestHandler({ fingerprinted: true })(
                makeContext(store),
                makeRequest(`/assets/${ HASH }/site.css`, {
                    ifNoneMatch: HASH,
                    pathnameParams: { hash: HASH, pathname: [ 'site.css' ] },
                }),
                new ServerResponse(),
            );

            assertEqual(304, response.status);
            assertEqual(0, store.getStaticAssetByHash.mock.callCount());
        });

        it('rejects malformed hashes and unsafe or uppercase pathnames', async () => {
            for (const { hash, pathname } of [
                { hash: 'not-a-hash', pathname: [ 'site.css' ] },
                { hash: HASH, pathname: [ '..', 'site.css' ] },
                { hash: HASH, pathname: [ 'CSS', 'main.css' ] },
            ]) {
                const { store } = makeStore();
                const error = await catchAsyncError(() => StaticAssetRequestHandler({ fingerprinted: true })(
                    makeContext(store),
                    makeRequest('/assets', { pathnameParams: { hash, pathname } }),
                    new ServerResponse(),
                ));

                assertError(error, 'BadRequestError');
                assertEqual(0, store.getStaticAssetByHash.mock.callCount());
            }
        });

        it('throws NotFoundError when the addressed blob is absent', async () => {
            const { store } = makeStore();
            const error = await catchAsyncError(() => StaticAssetRequestHandler({ fingerprinted: true })(
                makeContext(store),
                makeRequest('/assets', { pathnameParams: { hash: HASH, pathname: [ 'missing.css' ] } }),
                new ServerResponse(),
            ));

            assertError(error, 'NotFoundError');
        });

        it('requires a wired hash pathname param', async () => {
            const { store } = makeStore();
            const error = await catchAsyncError(() => StaticAssetRequestHandler({ fingerprinted: true })(
                makeContext(store),
                makeRequest('/assets', { pathnameParams: { pathname: [ 'site.css' ] } }),
                new ServerResponse(),
            ));

            assertError(error, 'AssertionError');
        });

        it('cancels the stream for HEAD', async () => {
            const body = makeStream();
            const { store } = makeStore({ directStream: body.stream });
            const response = await StaticAssetRequestHandler({ fingerprinted: true })(
                makeContext(store),
                makeRequest('/assets', {
                    isHead: true,
                    pathnameParams: { hash: HASH, pathname: [ 'site.css' ] },
                }),
                new ServerResponse(),
            );

            assertEqual(200, response.status);
            assertEqual(null, response.body);
            assertEqual(1, body.stream.cancel.mock.callCount());
        });
    });

    describe('pathname mode', ({ it }) => {
        it('folds case, serves the indexed asset, and supplies its content length', async () => {
            const body = makeStream();
            const { store, snapshot } = makeStore({
                stat: makeStat(),
                asset: { hash: HASH, size: 42, stream: body.stream },
            });
            const response = await StaticAssetRequestHandler()(makeContext(store), makeRequest('/CSS/Main.CSS'), new ServerResponse());

            assertEqual('/css/main.css', snapshot.statStaticAsset.mock.getCall(0).arguments[0]);
            assertEqual(200, response.status);
            assertEqual('42', response.headers.get('content-length'));
            assertEqual('text/css; charset=utf-8', response.headers.get('content-type'));
            assertEqual('public, max-age=0, must-revalidate', response.headers.get('cache-control'));
        });

        it('treats unsafe pathnames as misses that can defer', async () => {
            const { store } = makeStore();
            const response = new ServerResponse();
            const result = await StaticAssetRequestHandler({ throwNotFound: false })(makeContext(store), makeRequest('/my%20page'), response);

            assertEqual(response, result);
            assertEqual(0, store.openSnapshot.mock.callCount());
        });

        it('honors throwNotFound and skipWhenFound', async () => {
            const first = makeStore();
            const error = await catchAsyncError(() => StaticAssetRequestHandler()(makeContext(first.store), makeRequest('/missing.css'), new ServerResponse()));
            assertError(error, 'NotFoundError');

            const second = makeStore({
                stat: makeStat(),
                asset: { hash: HASH, size: 42, stream: makeStream().stream },
            });
            const skip = new MockTracker().fn();
            await StaticAssetRequestHandler({ skipWhenFound: true })(makeContext(second.store), makeRequest('/site.css'), new ServerResponse(), skip);
            assertEqual(1, skip.mock.callCount());
        });

        it('answers matching ETags and HEAD from index stats without opening a stream', async () => {
            const { store, snapshot } = makeStore({ stat: makeStat() });
            const conditional = await StaticAssetRequestHandler()(makeContext(store), makeRequest('/site.css', { ifNoneMatch: HASH }), new ServerResponse());
            assertEqual(304, conditional.status);
            assertEqual(0, snapshot.getStaticAsset.mock.callCount());

            const head = await StaticAssetRequestHandler()(makeContext(store), makeRequest('/site.css', { isHead: true }), new ServerResponse());
            assertEqual(200, head.status);
            assertEqual(null, head.body);
            assertEqual('42', head.headers.get('content-length'));
            assertEqual(0, snapshot.getStaticAsset.mock.callCount());
        });
    });
});
