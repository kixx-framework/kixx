import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createFakeKVNamespace } from '../../../../../fakes/workers-kv.js';
import KeyValueStore from '../../../../../../kixx/adapters/cloudflare/key-value-store/lib/key-value-store.js';
import Logger from '../../../../../../kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeContext(kvStore) {
    return { logger: makeLogger(), env: { KEY_VALUE_STORE: kvStore ?? createFakeKVNamespace() } };
}

function makeStore() {
    return new KeyValueStore();
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function withFixedNow(nowMilliseconds, callback) {
    const tracker = new MockTracker();
    tracker.method(Date, 'now', () => nowMilliseconds);
    try {
        return await callback();
    } finally {
        tracker.reset();
    }
}


describe('KeyValueStore', ({ describe }) => {

    describe('get', ({ it }) => {
        it('returns null when the key does not exist', async () => {
            const store = makeStore();

            const result = await store.get(makeContext(), 'missing');

            assertEqual(null, result);
        });

        it('returns the raw string for the default text type', async () => {
            const kvStore = createFakeKVNamespace({ initial: { greeting: 'hello' } });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'greeting');

            assertEqual('hello', result);
        });

        it('returns a parsed value for the json type', async () => {
            const kvStore = createFakeKVNamespace({ initial: { profile: JSON.stringify({ name: 'Kris' }) } });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
        });

        it('returns the stored buffer for the arrayBuffer type', async () => {
            const buffer = new Uint8Array([ 1, 2, 3 ]).buffer;
            const kvStore = createFakeKVNamespace({ initial: { blob: buffer } });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'blob', { type: 'arrayBuffer' });

            // KV returns a copy of the stored bytes, never the buffer it was given.
            assert(result instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual('1,2,3', Array.from(new Uint8Array(result)).join(','));
        });

        it('throws when the type is not supported', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { type: 'binary' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('type must be one of', caught.message);
        });

        it('maps cacheTtl onto the KV get cacheTtl option', async () => {
            const kvStore = createFakeKVNamespace({ initial: { greeting: 'hello' } });
            const store = makeStore();

            await store.get(makeContext(kvStore), 'greeting', { cacheTtl: 300 });

            assertEqual('get', kvStore.calls[0].method);
            assertEqual(300, kvStore.calls[0].options.cacheTtl);
        });

        it('throws when cacheTtl is below the 60 second minimum', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { cacheTtl: 59 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual('KeyValueStore "cacheTtl" must be at least 60 seconds', caught.message);
        });

        it('throws when cacheTtl is not a positive integer', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { cacheTtl: 1.5 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('cacheTtl" must be a positive integer', caught.message);
        });
    });

    describe('put', ({ it }) => {
        it('writes a text value without expiry options', async () => {
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'greeting', 'hello');

            assertEqual('put', kvStore.calls[0].method);
            assertEqual(0, Object.keys(kvStore.calls[0].options).length);
            assertEqual('hello', await kvStore.get('greeting'));
        });

        it('serializes a json value before storing it', async () => {
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'profile', { name: 'Kris' }, { type: 'json' });

            assertEqual(JSON.stringify({ name: 'Kris' }), await kvStore.get('profile'));
        });

        it('stores an arrayBuffer value as-is', async () => {
            const view = new Uint8Array([ 4, 5, 6 ]);
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'blob', view, { type: 'arrayBuffer' });

            assertEqual(view, kvStore.calls[0].value);
            assertEqual('4,5,6', Array.from(new Uint8Array(await kvStore.get('blob', 'arrayBuffer'))).join(','));
        });

        it('maps ttlSeconds onto the KV expirationTtl option', async () => {
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'session', 'token', { ttlSeconds: 300 });

            assertEqual(300, kvStore.calls[0].options.expirationTtl);
        });

        it('maps expiresAt onto the KV expiration option', async () => {
            const expiresAt = Math.floor(Date.now() / 1000) + 120;
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'session', 'token', { expiresAt });

            assertEqual(expiresAt, kvStore.calls[0].options.expiration);
        });

        it('throws when both ttlSeconds and expiresAt are provided', async () => {
            const store = makeStore();
            const expiresAt = Math.floor(Date.now() / 1000) + 120;

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { ttlSeconds: 300, expiresAt }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('only one of', caught.message);
        });

        it('throws when ttlSeconds is below the 60 second minimum', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { ttlSeconds: 59 }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual('KeyValueStore "ttlSeconds" must be at least 60 seconds', caught.message);
        });

        it('accepts ttlSeconds at the 60 second minimum', async () => {
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'session', 'token', { ttlSeconds: 60 });

            assertEqual(60, kvStore.calls[0].options.expirationTtl);
        });

        it('throws when ttlSeconds is not a positive integer', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { ttlSeconds: 1.5 }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('positive integer', caught.message);
        });

        it('throws when expiresAt is less than 60 seconds in the future', async () => {
            const store = makeStore();
            const nowMilliseconds = 1_800_000_000_000;
            const expiresAt = (nowMilliseconds / 1000) + 59;

            const caught = await withFixedNow(nowMilliseconds, async () => {
                return await catchAsyncError(
                    () => store.put(makeContext(), 'session', 'token', { expiresAt }),
                );
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual('KeyValueStore "expiresAt" must be at least 60 seconds in the future', caught.message);
        });

        it('accepts expiresAt exactly 60 seconds in the future', async () => {
            const nowMilliseconds = 1_800_000_000_000;
            const expiresAt = (nowMilliseconds / 1000) + 60;
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            await withFixedNow(nowMilliseconds, async () => {
                await store.put(makeContext(kvStore), 'session', 'token', { expiresAt });
            });

            assertEqual(expiresAt, kvStore.calls[0].options.expiration);
        });

        it('throws when a text value is not a string', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(), 'key', 42));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"text" value must be a non-empty string', caught.message);
        });

        it('throws when a json value is null', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(), 'key', null, { type: 'json' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"json" value must not be null', caught.message);
        });

        it('throws when an arrayBuffer value is not a buffer or view', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'key', 'not-bytes', { type: 'arrayBuffer' }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"arrayBuffer" value must be an ArrayBuffer', caught.message);
        });

        it('round-trips a json value through get', async () => {
            const kvStore = createFakeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.put(context, 'profile', { name: 'Kris' }, { type: 'json' });
            const result = await store.get(context, 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
        });
    });

    describe('delete', ({ it }) => {
        it('resolves with no value', async () => {
            const kvStore = createFakeKVNamespace({ initial: { greeting: 'hello' } });
            const store = makeStore();

            const result = await store.delete(makeContext(kvStore), 'greeting');

            assertEqual(undefined, result);
        });

        it('removes the key from the store', async () => {
            const kvStore = createFakeKVNamespace({ initial: { greeting: 'hello' } });
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.delete(context, 'greeting');

            assertEqual(null, await kvStore.get('greeting'));
            assertEqual(null, await store.get(context, 'greeting'));
        });

        it('resolves even when the key does not exist', async () => {
            const store = makeStore();

            const result = await store.delete(makeContext(), 'missing');

            assertEqual(undefined, result);
        });
    });

    describe('key validation', ({ it }) => {
        it('throws when the key is empty', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('key must be a non-empty string', caught.message);
        });

        it('throws when the key contains control characters', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'a\tb'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('control characters', caught.message);
        });

        it('throws when the key is "." or ".."', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), '..'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not be', caught.message);
        });

        it('throws when the key exceeds 512 bytes', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'a'.repeat(513)));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not exceed 512 bytes', caught.message);
        });

        it('rejects an invalid key on put before touching the store', async () => {
            const kvStore = createFakeKVNamespace();
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(kvStore), '', 'value'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual(0, kvStore.calls.length);
        });

        it('rejects an invalid key on delete', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.delete(makeContext(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
