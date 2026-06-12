import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import KeyValueStore from '../../../../src/plugins/cloudflare-key-value-store/lib/key-value-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Minimal Cloudflare KV namespace double. Backed by a single Map so reads and
// writes operate over the same stored keys. The double honors the `{ type }`
// option the way Cloudflare KV does: `type: 'json'` parses the stored text,
// `type: 'arrayBuffer'` and `type: 'text'` return the stored value as-is, and a
// missing key resolves to null. Each `put` is recorded in `puts` so tests can
// assert how the adapter maps expiry options onto KV's `expirationTtl` and
// `expiration`.
function makeKVNamespace(initial) {
    const store = new Map(Object.entries(initial ?? {}));
    const puts = [];

    function decode(raw, type) {
        if (raw === null || raw === undefined) {
            return null;
        }
        return type === 'json' ? JSON.parse(raw) : raw;
    }

    return {
        store,
        puts,
        async get(key, options) {
            const type = options?.type;
            return store.has(key) ? decode(store.get(key), type) : null;
        },
        async put(key, value, options) {
            store.set(key, value);
            puts.push({ key, value, options: options ?? {} });
        },
        async delete(key) {
            store.delete(key);
        },
    };
}

function makeContext(kvStore) {
    return { env: { KEY_VALUE_STORE: kvStore ?? makeKVNamespace() } };
}

function makeStore() {
    return new KeyValueStore({ logger: makeLogger() });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('KeyValueStore', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new KeyValueStore({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('KeyValueStore requires a logger', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new KeyValueStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('get', ({ it }) => {
        it('returns null when the key does not exist', async () => {
            const store = makeStore();

            const result = await store.get(makeContext(), 'missing');

            assertEqual(null, result);
        });

        it('returns the raw string for the default text type', async () => {
            const kvStore = makeKVNamespace({ greeting: 'hello' });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'greeting');

            assertEqual('hello', result);
        });

        it('returns a parsed value for the json type', async () => {
            const kvStore = makeKVNamespace({ profile: JSON.stringify({ name: 'Kris' }) });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
        });

        it('returns the stored buffer for the arrayBuffer type', async () => {
            const buffer = new Uint8Array([ 1, 2, 3 ]).buffer;
            const kvStore = makeKVNamespace({ blob: buffer });
            const store = makeStore();

            const result = await store.get(makeContext(kvStore), 'blob', { type: 'arrayBuffer' });

            assertEqual(buffer, result);
        });

        it('throws when the type is not supported', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { type: 'binary' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('type must be one of', caught.message);
        });
    });

    describe('put', ({ it }) => {
        it('writes a text value without expiry options', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'greeting', 'hello');

            assertEqual('hello', kvStore.store.get('greeting'));
            assertEqual(0, Object.keys(kvStore.puts[0].options).length);
        });

        it('serializes a json value before storing it', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'profile', { name: 'Kris' }, { type: 'json' });

            assertEqual(JSON.stringify({ name: 'Kris' }), kvStore.store.get('profile'));
        });

        it('stores an arrayBuffer value as-is', async () => {
            const view = new Uint8Array([ 4, 5, 6 ]);
            const kvStore = makeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'blob', view, { type: 'arrayBuffer' });

            assertEqual(view, kvStore.store.get('blob'));
        });

        it('maps ttlSeconds onto the KV expirationTtl option', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'session', 'token', { ttlSeconds: 300 });

            assertEqual(300, kvStore.puts[0].options.expirationTtl);
        });

        it('maps expiresAt onto the KV expiration option', async () => {
            const expiresAt = Math.floor(Date.now() / 1000) + 120;
            const kvStore = makeKVNamespace();
            const store = makeStore();

            await store.put(makeContext(kvStore), 'session', 'token', { expiresAt });

            assertEqual(expiresAt, kvStore.puts[0].options.expiration);
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
                () => store.put(makeContext(), 'session', 'token', { ttlSeconds: 30 }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('at least 60 seconds', caught.message);
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
            const expiresAt = Math.floor(Date.now() / 1000) + 10;

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { expiresAt }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('in the future', caught.message);
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
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.put(context, 'profile', { name: 'Kris' }, { type: 'json' });
            const result = await store.get(context, 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
        });
    });

    describe('delete', ({ it }) => {
        it('resolves with no value', async () => {
            const kvStore = makeKVNamespace({ greeting: 'hello' });
            const store = makeStore();

            const result = await store.delete(makeContext(kvStore), 'greeting');

            assertEqual(undefined, result);
        });

        it('removes the key from the store', async () => {
            const kvStore = makeKVNamespace({ greeting: 'hello' });
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.delete(context, 'greeting');

            assertEqual(false, kvStore.store.has('greeting'));
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
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(kvStore), '', 'value'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual(0, kvStore.puts.length);
        });

        it('rejects an invalid key on delete', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.delete(makeContext(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
