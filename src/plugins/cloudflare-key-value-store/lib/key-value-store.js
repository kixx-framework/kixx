import {
    AssertionError,
    isUndefined,
    assert,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex

const VALID_TYPES = [ 'text', 'json', 'arrayBuffer' ];

// Cloudflare KV hard limits: keys are at most 512 bytes and expirations must be
// at least 60 seconds in the future.
const MAX_KEY_BYTES = 512;
const MIN_TTL_SECONDS = 60;

/**
 * Cloudflare KV-backed key/value cache store.
 *
 * Implements the runtime-neutral key/value cache contract over a single
 * Cloudflare KV namespace resolved from `context.env.KEY_VALUE_STORE`. The store
 * is a flat keyspace with no namespace concept, no versioning, and optional
 * expiration. Callers declare each value's encoding explicitly through
 * `options.type` on every read and write; the store records no type metadata.
 *
 * This adapter surfaces Cloudflare KV's binding constraints rather than hiding
 * them: reads are eventually consistent (a write may take up to ~60 seconds to
 * be globally visible), expirations shorter than 60 seconds are rejected rather
 * than silently clamped, keys longer than 512 bytes are rejected, and `delete()`
 * resolves with no value because KV does not report whether the key existed.
 *
 * @implements {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueStoreInterface}
 */
export default class KeyValueStore {

    #logger = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a KeyValueStore child logger
     * @throws {Error} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'KeyValueStore requires a logger');
        this.#logger = logger.createChild('KeyValueStore');
    }

    /**
     * Retrieves a value by key, decoded per `options.type`.
     *
     * @param {RequestContext} context - Request context with the KEY_VALUE_STORE binding
     * @param {string} key - Cache key
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValueGetOptions} [options] - Read options
     * @returns {Promise<string|Object|ArrayBuffer|null>} The decoded value, or null when absent or expired
     * @throws {AssertionError} When the key or `options.type` is invalid
     */
    async get(context, key, options) {
        this.#assertValidKey(key);
        const type = this.#resolveType(options);
        this.#logger.debug('get() loading key', { key, type });

        const kvStore = context.env.KEY_VALUE_STORE;
        const value = await kvStore.get(key, { type });

        return isUndefined(value) ? null : value;
    }

    /**
     * Creates or overwrites a value, encoded per `options.type`, with optional
     * expiration.
     *
     * @param {RequestContext} context - Request context with the KEY_VALUE_STORE binding
     * @param {string} key - Cache key
     * @param {string|Object|ArrayBuffer|ArrayBufferView} value - Value to store; must match the declared type and be non-null
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValuePutOptions} [options] - Write options
     * @returns {Promise<void>}
     * @throws {AssertionError} When the key, value, type, or expiry options are invalid
     */
    async put(context, key, value, options) {
        this.#assertValidKey(key);
        const type = this.#resolveType(options);
        const storedValue = this.#encodeValue(type, value);
        const putOptions = this.#resolveExpiration(options);
        this.#logger.debug('put() writing key', { key, type });

        const kvStore = context.env.KEY_VALUE_STORE;
        await kvStore.put(key, storedValue, putOptions);
    }

    /**
     * Deletes a value by key. Resolves with no value, and does not report whether
     * the key previously existed.
     *
     * @param {RequestContext} context - Request context with the KEY_VALUE_STORE binding
     * @param {string} key - Cache key
     * @returns {Promise<void>}
     * @throws {AssertionError} When the key is invalid
     */
    async delete(context, key) {
        this.#assertValidKey(key);
        this.#logger.debug('delete() removing key', { key });

        const kvStore = context.env.KEY_VALUE_STORE;
        await kvStore.delete(key);
    }

    /**
     * Validates a cache key: a non-empty string with no control characters, not
     * `"."` or `".."`, and within Cloudflare KV's 512-byte limit.
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
        // KV measures the key against its byte length, not its character length.
        if (new TextEncoder().encode(key).byteLength > MAX_KEY_BYTES) {
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
     * Validates `value` against the declared `type` and returns the value to hand
     * to KV — a string for `'text'`, the serialized JSON for `'json'`, or the
     * binary buffer for `'arrayBuffer'`.
     * @param {string} type - Declared encoding
     * @param {string|Object|ArrayBuffer|ArrayBufferView} value - Value to encode
     * @returns {string|ArrayBuffer|ArrayBufferView} Value accepted by KV's put
     * @throws {AssertionError} When the value does not match the declared type
     */
    #encodeValue(type, value) {
        if (type === 'text') {
            assertNonEmptyString(value, 'KeyValueStore "text" value must be a non-empty string');
            return value;
        }

        if (type === 'json') {
            if (isUndefined(value) || value === null) {
                throw new AssertionError('KeyValueStore "json" value must not be null or undefined');
            }
            return JSON.stringify(value);
        }

        // type === 'arrayBuffer'
        if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
            throw new AssertionError('KeyValueStore "arrayBuffer" value must be an ArrayBuffer or typed-array view');
        }
        return value;
    }

    /**
     * Validates the mutually-exclusive expiry options and maps them to KV's put
     * options (`expirationTtl` for a relative TTL, `expiration` for an absolute
     * one). Enforces Cloudflare KV's 60-second minimum rather than clamping.
     * @param {import('../../../kixx/key-value-store/key-value-store-interface.js').KeyValuePutOptions} [options] - Write options
     * @returns {Object} KV put options, possibly empty when no expiry was supplied
     * @throws {AssertionError} When both expiry options are present or an expiry is invalid
     */
    #resolveExpiration(options) {
        const ttlSeconds = options?.ttlSeconds;
        const expiresAt = options?.expiresAt;

        if (!isUndefined(ttlSeconds) && !isUndefined(expiresAt)) {
            throw new AssertionError('KeyValueStore put accepts only one of "ttlSeconds" or "expiresAt"');
        }

        if (!isUndefined(ttlSeconds)) {
            if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
                throw new AssertionError('KeyValueStore "ttlSeconds" must be a positive integer');
            }
            if (ttlSeconds < MIN_TTL_SECONDS) {
                throw new AssertionError(`KeyValueStore "ttlSeconds" must be at least ${ MIN_TTL_SECONDS } seconds on Cloudflare KV`);
            }
            return { expirationTtl: ttlSeconds };
        }

        if (!isUndefined(expiresAt)) {
            if (!Number.isInteger(expiresAt)) {
                throw new AssertionError('KeyValueStore "expiresAt" must be an integer Unix timestamp in seconds');
            }
            const nowSeconds = Math.floor(Date.now() / 1000);
            if (expiresAt < nowSeconds + MIN_TTL_SECONDS) {
                throw new AssertionError(`KeyValueStore "expiresAt" must be at least ${ MIN_TTL_SECONDS } seconds in the future on Cloudflare KV`);
            }
            return { expiration: expiresAt };
        }

        return {};
    }
}
