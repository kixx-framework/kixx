import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import KeyValueStore from '../../../../src/plugins/node-key-value-store/lib/key-value-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


const tempDirs = [];

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
// most low-level behavior tests can pass an empty context.
function makeContext() {
    return {};
}

// arrayBuffer values come back as fresh ArrayBuffer instances, so identity
// comparison would fail; compare the bytes instead.
function bytesOf(arrayBuffer) {
    return Array.from(new Uint8Array(arrayBuffer));
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


describe('Node KeyValueStore', ({ after, describe }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new KeyValueStore({ path: ':memory:' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('KeyValueStore requires a logger', caught.message);
        });

        it('allows logger-only construction for request-config-backed stores', () => {
            const store = new KeyValueStore({ logger: makeLogger() });

            store.close();
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new KeyValueStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('request config', ({ it }) => {
        it('resolves KEY_VALUE_STORE.path from the method context', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'key_value_store.sqlite');
            const tracker = new MockTracker();
            const resolveFilepath = tracker.fn(() => sqlitePath);
            const context = {
                config: {
                    env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
                    resolveFilepath,
                },
            };
            const store = new KeyValueStore({ logger: makeLogger() });

            await store.put(context, 'greeting', 'hello');
            const result = await store.get(context, 'greeting');

            assertEqual('../data/key_value_store.sqlite', resolveFilepath.mock.getCall(0).arguments[0]);
            assertEqual('hello', result);
            store.close();
        });

        it('throws when KEY_VALUE_STORE.path is missing', async () => {
            const store = new KeyValueStore({ logger: makeLogger() });

            const caught = await catchAsyncError(() => store.get({ config: { env: {} } }, 'missing'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('KEY_VALUE_STORE.path', caught.message);
            store.close();
        });

        it('reuses the same database across requests with a stable resolved path', async () => {
            const directory = await makeTempDir();
            const sqlitePath = path.join(directory, 'key_value_store.sqlite');
            const resolveFilepath = () => sqlitePath;
            const makeConfigContext = () => {
                return {
                    config: {
                        env: { KEY_VALUE_STORE: { path: '../data/key_value_store.sqlite' } },
                        resolveFilepath,
                    },
                };
            };
            const store = new KeyValueStore({ logger: makeLogger() });

            // A fresh context object each request still resolves the same path, so
            // a value written on one request is visible on the next.
            await store.put(makeConfigContext(), 'shared', 'first');
            await store.put(makeConfigContext(), 'shared', 'second');

            assertEqual('second', await store.get(makeConfigContext(), 'shared'));
            store.close();
        });

        it('throws when the resolved path changes after the database is opened', async () => {
            const directory = await makeTempDir();
            const firstPath = path.join(directory, 'first.sqlite');
            const secondPath = path.join(directory, 'second.sqlite');
            const resolveFilepath = (configuredPath) => {
                return configuredPath === './first.sqlite' ? firstPath : secondPath;
            };
            const firstContext = {
                config: {
                    env: { KEY_VALUE_STORE: { path: './first.sqlite' } },
                    resolveFilepath,
                },
            };
            const secondContext = {
                config: {
                    env: { KEY_VALUE_STORE: { path: './second.sqlite' } },
                    resolveFilepath,
                },
            };
            const store = new KeyValueStore({ logger: makeLogger() });

            await store.put(firstContext, 'shared', 'first');

            const caught = await catchAsyncError(() => store.put(secondContext, 'shared', 'second'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not change', caught.message);
            store.close();
        });
    });

    describe('get', ({ it }) => {
        it('returns null when the key does not exist', async () => {
            const store = makeStore();

            const result = await store.get(makeContext(), 'missing');

            assertEqual(null, result);
            store.close();
        });

        it('returns the string for the default text type', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'greeting', 'hello');
            const result = await store.get(context, 'greeting');

            assertEqual('hello', result);
            store.close();
        });

        it('returns a parsed value for the json type', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'profile', { name: 'Kris' }, { type: 'json' });
            const result = await store.get(context, 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
            store.close();
        });

        it('returns an ArrayBuffer for the arrayBuffer type', async () => {
            const store = makeStore();
            const context = makeContext();
            const view = new Uint8Array([ 1, 2, 3 ]);

            await store.put(context, 'blob', view, { type: 'arrayBuffer' });
            const result = await store.get(context, 'blob', { type: 'arrayBuffer' });

            assert(result instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual(JSON.stringify([ 1, 2, 3 ]), JSON.stringify(bytesOf(result)));
            store.close();
        });

        it('throws when the type is not supported', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.get(makeContext(), 'key', { type: 'binary' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('type must be one of', caught.message);
            store.close();
        });
    });

    describe('put', ({ it }) => {
        it('overwrites an existing key', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'greeting', 'hello');
            await store.put(context, 'greeting', 'goodbye');
            const result = await store.get(context, 'greeting');

            assertEqual('goodbye', result);
            store.close();
        });

        it('round-trips a json value through get', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'profile', { name: 'Kris', count: 7 }, { type: 'json' });
            const result = await store.get(context, 'profile', { type: 'json' });

            assertEqual('Kris', result.name);
            assertEqual(7, result.count);
            store.close();
        });

        it('round-trips a primitive json value through get', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'flag', true, { type: 'json' });
            const result = await store.get(context, 'flag', { type: 'json' });

            assertEqual(true, result);
            store.close();
        });

        it('round-trips an arrayBuffer value byte-for-byte', async () => {
            const store = makeStore();
            const context = makeContext();
            const buffer = new Uint8Array([ 9, 8, 7, 6 ]).buffer;

            await store.put(context, 'blob', buffer, { type: 'arrayBuffer' });
            const result = await store.get(context, 'blob', { type: 'arrayBuffer' });

            assertEqual(JSON.stringify([ 9, 8, 7, 6 ]), JSON.stringify(bytesOf(result)));
            store.close();
        });

        it('accepts a sub-60-second ttlSeconds (Node has no minimum TTL)', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'session', 'token', { ttlSeconds: 30 });
            const result = await store.get(context, 'session');

            assertEqual('token', result);
            store.close();
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

        it('throws when expiresAt is not in the future', async () => {
            const store = makeStore();
            const expiresAt = Math.floor(Date.now() / 1000) - 10;

            const caught = await catchAsyncError(
                () => store.put(makeContext(), 'session', 'token', { expiresAt }),
            );

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('in the future', caught.message);
            store.close();
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

        it('keeps an entry with a null expiry visible', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'permanent', 'value');
            const result = await store.get(context, 'permanent');

            assertEqual('value', result);
            store.close();
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

    describe('delete', ({ it }) => {
        it('resolves with no value', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'greeting', 'hello');
            const result = await store.delete(context, 'greeting');

            assertEqual(undefined, result);
            store.close();
        });

        it('removes the key from the store', async () => {
            const store = makeStore();
            const context = makeContext();

            await store.put(context, 'greeting', 'hello');
            await store.delete(context, 'greeting');

            assertEqual(null, await store.get(context, 'greeting'));
            store.close();
        });

        it('resolves even when the key does not exist', async () => {
            const store = makeStore();

            const result = await store.delete(makeContext(), 'missing');

            assertEqual(undefined, result);
            store.close();
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

        it('rejects an invalid key on delete', async () => {
            const store = makeStore();

            const caught = await catchAsyncError(() => store.delete(makeContext(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
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
