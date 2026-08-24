import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotMatches } from 'kixx-assert';

import ContentStore from '../../../../../src/plugins/cloudflare-content-store/lib/content-store.js';
import ContentAddressableIndex from '../../../../../src/kixx/content-addressable-store/content-addressable-index.js';


const SILENT_LOGGER = {
    createChild() {
        return { info() {}, warn() {}, debug() {} };
    },
};

// A valid encoded index table, shaped exactly as ContentAddressableIndex
// requires: tree tuples carry two elements, blob tuples carry four.
function makeEntries(blobHash) {
    return {
        '/': [ 'tree', 'root-hash' ],
        '/a.txt': [ 'blob', blobHash ?? 'hash-a', 5, null ],
    };
}

// Stores real Response objects so headers written by the store are observable,
// and so a stale entry can actually be served back on a later read.
function makeEdgeCache() {
    const store = new Map();
    return {
        store,
        async match(request) {
            const response = store.get(request.url);
            // A Response body can only be read once, so hand back a clone the
            // way the real Cache API hands back a fresh response each time.
            return response ? response.clone() : null;
        },
        async put(request, response) {
            store.set(request.url, response);
        },
        async delete(request) {
            return store.delete(request.url);
        },
    };
}

function makeKvStore(values) {
    const calls = [];
    return {
        calls,
        async get(key, options) {
            calls.push({ key, options });
            if (Array.isArray(key)) {
                return new Map(key.map((k) => [ k, values?.get(k) ?? null ]));
            }
            return values?.get(key) ?? null;
        },
        async put(key, value, options) {
            calls.push({ key, value, options });
        },
    };
}

function makeContext({ durableObject, kvStore }) {
    return {
        env: {
            CA_STORE_KV_STORE: kvStore,
            CA_STORE_DURABLE_OBJECT: {
                getByName() {
                    return durableObject;
                },
            },
        },
    };
}

function makeStore(options) {
    return new ContentStore({
        logger: SILENT_LOGGER,
        kvBindingName: 'CA_STORE_KV_STORE',
        durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
        wireFormat: 1,
        blobReadCacheTtlSeconds: 60,
        indexCacheTtlSeconds: 10,
        edgeCache: makeEdgeCache(),
        scheduler: { async wait() {} },
        ...options,
    });
}

