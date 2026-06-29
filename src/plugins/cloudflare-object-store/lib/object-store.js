import {
    AssertionError,
    isUndefined,
    isString,
    isNonEmptyString,
    isObjectNotNull,
    isPlainObject,
    assert,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectMeta} ObjectMeta
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectBody} ObjectBody
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectList} ObjectList
 */

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex

// R2 and S3 cap object keys at 1024 bytes; the contract adopts the same limit.
const MAX_KEY_BYTES = 1024;

const INCLUDABLE_FIELDS = [ 'contentType', 'customMetadata' ];
const MAX_LIST_LIMIT = 1000;

const textEncoder = new TextEncoder();

/**
 * Cloudflare R2-backed object store.
 *
 * The Cloudflare port of the object store contract, implemented over an R2 bucket
 * binding resolved per call from `context.env`. Bucket names are mapped to R2
 * binding names through the allow-list in `context.config.env.OBJECT_STORE.buckets`;
 * an unknown bucket or an unbound binding is a configuration error and throws an
 * `AssertionError`.
 *
 * R2 supplies streaming bodies, object metadata, prefix listing, and strong
 * read-after-write consistency natively, so this adapter is a thin mapping
 * between the runtime-neutral DTO shapes and the R2 binding API. R2 results are
 * mapped onto plain `ObjectMeta`/`ObjectBody`/`ObjectList` objects rather than
 * leaking `R2Object` instances to callers.
 *
 * @implements {import('../../../kixx/object-store/object-store-interface.js').ObjectStoreInterface}
 * @see ObjectStore in ../../node-object-store/lib/object-store.js for the Node.js filesystem implementation
 */
export default class ObjectStore {

