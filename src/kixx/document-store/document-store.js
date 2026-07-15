import {
    AssertionError,
    isString,
    isBoolean,
    isObjectNotNull,
    isUndefined,
    isNonEmptyString,
    assert,
    assertArray,
    assertNonEmptyString,
} from '../assertions/mod.js';
import InvalidCursorError from './invalid-cursor-error.js';


const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F]/; // eslint-disable-line no-control-regex
const CURSOR_ENVELOPE_VERSION = 1;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;


/**
 * Highest-sorting sentinel character (U+FFFF) for upper-bounding sort key and
 * secondary index range queries.
 *
 * U+FFFF is a Unicode noncharacter — permanently guaranteed never to be
 * assigned — so it cannot collide with real document content. Both engines
 * compare sort keys and index values as UTF-8 bytes (SQLite BINARY collation),
 * where U+FFFF (EF BF BF) sorts above every Basic Multilingual Plane character
 * but below supplementary-plane characters (F0 ...). The bound is therefore
 * exhaustive only when key content is known to be BMP-only (ASCII identifiers,
 * DNS labels, ISO timestamps, etc.).
 *
 * No lower-bound counterpart exists because the minimal key under a prefix is
 * the bare prefix itself, directly expressible as `greaterThanOrEqualTo`.
 * @type {string}
 */
export const MAX_SORT_KEY_CHAR = '\uFFFF';


/**
 * Validating facade for a configured document store engine.
 *
 * The store enforces the public document contract shared by collection callers:
 * document `type` values must be identifier-like strings, document `id` values
 * must be non-empty strings without control characters, and optional `sortKey`
 * values must be strings. `initialize()` must be called before the store is
 * used. Pagination cursors exposed by `scan()` and `query()` are public,
 * signed tokens issued and verified by this facade. `initialize()` requires a
 * runtime cursor-signing secret; its HMAC-SHA-256 envelope uses Web Crypto so
 * the same public token works across Node.js and Cloudflare Workers. Engines
 * receive only their private continuation cursors. Invalid public tokens reject
 * with `InvalidCursorError`, allowing the calling transport layer to classify
 * them as expected input failures.
 *
 * @see DocumentStoreEngineInterface in ./document-store-engine-interface.js for the engine contract
 * @see DocumentStoreEngine in ../../plugins/cloudflare-document-store-engine/lib/document-store-engine.js for the Cloudflare D1 implementation
 * @see DocumentStoreEngine in ../../plugins/node-document-store-engine/lib/document-store-engine.js for the Node.js SQLite implementation
 * @see docs/document-store.md for the facade, engine, and runtime-adapter overview
 */
export default class DocumentStore {

    #engine;
    #cursorSigningKey;

