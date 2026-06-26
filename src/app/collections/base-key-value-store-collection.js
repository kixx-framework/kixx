import Record from './base-key-value-store-record.js';
import {
    assert,
    assertNotEqual,
    assertNonEmptyString,
    AssertionError,
    isNonEmptyString,
    isPlainObject,
    toFriendlyString,
} from '../../kixx/assertions/mod.js';


/**
 * Table Data Gateway scoping key/value-store JSON records to a single type.
 *
 * The KeyValueStore itself is a flat keyspace, so this gateway owns the key
 * format for typed records and stores each record as a JSON value at
 * `${type}_${id}`. Subclasses override `TYPE` and optionally `Record` to add
 * domain validation and accessors while callers stay insulated from cache-key
 * construction and serialization details.
 */
export default class Collection {

    /**
     * Record type managed by this collection. Must be overridden on every subclass.
     * @type {string}
     */
    static TYPE = '_BaseType';

    /**
     * DTO class used to wrap stored JSON records. Optionally override to use a custom Record subclass.
     * @type {Function}
     */
    static Record = Record;

    #db;

    /**
     * @param {Object} config
     * @param {import('../../kixx/key-value-store/key-value-store-interface.js').KeyValueStoreInterface} config.db - Initialized KeyValueStore instance
     * @throws {AssertionError} When `db` is missing or `TYPE` has not been overridden from the base class
     */
    constructor(config) {
        const { db } = config ?? {};
        assert(db, 'Collection constructor requires a "db" KeyValueStore');
        this.#db = db;

        const type = this.constructor.TYPE;
        const RecordClass = this.constructor.Record;

        assertNonEmptyString(type, 'Collection.TYPE must be a non-empty string');
        assertNotEqual('_BaseType', type, 'Collection.TYPE must be overridden from the base class');

        Object.defineProperties(this, {
            /**
             * Record type managed by this collection instance.
             * @name type
             * @type {string}
             * @readonly
             */
            type: {
                value: type,
                enumerable: true,
            },
            /**
             * DTO class used to convert stored JSON records on every read or write.
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
     * Retrieves one JSON record by id.
     * @param {Object} context - Request or execution context passed through to the key/value store
     * @param {string} id - Record identifier within this collection's type
     * @returns {Promise<Record|null>} The stored value wrapped in the configured Record class, or null when absent or expired
     * @throws {AssertionError} When arguments are invalid
     */
    async get(context, id) {
        assertNonEmptyString(id, `Collection#get() invalid id for Key Value Collection (type:${ this.type })`);
        const key = this.#toKey(id);
        const record = await this.#db.get(context, key, { type: 'json' });
        return record ? this.Record.fromRecord(record) : null;
    }

    /**
     * Creates or overwrites one JSON record, with optional expiration.
     *
     * Plain-object input is coerced to an instance of the configured Record
     * class via `Record.forWrite()` so the subclass `validate()` hook runs
     * before persistence.
     *
     * @param {Object} context - Request or execution context passed through to the key/value store
     * @param {Object|Record} input - Plain attributes object, or Record instance to persist
     * @param {import('../../kixx/key-value-store/key-value-store-interface.js').KeyValuePutOptions} [options] - Expiration options; `type` is always forced to `'json'`
     * @returns {Promise<Record>} The persisted JSON value wrapped in the configured Record class
     * @throws {AssertionError} When arguments are invalid
     * @throws {ValidationError} When the Record subclass `validate()` rejects the input
     */
    async put(context, input, options) {
        const dto = this.#coerceToRecord(input, 'Collection#put()');
        dto.validate();
        const record = dto.toDocument();
        assertNonEmptyString(record.id, `Collection#put() invalid id for Key Value Collection (type:${ this.type })`);
        const key = this.#toKey(record.id);
        const opts = Object.assign({}, options, { type: 'json' });
        await this.#db.put(context, key, record, opts);
        return dto;
    }

    /**
     * Deletes one JSON record by id.
     * @param {Object} context - Request or execution context passed through to the key/value store
     * @param {string} id - Record identifier within this collection's type
     * @returns {Promise<void>}
     * @throws {AssertionError} When arguments are invalid
     */
    async delete(context, id) {
        assertNonEmptyString(id, `Collection#delete() invalid id for Key Value Collection (type:${ this.type })`);
        const key = this.#toKey(id);
        await this.#db.delete(context, key);
    }

    /**
     * Returns a unique identifier string for a new record of this type.
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

    #toKey(id) {
        return `${ this.type }_${ id }`;
    }

    #coerceToRecord(input, methodName) {
        if (input instanceof this.Record) {
            return input;
        }

        if (!isPlainObject(input)) {
            throw new AssertionError(
                `${ methodName } input must be a plain object or an instance of this.Record (got ${ toFriendlyString(input) })`,
            );
        }

        const attributes = {};

        for (const key of Object.keys(input)) {
            if (key === 'type' || key === 'id') {
                continue;
            }

            attributes[key] = input[key];
        }

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
}
