import { isPlainObject } from '../assertions.js';
import { ValidationError } from '../errors.js';
import {
    DataStoreClosedError,
    DataStoreNotInitializedError
} from './errors.js';

const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F]/;
const RESERVED_DOC_ATTRIBUTES = new Set([ 'version', 'createdAt', 'updatedAt' ]);

/**
 * Schemaless document store with optimistic concurrency control and indexed queries.
 *
 * DataStore is the sole interface application developers interact with. It validates
 * all inputs, owns the public lifecycle, and delegates persistence work to a pluggable
 * StorageEngine. Swapping engines requires no changes to application code.
 *
 * Usage:
 * ```javascript
 * const store = new DataStore(engine);
 * await store.initialize();
 * await store.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
 * const record = await store.put({ id: 'cust_001', type: 'Customer', email: 'a@b.com' });
 * const page = await store.query('Customer', { index: 'email', beginsWith: 'a' });
 * ```
 *
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export default class DataStore {

    /** @type {import('../ports/storage-engine.js').StorageEngine} */
    #engine = null;

    /** @type {boolean} */
    #isInitialized = false;

    /** @type {boolean} */
    #isClosed = false;

    /**
     * @param {import('../ports/storage-engine.js').StorageEngine} engine - Persistence backend.
     */
    constructor(engine) {
        this.#engine = engine;
    }

    /**
     * Prepares the engine for use. Must be called once before any other method.
     * @public
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.#isClosed) {
            throw new DataStoreClosedError('initialize', {}, this.initialize);
        }
        if (this.#isInitialized) {
            return;
        }
        await this.#engine.initialize();
        this.#isInitialized = true;
    }

    /**
     * Declares the complete set of custom indexes the store should maintain. This call
     * is declarative and idempotent — call it again with a superset to add indexes, or
     * with a subset to drop indexes. Calling with an empty array removes all custom indexes.
     *
     * Adding a new index over existing data causes the engine to backfill the index.
     *
     * @public
     * @param {import('../ports/storage-engine.js').IndexDefinition[]} indexes
     *   Complete desired set of custom indexes.
     * @returns {Promise<void>}
     * @throws {import('./errors.js').DataStoreNotInitializedError} When initialize() has not completed.
     * @throws {import('./errors.js').DataStoreClosedError} When the store has been closed.
     * @throws {ValidationError} When any index definition is invalid.
     */
    async configureIndexes(indexes) {
        this.#assertUsable('configureIndexes');

        const err = new ValidationError('Invalid index definitions');

        if (!Array.isArray(indexes)) {
            err.push('indexes must be an array', 'indexes');
            throw err;
        }

        for (let i = 0; i < indexes.length; i += 1) {
            const def = indexes[i];

            if (!isPlainObject(def)) {
                err.push('Each index definition must be a plain object', `indexes[${ i }]`);
                continue;
            }
            if (!TYPE_PATTERN.test(def.type)) {
                err.push(
                    `type must match ${ TYPE_PATTERN } — got "${ def.type }"`,
                    `indexes[${ i }].type`
                );
            }
            if (!ATTRIBUTE_PATTERN.test(def.attribute)) {
                err.push(
                    `attribute must match ${ ATTRIBUTE_PATTERN } — got "${ def.attribute }"`,
                    `indexes[${ i }].attribute`
                );
            }
        }

        if (err.length > 0) {
            throw err;
        }

        await this.#engine.configureIndexes(indexes);
    }

    /**
     * Write a document, creating or overwriting it depending on options.
     *
     * Behavior is determined by `options.version`:
     * - **No version** — upsert. Creates the document if it does not exist; overwrites it if it does.
     * - **Version provided** — optimistic update. Fails if the document does not exist or the stored
     *   version does not match.
     *
     * @public
     * @param {Object} doc - The document to store. Must include `id` and `type`.
     * @param {Object} [options] - Write options.
     * @param {number} [options.version] - Expected current version for an optimistic update.
     * @returns {Promise<import('../ports/storage-engine.js').DocumentRecord>}
     * @throws {import('./errors.js').DataStoreNotInitializedError} When initialize() has not completed.
     * @throws {import('./errors.js').DataStoreClosedError} When the store has been closed.
     * @throws {ValidationError} When the document or options fail validation.
     * @throws {import('./errors.js').DocumentNotFoundError} On update when (type, id) does not exist.
     * @throws {import('./errors.js').VersionConflictError} On update when versions do not match.
     */
    async put(doc, options) {
        this.#assertUsable('put');

        const err = new ValidationError('Invalid document');

        if (!isPlainObject(doc)) {
            err.push('doc must be a non-null plain object', 'doc');
            throw err;
        }

        if (typeof doc.type !== 'string' || !TYPE_PATTERN.test(doc.type)) {
            err.push(
                `type must match ${ TYPE_PATTERN } — got "${ doc.type }"`,
                'doc.type'
            );
        }

        if (typeof doc.id !== 'string' || doc.id.length === 0) {
            err.push('id must be a non-empty string', 'doc.id');
        } else if (CONTROL_CHAR_PATTERN.test(doc.id)) {
            err.push('id must not contain control characters (\\x00–\\x1F)', 'doc.id');
        }

        if ('sortKey' in doc && typeof doc.sortKey !== 'string') {
            err.push('sortKey must be a string when present', 'doc.sortKey');
        }

        for (const attr of RESERVED_DOC_ATTRIBUTES) {
            if (attr in doc) {
                err.push(`"${ attr }" is reserved and must not appear in the document`, `doc.${ attr }`);
            }
        }

        const version = options && options.version;

        if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
            err.push('options.version must be a positive integer', 'options.version');
        }

        if (err.length > 0) {
            throw err;
        }

        // Verify JSON-serializability separately — JSON.stringify may throw with a
        // non-descriptive error, so we catch and re-wrap as a ValidationError.
        try {
            JSON.stringify(doc);
        } catch (cause) {
            const serErr = new ValidationError('doc must be JSON-serializable', { cause });
            serErr.push('doc contains a non-serializable value', 'doc');
            throw serErr;
        }

        return this.#engine.put(doc, options);
    }

    /**
     * Retrieve a document by its composite key.
     * @public
     * @param {string} type - Document type.
     * @param {string} id - Document identifier.
     * @returns {Promise<import('../ports/storage-engine.js').DocumentRecord|null>}
     *   The DocumentRecord, or null if no document exists for (type, id).
     * @throws {import('./errors.js').DataStoreNotInitializedError} When initialize() has not completed.
     * @throws {import('./errors.js').DataStoreClosedError} When the store has been closed.
     * @throws {ValidationError} When type or id are invalid.
     */
    async get(type, id) {
        this.#assertUsable('get');

        const err = new ValidationError('Invalid get() arguments');

        if (typeof type !== 'string' || type.length === 0) {
            err.push('type must be a non-empty string', 'type');
        }
        if (typeof id !== 'string' || id.length === 0) {
            err.push('id must be a non-empty string', 'id');
        }

        if (err.length > 0) {
            throw err;
        }

        return this.#engine.get(type, id);
    }

    /**
     * Delete a document, optionally with an optimistic version check.
     *
     * Behavior is determined by `options.version`:
     * - **No version** — delete. Returns `true` if deleted, `false` if the document did not exist.
     * - **Version provided** — optimistic delete. Throws `DocumentNotFoundError` if the document
     *   does not exist; throws `VersionConflictError` if the stored version does not match.
     *
     * @public
     * @param {string} type - Document type.
     * @param {string} id - Document identifier.
     * @param {Object} [options] - Delete options.
     * @param {number} [options.version] - Expected current version for an optimistic delete.
     * @returns {Promise<boolean>} True if deleted, false if the document did not exist.
     * @throws {import('./errors.js').DataStoreNotInitializedError} When initialize() has not completed.
     * @throws {import('./errors.js').DataStoreClosedError} When the store has been closed.
     * @throws {ValidationError} When arguments fail validation.
     * @throws {import('./errors.js').DocumentNotFoundError} On versioned delete when (type, id) does not exist.
     * @throws {import('./errors.js').VersionConflictError} On versioned delete when versions do not match.
     */
    async delete(type, id, options) {
        this.#assertUsable('delete');

        const err = new ValidationError('Invalid delete() arguments');

        if (typeof type !== 'string' || type.length === 0) {
            err.push('type must be a non-empty string', 'type');
        }
        if (typeof id !== 'string' || id.length === 0) {
            err.push('id must be a non-empty string', 'id');
        }

        const version = options && options.version;

        if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
            err.push('options.version must be a positive integer', 'options.version');
        }

        if (err.length > 0) {
            throw err;
        }

        return this.#engine.delete(type, id, version);
    }

    /**
     * Query documents of a given type using an index.
     *
     * Uses the built-in `type+sortKey` index by default. Pass `options.index` to
     * query a custom index declared via configureIndexes().
     *
     * @public
     * @param {string} type - Document type to query.
     * @param {Object} [options] - Filtering, pagination, and ordering options.
     * @param {string}  [options.index]                - Custom index attribute name.
     * @param {string}  [options.startKey]             - Inclusive lower bound (alias for greaterThanOrEqualTo).
     * @param {string}  [options.endKey]               - Inclusive upper bound (alias for lessThanOrEqualTo).
     * @param {string}  [options.greaterThanOrEqualTo] - Inclusive lower bound.
     * @param {string}  [options.lessThanOrEqualTo]    - Inclusive upper bound.
     * @param {string}  [options.greaterThan]          - Exclusive lower bound.
     * @param {string}  [options.lessThan]             - Exclusive upper bound.
     * @param {string}  [options.beginsWith]           - Prefix match. Cannot be combined with range operators.
     * @param {number}  [options.limit=100]            - Page size (1–1000).
     * @param {boolean} [options.reverse=false]        - Descending index order.
     * @param {string}  [options.cursor]               - Pagination token from a previous QueryResult.
     * @returns {Promise<import('../ports/storage-engine.js').QueryResult>}
     * @throws {import('./errors.js').DataStoreNotInitializedError} When initialize() has not completed.
     * @throws {import('./errors.js').DataStoreClosedError} When the store has been closed.
     * @throws {ValidationError} When type or any query option is invalid.
     * @throws {import('./errors.js').IndexNotConfiguredError} When options.index is not declared.
     */
    async query(type, options) {
        this.#assertUsable('query');

        const err = new ValidationError('Invalid query() arguments');

        if (!TYPE_PATTERN.test(type)) {
            err.push(`type must match ${ TYPE_PATTERN } — got "${ type }"`, 'type');
            throw err;
        }

        const opts = options || {};

        const {
            index,
            startKey,
            endKey,
            greaterThanOrEqualTo,
            lessThanOrEqualTo,
            greaterThan,
            lessThan,
            beginsWith,
            limit,
            reverse,
            cursor,
        } = opts;

        // Validate range operator mutual exclusivity.
        if (startKey !== undefined && greaterThanOrEqualTo !== undefined) {
            err.push('startKey and greaterThanOrEqualTo are mutually exclusive', 'options');
        }
        if (endKey !== undefined && lessThanOrEqualTo !== undefined) {
            err.push('endKey and lessThanOrEqualTo are mutually exclusive', 'options');
        }

        const hasLower = greaterThan !== undefined
            || greaterThanOrEqualTo !== undefined
            || startKey !== undefined;
        const hasUpper = lessThan !== undefined
            || lessThanOrEqualTo !== undefined
            || endKey !== undefined;

        if (beginsWith !== undefined) {
            if (hasLower || hasUpper) {
                err.push('beginsWith cannot be combined with range operators', 'options');
            }
            if (typeof beginsWith !== 'string') {
                err.push('beginsWith must be a string', 'options.beginsWith');
            } else if (beginsWith.length === 0) {
                err.push('beginsWith must be a non-empty string', 'options.beginsWith');
            }
        }

        if (greaterThan !== undefined && (greaterThanOrEqualTo !== undefined || startKey !== undefined)) {
            err.push('greaterThan and greaterThanOrEqualTo/startKey are mutually exclusive', 'options');
        }
        if (lessThan !== undefined && (lessThanOrEqualTo !== undefined || endKey !== undefined)) {
            err.push('lessThan and lessThanOrEqualTo/endKey are mutually exclusive', 'options');
        }

        // Validate bound types.
        for (const [ name, value ] of [
            [ 'greaterThanOrEqualTo', greaterThanOrEqualTo ],
            [ 'lessThanOrEqualTo', lessThanOrEqualTo ],
            [ 'greaterThan', greaterThan ],
            [ 'lessThan', lessThan ],
            [ 'startKey', startKey ],
            [ 'endKey', endKey ],
        ]) {
            if (value !== undefined && typeof value !== 'string') {
                err.push(`${ name } must be a string`, `options.${ name }`);
            }
        }

        // Validate limit.
        const resolvedLimit = limit === undefined ? 100 : limit;
        if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > 1000) {
            err.push('limit must be an integer in the range [1, 1000]', 'options.limit');
        }

        if (err.length > 0) {
            throw err;
        }

        // Normalize options before passing to engine:
        // - Resolve startKey/endKey aliases.
        // - Expand beginsWith into a gte + lt range.
        // - Apply defaults.
        const normalizedGte = greaterThanOrEqualTo !== undefined ? greaterThanOrEqualTo : startKey;
        const normalizedLte = lessThanOrEqualTo !== undefined ? lessThanOrEqualTo : endKey;

        const normalizedGt = greaterThan;
        const normalizedLt = lessThan;

        if (beginsWith !== undefined) {
            const lastCodePoint = beginsWith.codePointAt(beginsWith.length - 1);
            const upperBound = beginsWith.slice(0, -1) + String.fromCodePoint(lastCodePoint + 1);
            // beginsWith is resolved into greaterThanOrEqualTo + lessThan range.
            return this.#engine.query(type, {
                index,
                greaterThanOrEqualTo: beginsWith,
                lessThan: upperBound,
                limit: resolvedLimit,
                reverse: reverse === true,
                cursor,
            });
        }

        return this.#engine.query(type, {
            index,
            greaterThanOrEqualTo: normalizedGte,
            lessThanOrEqualTo: normalizedLte,
            greaterThan: normalizedGt,
            lessThan: normalizedLt,
            limit: resolvedLimit,
            reverse: reverse === true,
            cursor,
        });
    }

    /**
     * Releases any resources held by the underlying engine.
     * @public
     * @returns {Promise<void>}
     */
    async close() {
        if (!this.#isInitialized || this.#isClosed) {
            return;
        }
        await this.#engine.close();
        this.#isClosed = true;
    }

    #assertUsable(operation) {
        if (this.#isClosed) {
            throw new DataStoreClosedError(operation, {}, this.#assertUsable);
        }
        if (!this.#isInitialized) {
            throw new DataStoreNotInitializedError(operation, {}, this.#assertUsable);
        }
    }
}
