import deepMerge from '../../kixx/utils/deep-merge.js';
import {
    AssertionError,
    isNonEmptyString,
    isObjectNotNull,
    isPlainObject,
    toFriendlyString,
} from '../../kixx/assertions/mod.js';


/**
 * @typedef {Object} RecordSpec
 * @property {string} type - Record type managed by the owning collection.
 * @property {string} id - Record identifier within the type.
 * @property {Object} attributes - Plain object containing user-defined record attributes.
 */

/**
 * Mutable DTO wrapping a key/value-store JSON record for collection callers.
 *
 * User-defined attributes are held in a private `#attributes` slot. Callers
 * read and write attributes through `get`, `set`, `merge`, and `deepMerge`;
 * subclasses expose domain-specific getters by delegating to `this.get(name)`.
 */
export default class Record {

    #attributes;

    /**
     * @param {RecordSpec} spec - Stored record data and user-defined attributes.
     * @throws {AssertionError} When the spec shape is invalid.
     */
    constructor(spec) {
        if (!isObjectNotNull(spec)) {
            throw new AssertionError(
                `Record constructor requires a spec object (got ${ toFriendlyString(spec) })`,
            );
        }
        if (!isNonEmptyString(spec.type)) {
            throw new AssertionError(
                `Record spec.type must be a non-empty string (got ${ toFriendlyString(spec.type) })`,
            );
        }
        if (!isNonEmptyString(spec.id)) {
            throw new AssertionError(
                `Record spec.id must be a non-empty string (got ${ toFriendlyString(spec.id) })`,
            );
        }
        if (!isPlainObject(spec.attributes)) {
            throw new AssertionError(
                `Record spec.attributes must be a plain object (got ${ toFriendlyString(spec.attributes) })`,
            );
        }

        this.#attributes = spec.attributes;

        Object.defineProperties(this, {
            /**
             * Record type managed by the owning collection.
             * @name type
             * @type {string}
             * @readonly
             */
            type: {
                value: spec.type,
                enumerable: true,
            },
            /**
             * Record identifier within the type.
             * @name id
             * @type {string}
             * @readonly
             */
            id: {
                value: spec.id,
                enumerable: true,
            },
        });
    }

    /**
     * Validates this record before persistence.
     *
     * Subclasses override this method and throw a ValidationError when the
     * current attributes violate record invariants.
     *
     * @returns {void}
     * @throws {ValidationError} When the record is not valid for persistence.
     */
    validate() { }

    /**
     * Builds a Record instance for the key/value-store write path.
     *
     * @param {Object} spec
     * @param {string} spec.type - Record type managed by the owning collection.
     * @param {string} spec.id - Record identifier (already derived or assigned).
     * @param {Object} spec.attributes - User-defined record attributes.
     * @returns {Record} Instance of the receiving Record class.
     * @throws {AssertionError} When `type`, `id`, or `attributes` are invalid.
     */
    static forWrite(spec) {
        const RecordClass = this;
        return new RecordClass({
            type: spec?.type,
            id: spec?.id,
            attributes: spec?.attributes,
        });
    }

    /**
     * Shallowly merges own enumerable attributes into this record.
     *
     * A `__proto__` key is ignored so untrusted JSON cannot mutate the
     * attributes object's prototype.
     *
     * @param {Object} patch - Attribute values to assign.
     * @returns {Record} This record for chaining.
     * @throws {TypeError} When patch is null or undefined.
     */
    merge(patch) {
        copyAttributes(this.#attributes, patch);
        return this;
    }

    /**
     * Deeply merges plain-object attributes into this record.
     * @param {Object} patch - Attribute values to merge.
     * @returns {Record} This record for chaining.
     * @throws {TypeError} When patch is not a plain object.
     */
    deepMerge(patch) {
        deepMerge(this.#attributes, patch);
        return this;
    }

    /**
     * Reads a user-defined attribute.
     * @param {string} name - Attribute name.
     * @returns {*} Attribute value, or undefined when absent.
     * @throws {AssertionError} When name is not a non-empty string.
     */
    get(name) {
        assertAttributeName(name, 'Record#get() attribute name');
        return this.#attributes[name];
    }

    /**
     * Sets a user-defined attribute.
     * @param {string} name - Attribute name.
     * @param {*} value - Attribute value.
     * @returns {Record} This record for chaining.
     * @throws {AssertionError} When name is not a non-empty string.
     */
    set(name, value) {
        assertAttributeName(name, 'Record#set() attribute name');
        this.#attributes[name] = value;
        return this;
    }

    /**
     * Reformats this record into the JSON value persisted by KeyValueStore.
     * @returns {Object} Record attributes plus `type` and `id`.
     */
    toDocument() {
        const record = copyAttributes({}, this.#attributes);
        record.type = this.type;
        record.id = this.id;
        return record;
    }

    /**
     * Reformats this record into a plain JavaScript Object.
     * @returns {Object} Record attributes plus `type` and `id`.
     */
    toObject() {
        const object = copyAttributes({}, this.#attributes);
        object.type = this.type;
        object.id = this.id;
        return object;
    }

    /**
     * Wraps a raw key/value-store JSON record in the receiving Record class.
     *
     * Stored `type` and `id` fields are metadata and are not copied into the
     * mutable user-defined attributes object.
     *
     * @param {Object} record - Raw JSON value returned by KeyValueStore.
     * @param {string} record.type - Record type.
     * @param {string} record.id - Record identifier.
     * @returns {Record} Record instance created from the raw stored value.
     * @throws {AssertionError} When the raw record shape is invalid.
     */
    static fromRecord(record) {
        const RecordClass = this;

        return new RecordClass({
            type: record?.type,
            id: record?.id,
            attributes: normalizeStoredAttributes(record),
        });
    }
}

function copyAttributes(target, source) {
    for (const key of Object.keys(source)) {
        // JSON payloads can carry this key; assigning it mutates the target prototype.
        if (key === '__proto__') {
            continue;
        }

        target[key] = source[key];
    }

    return target;
}

function normalizeStoredAttributes(record) {
    if (!isPlainObject(record)) {
        return record;
    }

    const attributes = {};

    for (const key of Object.keys(record)) {
        if (key === 'type' || key === 'id' || key === '__proto__') {
            continue;
        }

        attributes[key] = record[key];
    }

    return attributes;
}

function assertAttributeName(name, label) {
    if (!isNonEmptyString(name)) {
        throw new AssertionError(
            `${ label } must be a non-empty string (got ${ toFriendlyString(name) })`,
        );
    }
}
