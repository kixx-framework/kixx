/**
 * A fake of a Workers KV namespace binding for unit tests, held in memory.
 *
 * Shared on purpose. Test helpers are normally local to one test file. A fake
 * of a platform service is an exception, because every test of code that uses
 * Workers KV must meet the same platform rules. Only test code imports this
 * module.
 *
 * What it models, from Cloudflare's documentation:
 *
 * - `get(key, options)`, where `options` is a type or `{ type, cacheTtl }`.
 *   The types are `text` (the default), `json`, `arrayBuffer`, and `stream`. A
 *   missing or expired key resolves `null`. `cacheTtl` must be at least 30.
 * - `get(keys, options)` with an array of at most 100 keys and the type
 *   `text` or `json`. It resolves a `Map` with `null` for each missing key.
 * - `put(key, value, options)` with a string or an `ArrayBuffer`.
 *   `expirationTtl` must be at least 60, `expiration` (seconds since the
 *   epoch) at least 60 seconds away, and `metadata` at most 1,024 bytes as
 *   JSON.
 * - `delete(key)`, which succeeds for a missing key.
 * - A key is at most 512 bytes of UTF-8, and is not empty, `.`, or `..`.
 * - A value is at most 25 MiB (26,214,400 bytes).
 * - One write per second to a key. A `put` less than 1,000 ms after the last
 *   `put` to the same key rejects with `KV PUT failed: 429 Too Many
 *   Requests`, and the value stays as it was.
 * - A key is gone from the moment its expiration is reached.
 *
 * Where the documentation is silent:
 *
 * - `put` accepts a view (`ArrayBufferView`) as well as an `ArrayBuffer`. The
 *   documentation lists only `ArrayBuffer`. This is the one place the fake
 *   may accept more than the platform; confirm it on Cloudflare.
 * - `get([])`, a `put` with both `expiration` and `expirationTtl`, and an
 *   argument of the wrong type all reject. The fake takes the stricter
 *   reading.
 * - A `json` read of a value that isn't JSON rejects with `SyntaxError`.
 *
 * What it doesn't model:
 *
 * - `list()` and `getWithMetadata()`. They are left out, so calling one
 *   throws. Metadata is checked for size and then dropped.
 * - `put` of a `ReadableStream`. It rejects like any unsupported value.
 * - Eventual consistency. Every read sees the latest write at once. On the
 *   platform a write can take 60 seconds or more to reach other locations.
 * - Caching: `cacheTtl` is checked and then ignored, and a missing key isn't
 *   cached.
 * - A rate limit on `delete`. The documentation doesn't say whether a delete
 *   counts as a write to its key.
 * - Per-account and per-namespace quotas.
 * - The platform's error messages for keys, values, and metadata that are too
 *   large, which aren't documented. Apart from the 429, the messages are the
 *   fake's own.
 *
 * Documentation, checked 2026-11-24:
 *
 * - https://developers.cloudflare.com/kv/api/read-key-value-pairs/
 * - https://developers.cloudflare.com/kv/api/write-key-value-pairs/
 * - https://developers.cloudflare.com/kv/api/delete-key-value-pairs/
 * - https://developers.cloudflare.com/kv/api/list-keys/
 * - https://developers.cloudflare.com/kv/platform/limits/
 * - https://developers.cloudflare.com/kv/concepts/how-kv-works/
 *
 * When a run on Cloudflare shows that this fake differs from the platform,
 * fix the fake and pin the difference with a unit test.
 */

const MAX_KEY_BYTES = 512;
const MAX_VALUE_BYTES = 25 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024;
const MAX_BULK_KEYS = 100;
const MIN_CACHE_TTL_SECONDS = 30;
const MIN_EXPIRATION_SECONDS = 60;
const MIN_WRITE_INTERVAL_MS = 1000;

const GET_TYPES = [ 'text', 'json', 'arrayBuffer', 'stream' ];
const BULK_GET_TYPES = [ 'text', 'json' ];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();


/**
 * @typedef {Object} FakeKVCall
 * @property {'get'|'put'|'delete'} method - The method called
 * @property {string|string[]} key - The key, or the array of keys of a bulk
 *   `get`, as passed
 * @property {*} value - The value as passed to `put`; `undefined` for the
 *   other methods
 * @property {*} options - The options exactly as passed; `undefined` when
 *   none were
 */

