import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { OperationalError } from '../../../kixx/errors/mod.js';
import {
    AssertionError,
    isUndefined,
    isBoolean,
    assert,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex

const VALID_TYPES = [ 'text', 'json', 'arrayBuffer' ];

// Keys are capped at 512 bytes to stay portable with the Cloudflare KV adapter
// even though SQLite itself imposes no such limit.
const MAX_KEY_BYTES = 512;

// How long a write blocks waiting for another process's lock before SQLite
// raises SQLITE_BUSY. Multiple processes share one cache file, so the busy
// timeout lets a contended writer retry rather than fail immediately.
const BUSY_TIMEOUT_MS = 5000;

// Fraction of writes that trigger an expired-row sweep. Reclaiming dead rows
// opportunistically on a sampled fraction of puts amortizes the DELETE scan
// instead of paying it on every write or running a background timer.
const SWEEP_PROBABILITY = 0.1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Node.js SQLite-backed key/value cache store.
 *
 * The Node.js port of the key/value cache contract. Where the Cloudflare adapter
 * resolves a request-scoped KV binding from `context.env.KEY_VALUE_STORE`, this
 * adapter receives its resolved SQLite file path and options from immutable
 * application config during plugin registration. A single on-disk database
 * (kept on local disk, not a network mount) is the shared medium across every
 * process on the machine, so cache state survives process restarts and is
 * visible to sibling workers without keeping anything in process memory.
 *
 * Entries live in a flat `kv` table: the value is stored as an opaque `BLOB` and
 * an optional `expires_at` Unix-seconds column carries the expiry. No type
 * metadata is stored, so the caller's declared `options.type`
 * (`'text'` | `'json'` | `'arrayBuffer'`) drives symmetric encode-on-write and
 * decode-on-read exactly as on Cloudflare KV. The connection is opened in WAL
 * mode with a busy timeout so concurrent writers from other processes retry
 * instead of failing with `SQLITE_BUSY`.
 *
 * This adapter diverges from the Cloudflare adapter in two ways that reflect
 * SQLite's different capabilities, both compatible with the contract:
 * - There is no 60-second minimum TTL; any positive-integer `ttlSeconds` is
 *   accepted, because SQLite imposes no such floor.
 * - Reads are read-after-write consistent on the local machine — a stronger
 *   guarantee than the contract's eventual-consistency floor, and a compatible
 *   superset of it.
 *
 * Expired entries are filtered out lazily on every read; dead rows are reclaimed
 * by an opportunistic sweep sampled on a fraction of writes rather than a timer.
 *
 * @implements {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueStoreInterface}
 * @see KeyValueStore in ../../cloudflare-key-value-store/lib/key-value-store.js for the Cloudflare KV implementation
 */
export default class KeyValueStore {

    #logger = null;

    #database = null;
    #ownsDatabase = false;
    #path = null;
    #sqliteOptions = null;
    #prepared = false;
    #closed = false;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a KeyValueStore child logger
     * @param {string} [options.path] - File system path or `':memory:'`. Required when no `database` is supplied.
     * @param {Object} [options.sqliteOptions] - Options forwarded to the `DatabaseSync` constructor when opening `path`
     * @param {import('node:sqlite').DatabaseSync} [options.database] - Pre-opened SQLite connection to use instead of opening `path`
     * @param {boolean} [options.ownsDatabase] - Whether `close()` should close the connection. Defaults to false when
     *   `database` is supplied and true when the store opens `path`.
     * @throws {AssertionError} When logger is missing, or when neither `database` nor a non-empty `path` is supplied
     */
    constructor(options) {
        const {
            logger,
            path,
            sqliteOptions,
            database,
            ownsDatabase,
        } = options ?? {};

        assert(logger, 'KeyValueStore requires a logger');

        if (database) {
            // An injected connection is owned by the caller unless explicitly claimed.
            this.#database = database;
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : false;
        } else {
            assertNonEmptyString(path, 'KeyValueStore requires a database or path');
            this.#path = path;
            this.#sqliteOptions = sqliteOptions ?? {};
            // A connection opened by the store is owned by the store by default.
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : true;
        }

        this.#logger = logger.createChild('KeyValueStore');
    }

    /**
     * Retrieves a value by key, decoded per `options.type`.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} key - Cache key
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueGetOptions} [options] - Read options
     * @returns {Promise<string|import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueJSONValue|ArrayBuffer|null>} The decoded value, or null when absent or expired
     * @throws {AssertionError} When the key or `options.type` is invalid
     */
    async get(_context, key, options) {
        this.#assertValidKey(key);
        const type = this.#resolveType(options);
        this.#logger.debug('get() loading key', { key, type });

        const db = this.#getDatabase();
        const nowSeconds = Math.floor(Date.now() / 1000);

        // The expiry guard hides entries whose absolute expiry has passed; an
        // entry with a null expires_at never expires.
        const row = db
            .prepare('SELECT value FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)')
            .get(key, nowSeconds);

        if (!row) {
            return null;
        }

        return this.#decodeValue(type, row.value);
    }

    /**
     * Creates or overwrites a value, encoded per `options.type`, with optional
     * expiration.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} key - Cache key
     * @param {string|import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueJSONValue|ArrayBuffer|ArrayBufferView} value - Value to store; must match the declared type and be non-null
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValuePutOptions} [options] - Write options
     * @returns {Promise<void>}
     * @throws {AssertionError} When the key, value, type, or expiry options are invalid
     */
    async put(_context, key, value, options) {
        this.#assertValidKey(key);
        const type = this.#resolveType(options);
        const blob = this.#encodeValue(type, value);
        const expiresAt = this.#resolveExpiresAt(options);
        this.#logger.debug('put() writing key', { key, type });

        const db = this.#getDatabase();

        db
            .prepare(`
                INSERT INTO kv (key, value, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    expires_at = excluded.expires_at
            `)
            .run(key, blob, expiresAt);

        this.#maybeSweepExpired(db);
    }

    /**
     * Deletes a value by key. Resolves with no value, and does not report whether
     * the key previously existed.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} key - Cache key
     * @returns {Promise<void>}
     * @throws {AssertionError} When the key is invalid
     */
    async delete(_context, key) {
        this.#assertValidKey(key);
        this.#logger.debug('delete() removing key', { key });

        const db = this.#getDatabase();
        db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    }

    /**
     * Releases the SQLite connection when the store owns it.
     *
     * Safe to call more than once: subsequent calls are no-ops. An injected
     * connection that the store does not own is left open for the caller.
     *
     * @returns {void}
     */
    close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;

        // Only close a connection the store opened; an injected database is the caller's to manage.
        if (this.#ownsDatabase && this.#database) {
            this.#database.close();
        }
        this.#database = null;
        this.#prepared = false;
    }

    /**
     * Validates a cache key: a non-empty string with no control characters, not
     * `"."` or `".."`, and within the 512-byte portability limit.
     * @param {string} key - Cache key to validate
     * @throws {AssertionError} When the key is invalid
     */
    #assertValidKey(key) {
        assertNonEmptyString(key, 'KeyValueStore key must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(key)) {
            throw new AssertionError('KeyValueStore key contains illegal control characters');
        }
        if (key === '.' || key === '..') {
            throw new AssertionError('KeyValueStore key must not be "." or ".."');
        }
        // The limit is measured against the key's byte length, not its character length.
        if (textEncoder.encode(key).byteLength > MAX_KEY_BYTES) {
            throw new AssertionError(`KeyValueStore key must not exceed ${ MAX_KEY_BYTES } bytes`);
        }
    }

    /**
     * Resolves and validates the declared value encoding, defaulting to `'text'`.
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueGetOptions} [options] - Read or write options
     * @returns {string} One of `'text'`, `'json'`, or `'arrayBuffer'`
     * @throws {AssertionError} When `options.type` is not a supported value
     */
    #resolveType(options) {
        const type = options?.type;
        if (isUndefined(type)) {
            return 'text';
        }
        if (!VALID_TYPES.includes(type)) {
            throw new AssertionError(`KeyValueStore type must be one of ${ VALID_TYPES.join(', ') }`);
        }
        return type;
    }

    /**
     * Validates `value` against the declared `type` and encodes it to the byte
     * buffer stored in the BLOB column — UTF-8 bytes for `'text'`, the UTF-8 bytes
     * of the serialized JSON for `'json'`, or a byte copy of the binary input for
     * `'arrayBuffer'`.
     * @param {string} type - Declared encoding
     * @param {string|import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueJSONValue|ArrayBuffer|ArrayBufferView} value - Value to encode
     * @returns {Uint8Array} Bytes to bind to the BLOB column
     * @throws {AssertionError} When the value does not match the declared type
     */
    #encodeValue(type, value) {
        if (type === 'text') {
            assertNonEmptyString(value, 'KeyValueStore "text" value must be a non-empty string');
            return textEncoder.encode(value);
        }

        if (type === 'json') {
            if (isUndefined(value) || value === null) {
                throw new AssertionError('KeyValueStore "json" value must not be null or undefined');
            }
            let json;
            try {
                json = JSON.stringify(value);
            } catch (cause) {
                throw new AssertionError('KeyValueStore "json" value must be JSON-serializable', { cause });
            }
            if (isUndefined(json)) {
                throw new AssertionError('KeyValueStore "json" value must be JSON-serializable');
            }
            return textEncoder.encode(json);
        }

        // type === 'arrayBuffer'
        if (value instanceof ArrayBuffer) {
            return new Uint8Array(value.slice(0));
        }
        if (ArrayBuffer.isView(value)) {
            // Copy only the view's own region of its backing buffer so unrelated
            // bytes from a shared buffer are not persisted.
            return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        }
        throw new AssertionError('KeyValueStore "arrayBuffer" value must be an ArrayBuffer or typed-array view');
    }

    /**
     * Decodes a stored BLOB (`Uint8Array`) back into the value the caller declared
     * with `type` — a string for `'text'`, the parsed value for `'json'`, or an
     * `ArrayBuffer` for `'arrayBuffer'`.
     * @param {string} type - Declared encoding
     * @param {Uint8Array} bytes - Stored bytes from the BLOB column
     * @returns {string|import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueJSONValue|ArrayBuffer} The decoded value
     */
    #decodeValue(type, bytes) {
        if (type === 'text') {
            return textDecoder.decode(bytes);
        }
        if (type === 'json') {
            return JSON.parse(textDecoder.decode(bytes));
        }
        // type === 'arrayBuffer' — return an exact-length ArrayBuffer copy.
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    /**
     * Validates the mutually-exclusive expiry options and maps them to an absolute
     * `expires_at` Unix-seconds value, or null when no expiry was supplied. Unlike
     * the Cloudflare adapter, no minimum TTL is imposed.
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValuePutOptions} [options] - Write options
     * @returns {number|null} Absolute expiry in Unix seconds, or null for no expiry
     * @throws {AssertionError} When both expiry options are present or an expiry is invalid
     */
    #resolveExpiresAt(options) {
        const ttlSeconds = options?.ttlSeconds;
        const expiresAt = options?.expiresAt;

        if (!isUndefined(ttlSeconds) && !isUndefined(expiresAt)) {
            throw new AssertionError('KeyValueStore put accepts only one of "ttlSeconds" or "expiresAt"');
        }

        if (!isUndefined(ttlSeconds)) {
            if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
                throw new AssertionError('KeyValueStore "ttlSeconds" must be a positive integer');
            }
            return Math.floor(Date.now() / 1000) + ttlSeconds;
        }

        if (!isUndefined(expiresAt)) {
            if (!Number.isInteger(expiresAt)) {
                throw new AssertionError('KeyValueStore "expiresAt" must be an integer Unix timestamp in seconds');
            }
            const nowSeconds = Math.floor(Date.now() / 1000);
            if (expiresAt <= nowSeconds) {
                throw new AssertionError('KeyValueStore "expiresAt" must be a Unix timestamp in the future');
            }
            return expiresAt;
        }

        return null;
    }

    /**
     * Reclaims expired rows on a sampled fraction of writes so the cost is
     * amortized rather than paid on every put or by a background timer.
     * @param {import('node:sqlite').DatabaseSync} db - Open SQLite connection
     */
    #maybeSweepExpired(db) {
        if (Math.random() >= SWEEP_PROBABILITY) {
            return;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const result = db
            .prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?')
            .run(nowSeconds);
        if (result.changes > 0) {
            this.#logger.debug('swept expired keys', { count: result.changes });
        }
    }

    /**
     * Returns the SQLite connection, opening and preparing it lazily on first use.
     *
     * Opening is deferred so construction stays cheap. Preparation runs the WAL and
     * busy-timeout pragmas and creates the `kv` table; it is synchronous, so there
     * is no interleaving window for concurrent callers between open and prepare.
     * @returns {import('node:sqlite').DatabaseSync} The prepared connection
     * @throws {AssertionError} When the store has been closed
     */
    #getDatabase() {
        if (this.#closed) {
            throw new AssertionError('KeyValueStore has been closed');
        }

        if (!this.#database) {
            ensureDatabaseDirectory(this.#path);
            this.#database = new DatabaseSync(this.#path, this.#sqliteOptions);
        }

        if (!this.#prepared) {
            this.#prepareDatabase(this.#database);
            this.#prepared = true;
        }
        return this.#database;
    }

    /**
     * Configures WAL journaling and the busy timeout for multi-process access and
     * creates the `kv` table if it does not already exist. Safe to run against an
     * injected connection: the pragmas are idempotent and the DDL uses IF NOT EXISTS.
     * @param {import('node:sqlite').DatabaseSync} db - Open SQLite connection
     */
    #prepareDatabase(db) {
        // WAL lets readers proceed during a write and is the journaling mode that
        // makes concurrent multi-process access on local disk practical.
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(`PRAGMA busy_timeout = ${ BUSY_TIMEOUT_MS }`);
        db.exec(`
            CREATE TABLE IF NOT EXISTS kv (
                key        TEXT PRIMARY KEY,
                value      BLOB NOT NULL,
                expires_at INTEGER
            )
        `);
        this.#logger.debug('prepared key/value cache database');
    }
}

function ensureDatabaseDirectory(filePath) {
    // An in-memory database has no filesystem directory to create.
    if (filePath === ':memory:') {
        return;
    }

    // SQLite creates the database file but never its parent directory, so a
    // first run against a fresh data path fails to open unless we create it.
    const directory = path.dirname(filePath);
    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch (cause) {
        throw new OperationalError(`Unable to create SQLite database directory ${ directory }`, { cause });
    }
}
