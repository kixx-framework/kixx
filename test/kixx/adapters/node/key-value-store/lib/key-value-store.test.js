import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import KeyValueStore from '../../../../../../kixx/adapters/node/key-value-store/lib/key-value-store.js';
import Logger from '../../../../../../kixx/logger/logger.js';
import keyValueStoreConformance from '../../../../key-value-store/key-value-store-conformance.js';


const tempDirs = [];
const conformanceStores = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-kv-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Each store gets its own in-memory SQLite database so tests stay isolated and
// never touch the filesystem. The store opens and prepares the connection lazily
// on first use, so ':memory:' is enough.
function makeStore() {
    return new KeyValueStore({ logger: makeLogger(), path: ':memory:' });
}

// Constructor-supplied path/database stores bypass request-config resolution, so
// most low-level behavior tests need only a logger for tracing.
function makeContext() {
    return { logger: makeLogger() };
}

function makeConformanceStore() {
    const store = makeStore();
    conformanceStores.push(store);

    return {
        store,
        context: makeContext(),
        async afterWrite() {
            // SQLite has no write rate limit and reads its own writes at once.
        },
    };
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

async function withFixedNow(nowMilliseconds, callback) {
    const tracker = new MockTracker();
    tracker.method(Date, 'now', () => nowMilliseconds);
    try {
        return await callback();
    } finally {
        tracker.reset();
    }
}


describe('Node KeyValueStore', ({ after, describe }) => {

    after(async () => {
        for (const store of conformanceStores) {
            store.close();
        }

        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    keyValueStoreConformance(describe, makeConformanceStore);

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new KeyValueStore({ path: ':memory:' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('KeyValueStore requires a logger', caught.message);
        });

        it('throws when neither a database nor path is provided', () => {
            const caught = catchError(() => new KeyValueStore({ logger: makeLogger() }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('database or path', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new KeyValueStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('logger', caught.message);
        });
    });

    describe('explicit database configuration', ({ it }) => {
        it('keeps using the constructor path regardless of method context config', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'key_value_store.sqlite');
            const context = {
                logger: makeLogger(),
                config: {
                    env: { KEY_VALUE_STORE: { path: './ignored.sqlite' } },
                    resolveFilepath() {
                        throw new Error('method context config should not be used');
                    },
                },
            };
            const store = new KeyValueStore({ logger: makeLogger(), path: sqlitePath });

            await store.put(context, 'shared', 'first');
            await store.put(context, 'shared', 'second');

            assertEqual('second', await store.get(context, 'shared'));
            store.close();
        });

        it('persists values through a constructor-supplied file path', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'key_value_store.sqlite');
            const firstStore = new KeyValueStore({ logger: makeLogger(), path: sqlitePath });
            const secondStore = new KeyValueStore({ logger: makeLogger(), path: sqlitePath });

            await firstStore.put(makeContext(), 'shared', 'first');
            firstStore.close();

            assertEqual('first', await secondStore.get(makeContext(), 'shared'));
            secondStore.close();
        });
    });

    describe('get', ({ it }) => {
        it('throws when the type is not supported', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { type: 'binary' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('type must be one of', caught.message);
            store.close();
        });

        it('throws when cacheTtl is not a positive integer', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { cacheTtl: -1 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('cacheTtl" must be a positive integer', caught.message);
            store.close();
        });

        it('throws when cacheTtl is below the 60 second floor', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { cacheTtl: 59 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('cacheTtl" must be at least 60 seconds', caught.message);
            store.close();
        });
    });

    describe('put', ({ it }) => {
        it('throws when ttlSeconds is below the 60 second minimum', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => {
                return store.put(makeContext(), 'session', 'token', { ttlSeconds: 59 });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual('KeyValueStore "ttlSeconds" must be at least 60 seconds', caught.message);
            store.close();
        });

        it('accepts ttlSeconds at the 60 second minimum', async () => {
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database });
            const nowMilliseconds = 1_800_000_000_000;

            await withFixedNow(nowMilliseconds, async () => {
                await store.put(makeContext(), 'session', 'token', { ttlSeconds: 60 });
            });

            const row = database.prepare('SELECT expires_at FROM kv WHERE key = ?').get('session');

            assertEqual((nowMilliseconds / 1000) + 60, row.expires_at);
            database.close();
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
            store.close();
        });

        it('throws when ttlSeconds is not a positive integer', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { ttlSeconds: 1.5 }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('positive integer', caught.message);
            store.close();
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
            store.close();
        });

        it('accepts expiresAt exactly 60 seconds in the future', async () => {
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database });
            const nowMilliseconds = 1_800_000_000_000;
            const expiresAt = (nowMilliseconds / 1000) + 60;

            await withFixedNow(nowMilliseconds, async () => {
                await store.put(makeContext(), 'session', 'token', { expiresAt });
            });

            const row = database.prepare('SELECT expires_at FROM kv WHERE key = ?').get('session');

            assertEqual(expiresAt, row.expires_at);
            database.close();
        });

        it('throws when a text value is not a string', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(), 'key', 42));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"text" value must be a non-empty string', caught.message);
            store.close();
        });

        it('throws when a json value is null', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.put(makeContext(), 'key', null, { type: 'json' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"json" value must not be null', caught.message);
            store.close();
        });

        it('throws when a json value cannot serialize to JSON text', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'key', () => {}, { type: 'json' }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"json" value must be JSON-serializable', caught.message);
            store.close();
        });

        it('throws an AssertionError when JSON serialization rejects the value', async () => {
            const store = makeStore();
            const value = {};
            value.self = value;

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'key', value, { type: 'json' }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"json" value must be JSON-serializable', caught.message);
            assertEqual('TypeError', caught.cause.name);
            store.close();
        });

        it('throws when an arrayBuffer value is not a buffer or view', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'key', 'not-bytes', { type: 'arrayBuffer' }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"arrayBuffer" value must be an ArrayBuffer', caught.message);
            store.close();
        });
    });

    describe('expiration', ({ it }) => {
        it('returns null for an entry whose expiry has passed', async () => {
            // Inject the connection so the test can backdate the stored expiry
            // directly, exercising the read-side expiry guard deterministically
            // without waiting on the clock.
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database });
            const context = makeContext();

            await store.put(context, 'session', 'token', { ttlSeconds: 300 });

            // Backdate the entry past its expiry; the store's own put() rejects a
            // past expiresAt, so we set it on the row directly.
            const pastSeconds = Math.floor(Date.now() / 1000) - 1;
            database.prepare('UPDATE kv SET expires_at = ? WHERE key = ?').run(pastSeconds, 'session');

            const result = await store.get(context, 'session');

            assertEqual(null, result);
            database.close();
        });

        it('opportunistically sweeps expired rows on sampled writes', async () => {
            const tracker = new MockTracker();
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database });
            const context = makeContext();

            await store.put(context, 'fresh', 'value');
            const pastSeconds = Math.floor(Date.now() / 1000) - 1;
            database
                .prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)')
                .run('expired', new Uint8Array([ 1 ]), pastSeconds);

            try {
                tracker.method(Math, 'random', () => 0);
                await store.put(context, 'trigger', 'value');
            } finally {
                tracker.reset();
            }

            const expired = database.prepare('SELECT key FROM kv WHERE key = ?').get('expired');

            assertEqual(undefined, expired);
            database.close();
        });
    });

    describe('key validation', ({ it }) => {
        it('throws when the key is empty', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('key must be a non-empty string', caught.message);
            store.close();
        });

        it('throws when the key contains control characters', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'a\tb'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('control characters', caught.message);
            store.close();
        });

        it('throws when the key is "." or ".."', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), '..'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not be', caught.message);
            store.close();
        });

        it('throws when the key exceeds 512 bytes', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'a'.repeat(513)));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not exceed 512 bytes', caught.message);
            store.close();
        });
    });

    describe('close', ({ it }) => {
        it('is safe to call more than once', () => {
            const store = makeStore();

            store.close();
            const caught = catchError(() => store.close());

            assertEqual(null, caught);
        });

        it('throws when used after close', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'greeting', 'hello');
            store.close();
            const caught = await catchAsyncError(() => store.get(context, 'greeting'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('has been closed', caught.message);
        });

        it('leaves a caller-owned injected database open', async () => {
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database });

            await store.put(makeContext(), 'greeting', 'hello');
            store.close();
            const row = database.prepare('SELECT value FROM kv WHERE key = ?').get('greeting');

            assert(row, 'expected the caller-owned database to remain open');
            database.close();
        });

        it('closes an injected database when ownsDatabase is true', async () => {
            const database = new DatabaseSync(':memory:');
            const store = new KeyValueStore({ logger: makeLogger(), database, ownsDatabase: true });

            await store.put(makeContext(), 'greeting', 'hello');
            store.close();
            const caught = catchError(() => database.prepare('SELECT 1'));

            assert(caught, 'expected the owned database to be closed');
        });
    });
});
