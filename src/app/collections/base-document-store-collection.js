import Record from './base-document-store-record.js';
import RetryLimitExceededError from './retry-limit-exceeded-error.js';
import DocumentNotFoundError from '../../kixx/document-store/document-not-found-error.js';
import {
    assert,
    assertEqual,
    assertFunction,
    assertNotEqual,
    assertNonEmptyString,
    AssertionError,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
    isString,
    toFriendlyString,
} from '../../kixx/assertions/mod.js';


/**
 * Rebuilds a pending update after an optimistic concurrency conflict.
 * @callback CollectionUpdateRetryCallback
 * @param {Record} latest - Latest stored record after a version conflict
 * @param {Object} metadata - Conflict metadata
 * @param {number} metadata.attempt - One-based retry attempt number
 * @param {VersionConflictError} metadata.conflict - Conflict which triggered this retry attempt
 * @returns {Record|undefined|Promise<Record|undefined>} Next record to update, or `undefined` to use the mutated `latest` record
 */

/**
 * Table Data Gateway scoping all document store operations to a single type.
 *
 * Subclasses must override `TYPE` with the document type string they manage.
 * All reads and writes are automatically scoped to that type, and raw store
 * records are converted to and from the configured `Record` DTO class on
 * every call.
 *
 * @see DocumentStore in ../../kixx/document-store/document-store.js
 */
export default class Collection {

    /**
     * Document type managed by this collection. Must be overridden on every subclass.
     * @type {string}
     */
    static TYPE = '_BaseType';

    /**
     * DTO class used to wrap raw store records. Optionally override to use a custom Record subclass.
     * @type {Function}
     */
    static Record = Record;

    #db;

    /**
     * @param {Object} config
     * @param {DocumentStore} config.db - Initialized DocumentStore instance
     * @throws {AssertionError} When `db` is missing or `TYPE` has not been overridden from the base class
     */
    constructor(config) {
        const { db } = config ?? {};
        assert(db, 'Collection constructor requires a "db" DocumentStore');
        this.#db = db;

        const type = this.constructor.TYPE;
        const RecordClass = this.constructor.Record;

        assertNonEmptyString(type, 'Collection.TYPE must be a non-empty string');
        assertNotEqual('_BaseType', type, 'Collection.TYPE must be overridden from the base class');

        Object.defineProperties(this, {
            /**
             * Document type managed by this collection instance.
             * @name type
             * @type {string}
             * @readonly
             */
            type: {
                value: type,
                enumerable: true,
            },
            /**
             * DTO class used to convert raw store records on every read or write.
             * @name Record
             * @type {Function}
             * @readonly
             */
            Record: {
                value: RecordClass,
                enumerable: true,
            },
        });
    }

    /**
     * Creates a document only when none exists for the same id.
     *
     * Plain-object input is coerced to an instance of the configured Record
     * class via `Record.forWrite()` so the subclass `validate()` runs before
     * the store call.
     *
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Object|Record} input - Plain attributes object, or Record instance to persist
     * @returns {Promise<Record>} The stored document wrapped in the configured Record class
     * @throws {AssertionError} When arguments are invalid
     * @throws {ValidationError} When the Record subclass `validate()` rejects the input
     * @throws {DocumentAlreadyExistsError} When a document already exists for the same id
     */
    async create(context, input) {
        const dto = this.#coerceToRecord(input, 'Collection#create()');
        dto.validate();
        const record = await this.#db.create(context, this.#toDocument(dto));
        return this.Record.fromRecord(record);
    }

    /**
     * Updates an existing document when its stored version matches `dto.version`.
     *
     * Requires a Record instance so the subclass `validate()` hook can run
     * against the prepared write before persistence.
     *
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Record} dto - Record whose `toDocument()` output replaces the stored document; must carry the current `version`
     * @returns {Promise<Record>} The updated document wrapped in the configured Record class
     * @throws {AssertionError} When `dto` is not an instance of `this.Record`
     * @throws {ValidationError} When the Record subclass `validate()` rejects the input
     * @throws {DocumentNotFoundError} When the target document does not exist
     * @throws {VersionConflictError} When the stored version does not match `dto.version`
     */
    async update(context, dto) {
        assert(
            dto instanceof this.Record,
            'Collection#update() requires an instance of this.Record',
        );
        this.#assertRecordBelongsToCollection(dto, 'Collection#update()');
        dto.validate();
        const record = await this.#db.update(context, this.#toDocument(dto), dto.version);
        return this.Record.fromRecord(record);
    }

