import { assert, assertEqual } from '../../../kixx/assertions/mod.js';


/**
 * @typedef {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueStoreInterface} KeyValueStoreInterface
 */

/**
 * @typedef {Object} KeyValueStoreSubject
 * @property {KeyValueStoreInterface} store - The adapter under test.
 * @property {Object} context - The context to pass as each call's first argument.
 * @property {function(): Promise<void>} afterWrite - Resolves when a key just
 *   written may be read back, written again, or deleted. A store limited to
 *   one write per second to a key waits that second out, or moves the clock it
 *   was given. A store with no such limit resolves at once.
 */

/**
 * @callback MakeKeyValueStore
 * @returns {KeyValueStoreSubject}
 */

/**
 * The shared key/value store contract suite, run against every adapter.
 *
 * It covers only what the port promises on every platform. What an adapter
 * hands to its backing store, and the wording of its error messages, belong in
 * the adapter's own test file.
 *
 * This suite also runs on real platforms, where storage outlives the test and
 * every call is a network request. Before you change it, read the rules for
 * such suites in `test/README.md`, under "Shared Conformance Suites".
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeKeyValueStore} makeKeyValueStore - Builds the adapter under test. Called once per test.
 */
export default function keyValueStoreConformance(describe, makeKeyValueStore) {

    describe('contract: reads and writes', ({ it }) => {
        it('resolves null for a missing key', async () => {
            const { store, context } = makeKeyValueStore();

            assertEqual(null, await store.get(context, makeKey('missing')));
        });

        it('round-trips a text value by default', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('text');

            await store.put(context, key, 'hello 👋');
            await afterWrite();

            assertEqual('hello 👋', await store.get(context, key));
        });

        it('round-trips a json object', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('json-object');
            const value = { name: 'Kris', count: 7, tags: [ 'a', 'b' ], nested: { ok: true } };

            await store.put(context, key, value, { type: 'json' });
            await afterWrite();
            const result = await store.get(context, key, { type: 'json' });

            assertEqual(JSON.stringify(value), JSON.stringify(result));
        });

        it('round-trips a json primitive', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('json-primitive');

            await store.put(context, key, true, { type: 'json' });
            await afterWrite();

            assertEqual(true, await store.get(context, key, { type: 'json' }));
        });

        it('round-trips an ArrayBuffer', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('array-buffer');
            const buffer = new Uint8Array([ 9, 8, 7, 0, 255 ]).buffer;

            await store.put(context, key, buffer, { type: 'arrayBuffer' });
            await afterWrite();
            const result = await store.get(context, key, { type: 'arrayBuffer' });

            assert(result instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual('9,8,7,0,255', bytesOf(result));
        });

        it('stores only the bytes a typed-array view covers and reads them as an ArrayBuffer', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('view');
            const backing = new Uint8Array([ 1, 2, 3, 4, 5, 6 ]).buffer;
            const view = new Uint8Array(backing, 2, 3);

            await store.put(context, key, view, { type: 'arrayBuffer' });
            await afterWrite();
            const result = await store.get(context, key, { type: 'arrayBuffer' });

            assert(result instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual('3,4,5', bytesOf(result));
        });

        it('overwrites an existing value', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('overwrite');

            await store.put(context, key, 'first');
            await afterWrite();
            await store.put(context, key, 'second');
            await afterWrite();

            assertEqual('second', await store.get(context, key));
        });
    });

    describe('contract: delete', ({ it }) => {
        it('resolves undefined', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('delete');

            await store.put(context, key, 'value');
            await afterWrite();

            assertEqual(undefined, await store.delete(context, key));
        });

        it('removes the key', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('delete-removes');

            await store.put(context, key, 'value');
            await afterWrite();
            await store.delete(context, key);
            await afterWrite();

            assertEqual(null, await store.get(context, key));
        });

        it('resolves undefined for a missing key', async () => {
            const { store, context } = makeKeyValueStore();

            assertEqual(undefined, await store.delete(context, makeKey('never-written')));
        });
    });

    // An expiry is never waited out here: a test that sleeps for a minute is
    // too slow, and a store's own clock is not the suite's to move.
    describe('contract: expiry and cache hints', ({ it }) => {
        it('accepts ttlSeconds at the 60 second minimum', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('ttl');

            await store.put(context, key, 'value', { ttlSeconds: 60 });
            await afterWrite();

            assertEqual('value', await store.get(context, key));
        });

        it('accepts expiresAt 120 seconds in the future', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('expires-at');

            await store.put(context, key, 'value', { expiresAt: secondsFromNow(120) });
            await afterWrite();

            assertEqual('value', await store.get(context, key));
        });

        it('accepts cacheTtl at the 60 second minimum', async () => {
            const { store, context, afterWrite } = makeKeyValueStore();
            const key = makeKey('cache-ttl');

            await store.put(context, key, 'value');
            await afterWrite();

            assertEqual('value', await store.get(context, key, { cacheTtl: 60 }));
        });
    });

    // Each of these is refused by the adapter itself, before it calls its
    // backing store, so none of them needs afterWrite().
    describe('contract: rejected options and values', ({ it }) => {
        it('rejects ttlSeconds below 60', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('ttl'), 'value', { ttlSeconds: 59 }));
        });

        it('rejects ttlSeconds that is not an integer', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('ttl'), 'value', { ttlSeconds: 60.5 }));
        });

        it('rejects ttlSeconds and expiresAt together', async () => {
            const { store, context } = makeKeyValueStore();
            const options = { ttlSeconds: 300, expiresAt: secondsFromNow(300) };

            await assertAssertionError(() => store.put(context, makeKey('both'), 'value', options));
        });

        it('rejects expiresAt less than 60 seconds in the future', async () => {
            const { store, context } = makeKeyValueStore();
            // Round down, so the expiry is under the floor at whatever instant
            // the adapter reads the clock.
            const expiresAt = Math.floor(Date.now() / 1000) + 59;

            await assertAssertionError(() => store.put(context, makeKey('expires-at'), 'value', { expiresAt }));
        });

        it('rejects cacheTtl below 60', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, makeKey('cache-ttl'), { cacheTtl: 59 }));
        });

        it('rejects cacheTtl that is not an integer', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, makeKey('cache-ttl'), { cacheTtl: 60.5 }));
        });

        it('rejects an unsupported type', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, makeKey('type'), { type: 'stream' }));
        });

        it('rejects an empty text value', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('text'), ''));
        });

        it('rejects a text value that is not a string', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('text'), 42));
        });

        it('rejects a null json value', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('json'), null, { type: 'json' }));
        });

        it('rejects an arrayBuffer value that is not a buffer or view', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.put(context, makeKey('bytes'), 'not-bytes', { type: 'arrayBuffer' }));
        });
    });

    describe('contract: rejected keys', ({ it }) => {
        it('rejects an empty key', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, ''));
        });

        it('rejects a key that holds a control character', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, makeKey('tab\there')));
        });

        it('rejects the key "."', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, '.'));
        });

        it('rejects the key ".."', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.get(context, '..'));
        });

        it('rejects a key over 512 bytes, counting bytes and not characters', async () => {
            const { store, context } = makeKeyValueStore();
            // 257 characters, each two bytes in UTF-8: 514 bytes.
            const key = 'é'.repeat(257);

            await assertAssertionError(() => store.get(context, key));
        });

        it('rejects an invalid key on delete', async () => {
            const { store, context } = makeKeyValueStore();

            await assertAssertionError(() => store.delete(context, ''));
        });
    });
}

// Storage on a real platform outlives the test, and tests may run again
// before earlier keys expire, so no two tests ever share a key.
function makeKey(name) {
    return `conformance/${ crypto.randomUUID() }/${ name }`;
}

// Round up, so the expiry is at least this far away at whatever instant the
// adapter or its backing store reads the clock.
function secondsFromNow(seconds) {
    return Math.ceil(Date.now() / 1000) + seconds;
}

function bytesOf(arrayBuffer) {
    return Array.from(new Uint8Array(arrayBuffer)).join(',');
}

async function assertAssertionError(fn) {
    try {
        await fn();
    } catch (error) {
        assertEqual('AssertionError', error.name);
        return;
    }

    assert(false, 'expected an AssertionError');
}
