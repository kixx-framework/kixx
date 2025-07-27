import { WrappedError, ConflictError, AssertionError } from '../errors/mod.js';
import DatastoreEngine from './datastore-engine.js';
import LockingQueue from '../lib/locking-queue.js';

import {
    isUndefined,
    isNumberNotNaN,
    isPlainObject,
    assert
} from '../assertions/mod.js';


const DEFAULT_QUERY_LIMIT = 10;


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
     */
    constructor(options = {}) {
        if (options.db) {
            this.#db = options.db;
        } else {
            this.#db = new DatastoreEngine(options);
        }
        if (!isUndefined(options.lockingQueue)) {
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
     * @returns {Promise<Object|null>} The document object (deep cloned) or null if not found
     */
    async getItem(key) {
        // Ensure existing async operations are completed before proceeding.
        await this.getLock();
        this.releaseLock();

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
     * document already exists and has been modified since it was last read,
     * the operation will fail with a revision conflict.
     *
     * @async
     * @param {string|number} key - The document key
     * @param {Object} document - The document to store (must be a plain object)
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.checkConsistency=true] - Whether to check for revision conflicts
     * @returns {Promise<Object>} The stored document with updated _rev property
     * @throws {AssertionError} When document is not a plain object or _rev is not an integer
     * @throws {AssertionError} When a revision conflict is detected (if checkConsistency is true)
     */
    async setItem(key, document, options = {}) {
        const checkConsistency = options.checkConsistency === false ? false : true;

        // We make some assumptions about the document structure.
        // Ex. If the document is an Array, we can't assign the _rev property to it.
        assert(isPlainObject(document), 'The document must be a plain object');

        if (!isUndefined(document._rev)) {
            assert(Number.isInteger(document._rev), 'The document _rev must be an integer');
        }

        // Clone the document to avoid mutating the original object.
        document = structuredClone(document);

        await this.getLock();

        const existing = this.#db.getItem(key);

        let revision = 0;
        if (existing.document) {
            if (checkConsistency && existing.document._rev !== document._rev) {
                this.releaseLock();
                throw new AssertionError(
                    `The document with key "${ key }" has been modified since it was last read.`,
                    { code: ConflictError.CODE }
                );
            }
            revision = existing.document._rev + 1;
        }

        // We can safely mutate the document because we cloned it earlier.
        // eslint-disable-next-line require-atomic-updates
        document._rev = revision;

        await this.#db.setItem(key, structuredClone(document));

        this.releaseLock();

        return document;
    }

    /**
     * Updates a document using a function that receives the current document
     *
     * The update function receives a clone of the current document (or undefined
     * if the document doesn't exist) and should return the updated document.
     * Performs optimistic concurrency control using the _rev property.
     *
     * @async
     * @param {string|number} key - The document key
     * @param {Function} updateFunction - Function that receives current document and returns updated document
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.checkConsistency=true] - Whether to check for revision conflicts
     * @returns {Promise<Object>} The updated document with updated _rev property
     * @throws {AssertionError} When _rev property is not an integer
     * @throws {AssertionError} When a revision conflict is detected (if checkConsistency is true)
     */
    async updateItem(key, updateFunction, options = {}) {
        const checkConsistency = options.checkConsistency === false ? false : true;

        await this.getLock();

        const existing = this.#db.getItem(key);
        const document = await updateFunction(structuredClone(existing.document));

        if (!isUndefined(document._rev)) {
            assert(Number.isInteger(document._rev), 'The document _rev must be an integer');
        }

        let revision = 0;
        if (existing.document) {
            assert(Number.isInteger(existing.document._rev));
            if (checkConsistency && existing.document._rev !== document._rev) {
                this.releaseLock();
                throw new AssertionError(
                    `The updated document with key "${ key }" does not match the expected revision.`,
                    { code: ConflictError.CODE }
                );
            }
            revision = existing.document._rev + 1;
        }

        document._rev = revision;

        await this.#db.setItem(key, structuredClone(document));

        this.releaseLock();

        return document;
    }

    /**
     * Removes a document from the datastore
     *
     * @async
     * @param {string|number} key - The document key to delete
     * @returns {Promise<string|number>} The deleted key
     */
    async deleteItem(key) {
        await this.getLock();
        await this.#db.deleteItem(key);
        this.releaseLock();
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
     * @returns {Promise<Object>} Query results with pagination information:
     *   - exclusiveEndIndex: Index for next page, or null if no more results
     *   - items: Array of { key, [document] } objects
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

        // Ensure existing async operations are completed before proceeding.
        await this.getLock();
        this.releaseLock();

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
     * @returns {Promise<Object>} Query results with pagination information:
     *   - exclusiveEndIndex: Index for next page, or null if no more results
     *   - items: Array of { key, value, [document] } objects
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

        // Ensure existing async operations are completed before proceeding.
        await this.getLock();
        this.releaseLock();

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

    /**
     * Acquires the locking queue for atomic operations
     *
     * Used internally to serialize async access and prevent race conditions
     * during concurrent operations.
     *
     * @async
     * @returns {Promise<void>}
     */
    async getLock() {
        if (this.#lockingQueue) {
            await this.#lockingQueue.getLock();
        }
    }

    /**
     * Releases the locking queue after an atomic operation
     *
     * Used internally to serialize async access and prevent race conditions
     * during concurrent operations.
     */
    releaseLock() {
        if (this.#lockingQueue) {
            this.#lockingQueue.releaseLock();
        }
    }
}