/**
 * @typedef {Object} FakeKVNamespace
 * @property {FakeKVCall[]} calls - Every `get`, `put`, and `delete` call in
 *   call order, including the calls that rejected
 * @property {function((string|string[]), (string|Object)=): Promise<*>} get -
 *   Reads one value, or a `Map` of values for an array of keys
 * @property {function(string, (string|ArrayBuffer|ArrayBufferView), Object=): Promise<void>} put -
 *   Creates or replaces a value
 * @property {function(string): Promise<void>} delete - Removes a value
 */

/**
 * Creates a Workers KV namespace binding.
 * @param {Object} [options]
 * @param {Map<string, (string|ArrayBuffer|ArrayBufferView)>|Object<string, (string|ArrayBuffer|ArrayBufferView)>} [options.initial] -
 *   Values the namespace starts with. Seeding logs no calls and doesn't count
 *   toward the write rate.
 * @param {function(): number} [options.now] - A clock returning milliseconds
 *   since the epoch. It drives expiry and the write rate. The default reads
 *   `Date.now()`.
 * @returns {FakeKVNamespace}
 * @throws {Error} When `initial` is not a Map or a plain object, or holds a
 *   key or value `put` would reject
 */
export function createFakeKVNamespace(options) {
    const {
        initial,
        now = () => Date.now(),
    } = options ?? {};

    // key → { value: string|Uint8Array, expiresAt: milliseconds|null }
    const entries = new Map();

    // key → the time of the last successful put, in milliseconds
    const lastWrites = new Map();

    const calls = [];

    for (const [ key, value ] of readInitialEntries(initial)) {
        assertValidKey(key);
        entries.set(key, { value: toStoredValue(value), expiresAt: null });
    }

    function read(key, type) {
        const entry = entries.get(key);

        if (!entry) {
            return null;
        }
        if (entry.expiresAt !== null && now() >= entry.expiresAt) {
            entries.delete(key);
            return null;
        }

        return decodeValue(entry.value, type);
    }

    return {
        calls,

        async get(key, getOptions) {
            calls.push({ method: 'get', key, value: undefined, options: getOptions });

            if (Array.isArray(key)) {
                const type = readGetType(getOptions, BULK_GET_TYPES);

                if (key.length === 0) {
                    throw new TypeError('get() requires at least one key');
                }
                if (key.length > MAX_BULK_KEYS) {
                    throw new Error(`get() accepts at most ${ MAX_BULK_KEYS } keys; received ${ key.length }`);
                }
                key.forEach(assertValidKey);

                return new Map(key.map((k) => [ k, read(k, type) ]));
            }

            const type = readGetType(getOptions, GET_TYPES);
            assertValidKey(key);

            return read(key, type);
        },

        async put(key, value, putOptions) {
            calls.push({ method: 'put', key, value, options: putOptions });

            assertValidKey(key);
            const storedValue = toStoredValue(value);
            const writtenAt = now();
            const expiresAt = readExpiration(putOptions, writtenAt);

            if (lastWrites.has(key) && writtenAt - lastWrites.get(key) < MIN_WRITE_INTERVAL_MS) {
                throw new Error('KV PUT failed: 429 Too Many Requests');
            }

            entries.set(key, { value: storedValue, expiresAt });
            lastWrites.set(key, writtenAt);
        },

        async delete(key) {
            calls.push({ method: 'delete', key, value: undefined, options: undefined });

            assertValidKey(key);
            entries.delete(key);
        },
    };
}


function readInitialEntries(initial) {
    if (initial === undefined) {
        return [];
    }
    if (initial instanceof Map) {
        return initial.entries();
    }
    if (isPlainObject(initial)) {
        return Object.entries(initial);
    }
    throw new TypeError('initial must be a Map or a plain object');
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertValidKey(key) {
    if (typeof key !== 'string') {
        throw new TypeError('the key must be a string');
    }
    if (key === '' || key === '.' || key === '..') {
        throw new Error(`${ JSON.stringify(key) } is not allowed as a key`);
    }
    if (exceedsByteLimit(key, MAX_KEY_BYTES)) {
        throw new Error(`the key is longer than the limit of ${ MAX_KEY_BYTES } bytes`);
    }
}

// Each UTF-16 code unit encodes to between one and three UTF-8 bytes, so most
// strings are settled without encoding them.
function exceedsByteLimit(text, limit) {
    if (text.length > limit) {
        return true;
    }
    if (text.length * 3 <= limit) {
        return false;
    }
    return textEncoder.encode(text).length > limit;
}

// Bytes are copied on the way in, so the caller cannot change what is stored.
function toStoredValue(value) {
    if (typeof value === 'string') {
        if (exceedsByteLimit(value, MAX_VALUE_BYTES)) {
            throw new Error(`the value is larger than the limit of ${ MAX_VALUE_BYTES } bytes`);
        }
        return value;
    }

    let bytes;
    if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
        throw new TypeError('the value must be a string, an ArrayBuffer, or an ArrayBufferView');
    }

    if (bytes.byteLength > MAX_VALUE_BYTES) {
        throw new Error(`the value is larger than the limit of ${ MAX_VALUE_BYTES } bytes`);
    }

    return bytes.slice();
}

