import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

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
            assertMatches('storage offline', caught.message);
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

        it('never passes KV a cacheTtl below the platform minimum', async () => {
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

            await store.putFile(makeContext({ kvStore }), '/a.txt', 'hash-a', 'the bytes');

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

            await store.putFile(makeContext({ kvStore }), '/a.bin', 'hash-a', blob);

            assertEqual('hash-a#1', kvStore.calls[0].key);
            assertEqual(blob, kvStore.calls[0].value);
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