    #logger = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create an ObjectStore child logger
     * @throws {AssertionError} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'ObjectStore requires a logger');
        this.#logger = logger.createChild('ObjectStore');
    }

    /**
     * Stores a body under `bucket`/`key`, creating or overwriting any existing
     * object.
     *
     * @param {RequestContext} context - Request context exposing the configured R2 binding
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @param {ReadableStream|ArrayBuffer|ArrayBufferView|string|Blob} body - Object body; must be non-null
     * @param {import('../../../kixx/object-store/object-store-interface.js').ObjectPutOptions} [options] - Write options
     * @returns {Promise<ObjectMeta>} Metadata for the stored object
     * @throws {AssertionError} When the bucket, key, body, or options are invalid
     */
    async put(context, bucket, key, body, options) {
        const bucketBinding = this.#resolveBinding(context, bucket);
        this.#assertValidKey(key);

        const isAllowedBody = body instanceof ReadableStream
            || body instanceof Blob
            || body instanceof ArrayBuffer
            || ArrayBuffer.isView(body)
            || isString(body);
        assert(
            isAllowedBody,
            'ObjectStore body must be a ReadableStream, Blob, ArrayBuffer, ArrayBufferView, or string',
        );

        const contentType = options?.contentType;
        const customMetadata = options?.customMetadata;
        const putOptions = {};

        if (!isUndefined(contentType)) {
            assertNonEmptyString(contentType, 'ObjectStore "contentType" must be a non-empty string when provided');
            putOptions.httpMetadata = { contentType };
        }

        if (!isUndefined(customMetadata)) {
            assert(isPlainObject(customMetadata), 'ObjectStore "customMetadata" must be a plain object when provided');
            for (const value of Object.values(customMetadata)) {
                assert(isString(value), 'ObjectStore "customMetadata" values must be strings');
            }
            putOptions.customMetadata = customMetadata;
        }

        this.#logger.debug('put() writing object', { bucket, key });

        let object;
        try {
            object = await bucketBinding.put(key, body, putOptions);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to store object "${ bucket }/${ key }"`,
                { cause },
            );
        }

        if (!object) {
            // Without conditional `onlyIf` options a put always stores; a null
            // result means R2 behaved unexpectedly.
            throw new OperationalError(`ObjectStore received no result storing "${ bucket }/${ key }"`);
        }

        return metaFromR2(object);
    }

    /**
     * Retrieves the object body and metadata for `bucket`/`key`.
     *
     * @param {RequestContext} context - Request context exposing the configured R2 binding
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<ObjectBody|null>} The object body and metadata, or null when absent
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async get(context, bucket, key) {
        const bucketBinding = this.#resolveBinding(context, bucket);
        this.#assertValidKey(key);
        this.#logger.debug('get() loading object', { bucket, key });

        let object;
        try {
            object = await bucketBinding.get(key);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to read object "${ bucket }/${ key }"`,
                { cause },
            );
        }

        if (!object) {
            return null;
        }

        const meta = metaFromR2(object);
        meta.body = object.body;
        return meta;
    }

    /**
     * Retrieves only the metadata for `bucket`/`key`, without the body.
     *
     * @param {RequestContext} context - Request context exposing the configured R2 binding
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<ObjectMeta|null>} The object metadata, or null when absent
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async head(context, bucket, key) {
        const bucketBinding = this.#resolveBinding(context, bucket);
        this.#assertValidKey(key);
        this.#logger.debug('head() loading metadata', { bucket, key });

        let object;
        try {
            object = await bucketBinding.head(key);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to read metadata for "${ bucket }/${ key }"`,
                { cause },
            );
        }

        return object ? metaFromR2(object) : null;
    }

    /**
     * Deletes `bucket`/`key`. Resolves with no value, and deleting an absent key
     * is a successful no-op.
     *
     * @param {RequestContext} context - Request context exposing the configured R2 binding
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<void>}
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async delete(context, bucket, key) {
        const bucketBinding = this.#resolveBinding(context, bucket);
        this.#assertValidKey(key);
        this.#logger.debug('delete() removing object', { bucket, key });

        try {
            await bucketBinding.delete(key);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to delete object "${ bucket }/${ key }"`,
                { cause },
            );
        }
    }

    /**
     * Lists objects in `bucket`, ordered lexicographically by key.
     *
     * @param {RequestContext} context - Request context exposing the configured R2 binding
     * @param {string} bucket - Configured bucket name
     * @param {import('../../../kixx/object-store/object-store-interface.js').ObjectListOptions} [options] - List options
     * @returns {Promise<ObjectList>} A keyset-paginated page of objects
     * @throws {AssertionError} When the bucket or options are invalid
     */
    async list(context, bucket, options) {
        const bucketBinding = this.#resolveBinding(context, bucket);
        const {
            prefix,
            cursor,
            limit,
            delimiter,
            include: requestedInclude,
        } = options ?? {};

        const listOptions = {};

        if (!isUndefined(prefix)) {
            assert(isString(prefix), 'ObjectStore list "prefix" must be a string when provided');
            listOptions.prefix = prefix;
        }
        if (!isUndefined(cursor)) {
            // R2 cursors are opaque and pass straight back through to R2.
            assertNonEmptyString(cursor, 'ObjectStore list "cursor" must be a non-empty string when provided');
            listOptions.cursor = cursor;
        }
        if (!isUndefined(delimiter)) {
            assertNonEmptyString(delimiter, 'ObjectStore list "delimiter" must be a non-empty string when provided');
            listOptions.delimiter = delimiter;
        }
        if (!isUndefined(limit)) {
            assert(
                Number.isInteger(limit) && limit > 0,
                'ObjectStore list "limit" must be a positive integer',
            );
            listOptions.limit = Math.min(limit, MAX_LIST_LIMIT);
        }

        const include = { contentType: false, customMetadata: false };
        if (!isUndefined(requestedInclude)) {
            assert(Array.isArray(requestedInclude), 'ObjectStore list "include" must be an array when provided');
            const r2Include = new Set();
            for (const field of requestedInclude) {
                assert(
                    INCLUDABLE_FIELDS.includes(field),
                    `ObjectStore list "include" must contain only ${ INCLUDABLE_FIELDS.join(', ') }`,
                );
                include[field] = true;
                // Content type is part of R2's httpMetadata bundle.
                r2Include.add(field === 'contentType' ? 'httpMetadata' : 'customMetadata');
            }
            listOptions.include = Array.from(r2Include);
        }

        this.#logger.debug('list() listing objects', { bucket, prefix: listOptions.prefix });

        let result;
        try {
            result = await bucketBinding.list(listOptions);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to list objects in bucket "${ bucket }"`,
                { cause },
            );
        }

        return {
            objects: result.objects.map((object) => listEntryFromR2(object, include)),
            truncated: result.truncated === true,
            cursor: result.truncated ? result.cursor : undefined,
            delimitedPrefixes: result.delimitedPrefixes ?? [],
        };
    }

    #resolveBinding(context, bucket) {
        assertNonEmptyString(bucket, 'ObjectStore bucket must be a non-empty string');

        const bucketsConfig = context?.config?.env?.OBJECT_STORE?.buckets;
        assert(
            isPlainObject(bucketsConfig),
            'ObjectStore requires context.config.env.OBJECT_STORE.buckets',
        );

        const entry = bucketsConfig[bucket];
        assert(entry, `ObjectStore bucket "${ bucket }" is not configured`);

        // A bucket entry may be the binding name directly or an object carrying it.
        const bindingName = isNonEmptyString(entry) ? entry : entry?.bindingName;
        assertNonEmptyString(
            bindingName,
            `ObjectStore bucket "${ bucket }" must configure a non-empty bindingName`,
        );

        const binding = context?.env?.[bindingName];
        assert(binding, `ObjectStore R2 binding "${ bindingName }" is not bound on context.env`);
        return binding;
    }

    /**
     * Validates an object key: a non-empty string of at most 1024 bytes with no
     * control characters, no leading `/`, and no `"."` or `".."` path segment.
     * @param {string} key - Object key to validate
     * @throws {AssertionError} When the key is invalid
     */
    #assertValidKey(key) {
        assertNonEmptyString(key, 'ObjectStore key must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(key)) {
            throw new AssertionError('ObjectStore key contains illegal control characters');
        }
        if (key.startsWith('/')) {
            throw new AssertionError('ObjectStore key must not begin with "/"');
        }
        if (textEncoder.encode(key).byteLength > MAX_KEY_BYTES) {
            throw new AssertionError(`ObjectStore key must not exceed ${ MAX_KEY_BYTES } bytes`);
        }
        for (const segment of key.split('/')) {
            if (segment === '.' || segment === '..') {
                throw new AssertionError('ObjectStore key must not contain a "." or ".." path segment');
            }
        }
    }

}

function metaFromR2(object) {
    return {
        key: object.key,
        contentType: isNonEmptyString(object.httpMetadata?.contentType)
            ? object.httpMetadata.contentType
            : undefined,
        contentLength: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
        customMetadata: normalizeCustomMetadata(object.customMetadata),
    };
}

function listEntryFromR2(object, include) {
    const entry = {
        key: object.key,
        contentLength: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
    };
    if (include.contentType && isNonEmptyString(object.httpMetadata?.contentType)) {
        entry.contentType = object.httpMetadata.contentType;
    }
    if (include.customMetadata) {
        const customMetadata = normalizeCustomMetadata(object.customMetadata);
        if (!isUndefined(customMetadata)) {
            entry.customMetadata = customMetadata;
        }
    }
    return entry;
}

// R2 returns an empty object when no custom metadata was stored; normalize that
// to undefined so the contract's "present only when set" shape is consistent.
function normalizeCustomMetadata(value) {
    if (isObjectNotNull(value) && Object.keys(value).length > 0) {
        return value;
    }
    return undefined;
}