    /**
     * Updates a document using optimistic concurrency, retrying on version conflicts.
     *
     * The initial update is attempted directly with `dto`. If a `VersionConflictError`
     * is thrown, the latest stored record is fetched and passed to `callback`, which
     * returns the updated candidate for the next attempt. This continues until the
     * update succeeds or `retryLimit` conflicts are exhausted.
     *
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Record} dto - Record to update on the first attempt; must carry the current `version`
     * @param {CollectionUpdateRetryCallback} callback - Called only on conflict; receives the latest stored record and returns the next update candidate
     * @param {Object} [options] - Retry configuration
     * @param {number} [options.retryLimit=3] - Maximum number of refetch-and-retry attempts after the first conflict
     * @returns {Promise<Record>} The updated document wrapped in the configured Record class
     * @throws {AssertionError} When arguments are invalid
     * @throws {DocumentNotFoundError} When the document disappears during a retry
     * @throws {RetryLimitExceededError} When conflicts continue past `retryLimit`
     */
    async updateWithRetry(context, dto, callback, options) {
        const { retryLimit = 3 } = options ?? {};
        assertFunction(callback, 'Collection#updateWithRetry() callback');

        if (!Number.isInteger(retryLimit) || retryLimit < 0) {
            throw new AssertionError(
                'Collection#updateWithRetry() options.retryLimit must be an integer greater than or equal to zero',
            );
        }

        let candidate = dto;
        let retryCount = 0;

        while (true) {
            try {
                return await this.update(context, candidate);
            } catch (cause) {
                if (cause.name !== 'VersionConflictError') {
                    throw cause;
                }

                if (retryCount >= retryLimit) {
                    throw new RetryLimitExceededError(this.type, dto.id, retryLimit, { cause });
                }

                retryCount += 1;

                const latest = await this.get(context, dto.id);
                if (!latest) {
                    throw new DocumentNotFoundError(this.type, dto.id);
                }

                // The callback owns business-specific merge semantics; the collection only coordinates refetching.
                const nextCandidate = await callback(latest, {
                    attempt: retryCount,
                    conflict: cause,
                });

                candidate = isUndefined(nextCandidate) ? latest : nextCandidate;
            }
        }
    }

    /**
     * Creates or overwrites a document without optimistic concurrency control.
     *
     * Plain-object input is coerced to an instance of the configured Record
     * class via `Record.forWrite()` so the subclass `validate()` runs before
     * the store call.
     *
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Object|Record} input - Plain attributes object, or Record instance to persist
     * @returns {Promise<Record>} The stored document wrapped in the configured Record class
     * @throws {AssertionError} When arguments are invalid
     * @throws {ValidationError} When the Record subclass `validate()` rejects the input
     */
    async put(context, input) {
        const dto = this.#coerceToRecord(input, 'Collection#put()');
        dto.validate();
        const record = await this.#db.put(context, this.#toDocument(dto));
        return this.Record.fromRecord(record);
    }

    /**
     * Retrieves one document by id.
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {string} id - Document identifier within this collection's type
     * @returns {Promise<Record|null>} The document wrapped in the configured Record class, or null when absent
     * @throws {AssertionError} When arguments are invalid
     */
    async get(context, id) {
        const record = await this.#db.get(context, this.type, id);
        return record ? this.Record.fromRecord(record) : null;
    }

    /**
     * Deletes one document by id without optimistic concurrency control.
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {string} id - Document identifier within this collection's type
     * @returns {Promise<boolean>} `true` when a document was deleted; otherwise `false`
     * @throws {AssertionError} When arguments are invalid
     */
    async delete(context, id) {
        return await this.#db.delete(context, this.type, id);
    }

    /**
     * Deletes one document using optimistic concurrency, rejecting on a version mismatch.
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Record} dto - DTO carrying the `id` and `version` of the document to delete
     * @returns {Promise<boolean>} `true` when the document was deleted
     * @throws {AssertionError} When arguments are invalid
     * @throws {DocumentNotFoundError} When the target document does not exist
     * @throws {VersionConflictError} When the stored version does not match `dto.version`
     */
    async deleteStrict(context, dto) {
        assert(
            dto instanceof this.Record,
            'Collection#deleteStrict() requires an instance of this.Record',
        );
        this.#assertRecordBelongsToCollection(dto, 'Collection#deleteStrict()');
        return await this.#db.delete(context, this.type, dto.id, dto.version);
    }

