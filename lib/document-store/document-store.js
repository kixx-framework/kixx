import {
    AssertionError,
    isNumber,
    isString,
    isBoolean,
    isUndefined,
    isNumberNotNaN,
    isNonEmptyString,
    assert,
    assertArray,
    assertNonEmptyString,
} from '../assertions/mod.js';


const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F]/; // eslint-disable-line no-control-regex


/**
 * Validating facade for a configured document store engine.
 *
 * The store enforces the public document contract shared by collection callers:
 * document `type` values must be identifier-like strings, document `id` values
 * must be non-empty strings without control characters, and optional `sortKey`
 * values must be strings. `initialize()` must be called before the store is
 * used.
 *
 * @see DocumentStoreEngineInterface in ./document-store-engine-interface.js for the engine contract
 * @see DocumentStoreEngine in ../cloudflare/document-store/document-store-engine.js for the Cloudflare D1 implementation
 */
export default class DocumentStore {

    #engine;

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
     * @param {string} config.indexes[].name - Query index name, limited to lowercase letters, numbers, and underscores
     * @param {string} config.indexes[].jsonPath - JSON path beginning with `$.`
     * @param {boolean} [config.indexes[].unique=false] - When true, the engine enforces uniqueness on
     *   `(type, indexed-value)` and rejects conflicting writes with `DocumentUniqueIndexViolationError`.
     * @returns {void}
     * @throws {AssertionError} When the engine or index definitions are invalid
     */
    initialize(config) {
        const { engine, indexes } = config ?? {};
        assert(engine, 'DocumentStore#initialize() requires a DocumentStoreEngine as "engine"');
        assertArray(indexes, 'DocumentStore#initialize() requires an Array as "indexes"');

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
        this.#engine.setIndexDefinitions(indexes);
    }

    /**
     * Ensures callers receive the public method as the AssertionError stack source.
     */
    #assertInitialized(method) {
        if (!this.#engine) {
            throw new AssertionError('DocumentStore has not been initialized', null, method);
        }
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
     * @param {number} version - Expected current document version
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

        if (!Number.isInteger(version)) {
            throw new AssertionError('DocumentStore#update() version must an integer greater than zero');
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
     * When a version is supplied, the engine may reject if the document is missing
     * or if the stored version differs. Without a version, the engine returns
     * whether a row was deleted.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type
     * @param {string} id - Document identifier within the type
     * @param {number} [version] - Expected current document version
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

        if (!isUndefined(version) && !isNumber(version) && !Number.isInteger(version)) {
            throw new AssertionError('DocumentStore#delete() version must an integer greater than zero when present');
        }

        return await this.#engine.delete(context, type, id, version);
    }

    /**
     * Returns a keyset-paginated page of documents ordered by their built-in sort key.
     *
     * The cursor is opaque and should only be reused with the same method, type,
     * sort direction, and range options that produced it.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type used to scope the scan
     * @param {Object} [options] - Scan options
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Maximum number of records per page
     * @param {string} [options.cursor] - Opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the sort key; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the sort key
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the sort key
     * @param {*} [options.lessThan] - Exclusive upper bound on the sort key
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the sort key
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When the store is not initialized or the arguments are invalid
     */
    async scan(context, type, options) {
        this.#assertInitialized(this.scan);
        assert(context, 'DocumentStore#scan() requires a context object');
        assertNonEmptyString(type, 'DocumentStore#scan() requires a type string');
        options = options ??  {};
        const limit = isNumberNotNaN(options.limit) ? options.limit : 100;
        const descending = isBoolean(options.descending) ? options.descending : false;
        const cursor = isNonEmptyString(options.cursor) ? options.cursor : null;

        return await this.#engine.scan(context, type, {
            descending,
            limit,
            cursor,
            equalTo: options.equalTo,
            greaterThan: options.greaterThan,
            greaterThanOrEqualTo: options.greaterThanOrEqualTo,
            lessThan: options.lessThan,
            lessThanOrEqualTo: options.lessThanOrEqualTo,
        });
    }

    /**
     * Returns a keyset-paginated page of documents ordered by a named secondary index.
     *
     * The cursor is opaque and should only be reused with the same method, type,
     * index, sort direction, and range options that produced it.
     *
     * @param {Object} context - Request or execution context consumed by the configured engine
     * @param {string} type - Document type used to scope the query
     * @param {Object} options - Query options
     * @param {string} options.index - Name of the configured index key to query
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Maximum number of records per page
     * @param {string} [options.cursor] - Opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the index value; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the index value
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the index value
     * @param {*} [options.lessThan] - Exclusive upper bound on the index value
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the index value
     * @returns {Promise<{records: Object[], cursor: string|null}>} Page of records and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When the arguments are invalid or the index is not configured
     */
    async query(context, type, options) {
        this.#assertInitialized(this.query);
        assert(context, 'DocumentStore#query() requires a context object');
        assertNonEmptyString(type, 'DocumentStore#query() requires a type');
        options = options ??  {};
        assertNonEmptyString(options.index, 'DocumentStore#query() requires an index');
        const limit = isNumberNotNaN(options.limit) ? options.limit : 100;
        const descending = isBoolean(options.descending) ? options.descending : false;
        const cursor = isNonEmptyString(options.cursor) ? options.cursor : null;

        return await this.#engine.query(context, type, {
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
    }
}