    /**
     * Configures the engine and secondary indexes used by this store.
     *
     * The index definitions are validated before being passed through to the
     * engine. Each index name must be safe for use as a generated key name, and
     * each JSON path must reference a document field beneath `$`.
     *
     * @param {Object} config - Store configuration
     * @param {Object} config.engine - DocumentStoreEngineInterface-compatible engine
     * @param {Object[]} config.indexes - Secondary index definitions
     * @param {string} config.cursorSigningSecret - Non-empty runtime secret used to sign public pagination cursors
     * @param {string} config.indexes[].name - Query index name, limited to lowercase letters, numbers, and underscores
     * @param {string} config.indexes[].jsonPath - JSON path beginning with `$.`
     * @param {boolean} [config.indexes[].unique=false] - When true, the engine enforces uniqueness on
     *   `(type, indexed-value)` and rejects conflicting writes with `DocumentUniqueIndexViolationError`.
     * @returns {void}
     * @throws {AssertionError} When the engine, cursor-signing secret, or index definitions are invalid
     */
    initialize(config) {
        const { engine, indexes, cursorSigningSecret } = config ?? {};
        assert(engine, 'DocumentStore#initialize() requires a DocumentStoreEngine as "engine"');
        assertArray(indexes, 'DocumentStore#initialize() requires an Array as "indexes"');
        assertNonEmptyString(
            cursorSigningSecret,
            'DocumentStore#initialize() requires a non-empty cursorSigningSecret',
        );

        for (let i = 0; i < indexes.length; i += 1) {
            const def = indexes[i];
            assertNonEmptyString(def.name, `indexes[${ i }].name must be a non-empty string`);
            if (def.name.length > 80) {
                throw new AssertionError(`indexes[${ i }].name must not be more than 80 characters long`);
            }
            if (!/^[a-z]/.test(def.name)) {
                throw new AssertionError(`indexes[${ i }].name must start with a letter from a-z`);
            }
            if (!/^[a-z0-9_]+$/.test(def.name)) {
                throw new AssertionError(`indexes[${ i }].name may only contain characters from a-z, 0-9, and _`);
            }
            assertNonEmptyString(def.jsonPath, `indexes[${ i }].jsonPath must be a non-empty string`);
            // jsonPath must be at least "$.x" (3 chars) to reference a field.
            if (!def.jsonPath.startsWith('$.') || def.jsonPath.length <= 2) {
                throw new AssertionError(`indexes[${ i }].jsonPath must start with "$." followed by at least one character`);
            }
            if ('unique' in def && !isBoolean(def.unique)) {
                throw new AssertionError(`indexes[${ i }].unique must be a boolean when present`);
            }
        }

        this.#engine = engine;
        this.#cursorSigningKey = crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(cursorSigningSecret),
            {
                name: 'HMAC',
                hash: 'SHA-256',
            },
            false,
            [ 'sign', 'verify' ],
        );
        this.#engine.setIndexDefinitions(indexes);
    }

    /**
     * Ensures callers receive the public method as the AssertionError stack source.
     */
    #assertInitialized(method) {
        if (!this.#engine || !this.#cursorSigningKey) {
            throw new AssertionError('DocumentStore has not been initialized', null, method);
        }
    }

    async #sealCursor(cursor) {
        const payload = new TextEncoder().encode(JSON.stringify({
            version: CURSOR_ENVELOPE_VERSION,
            cursor,
        }));
        const key = await this.#cursorSigningKey;
        const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));

        return `${ bytesToBase64Url(payload) }.${ bytesToBase64Url(signature) }`;
    }

    async #unsealCursor(cursor) {
        const [ encodedPayload, encodedSignature, ...extraSegments ] = cursor.split('.');
        if (extraSegments.length > 0 || !encodedPayload || !encodedSignature) {
            throw new InvalidCursorError();
        }

        let payload;
        let signature;
        try {
            payload = base64UrlToBytes(encodedPayload);
            signature = base64UrlToBytes(encodedSignature);
        } catch {
            throw new InvalidCursorError();
        }

        const key = await this.#cursorSigningKey;
        const isValidSignature = await crypto.subtle.verify('HMAC', key, signature, payload);
        if (!isValidSignature) {
            throw new InvalidCursorError();
        }

        let envelope;
        try {
            envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
        } catch {
            throw new InvalidCursorError();
        }

        if (!isObjectNotNull(envelope)
            || Array.isArray(envelope)
            || envelope.version !== CURSOR_ENVELOPE_VERSION
            || !isNonEmptyString(envelope.cursor)) {
            throw new InvalidCursorError();
        }

        return envelope.cursor;
    }

    async #sealPaginationResult(result) {
        if (result.cursor === null) {
            return result;
        }

        assertNonEmptyString(result.cursor, 'DocumentStore engine result cursor must be a non-empty string or null');

        return {
            records: result.records,
            cursor: await this.#sealCursor(result.cursor),
        };
    }

    /**
     * Creates or overwrites a document without optimistic concurrency control.
     *
     * A missing document is created and an existing document is replaced. The
     * stored record is returned with engine-assigned version and timestamp fields.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {Object} doc - Document payload
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier within the type
     * @param {string} [doc.sortKey] - Optional sort key used by `scan()`
     * @returns {Promise<Object>} Stored record with `type`, `id`, `version`, `createdAt`, `updatedAt`, and `doc`
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     */
    async put(context, doc) {
        this.#assertInitialized(this.put);
        assert(context, 'DocumentStore#put() requires a context object');
        assert(doc, 'DocumentStore#put() requires a doc object');

        assertNonEmptyString(doc.type, 'DocumentStore#put() doc.type must be a non-empty string');
        if (!TYPE_PATTERN.test(doc.type)) {
            throw new AssertionError(`DocumentStore#put() doc.type "${ doc.type }" must match ${ TYPE_PATTERN }`);
        }

        assertNonEmptyString(doc.id, 'DocumentStore#put() doc.id must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(doc.id)) {
            throw new AssertionError('DocumentStore#put() doc.id contains illegal control characters');
        }

        if ('sortKey' in doc && !isString(doc.sortKey)) {
            throw new AssertionError('DocumentStore#put() doc.sortKey must be a string when present');
        }

        return await this.#engine.put(context, doc);
    }

    /**
     * Creates a document only when no document exists for the same type and id.
     *
     * The document must include a valid `type` and `id`; `sortKey` is optional
     * and must be a string when present.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {Object} doc - Document payload
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier within the type
     * @param {string} [doc.sortKey] - Optional sort key used by `scan()`
     * @returns {Promise<Object>} Stored record with `type`, `id`, `version`, `createdAt`, `updatedAt`, and `doc`
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     * @throws {DocumentAlreadyExistsError} When a document already exists for the same type and id
     */
    async create(context, doc) {
        this.#assertInitialized(this.create);
        assert(context, 'DocumentStore#create() requires a context object');
        assert(doc, 'DocumentStore#create() requires a doc object');

        assertNonEmptyString(doc.type, 'DocumentStore#create() doc.type must be a non-empty string');
        if (!TYPE_PATTERN.test(doc.type)) {
            throw new AssertionError(`DocumentStore#create() doc.type "${ doc.type }" must match ${ TYPE_PATTERN }`);
        }

        assertNonEmptyString(doc.id, 'DocumentStore#create() doc.id must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(doc.id)) {
            throw new AssertionError('DocumentStore#create() doc.id contains illegal control characters');
        }

        if ('sortKey' in doc && !isString(doc.sortKey)) {
            throw new AssertionError('DocumentStore#create() doc.sortKey must be a string when present');
        }

        return await this.#engine.create(context, doc);
    }

    /**
     * Updates an existing document when its current version matches `version`.
     *
     * The document must include a valid `type` and `id`; `sortKey` is optional
     * and must be a string when present. The version argument is the optimistic
     * concurrency token returned by a previous read or write.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {Object} doc - Replacement document payload
     * @param {string} doc.type - Document type
     * @param {string} doc.id - Document identifier within the type
     * @param {string} [doc.sortKey] - Optional sort key used by `scan()`
     * @param {number} version - Expected current positive integer document version
     * @returns {Promise<Object>} Stored record with incremented `version`, `createdAt`, `updatedAt`, `type`, `id`, and `doc`
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     * @throws {DocumentNotFoundError} When the target document does not exist
     * @throws {VersionConflictError} When the stored version does not match `version`
     */
    async update(context, doc, version) {
        this.#assertInitialized(this.update);
        assert(context, 'DocumentStore#update() requires a context object');
        assert(doc, 'DocumentStore#update() requires a doc object');

        assertNonEmptyString(doc.type, 'DocumentStore#update() doc.type must be a non-empty string');
        if (!TYPE_PATTERN.test(doc.type)) {
            throw new AssertionError(`DocumentStore#update() doc.type "${ doc.type }" must match ${ TYPE_PATTERN }`);
        }

        assertNonEmptyString(doc.id, 'DocumentStore#update() doc.id must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(doc.id)) {
            throw new AssertionError('DocumentStore#update() doc.id contains illegal control characters');
        }

        if ('sortKey' in doc && !isString(doc.sortKey)) {
            throw new AssertionError('DocumentStore#update() doc.sortKey must be a string when present');
        }

        if (!Number.isInteger(version) || version <= 0) {
            throw new AssertionError('DocumentStore#update() version must be an integer greater than zero');
        }

        const patch = await this.#engine.update(context, doc, version);

        return Object.assign(patch, {
            type: doc.type,
            id: doc.id,
        });
    }

    /**
     * Retrieves one document by type and id.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type
     * @param {string} id - Document identifier within the type
     * @returns {Promise<(Object|null)>} Stored record with parsed `doc` payload, or null when absent
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     */
    async get(context, type, id) {
        this.#assertInitialized(this.get);
        assert(context, 'DocumentStore#get() requires a context object');

        assertNonEmptyString(type, 'DocumentStore#get() type must be a non-empty string');
        if (!TYPE_PATTERN.test(type)) {
            throw new AssertionError(`DocumentStore#get() type "${ type }" must match ${ TYPE_PATTERN }`);
        }

        assertNonEmptyString(id, 'DocumentStore#get() id must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(id)) {
            throw new AssertionError('DocumentStore#get() id contains illegal control characters');
        }

        return await this.#engine.get(context, type, id);
    }

    /**
     * Deletes one document by type and id, optionally using optimistic concurrency.
     *
     * When a positive integer version is supplied, the engine rejects if the
     * document is missing or if the stored version differs. Without a version,
     * the engine returns whether a row was deleted.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type
     * @param {string} id - Document identifier within the type
     * @param {number} [version] - Expected current positive integer document version
     * @returns {Promise<boolean>} `true` when a document was deleted; otherwise `false`
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     * @throws {DocumentNotFoundError} When a versioned delete targets a missing document
     * @throws {VersionConflictError} When the stored version does not match `version`
     */
    async delete(context, type, id, version) {
        this.#assertInitialized(this.delete);
        assert(context, 'DocumentStore#delete() requires a context object');

        assertNonEmptyString(type, 'DocumentStore#delete() type must be a non-empty string');
        if (!TYPE_PATTERN.test(type)) {
            throw new AssertionError(`DocumentStore#delete() type "${ type }" must match ${ TYPE_PATTERN }`);
        }

        assertNonEmptyString(id, 'DocumentStore#delete() id must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(id)) {
            throw new AssertionError('DocumentStore#delete() id contains illegal control characters');
        }

        if (!isUndefined(version) && (!Number.isInteger(version) || version <= 0)) {
            throw new AssertionError('DocumentStore#delete() version must be an integer greater than zero when present');
        }

        return await this.#engine.delete(context, type, id, version);
    }

    /**
     * Returns a keyset-paginated page of documents ordered by their built-in sort key.
     *
     * The cursor is an opaque signed public token and should only be reused with
     * the same method, type, sort direction, and range options that produced it.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type used to scope the scan
     * @param {Object} [options] - Scan options
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty signed public pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the sort key; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the sort key
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the sort key
     * @param {*} [options.lessThan] - Exclusive upper bound on the sort key
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the sort key
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and a signed public next-page cursor, or null on the last page
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     * @throws {InvalidCursorError} When options.cursor is not a valid public cursor issued by this facade
     */
    async scan(context, type, options) {
        this.#assertInitialized(this.scan);
        assert(context, 'DocumentStore#scan() requires a context object');
        assertNonEmptyString(type, 'DocumentStore#scan() requires a type string');
        options = options ??  {};
        const limit = getPaginationLimit(options, 'DocumentStore#scan()');
        const descending = isBoolean(options.descending) ? options.descending : false;
        const publicCursor = getPaginationCursor(options, 'DocumentStore#scan()');
        const cursor = isUndefined(publicCursor) ? undefined : await this.#unsealCursor(publicCursor);

        const result = await this.#engine.scan(context, type, {
            descending,
            limit,
            cursor,
            equalTo: options.equalTo,
            greaterThan: options.greaterThan,
            greaterThanOrEqualTo: options.greaterThanOrEqualTo,
            lessThan: options.lessThan,
            lessThanOrEqualTo: options.lessThanOrEqualTo,
        });

        return await this.#sealPaginationResult(result);
    }

    /**
     * Returns a keyset-paginated page of documents ordered by a named secondary index.
     *
     * The cursor is an opaque signed public token and should only be reused with
     * the same method, type, index, sort direction, and range options that
     * produced it.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type used to scope the query
     * @param {Object} options - Query options
     * @param {string} options.index - Name of the configured index key to query
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty signed public pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the index value; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the index value
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the index value
     * @param {*} [options.lessThan] - Exclusive upper bound on the index value
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the index value
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and a signed public next-page cursor, or null on the last page
     * @throws {AssertionError} When the arguments are invalid or the index is not configured
     * @throws {InvalidCursorError} When options.cursor is not a valid public cursor issued by this facade
     */
    async query(context, type, options) {
        this.#assertInitialized(this.query);
        assert(context, 'DocumentStore#query() requires a context object');
        assertNonEmptyString(type, 'DocumentStore#query() requires a type');
        options = options ??  {};
        assertNonEmptyString(options.index, 'DocumentStore#query() requires an index');
        const limit = getPaginationLimit(options, 'DocumentStore#query()');
        const descending = isBoolean(options.descending) ? options.descending : false;
        const publicCursor = getPaginationCursor(options, 'DocumentStore#query()');
        const cursor = isUndefined(publicCursor) ? undefined : await this.#unsealCursor(publicCursor);

        const result = await this.#engine.query(context, type, {
            index: options.index,
            descending,
            limit,
            cursor,
            equalTo: options.equalTo,
            greaterThan: options.greaterThan,
            greaterThanOrEqualTo: options.greaterThanOrEqualTo,
            lessThan: options.lessThan,
            lessThanOrEqualTo: options.lessThanOrEqualTo,
        });

        return await this.#sealPaginationResult(result);
    }
}

