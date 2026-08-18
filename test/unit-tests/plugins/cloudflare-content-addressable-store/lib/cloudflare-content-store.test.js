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

function makeStore() {
    return new CloudflareContentStore({
        logger: makeLogger(),
        kvBindingName: 'CA_STORE_KV_STORE',
        durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
        blobReadCacheTtlSeconds: 60,
        indexCacheTtlSeconds: 10,
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

async function withCapturedTimeouts(callback) {
    const tracker = new MockTracker();
    const callbacks = [];
    tracker.method(globalThis, 'setTimeout', (fn) => {
        callbacks.push(fn);
        return callbacks.length;
    });

    try {
        return await callback(callbacks);
    } finally {
        tracker.reset();
    }
}


describe('CloudflareContentStore', ({ describe }) => {

    describe('getIndex()', ({ it }) => {
        it('caches indexes independently by build ID', async () => {
            await withCapturedTimeouts(async () => {
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
        });

        it('does not let an expired entry timer clear its replacement', async () => {
            await withCapturedTimeouts(async (callbacks) => {
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
                callbacks[0]();
                const cached = await store.getIndex(context);

                assertEqual(replacement, cached);
                assertEqual(2, callCount);
            });
        });

        it('translates Durable Object transport failures and preserves the cause', async () => {
            await withCapturedTimeouts(async () => {
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
        });

        it('preserves programmer errors thrown by the Durable Object', async () => {
            await withCapturedTimeouts(async () => {
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
        });

        it('translates unsuccessful Durable Object responses', async () => {
            await withCapturedTimeouts(async () => {
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
    });

    describe('assignBuild()', ({ it }) => {
        it('invalidates the cached index for the assigned build', async () => {
            await withCapturedTimeouts(async () => {
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
                const store = makeStore();

                const before = await store.getIndex(context);
                await store.assignBuild(context, 'build-a', 'after');
                const after = await store.getIndex(context);

                assertEqual('before', (await before.getNode('/')).hash);
                assertEqual('after', (await after.getNode('/')).hash);
                assertEqual(2, getIndexCallCount);
            });
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