function makeDeferredPromise() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
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

    describe('getIndex()', ({ it }) => {
        it('returns an entry table the framework index accepts', async () => {
            const durableObject = {
                async getIndex() {
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore();

            const entries = await store.getIndex(makeContext({ durableObject }), 'build-1');

            // The contract that matters is not the shape in isolation, but that
            // ContentAddressableIndex can be constructed from it. Entry objects,
            // or tree tuples padded to four elements, fail here.
            const index = new ContentAddressableIndex(entries);
            assertEqual('blob', index.getNode('/a.txt').kind);
            assertEqual('hash-a', index.getNode('/a.txt').hash);
        });

        it('serves a repeat read from the isolate cache without calling the Durable Object', async () => {
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObject });

            await store.getIndex(context, 'build-1');
            await store.getIndex(context, 'build-1');

            assertEqual(1, calls);
        });

        it('writes the configured TTL onto the colo cache entry', async () => {
            const edgeCache = makeEdgeCache();
            const durableObject = {
                async getIndex() {
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore({ edgeCache, indexCacheTtlSeconds: 42 });

            await store.getIndex(makeContext({ durableObject }), 'build-1');

            assertEqual(1, edgeCache.store.size);
            const [ response ] = Array.from(edgeCache.store.values());
            assertEqual('max-age=42', response.headers.get('cache-control'));
        });

        it('serves an index from the colo cache without calling the Durable Object', async () => {
            const edgeCache = makeEdgeCache();
            const cacheKey = new Request('https://content-addressable-store.internal/index/1/build-1');
            await edgeCache.put(cacheKey, new Response(JSON.stringify(makeEntries('cached-hash'))));
            const durableObject = {
                async getIndex() {
                    throw new Error('Durable Object should not be called');
                },
            };
            const store = makeStore({ edgeCache });

            const entries = await store.getIndex(makeContext({ durableObject }), 'build-1');

            assertEqual('cached-hash', entries['/a.txt'][1]);
        });

        it('fetches a fresh index after the isolate cache TTL expires', async () => {
            const tracker = new MockTracker();
            let now = 1000;
            tracker.method(Date, 'now', () => now);
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    return { success: true, entries: makeEntries(`hash-${ calls }`) };
                },
            };
            const edgeCache = makeEdgeCache();
            const store = makeStore({ edgeCache, indexCacheTtlSeconds: 10 });
            const context = makeContext({ durableObject });

            const first = await store.getIndex(context, 'build-1');
            edgeCache.store.clear();
            now += 10001;
            const second = await store.getIndex(context, 'build-1');
            tracker.reset();

            assertEqual('hash-1', first['/a.txt'][1]);
            assertEqual('hash-2', second['/a.txt'][1]);
            assertEqual(2, calls);
        });

        it('shares an in-flight index read between concurrent callers', async () => {
            const deferred = makeDeferredPromise();
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    return await deferred.promise;
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObject });

            const first = store.getIndex(context, 'build-1');
            const second = store.getIndex(context, 'build-1');
            deferred.resolve({ success: true, entries: makeEntries() });

            assertEqual(await first, await second);
            assertEqual(1, calls);
        });

        it('does not let an older failed read evict a newer cached read', async () => {
            const tracker = new MockTracker();
            let now = 1000;
            tracker.method(Date, 'now', () => now);
            const firstRead = makeDeferredPromise();
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    if (calls === 1) {
                        return await firstRead.promise;
                    }
                    return { success: true, entries: makeEntries('new-hash') };
                },
            };
            const store = makeStore({ indexCacheTtlSeconds: 10 });
            const context = makeContext({ durableObject });

            const stalePromise = store.getIndex(context, 'build-1');
            now += 10001;
            await store.getIndex(context, 'build-1');
            firstRead.reject(new TypeError('stale failure'));
            await catchAsyncError(() => stalePromise);
            const entries = await store.getIndex(context, 'build-1');
            tracker.reset();

            assertEqual('new-hash', entries['/a.txt'][1]);
            assertEqual(2, calls);
        });

        it('does not write a colo cache entry when the TTL is zero', async () => {
            const edgeCache = makeEdgeCache();
            const durableObject = {
                async getIndex() {
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore({ edgeCache, indexCacheTtlSeconds: 0 });

            await store.getIndex(makeContext({ durableObject }), 'build-1');

            assertEqual(0, edgeCache.store.size);
        });

        it('throws an AssertionError when the build has no registered index', async () => {
            const durableObject = {
                async getIndex() {
                    return { success: true, entries: null };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('build-1', caught.message);
        });

        it('throws an OperationalError when the Durable Object reports failure', async () => {
            const durableObject = {
                async getIndex() {
                    return { success: false, message: 'storage offline' };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(
                'ContentStore#fetchIndex() was unsuccessful: storage offline',
                caught.message,
            );
        });

        it('identifies a missing Durable Object namespace binding', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex({ env: {} }, 'build-1'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches(
                'CloudflareContentStore Durable Object namespace binding "CA_STORE_DURABLE_OBJECT" is not bound on context.env',
                caught.message,
            );
            assertNotMatches('KV DurableObject', caught.message);
        });

        it('retries the next read after a failed fetch instead of caching the rejection', async () => {
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    if (calls === 1) {
                        return { success: false, message: 'transient' };
                    }
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore();
            const context = makeContext({ durableObject });

            await catchAsyncError(() => store.getIndex(context, 'build-1'));
            const entries = await store.getIndex(context, 'build-1');

            assertEqual(2, calls);
            assertEqual('hash-a', entries['/a.txt'][1]);
        });
    });

    describe('assignBuild()', ({ it }) => {
        it('uses the stable Durable Object name scoped by wire format', async () => {
            let receivedName = null;
            const context = {
                env: {
                    CA_STORE_DURABLE_OBJECT: {
                        getByName(name) {
                            receivedName = name;
                            return {
                                async assignBuild() {
                                    return { success: true };
                                },
                            };
                        },
                    },
                },
            };
            const store = makeStore({ wireFormat: 'format-2' });

            await store.assignBuild(context, 'build-1', 'root-hash');

            assertEqual('ContentAddressableStore#format-2', receivedName);
        });

        it('invalidates both index caches so a rollback is visible immediately', async () => {
            let pointer = 'hash-new';
            let getIndexCalls = 0;
            const durableObject = {
                async getIndex() {
                    getIndexCalls += 1;
                    return { success: true, entries: makeEntries(pointer) };
                },
                async assignBuild(_buildId, rootHash) {
                    pointer = rootHash;
                    return { success: true };
                },
            };
            const edgeCache = makeEdgeCache();
            const store = makeStore({ edgeCache, indexCacheTtlSeconds: 600 });
            const context = makeContext({ durableObject });

            const before = await store.getIndex(context, 'build-1');
            assertEqual('hash-new', before['/a.txt'][1]);
            assertEqual(1, edgeCache.store.size);

            await store.assignBuild(context, 'build-1', 'hash-old');

            // Both tiers must be gone; a surviving entry would keep serving the
            // superseded closure for the whole 600 second TTL.
            assertEqual(0, edgeCache.store.size);

            const after = await store.getIndex(context, 'build-1');
            assertEqual('hash-old', after['/a.txt'][1]);
            assertEqual(2, getIndexCalls);
        });

        it('throws an OperationalError when the Durable Object reports failure', async () => {
            const durableObject = {
                async assignBuild() {
                    return { success: false, message: 'no such closure' };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.assignBuild(makeContext({ durableObject }), 'build-1', 'root-hash'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('no such closure', caught.message);
        });

        it('rejects an empty build id before calling the Durable Object', async () => {
            let calls = 0;
            const durableObject = {
                async assignBuild() {
                    calls += 1;
                    return { success: true };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.assignBuild(makeContext({ durableObject }), '', 'root-hash'),
            );

            assertEqual('AssertionError', caught.name);
            assertEqual(0, calls);
        });

        it('rejects an empty root hash before calling the Durable Object', async () => {
            let calls = 0;
            const durableObject = {
                async assignBuild() {
                    calls += 1;
                    return { success: true };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.assignBuild(makeContext({ durableObject }), 'build-1', ''),
            );

            assertEqual('AssertionError', caught.name);
            assertEqual(0, calls);
        });
    });

    describe('saveIndex()', ({ it }) => {
        it('passes the encoded table through to the Durable Object', async () => {
            let received = null;
            const durableObject = {
                async saveIndex(rootHash, index) {
                    received = { rootHash, index };
                    return { success: true };
                },
            };
            const store = makeStore();

            await store.saveIndex(makeContext({ durableObject }), 'root-hash', makeEntries());

            assertEqual('root-hash', received.rootHash);
            assertEqual('tree', received.index['/'][0]);
            assertEqual('hash-a', received.index['/a.txt'][1]);
        });

        it('throws an OperationalError when the Durable Object reports failure', async () => {
            const durableObject = {
                async saveIndex() {
                    return { success: false, message: 'write failed' };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.saveIndex(makeContext({ durableObject }), 'root-hash', makeEntries()),
            );

            assertEqual('OperationalError', caught.name);
            assertMatches('write failed', caught.message);
        });

        it('rejects an empty root hash before calling the Durable Object', async () => {
            let calls = 0;
            const durableObject = {
                async saveIndex() {
                    calls += 1;
                    return { success: true };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.saveIndex(makeContext({ durableObject }), '', makeEntries()),
            );

            assertEqual('AssertionError', caught.name);
            assertEqual(0, calls);
        });

        it('rejects a non-plain entry table before calling the Durable Object', async () => {
            let calls = 0;
            const durableObject = {
                async saveIndex() {
                    calls += 1;
                    return { success: true };
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.saveIndex(makeContext({ durableObject }), 'root-hash', []),
            );

            assertEqual('AssertionError', caught.name);
            assertEqual(0, calls);
        });
    });

    describe('Durable Object retries', ({ it }) => {
        it('retries a retryable failure and returns the eventual success', async () => {
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    if (calls === 1) {
                        const error = new Error('connection lost');
                        error.retryable = true;
                        throw error;
                    }
                    return { success: true, entries: makeEntries() };
                },
            };
            const store = makeStore();

            const entries = await store.getIndex(makeContext({ durableObject }), 'build-1');

            assertEqual(2, calls);
            assertEqual('hash-a', entries['/a.txt'][1]);
        });

        it('does not retry an overloaded failure', async () => {
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    const error = new Error('too many requests');
                    error.overloaded = true;
                    throw error;
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assertEqual(1, calls);
            assertEqual('OperationalError', caught.name);
        });

        it('stops after the maximum number of retryable failures', async () => {
            let calls = 0;
            const waits = [];
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    const error = new Error('connection lost');
                    error.retryable = true;
                    throw error;
                },
            };
            const store = makeStore({
                scheduler: {
                    async wait(delay) {
                        waits.push(delay);
                    },
                },
            });

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assertEqual(3, calls);
            assertEqual(2, waits.length);
            assertEqual('OperationalError', caught.name);
            assertEqual('connection lost', caught.cause.message);
        });

        it('does not retry a remote failure which is not marked retryable', async () => {
            let calls = 0;
            const durableObject = {
                async getIndex() {
                    calls += 1;
                    const error = new Error('remote failure');
                    error.remote = true;
                    throw error;
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assertEqual(1, calls);
            assertEqual('OperationalError', caught.name);
            assertEqual('remote failure', caught.cause.message);
        });

        it('rethrows a local error untouched rather than treating it as a storage failure', async () => {
            const durableObject = {
                async getIndex() {
                    // No remote/retryable/overloaded marker: this never crossed
                    // the RPC boundary, so it is a programmer error here.
                    throw new TypeError('local bug');
                },
            };
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getIndex(makeContext({ durableObject }), 'build-1'),
            );

            assertEqual('TypeError', caught.name);
            assertEqual('local bug', caught.message);
        });
    });

    describe('blob reads and writes', ({ it }) => {
        it('reads a blob by content hash', async () => {
            const kvStore = makeKvStore(new Map([ [ 'hash-a#1', 'the bytes' ] ]));
            const store = makeStore();

            const result = await store.getFile(makeContext({ kvStore }), 'text', '/a.txt', 'hash-a');

            assertEqual('the bytes', result);
            assertEqual('hash-a#1', kvStore.calls[0].key);
        });

        it('identifies a missing KV namespace binding', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getFile({ env: {} }, 'text', '/a.txt', 'hash-a'),
            );

            assertEqual('AssertionError', caught.name);
            assertMatches(
                'CloudflareContentStore KV binding "CA_STORE_KV_STORE" is not bound on context.env',
                caught.message,
            );
        });

        it('reads a blob as an ArrayBuffer, passing the type through to KV', async () => {
            const blob = new ArrayBuffer(4);
            const kvStore = makeKvStore(new Map([ [ 'hash-a#1', blob ] ]));
            const store = makeStore();

            const result = await store.getFile(makeContext({ kvStore }), 'arrayBuffer', '/a.bin', 'hash-a');

            assertEqual('arrayBuffer', kvStore.calls[0].options.type);
            assertEqual(blob, result);
        });

        it('never passes KV a cacheTtl below the adapter minimum', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore({ blobReadCacheTtlSeconds: 0 });

            await store.getFile(makeContext({ kvStore }), 'text', '/a.txt', 'hash-a');

            assertEqual(60, kvStore.calls[0].options.cacheTtl);
        });

        it('preserves a configured cacheTtl above the platform minimum', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore({ blobReadCacheTtlSeconds: 86400 });

            await store.getFile(makeContext({ kvStore }), 'text', '/a.txt', 'hash-a');

            assertEqual(86400, kvStore.calls[0].options.cacheTtl);
        });

        it('returns bulk reads in the order of the requested files', async () => {
            const kvStore = makeKvStore(new Map([
                [ 'hash-a#1', 'A' ],
                [ 'hash-b#1', 'B' ],
                [ 'hash-c#1', 'C' ],
            ]));
            const store = makeStore();
            const files = [ { hash: 'hash-c' }, { hash: 'hash-a' }, { hash: 'hash-b' } ];

            const results = await store.getFiles(makeContext({ kvStore }), 'text', files);

            // Callers zip these results back against their own stats array, so
            // the order must follow the request, not the store.
            assertEqual('C,A,B', results.join(','));
        });

        it('rejects a bulk read larger than the KV key cap', async () => {
            const files = [];
            for (let i = 0; i < 101; i += 1) {
                files.push({ hash: `hash-${ i }` });
            }
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            // KV rejects a bulk get() of more than 100 keys. Deciding how many
            // blobs one read is worth belongs to the caller, so this is a
            // programmer error here rather than a read split behind their back.
            const caught = await catchAsyncError(
                () => store.getFiles(makeContext({ kvStore }), 'text', files),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('101', caught.message);
            // The read must be refused before KV is touched at all.
            assertEqual(0, kvStore.calls.length);
        });

        it('accepts a bulk read of exactly the KV key cap', async () => {
            const files = [];
            const values = new Map();
            for (let i = 0; i < 100; i += 1) {
                files.push({ hash: `hash-${ i }` });
                values.set(`hash-${ i }#1`, `value-${ i }`);
            }
            const kvStore = makeKvStore(values);
            const store = makeStore();

            const results = await store.getFiles(makeContext({ kvStore }), 'text', files);

            assertEqual(1, kvStore.calls.length);
            assertEqual(100, results.length);
            assertEqual('value-0', results[0]);
            assertEqual('value-99', results[99]);
        });

        it('returns null for a key missing from a bulk read', async () => {
            const kvStore = makeKvStore(new Map([ [ 'hash-b#1', 'the bytes' ] ]));
            const store = makeStore();

            const results = await store.getFiles(
                makeContext({ kvStore }),
                'text',
                [ { hash: 'hash-a' }, { hash: 'hash-b' } ],
            );

            assertEqual(null, results[0]);
            assertEqual('the bytes', results[1]);
        });

        it('rejects a bulk arrayBuffer read, which KV cannot decode in bulk', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            // getFile() accepts arrayBuffer; KV's bulk get() decodes text and
            // json only, so the same type must be refused here.
            const caught = await catchAsyncError(
                () => store.getFiles(makeContext({ kvStore }), 'arrayBuffer', [ { hash: 'hash-a' } ]),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('arrayBuffer', caught.message);
        });

        it('writes a blob under its content hash', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            const size = await store.putFile(makeContext({ kvStore }), '/a.txt', 'hash-a', 'the bytes');

            assertEqual(9, size);
            assertEqual('hash-a#1', kvStore.calls[0].key);
            assertEqual('the bytes', kvStore.calls[0].value);
            // KV put() accepts expiration, expirationTtl, and metadata only.
            // Passing a read-side `type` here would be silently ignored, and
            // would suggest to a later reader that writes are type-tagged.
            assertEqual(undefined, kvStore.calls[0].options);
        });

        it('writes an ArrayBuffer blob', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();
            const blob = new ArrayBuffer(4);

            const size = await store.putFile(makeContext({ kvStore }), '/a.bin', 'hash-a', blob);

            assertEqual(4, size);
            assertEqual('hash-a#1', kvStore.calls[0].key);
            assertEqual(blob, kvStore.calls[0].value);
        });

        it('reports a string blob size in UTF-8 encoded bytes', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            const size = await store.putFile(makeContext({ kvStore }), '/wave.txt', 'hash-wave', '👋');

            assertEqual(4, size);
        });

        it('rejects a blob that is neither a string nor an ArrayBuffer', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.putFile(makeContext({ kvStore }), '/a.txt', 'hash-a', 42),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual(0, kvStore.calls.length);
        });

        it('reads a blob as a stream, passing the type through to KV', async () => {
            const kvStore = makeKvStore(new Map([ [ 'hash-a#1', 'a stream' ] ]));
            const store = makeStore();

            const result = await store.getFile(makeContext({ kvStore }), 'stream', '/a.txt', 'hash-a');

            assertEqual('stream', kvStore.calls[0].options.type);
            assertEqual('a stream', result);
        });

        it('rejects a stream write, which KV has no way to accept', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();
            const stream = new ReadableStream();

            // Only getFile() can stream. A blob is stored under a hash of its
            // whole content, so the write side needs the bytes regardless.
            // putFile() takes no type, so a stream is now refused by what the
            // blob is rather than by what the caller called it.
            const caught = await catchAsyncError(
                () => store.putFile(makeContext({ kvStore }), '/a.txt', 'hash-a', stream),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual(0, kvStore.calls.length);
        });

        it('rejects a bulk stream read, which KV does not support', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getFiles(makeContext({ kvStore }), 'stream', [ { hash: 'hash-a' } ]),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('stream', caught.message);
        });

        it('rejects an unsupported representation type', async () => {
            const kvStore = makeKvStore(new Map());
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.getFile(makeContext({ kvStore }), 'json', '/a.txt', 'hash-a'),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('json', caught.message);
        });
    });
});