    /**
     * Returns a keyset-paginated page of documents ordered by their built-in sort key.
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Object} [options] - Scan options
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the sort key; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the sort key
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the sort key
     * @param {*} [options.lessThan] - Exclusive upper bound on the sort key
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the sort key
     * @returns {Promise<{items: Record[], cursor: string|null}>} Page of Record instances and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When arguments are invalid
     */
    async scan(context, options) {
        const result = await this.#db.scan(context, this.type, options);
        const items = result.records.map((record) => {
            return this.Record.fromRecord(record);
        });

        return { items, cursor: result.cursor || null };
    }

    /**
     * Returns a keyset-paginated page of documents ordered by a named secondary index.
     * @param {Object} context - Request or execution context passed through to the store engine
     * @param {Object} options - Query options
     * @param {string} options.index - Name of the configured secondary index to query
     * @param {boolean} [options.descending=false] - Sort in descending order when true
     * @param {number} [options.limit=100] - Positive integer maximum number of records per page
     * @param {string} [options.cursor] - Non-empty opaque pagination token returned by a previous call
     * @param {*} [options.equalTo] - Exact match on the index value; mutually exclusive with range bounds
     * @param {*} [options.greaterThan] - Exclusive lower bound on the index value
     * @param {*} [options.greaterThanOrEqualTo] - Inclusive lower bound on the index value
     * @param {*} [options.lessThan] - Exclusive upper bound on the index value
     * @param {*} [options.lessThanOrEqualTo] - Inclusive upper bound on the index value
     * @returns {Promise<{items: Record[], cursor: string|null}>} Page of Record instances and an opaque next-page cursor, or null on the last page
     * @throws {AssertionError} When arguments are invalid or the index is not configured
     */
    async query(context, options) {
        const result = await this.#db.query(context, this.type, options);
        const items = result.records.map((record) => {
            return this.Record.fromRecord(record);
        });

        return { items, cursor: result.cursor || null };
    }

    /**
     * Returns a unique identifier string for a new document of this type.
     *
     * The default returns a random UUID. Override on a Collection subclass
     * when the gateway owns id generation, including derived ids, counters,
     * or generated id services.
     *
     * @param {Object} _attributes - The prepared attributes; available to custom id generators
     * @returns {string}
     */
    generateUniqueId(_attributes) {
        return crypto.randomUUID();
    }

    /**
     * Returns the sort key for a document of this type, or null/undefined to omit one.
     * Override to compute a sort key from document fields.
     * The default passes through `doc.sortKey` when present, or returns `undefined`.
     * @param {Object} doc - The prepared document
     * @returns {string|null|undefined}
     */
    generateSortKey(doc) {
        return doc?.sortKey;
    }

    #coerceToRecord(input, methodName) {
        if (input instanceof this.Record) {
            this.#assertRecordBelongsToCollection(input, methodName);
            return input;
        }

        if (!isPlainObject(input)) {
            throw new AssertionError(
                `${ methodName } input must be a plain object or an instance of this.Record (got ${ toFriendlyString(input) })`,
            );
        }

        const attributes = copyAttributes(input);

        let id = isNonEmptyString(input?.id) ? input.id : null;
        if (!id) {
            id = this.generateUniqueId(attributes) || null;
        }

        return this.Record.forWrite({
            type: this.type,
            id,
            attributes,
        });
    }

    #toDocument(dto) {
        this.#assertRecordBelongsToCollection(dto, 'Collection write');

        const doc = dto.toDocument();
        const sortKey = this.generateSortKey(doc);

        if (isUndefined(sortKey) || sortKey === null) {
            delete doc.sortKey;
            return doc;
        }

        if (isString(sortKey)) {
            doc.sortKey = sortKey;
            return doc;
        }

        throw new AssertionError(
            `Collection#generateSortKey() must return a string, null, or undefined (got ${ toFriendlyString(sortKey) })`,
        );
    }

    #assertRecordBelongsToCollection(dto, methodName) {
        assertEqual(
            this.type,
            dto.type,
            `${ methodName } record type must match Collection.type`,
        );
    }
}

function copyAttributes(input) {
    const attributes = {};

    for (const key of Object.keys(input)) {
        // Metadata belongs to the gateway, and __proto__ can mutate the target prototype.
        if (key === 'type' || key === 'id' || key === '__proto__') {
            continue;
        }

        attributes[key] = input[key];
    }

    return attributes;
}
