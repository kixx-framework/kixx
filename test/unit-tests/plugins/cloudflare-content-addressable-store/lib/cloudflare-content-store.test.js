import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import CloudflareContentStore from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import { getRootHash } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js';
import { KEY, hashBlob, hashEtag } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


const KV_BINDING_NAME = 'CONTENT_STORE_KV';
const DURABLE_OBJECT_BINDING_NAME = 'CONTENT_STORE_DO';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Minimal Cloudflare KV namespace double, backed by a Map of hash key ->
// stored ArrayBuffer. Only the {type: 'arrayBuffer', cacheTtl} shape the
// content store actually calls is honored.
function makeKvNamespace() {
    const store = new Map();
    const gets = [];

    return {
        store,
        gets,
        async get(key, options) {
            gets.push({ key, options: options ?? {} });
            return store.has(key) ? store.get(key) : null;
        },
        async put(key, value) {
            store.set(key, value);
        },
    };
}

// Minimal Cache API double, keyed by request URL, mirroring the subset of
// the Cache interface CloudflareContentStore relies on (match/put/delete).
function makeEdgeCache() {
    const store = new Map();
    const puts = [];
    const deletes = [];

    return {
        store,
        puts,
        deletes,
        async match(request) {
            return store.get(request.url) ?? null;
        },
        async put(request, response) {
            puts.push(request.url);
            store.set(request.url, response);
        },
        async delete(request) {
            deletes.push(request.url);
            store.delete(request.url);
        },
    };
}

// Minimal Durable Object namespace double. `getByName` always resolves the
// same stub, mirroring how a real DurableObjectNamespace returns a stub
// bound to a stable name.
function makeDurableObjectNamespace(stub) {
    const names = [];

    return {
        names,
        getByName(name) {
            names.push(name);
            return stub;
        },
    };
}

function makeContext({ kv, durableObjectNamespace, buildId } = {}) {
    return {
        env: {
            [KV_BINDING_NAME]: kv ?? makeKvNamespace(),
            [DURABLE_OBJECT_BINDING_NAME]: durableObjectNamespace ?? makeDurableObjectNamespace({}),
        },
        runtime: {
            build: { id: buildId ?? 'build-1' },
        },
    };
}

// Scheduler double that resolves immediately, so retry-backoff tests don't
// wait out real delays and don't need a Workers-runtime `scheduler` global.
function makeScheduler() {
    const waits = [];

    return {
        waits,
        async wait(milliseconds) {
            waits.push(milliseconds);
        },
    };
}

function makeStore(options) {
    return new CloudflareContentStore({
        logger: makeLogger(),
        kvBindingName: KV_BINDING_NAME,
        durableObjectBindingName: DURABLE_OBJECT_BINDING_NAME,
        edgeCache: makeEdgeCache(),
        scheduler: makeScheduler(),
        blobReadCacheTtlSeconds: 60 * 60,
        indexCacheTtlSeconds: 10,
        ...options,
    });
}

function makeIndexEntries() {
    return {
        '/': [ 'tree', 'root-hash' ],
        '/a.txt': [ 'blob', 'hash-a', 1, null ],
        '/dir': [ 'tree', 'dir-hash' ],
        '/dir/b.txt': [ 'blob', 'hash-b', 2, null ],
    };
}

function makeRetryableError(overrides) {
    const error = new Error('durable object call failed');
    error.remote = true;
    error.retryable = true;
    Object.assign(error, overrides);
    return error;
}

function makeDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('CloudflareContentStore', ({ describe }) => {

    describe('getIndex', ({ it }) => {
        it('fetches the index from the Durable Object on a cold cache', async () => {
            let callCount = 0;
            const stub = {
                async getIndex(buildId) {
                    callCount += 1;
                    assertEqual('build-1', buildId);
                    return { success: true, entries: makeIndexEntries() };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const stat = await store.statPath(context, '/a.txt');

            assertEqual('hash-a', stat.hash);
            assertEqual(1, callCount);
        });

        it('serves a second call from the in-memory cache without calling the Durable Object', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    return { success: true, entries: makeIndexEntries() };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            await store.statPath(context, '/a.txt');
            await store.statPath(context, '/dir/b.txt');

            assertEqual(1, callCount);
        });

        it('serves a cold in-memory cache from the edge Cache API without calling the Durable Object', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    return { success: true, entries: makeIndexEntries() };
                },
            };
            const edgeCache = makeEdgeCache();
            const storeA = makeStore({ edgeCache });
            const storeB = makeStore({ edgeCache });
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            // storeA's in-memory cache is now warm, but storeB has never seen
            // this build; it should still avoid the Durable Object by
            // reading storeA's edge cache entry.
            await storeA.statPath(context, '/a.txt');
            const stat = await storeB.statPath(context, '/a.txt');

            assertEqual('hash-a', stat.hash);
            assertEqual(1, callCount);
        });

        it('throws an AssertionError when no build is registered', async () => {
            const stub = {
                async getIndex() {
                    return { success: true, entries: null };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.getIndex(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('No registered content index', caught.message);
        });

        it('throws when the Durable Object reports an unsuccessful result', async () => {
            const stub = {
                async getIndex() {
                    return { success: false, message: 'boom' };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.getIndex(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('boom', caught.message);
        });

        it('propagates a non-Durable-Object error from the callback without retrying', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    throw new TypeError('programmer error');
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.getIndex(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertEqual(1, callCount);
        });

        it('does not retry a Durable Object error marked overloaded', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    const error = new Error('overloaded');
                    error.remote = true;
                    error.overloaded = true;
                    throw error;
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.getIndex(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(1, callCount);
        });

        it('retries a retryable Durable Object error and succeeds', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    if (callCount < 3) {
                        throw makeRetryableError();
                    }
                    return { success: true, entries: makeIndexEntries() };
                },
            };
            const fakeScheduler = makeScheduler();
            const store = makeStore({ scheduler: fakeScheduler });
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const stat = await store.statPath(context, '/a.txt');

            assertEqual('hash-a', stat.hash);
            assertEqual(3, callCount);
            assertEqual(2, fakeScheduler.waits.length);
        });

        it('wraps the error in an OperationalError once retries are exhausted', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    throw makeRetryableError();
                },
            };
            const store = makeStore({ scheduler: makeScheduler() });
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.getIndex(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assert(caught.cause, 'expected the OperationalError to carry the underlying cause');
            assertEqual(3, callCount);
        });

        it('re-resolves the Durable Object stub on every attempt', async () => {
            let callCount = 0;
            const stub = {
                async getIndex() {
                    callCount += 1;
                    if (callCount < 2) {
                        throw makeRetryableError();
                    }
                    return { success: true, entries: makeIndexEntries() };
                },
            };
            const durableObjectNamespace = makeDurableObjectNamespace(stub);
            const store = makeStore({ scheduler: makeScheduler() });
            const context = makeContext({ durableObjectNamespace });

            await store.getIndex(context);

            assertEqual(2, durableObjectNamespace.names.length);
        });

        it('keeps a newer cached index when an invalidated fetch fails late', async () => {
            const firstFetch = makeDeferred();
            const firstCallStarted = makeDeferred();
            let getIndexCallCount = 0;
            const stub = {
                async getIndex() {
                    getIndexCallCount += 1;
                    if (getIndexCallCount === 1) {
                        firstCallStarted.resolve();
                        return await firstFetch.promise;
                    }
                    return { success: true, entries: makeIndexEntries() };
                },
                async assignBuild() {
                    return { success: true };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const staleRequest = store.getIndex(context);
            await firstCallStarted.promise;
            await store.assignBuild(context, 'build-1', 'new-root-hash');
            await store.getIndex(context);

            firstFetch.reject(new Error('stale fetch failed'));
            await catchAsyncError(() => staleRequest);

            await store.getIndex(context);
            assertEqual(2, getIndexCallCount);
        });
    });

    describe('statPath', ({ it }) => {
        it('returns null when the pathname does not exist', async () => {
            const stub = { async getIndex() {
                return { success: true, entries: makeIndexEntries() };
            } };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const stat = await store.statPath(context, '/missing.txt');

            assertEqual(null, stat);
        });
    });

    describe('listStats', ({ it }) => {
        it('lists immediate children when recursive is false', async () => {
            const stub = { async getIndex() {
                return { success: true, entries: makeIndexEntries() };
            } };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const stats = await store.listStats(context, '/', { recursive: false });

            const pathnames = stats.map((stat) => stat.pathname).sort();
            assertEqual('/a.txt,/dir', pathnames.join(','));
        });

        it('normalizes a prefix without a trailing slash', async () => {
            const stub = { async getIndex() {
                return { success: true, entries: makeIndexEntries() };
            } };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const stats = await store.listStats(context, '/dir', { recursive: true });

            assertEqual(1, stats.length);
            assertEqual('/dir/b.txt', stats[0].pathname);
        });
    });

    describe('putBlob', ({ it }) => {
        it('stores the blob bytes in KV keyed by content hash', async () => {
            const kv = makeKvNamespace();
            const store = makeStore();
            const context = makeContext({ kv });
            const blob = new TextEncoder().encode('hello world');

            const result = await store.putBlob(context, '/a.txt', blob, null);

            const expectedHash = await hashBlob(blob);
            assertEqual(expectedHash, result.hash);
            assertEqual('/a.txt', result.pathname);
            assertEqual(blob.byteLength, result.size);
            assertEqual(null, result.metadata);
            assert(kv.store.has(KEY.blob + expectedHash), 'expected the blob to be stored under its content hash');
        });

        it('accepts a matching pre-computed etag', async () => {
            const store = makeStore();
            const context = makeContext();
            const blob = new TextEncoder().encode('hello world');
            const hash = await hashBlob(blob);
            const etag = await hashEtag(hash, null);

            const result = await store.putBlob(context, '/a.txt', blob, null, etag);

            assertEqual(hash, result.hash);
        });

        it('throws a ValidationError when the supplied etag does not match', async () => {
            const kv = makeKvNamespace();
            const store = makeStore();
            const context = makeContext({ kv });
            const blob = new TextEncoder().encode('hello world');

            const caught = await catchAsyncError(
                () => store.putBlob(context, '/a.txt', blob, null, 'not-the-real-etag'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual('INTEGRITY_CHECK_FAILED', caught.code);
            assertEqual(0, kv.store.size, 'expected no blob to be written on a failed integrity check');
        });
    });

    describe('commitClosure', ({ it }) => {
        it('derives the closure, commits it to the Durable Object, and returns a stable descriptor', async () => {
            let received = null;
            const stub = {
                async commitClosure(rootHash, index) {
                    received = { rootHash, index };
                    return { success: true };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });
            const files = [ { pathname: '/a.txt', hash: 'hash-a', size: 1 } ];

            const result = await store.commitClosure(context, files);

            // The Durable Object still receives the full encoded table...
            assertEqual('tree', received.index['/'][0]);
            assertEqual('hash-a', received.index['/a.txt'][1]);
            assertEqual(received.rootHash, getRootHash(received.index));
            // ...but the caller only gets back the stable closure descriptor.
            assertEqual(received.rootHash, result.rootHash);
            assertEqual(2, result.nodeCount);
        });

        it('throws when the Durable Object reports an unsuccessful result', async () => {
            const stub = {
                async commitClosure() {
                    return { success: false, message: 'disk full' };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });
            const files = [ { pathname: '/a.txt', hash: 'hash-a', size: 1 } ];

            const caught = await catchAsyncError(() => store.commitClosure(context, files));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('disk full', caught.message);
        });
    });

    describe('assignBuild', ({ it }) => {
        it('assigns the build on the Durable Object', async () => {
            let received = null;
            const stub = {
                async assignBuild(buildId, rootHash) {
                    received = { buildId, rootHash };
                    return { success: true };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            await store.assignBuild(context, 'build-1', 'root-hash');

            assertEqual('build-1', received.buildId);
            assertEqual('root-hash', received.rootHash);
        });

        it('invalidates the in-memory and edge index caches for the build', async () => {
            let getIndexCallCount = 0;
            const stub = {
                async getIndex() {
                    getIndexCallCount += 1;
                    return { success: true, entries: makeIndexEntries() };
                },
                async assignBuild() {
                    return { success: true };
                },
            };
            const edgeCache = makeEdgeCache();
            const store = makeStore({ edgeCache });
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            // Warm both the in-memory and edge caches for this build.
            await store.getIndex(context);
            assertEqual(1, getIndexCallCount);

            await store.assignBuild(context, 'build-1', 'new-root-hash');

            // Both caches were invalidated, so this call must reach the
            // Durable Object again instead of serving a stale entry.
            await store.getIndex(context);
            assertEqual(2, getIndexCallCount);
        });

        it('throws when the Durable Object reports an unsuccessful result', async () => {
            const stub = {
                async assignBuild() {
                    return { success: false, message: 'no such closure' };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });

            const caught = await catchAsyncError(() => store.assignBuild(context, 'build-1', 'root-hash'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('no such closure', caught.message);
        });
    });

    describe('commitChanges', ({ it }) => {
        it('commits a closure and assigns the build to its root hash', async () => {
            let committedRootHash = null;
            let assignedBuild = null;
            const stub = {
                async commitClosure(rootHash) {
                    committedRootHash = rootHash;
                    return { success: true };
                },
                async assignBuild(buildId, rootHash) {
                    assignedBuild = { buildId, rootHash };
                    return { success: true };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObjectNamespace: makeDurableObjectNamespace(stub) });
            const files = [ { pathname: '/a.txt', hash: 'hash-a', size: 1 } ];

            const result = await store.commitChanges(context, 'build-1', files);

            assertEqual(result.rootHash, committedRootHash);
            assertEqual('build-1', assignedBuild.buildId);
            assertEqual(result.rootHash, assignedBuild.rootHash);
            assertEqual(2, result.nodeCount);
        });
    });

    describe('getBlob', ({ it }) => {
        it('returns the stored bytes for a known hash', async () => {
            const kv = makeKvNamespace();
            const bytes = new Uint8Array([ 1, 2, 3 ]);
            kv.store.set(KEY.blob + 'hash-a', bytes.buffer);
            const store = makeStore();
            const context = makeContext({ kv });

            const result = await store.getBlob(context, 'hash-a');

            assertEqual(3, result.length);
            assertEqual(1, result[0]);
        });

        it('returns null for an unknown hash', async () => {
            const store = makeStore();
            const context = makeContext();

            const result = await store.getBlob(context, 'missing-hash');

            assertEqual(null, result);
        });

        it('passes blobReadCacheTtlSeconds as the KV read cacheTtl', async () => {
            const kv = makeKvNamespace();
            const store = makeStore({ blobReadCacheTtlSeconds: 3600 });
            const context = makeContext({ kv });

            await store.getBlob(context, 'hash-a');

            assertEqual(3600, kv.gets[0].options.cacheTtl);
        });
    });

    describe('getBlobs', ({ it }) => {
        it('returns bytes in the same order as the requested hashes, with nulls for misses', async () => {
            const kv = makeKvNamespace();
            kv.store.set(KEY.blob + 'hash-a', new Uint8Array([ 1 ]).buffer);
            kv.store.set(KEY.blob + 'hash-c', new Uint8Array([ 3 ]).buffer);
            const store = makeStore();
            const context = makeContext({ kv });

            const results = await store.getBlobs(context, [ 'hash-a', 'hash-b', 'hash-c' ]);

            assertEqual(3, results.length);
            assertEqual(1, results[0][0]);
            assertEqual(null, results[1]);
            assertEqual(3, results[2][0]);
        });

        it('reads more than one batch when hashes exceed the read concurrency', async () => {
            const kv = makeKvNamespace();
            const hashes = [];
            for (let i = 0; i < 10; i += 1) {
                const hash = `hash-${ i }`;
                hashes.push(hash);
                kv.store.set(KEY.blob + hash, new Uint8Array([ i ]).buffer);
            }
            const store = makeStore();
            const context = makeContext({ kv });

            const results = await store.getBlobs(context, hashes);

            assertEqual(10, results.length);
            assertEqual(10, kv.gets.length);
            for (let i = 0; i < 10; i += 1) {
                assertEqual(i, results[i][0]);
            }
        });
    });
});
