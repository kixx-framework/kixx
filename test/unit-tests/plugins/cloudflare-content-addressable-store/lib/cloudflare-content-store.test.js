import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import CloudflareContentStore from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeIndexEntries(hash) {
    return {
        '/': [ 'tree', hash ],
    };
}

function makeNamespace(durableObject) {
    const names = [];
    return {
        names,
        getByName(name) {
            names.push(name);
            return durableObject;
        },
    };
}

function makeContext(args) {
    const { buildId = 'build-a', durableObject, kv } = args ?? {};
    return {
        env: {
            CA_STORE_DURABLE_OBJECT: durableObject,
            CA_STORE_KV_STORE: kv,
        },
        runtime: {
            build: { id: buildId },
        },
    };
}

// Always misses. Used by tests which are not exercising the edge-cache layer
// itself, so a cached entry from an earlier assertion cannot mask a Durable
// Object call the test expects to observe.
function makeNoHitEdgeCache() {
    return {
        async match() {
            return undefined;
        },
        async put() {},
        async delete() {},
    };
}

// A minimal Cache API stand-in, keyed by request URL. Stores the response
// body as text and reconstructs a fresh Response per match(), matching real
// Cache API semantics where a Response body can only be read once.
function makeEdgeCache() {
    const store = new Map();
    const puts = [];

    return {
        puts,
        async match(request) {
            const entry = store.get(request.url);
            return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
        },
        async put(request, response) {
            puts.push({ url: request.url, headers: response.headers });
            const body = await response.text();
            store.set(request.url, { body, headers: response.headers });
        },
        async delete(request) {
            return store.delete(request.url);
        },
    };
}