function decodeValue(value, type) {
    const isText = typeof value === 'string';

    if (type === 'text') {
        return isText ? value : textDecoder.decode(value);
    }
    if (type === 'json') {
        return JSON.parse(isText ? value : textDecoder.decode(value));
    }

    // A fresh copy for every read, so one reader cannot change what the next
    // one sees.
    const bytes = isText ? textEncoder.encode(value) : value.slice();

    if (type === 'arrayBuffer') {
        return bytes.buffer;
    }

    return new ReadableStream({
        start(controller) {
            if (bytes.byteLength > 0) {
                controller.enqueue(bytes);
            }
            controller.close();
        },
    });
}

function readGetType(options, allowedTypes) {
    let type = 'text';
    let cacheTtl;

    if (typeof options === 'string') {
        type = options;
    } else if (isPlainObject(options)) {
        type = options.type ?? 'text';
        cacheTtl = options.cacheTtl;
    } else if (options !== undefined) {
        throw new TypeError('get() options must be a type string or an object');
    }

    if (!GET_TYPES.includes(type)) {
        throw new TypeError(`${ JSON.stringify(type) } is not a get() type; use one of ${ GET_TYPES.join(', ') }`);
    }
    if (!allowedTypes.includes(type)) {
        throw new TypeError(`get() with an array of keys accepts only the types ${ allowedTypes.join(' and ') }; received ${ type }`);
    }

    if (cacheTtl !== undefined) {
        assertNumber(cacheTtl, 'cacheTtl');

        if (!(cacheTtl >= MIN_CACHE_TTL_SECONDS)) {
            throw new Error(`cacheTtl must be at least ${ MIN_CACHE_TTL_SECONDS } seconds; received ${ cacheTtl }`);
        }
    }

    return type;
}

// Checks the put() options and returns the time the entry expires, in
// milliseconds, or null when it never does.
function readExpiration(options, writtenAt) {
    if (options === undefined) {
        return null;
    }
    if (!isPlainObject(options)) {
        throw new TypeError('put() options must be an object');
    }

    const { expiration, expirationTtl, metadata } = options;

    if (metadata !== undefined) {
        assertMetadataSize(metadata);
    }

    if (expiration !== undefined && expirationTtl !== undefined) {
        throw new TypeError('put() accepts expiration or expirationTtl, not both');
    }

    if (expirationTtl !== undefined) {
        assertNumber(expirationTtl, 'expirationTtl');

        if (!(expirationTtl >= MIN_EXPIRATION_SECONDS)) {
            throw new Error(`expirationTtl must be at least ${ MIN_EXPIRATION_SECONDS } seconds; received ${ expirationTtl }`);
        }
        return writtenAt + (expirationTtl * 1000);
    }

    if (expiration !== undefined) {
        assertNumber(expiration, 'expiration');

        if (!(expiration * 1000 >= writtenAt + (MIN_EXPIRATION_SECONDS * 1000))) {
            throw new Error(`expiration must be at least ${ MIN_EXPIRATION_SECONDS } seconds in the future; received ${ expiration }`);
        }
        return expiration * 1000;
    }

    return null;
}

function assertMetadataSize(metadata) {
    const json = JSON.stringify(metadata);

    if (typeof json !== 'string') {
        throw new TypeError('metadata must be serializable as JSON');
    }
    if (exceedsByteLimit(json, MAX_METADATA_BYTES)) {
        throw new Error(`metadata is larger than the limit of ${ MAX_METADATA_BYTES } bytes as JSON`);
    }
}

function assertNumber(value, name) {
    if (typeof value !== 'number') {
        throw new TypeError(`${ name } must be a number`);
    }
}
