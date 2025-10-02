import { WrappedError, ConflictError, AssertionError } from '../errors/mod.js';
import DatastoreEngine from './datastore-engine.js';
import LockingQueue from './locking-queue.js';

import {
    isUndefined,
    isNumberNotNaN,
    assert
} from '../assertions/mod.js';


const DEFAULT_QUERY_LIMIT = 10;


/**
 * @typedef {Object} Document
 * @property {number} _rev - Revision number for optimistic concurrency control
 * @property {*} [*] - Any additional document properties
 */

/**
 * @typedef {Object} QueryResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {Array<Object>} items - Array of query result items
 * @property {string|number} items[].key - Document key
 * @property {Document} [items[].document] - Full document object (when includeDocuments is true)
 * @property {*} [items[].value] - Emitted value (only for view queries)
 */

/**
 * @typedef {Function} UpdateFunction
 * @param {Document|null} currentDocument - Current document or null if doesn't exist
 * @returns {Document|Promise<Document>} Updated document
 */

/**
 * @fileoverview High-level document database with optimistic concurrency control
 *
 * The Datastore class provides a document-oriented API for managing persistent
 * data using a file-based backend. It wraps the DatastoreEngine with additional
 * features like optimistic concurrency control, revision tracking, and async
 * operation serialization.
 *
 * Core Features:
 *   - Atomic CRUD operations with automatic revision (_rev) management
 *   - Optimistic concurrency control to prevent lost updates
 *   - Async operation serialization via LockingQueue
 *   - Key-range and view-based querying with pagination
 *   - In-memory caching for fast read/write performance
 *   - URL-encoded keys for safe filesystem storage
 */
export default class Datastore {

    /**
     * @private
     * @type {DatastoreEngine|null}
     * The underlying database engine that handles file I/O and indexing
     */
    #db = null;

    /**
     * @private
     * @type {LockingQueue|null}
     * Queue for serializing async operations to prevent race conditions
     */
    #lockingQueue = null;

    /**
     * Creates a new Datastore instance
     *
     * @param {Object} options - Configuration options
     * @param {string} [options.directory] - Directory path for storing data files
     * @param {DatastoreEngine} [options.db] - Pre-configured database engine instance for testing
     * @param {LockingQueue} [options.lockingQueue] - Custom locking queue instance for testing
     * @throws {AssertionError} When directory is not a non-empty string (if provided)
     */
    constructor(options = {}) {
        if (options.db) {
            this.#db = options.db;
        } else {
            this.#db = new DatastoreEngine(options);
        }
        if (options.lockingQueue) {
            this.#lockingQueue = options.lockingQueue;
        } else {
            this.#lockingQueue = new LockingQueue();
        }
    }

    /**
     * Loads all documents from disk into memory
     *
     * Must be called before performing any operations. This method loads the
     * entire dataset into application memory for fast access.
     *
     * @async
     * @returns {Promise<Datastore>} The Datastore instance for method chaining
     * @throws {Error} When directory cannot be read or contains invalid JSON files
     * @throws {Error} When concurrent modifications occur during loading
     */
    async load() {
        await this.#db.loadDocuments();
        return this;
    }