function makeStore(args) {
    const { edgeCache = makeNoHitEdgeCache() } = args ?? {};
    return new CloudflareContentStore({
        logger: makeLogger(),
        kvBindingName: 'CA_STORE_KV_STORE',
        durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
        blobReadCacheTtlSeconds: 60,
        indexCacheTtlSeconds: 10,
        edgeCache,
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
        it('caches indexes independently by build ID', async () => {
            const durableObject = {
                calls: [],
                async getIndex(buildId) {
                    this.calls.push(buildId);
                    return { success: true, entries: makeIndexEntries(buildId) };
                },
            };
            const namespace = makeNamespace(durableObject);
            const store = makeStore();

            const indexOne = await store.getIndex(makeContext({ buildId: 'one', durableObject: namespace }));
            const indexOneAgain = await store.getIndex(makeContext({ buildId: 'one', durableObject: namespace }));
            const indexTwo = await store.getIndex(makeContext({ buildId: 'two', durableObject: namespace }));

            assertEqual('one', (await indexOne.getNode('/')).hash);
            assertEqual(indexOne, indexOneAgain);
            assertEqual('two', (await indexTwo.getNode('/')).hash);
            assertEqual(2, durableObject.calls.length);
            assertEqual('one', durableObject.calls[0]);
            assertEqual('two', durableObject.calls[1]);
        });

        it('retries immediately after a failed fetch instead of waiting out the TTL', async () => {
            let callCount = 0;
            const durableObject = {
                async getIndex() {
                    callCount += 1;
                    if (callCount === 1) {
                        throw new Error('temporary failure');
                    }
                    return { success: true, entries: makeIndexEntries('replacement') };
                },
            };
            const namespace = makeNamespace(durableObject);
            const context = makeContext({ durableObject: namespace });
            const store = makeStore();

            await catchAsyncError(() => store.getIndex(context));
            const replacement = await store.getIndex(context);

            assertEqual('replacement', (await replacement.getNode('/')).hash);
            assertEqual(2, callCount);
        });

        it('re-fetches once the in-memory cache entry exceeds indexCacheTtlSeconds', async () => {
            const tracker = new MockTracker();
            let now = 0;
            tracker.method(Date, 'now', () => now);

            try {
                let callCount = 0;
                const durableObject = {
                    async getIndex(buildId) {
                        callCount += 1;
                        return { success: true, entries: makeIndexEntries(buildId) };
                    },
                };
                const namespace = makeNamespace(durableObject);
                const context = makeContext({ durableObject: namespace });
                const store = makeStore();

                await store.getIndex(context);
                now += 5000;
                await store.getIndex(context);
                assertEqual(1, callCount);

                now += 6000;
                await store.getIndex(context);
                assertEqual(2, callCount);
            } finally {
                tracker.reset();
            }
        });

        it('shares a fetched index across store instances through the edge cache', async () => {
            const edgeCache = makeEdgeCache();
            let callCount = 0;
            const durableObject = {
                async getIndex(buildId) {
                    callCount += 1;
                    return { success: true, entries: makeIndexEntries(buildId) };
                },
            };
            const namespace = makeNamespace(durableObject);
            const context = makeContext({ durableObject: namespace });

            // Two separate instances stand in for two Workers isolates sharing
            // the same colo's edge cache.
            const storeOne = makeStore({ edgeCache });
            const storeTwo = makeStore({ edgeCache });

            const indexOne = await storeOne.getIndex(context);
            const indexTwo = await storeTwo.getIndex(context);

            assertEqual('build-a', (await indexOne.getNode('/')).hash);
            assertEqual('build-a', (await indexTwo.getNode('/')).hash);
            assertEqual(1, callCount);
            assertEqual('max-age=10', edgeCache.puts[0].headers.get('cache-control'));
        });

        it('translates Durable Object transport failures and preserves the cause', async () => {
            const cause = new Error('network unavailable');
            const namespace = makeNamespace({
                async getIndex() {
                    throw cause;
                },
            });
            const store = makeStore();

            const caught = await catchAsyncError(() => store.getIndex(makeContext({ durableObject: namespace })));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(cause, caught.cause);
            assertMatches('failed to call ContentAddressableIndexStore#getIndex()', caught.message);
        });

        it('preserves programmer errors thrown by the Durable Object', async () => {
            const cause = new TypeError('broken response construction');
            const namespace = makeNamespace({
                async getIndex() {
                    throw cause;
                },
            });
            const store = makeStore();

            const caught = await catchAsyncError(() => store.getIndex(makeContext({ durableObject: namespace })));

            assertEqual(cause, caught);
        });

        it('translates unsuccessful Durable Object responses', async () => {
            const namespace = makeNamespace({
                async getIndex() {
                    return { success: false, message: 'storage unavailable' };
                },
            });
            const store = makeStore();

            const caught = await catchAsyncError(() => store.getIndex(makeContext({ durableObject: namespace })));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('storage unavailable', caught.cause.message);
        });
    });

    describe('assignBuild()', ({ it }) => {
        it('invalidates the cached index for the assigned build, including the edge cache', async () => {
            let rootHash = 'before';
            let getIndexCallCount = 0;
            const durableObject = {
                async getIndex() {
                    getIndexCallCount += 1;
                    return { success: true, entries: makeIndexEntries(rootHash) };
                },
                async assignBuild(_buildId, assignedRootHash) {
                    rootHash = assignedRootHash;
                    return { success: true };
                },
            };
            const namespace = makeNamespace(durableObject);
            const context = makeContext({ durableObject: namespace });
            // A stateful edge cache is required here: the assertion below only
            // holds if assignBuild() actually purges the edge cache entry
            // written by the first getIndex() call, not merely the
            // in-memory one.
            const store = makeStore({ edgeCache: makeEdgeCache() });

            const before = await store.getIndex(context);
            await store.assignBuild(context, 'build-a', 'after');
            const after = await store.getIndex(context);

            assertEqual('before', (await before.getNode('/')).hash);
            assertEqual('after', (await after.getNode('/')).hash);
            assertEqual(2, getIndexCallCount);
        });
    });

    describe('getBlobs()', ({ it }) => {
        it('reads binary values individually with at most six concurrent requests', async () => {
            const pendingReads = [];
            const kv = {
                get(key, options) {
                    return new Promise((resolve) => {
                        pendingReads.push({ key, options, resolve });
                    });
                },
            };
            const store = makeStore();
            const hashes = [ 'a', 'b', 'c', 'd', 'e', 'f', 'g' ];

            const pending = store.getBlobs(makeContext({ kv }), hashes);
            await Promise.resolve();

            assertEqual(6, pendingReads.length);
            for (const read of pendingReads) {
                assertEqual('arrayBuffer', read.options.type);
                read.resolve(new Uint8Array([ read.key.charCodeAt(read.key.length - 1) ]).buffer);
            }

            await Promise.resolve();
            await Promise.resolve();
            assertEqual(7, pendingReads.length);
            pendingReads[6].resolve(null);

            const results = await pending;
            assertEqual(7, results.length);
            assertEqual('b:1:a', pendingReads[0].key);
            assertEqual(97, results[0][0]);
            assertEqual(null, results[6]);
        });
    });
});