/**
 * Builds the range bounds for scanning or querying every key beneath a prefix.
 *
 * Spread the result into the options for `scan()` or `query()`. The inclusive
 * lower bound is the bare prefix, and the exclusive upper bound appends
 * MAX_SORT_KEY_CHAR so only keys belonging to the next prefix are excluded
 * (see MAX_SORT_KEY_CHAR for the BMP-only caveat). Because the engines compare
 * with SQL, the bounded range also excludes documents whose sort key or
 * indexed value is missing or NULL.
 * @param {string} prefix - Sort key or index value prefix, including any trailing separator character
 * @returns {{greaterThanOrEqualTo: string, lessThan: string}} Range bounds for scan() or query() options
 * @throws {AssertionError} When prefix is not a non-empty string
 */
export function sortKeyPrefixRange(prefix) {
    assertNonEmptyString(prefix, 'sortKeyPrefixRange() prefix must be a non-empty string');

    return {
        greaterThanOrEqualTo: prefix,
        lessThan: `${ prefix }${ MAX_SORT_KEY_CHAR }`,
    };
}

function getPaginationLimit(options, methodName) {
    if (isUndefined(options.limit)) {
        return 100;
    }

    if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new AssertionError(`${ methodName } options.limit must be an integer greater than zero`);
    }

    return options.limit;
}

function getPaginationCursor(options, methodName) {
    if (isUndefined(options.cursor)) {
        return undefined;
    }

    if (!isNonEmptyString(options.cursor)) {
        throw new AssertionError(`${ methodName } options.cursor must be a non-empty string when present`);
    }

    return options.cursor;
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function base64UrlToBytes(value) {
    if (!BASE64URL_PATTERN.test(value)) {
        throw new Error('Invalid base64url value');
    }

    const paddedValue = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        Math.ceil(value.length / 4) * 4,
        '=',
    );
    const binary = atob(paddedValue);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    // Reject permissive atob() decodes so each cursor has one canonical form.
    if (bytesToBase64Url(bytes) !== value) {
        throw new Error('Invalid base64url value');
    }

    return bytes;
}