    /**
     * Retrieves a document by its key
     *
     * @async
     * @param {string|number} key - The document key
     * @returns {Promise<Document|null>} The document object (deep cloned) or null if not found
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async getItem(key) {
        const { document } = this.#db.getItem(key);
        if (document) {
            return structuredClone(document);
        }
        return null;
    }

    /**
     * Stores or updates a document by key with optimistic concurrency control
     *
     * Performs optimistic concurrency control using the _rev property. If the
     * checkConsistency flag is true and the document already exists and has been
     * modified since it was last read, the operation will fail with a revision
     * conflict error.
     *
     * @async
     * @param {string|number} key - The document key
     * @param {Object} document - The document to store (must be a plain object)
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.checkConsistency=true] - Whether to check for revision conflicts
     * @returns {Promise<Document>} The stored document with updated _rev property
     * @throws {AssertionError} When document is not a plain object or _rev is not an integer
     * @throws {AssertionError} When a revision conflict is detected (if checkConsistency is true)
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async setItem(key, doc, options = {}) {
        const checkConsistency = options.checkConsistency === false ? false : true;

        // Clone the document to avoid mutating the original object.
        const document = structuredClone(doc);

        await this.#lockingQueue.getLock(key);

        const existing = this.#db.getItem(key);

        let revision = 0;
        if (existing.document) {
            if (checkConsistency && !isUndefined(document._rev) && existing.document._rev !== document._rev) {
                this.#lockingQueue.releaseLock(key);
                throw new AssertionError(
                    `The document with key "${ key }" has been modified since it was last read.`,
                    { code: ConflictError.CODE }
                );
            }
            revision = existing.document._rev + 1;
        }

        // We can safely mutate the document because we cloned it earlier.
        document._rev = revision;

        await this.#db.setItem(key, document);

        this.#lockingQueue.releaseLock(key);

        return document;
    }

    /**
     * Updates a document using a function that receives the current document
     *
     * The update function receives a clone of the current document (or null
     * if the document doesn't exist) and should return the updated document.
     * Performs optimistic concurrency control using the _rev property.
     *
     * @async
     * @param {string|number} key - The document key
     * @param {UpdateFunction} updateFunction - Function that receives current document and returns updated document
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.checkConsistency=true] - Whether to check for revision conflicts
     * @returns {Promise<Document>} The updated document with updated _rev property
     * @throws {AssertionError} When _rev property is not an integer
     * @throws {AssertionError} When a revision conflict is detected (if checkConsistency is true)
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async updateItem(key, updateFunction, options = {}) {
        const checkConsistency = options.checkConsistency === false ? false : true;

        await this.#lockingQueue.getLock(key);

        const existing = this.#db.getItem(key);
        const doc = await updateFunction(structuredClone(existing.document));

        // Clone the document to avoid mutating the original object.
        const document = structuredClone(doc);

        let revision = 0;
        if (existing.document) {
            assert(Number.isInteger(existing.document._rev));
            if (checkConsistency && !isUndefined(document._rev) && existing.document._rev !== document._rev) {
                this.#lockingQueue.releaseLock(key);
                throw new AssertionError(
                    `The updated document with key "${ key }" does not match the expected revision.`,
                    { code: ConflictError.CODE }
                );
            }
            revision = existing.document._rev + 1;
        }

        document._rev = revision;

        await this.#db.setItem(key, document);

        this.#lockingQueue.releaseLock(key);

        return document;
    }

    /**
     * Removes a document from the datastore
     *
     * @async
     * @param {string|number} key - The document key to delete
     * @returns {Promise<string|number>} The deleted key
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async deleteItem(key) {
        await this.#lockingQueue.getLock(key);
        await this.#db.deleteItem(key);
        this.#lockingQueue.releaseLock(key);
        return key;
    }

    /**
     * Queries documents by key range with pagination support
     *
     * @async
     * @param {Object} options - Query parameters
     * @param {string|number} [options.startKey] - Inclusive start of key range
     * @param {string|number} [options.endKey] - Inclusive end of key range
     * @param {string|number} [options.key] - Exact key to match (overrides startKey/endKey)
     * @param {boolean} [options.descending=false] - Whether to sort results in descending order
     * @param {number} [options.inclusiveStartIndex=0] - Zero-based start index for pagination
     * @param {number} [options.limit=10] - Maximum number of items to return
     * @param {boolean} [options.includeDocuments=false] - Whether to include full document objects
     * @returns {Promise<QueryResult>} Query results with pagination information
     */
    async queryKeys(options) {
        options = options || {};

        const {
            startKey,
            endKey,
            key,
        } = options;

        const descending = Boolean(options.descending);

        const limit = isNumberNotNaN(options.limit)
            ? options.limit
            : DEFAULT_QUERY_LIMIT;

        const inclusiveStartIndex = isNumberNotNaN(options.inclusiveStartIndex)
            ? options.inclusiveStartIndex
            : 0;

        const includeDocuments = Boolean(options.includeDocuments);

        const result = this.#db.queryKeys({
            startKey,
            endKey,
            key,
            descending,
            inclusiveStartIndex,
            limit,
            includeDocuments,
        });

        const { exclusiveEndIndex, items } = result;

        if (includeDocuments) {
            for (const item of items) {
                item.document = structuredClone(item.document);
            }
        }

        return { exclusiveEndIndex, items };
    }

    /**
     * Queries a view with key range and pagination support
     *
     * Views provide custom indexing of documents using map functions. Each view
     * can emit multiple key-value pairs per document, enabling complex queries
     * like "all documents by type" or "all documents by date range".
     *
     * @async
     * @param {string} viewId - Registered view identifier
     * @param {Object} options - Query parameters
     * @param {string|number} [options.startKey] - Inclusive start of key range
     * @param {string|number} [options.endKey] - Inclusive end of key range
     * @param {string|number} [options.key] - Exact key to match (overrides startKey/endKey)
     * @param {boolean} [options.descending=false] - Whether to sort results in descending order
     * @param {number} [options.inclusiveStartIndex=0] - Zero-based start index for pagination
     * @param {number} [options.limit=10] - Maximum number of items to return
     * @param {boolean} [options.includeDocuments=false] - Whether to include full document objects
     * @returns {Promise<QueryResult>} Query results with pagination information
     * @throws {WrappedError} When the specified view is not registered with the database
     */
    async queryView(viewId, options = {}) {
        if (!this.#db.hasView(viewId)) {
            throw new WrappedError(
                `The view "${ viewId }" is not registered with this database`,
                null,
                this.queryView
            );
        }

        options = options || {};

        const {
            startKey,
            endKey,
            key,
        } = options;

        const descending = Boolean(options.descending);

        const limit = isNumberNotNaN(options.limit)
            ? options.limit
            : DEFAULT_QUERY_LIMIT;

        const inclusiveStartIndex = isNumberNotNaN(options.inclusiveStartIndex)
            ? options.inclusiveStartIndex
            : 0;

        const includeDocuments = Boolean(options.includeDocuments);

        const result = this.#db.queryView(viewId, {
            startKey,
            endKey,
            key,
            descending,
            inclusiveStartIndex,
            limit,
            includeDocuments,
        });

        const { exclusiveEndIndex, items } = result;

        if (includeDocuments) {
            for (const item of items) {
                item.document = structuredClone(item.document);
            }
        }

        return { exclusiveEndIndex, items };
    }
}
