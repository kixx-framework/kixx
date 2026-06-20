import deepMerge from '../../kixx/utils/deep-merge.js';
import {
    AssertionError,
    isNonEmptyString,
    isObjectNotNull,
    isPlainObject,
    isValidDate,
    toFriendlyString,
} from '../../kixx/assertions/mod.js';


/**
 * @typedef {Object} RecordSpec
 * @property {string} type - Document type managed by the owning collection.
 * @property {string} id - Document identifier within the type.
 * @property {number} version - Optimistic concurrency version returned by the document store.
 * @property {Date} createdAt - Date from the document store.
 * @property {Date} updatedAt - Date from the document store.
 * @property {Object} attributes - Plain object containing user-defined document attributes.
 */

/**
 * Mutable DTO wrapping a document-store record for collection callers.
 *
 * User-defined attributes are held in a private `#attributes` slot. Callers
 * read and write attributes through `get`, `set`, `merge`, and `deepMerge`;
 * subclasses expose domain-specific getters by delegating to `this.get(name)`.
 */
export default class Record {

    #attributes;

    /**
     * @param {RecordSpec} spec - Stored record data and user-defined attributes.
     * @throws {AssertionError} When the spec shape or timestamp fields are invalid.
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
        if (!Number.isInteger(spec.version)) {
            throw new AssertionError(
                `Record spec.version must be an integer (got ${ toFriendlyString(spec.version) })`,
            );
        }
        if (!isPlainObject(spec.attributes)) {
            throw new AssertionError(
                `Record spec.attributes must be a plain object (got ${ toFriendlyString(spec.attributes) })`,
            );
        }

        this.#attributes = spec.attributes;

        const createdAt = new Date(spec.createdAt);
        const updatedAt = new Date(spec.updatedAt);

        if (!isValidDate(createdAt)) {
            throw new AssertionError(
                `Record spec.createdAt must be a parsable date string (got ${ toFriendlyString(spec.createdAt) })`,
            );
        }
        if (!isValidDate(updatedAt)) {
            throw new AssertionError(
                `Record spec.updatedAt must be a parsable date string (got ${ toFriendlyString(spec.updatedAt) })`,
            );
        }

        Object.defineProperties(this, {
            /**
             * Document type managed by the owning collection.
             * @name type
             * @type {string}
             * @readonly
             */
            type: {
                value: spec.type,
                enumerable: true,
            },
            /**
             * Document identifier within the type.
             * @name id
             * @type {string}
             * @readonly
             */
            id: {
                value: spec.id,
                enumerable: true,
            },
            /**
             * Optimistic concurrency version returned by the document store.
             * @name version
             * @type {number}
             * @readonly
             */
            version: {
                value: spec.version,
                enumerable: true,
            },
            /**
             * Creation timestamp returned by the document store.
             * @name createdAt
             * @type {Date}
             * @readonly
             */
            createdAt: {
                value: createdAt,
                enumerable: true,
            },
            /**
             * Last update timestamp returned by the document store.
             * @name updatedAt
             * @type {Date}
             * @readonly
             */
            updatedAt: {
                value: updatedAt,
                enumerable: true,
            },
        });
    }

    /**
     * Subclasses should override validate() and throw a ValidationError
     * when appropriate.
     */
    validate() { }

    /**
     * Returns a content-derived id for a new record, or null when this record
     * type uses an opaque id assigned by the gateway.
     *
     * Subclasses override this when identity is a domain fact (e.g., username,
     * slug, content hash). The default returns null so the owning Collection
     * falls back to its own `generateUniqueId()`.
     *
     * Runs against a plain attributes object before any Record instance exists,
     * so it must be implemented as a static method and must not depend on
     * Record instance state.
     *
     * @param {Object} _attributes - Attributes the new record is being built from.
     * @returns {string|null}
     */
    static deriveId(_attributes) {
        return null;
    }

    /**
     * Builds a Record instance for the write path, before the document store
     * has assigned version and timestamps.
     *
     * Returns an instance of the receiving Record subclass with placeholder
     * store metadata. Callers use `toDocument()` to extract the write payload;
     * the placeholders never escape the gateway because Collection always
     * re-wraps the stored record via `fromRecord()` on return.
     *
     * @param {Object} spec
     * @param {string} spec.type - Document type managed by the owning collection.
     * @param {string} spec.id - Document identifier (already derived or assigned).
     * @param {Object} spec.attributes - User-defined document attributes.
     * @returns {Record} Instance of the receiving Record class.
     * @throws {AssertionError} When `type`, `id`, or `attributes` are invalid.
     */
    static forWrite(spec) {
        const RecordClass = this;
        const placeholder = new Date(0).toISOString();
        return new RecordClass({
            type: spec?.type,
            id: spec?.id,
            version: 0,
            createdAt: placeholder,
            updatedAt: placeholder,
            attributes: spec?.attributes,
        });
    }

    /**
     * Shallowly merges attributes into this record.
     * @param {Object} patch - Attribute values to assign.
     * @returns {Record} This record for chaining.
     */
    merge(patch) {
        Object.assign(this.#attributes, patch);
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
     * Reformats this record into the document shape accepted by DocumentStore.
     * @returns {Object} Document attributes plus `type` and `id`.
     */
    toDocument() {
        return Object.assign({}, this.#attributes, {
            type: this.type,
            id: this.id,
        });
    }

    /**
     * Reformats this record into a plain JavaScript Object, flattening the
     * attributes into top level properties, with store metadata under `meta`.
     * @returns {Object} Document attributes plus `type`, `id`, and `meta`.
     */
    toObject() {
        return Object.assign({}, this.#attributes, {
            type: this.type,
            id: this.id,
            meta: {
                version: this.version,
                createdAt: this.createdAt,
                updatedAt: this.updatedAt,
            },
        });
    }

    /**
     * Wraps a raw document-store record in the receiving Record class.
     * @param {Object} record - Raw record returned by DocumentStore.
     * @param {string} record.type - Document type.
     * @param {string} record.id - Document identifier.
     * @param {number} record.version - Optimistic concurrency version.
     * @param {string} record.createdAt - Creation timestamp.
     * @param {string} record.updatedAt - Last update timestamp.
     * @param {Object} record.doc - Stored document payload.
     * @returns {Record} Record instance created from the raw store record.
     * @throws {AssertionError} When the raw record shape is invalid.
     */
    static fromRecord(record) {
        const RecordClass = this;

        return new RecordClass({
            type: record.type,
            id: record.id,
            version: record.version,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            attributes: record.doc,
        });
    }
}

function assertAttributeName(name, label) {
    if (!isNonEmptyString(name)) {
        throw new AssertionError(
            `${ label } must be a non-empty string (got ${ toFriendlyString(name) })`,
        );
    }
}
