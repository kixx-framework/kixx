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
 * Datastore
 * =========
 *
 * The Datastore class provides a high-level, document-oriented API for managing
 * persistent data using a file-based backend. It supports atomic operations,
 * optimistic concurrency control, revision tracking, and view-based querying.
 *
 * Core Features:
 *   - Atomic get/set/update/delete operations with revision (_rev) support
 *   - Optimistic concurrency control to prevent lost updates
 *   - Locking queue for safe concurrent access in async environments
 *   - Querying by key range or custom views, with pagination and sorting
 *   - Optionally pluggable backend (DatastoreEngine) and locking queue
 *
 * Usage Example:
 *   const store = new Datastore({ directory: '/data/db' });
 *   await store.load();
 *   await store.setItem('foo', { name: 'bar' });
 *   const doc = await store.getItem('foo');
 *   await store.deleteItem('foo');
 */
export default class Datastore {

    /**
     * @private
     * @type {DatastoreEngine|null}
     * The underlying database engine instance.
     */
    #db = null;

    /**
     * @private
     * @type {LockingQueue|null}
     * Locking queue for serializing async operations.
     */
    #lockingQueue = null;

    /**
     * Construct a new Datastore instance.
     *
     * @param {Object} options - Configuration options.
     * @param {string} [options.directory] - Directory path for storing data files.
     * @param {Object} [options.db] - Optional pre-configured database engine instance.
     * @param {Object} [options.lockingQueue] - Optional locking queue instance.
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
     * Load all documents from the underlying database engine.
     * Must be called before performing operations.
     *
     * @returns {Promise<Datastore>} The Datastore instance (for chaining).
     */
    async load() {
        await this.#db.loadDocuments();
        return this;
    }

    /**
     * Retrieve a document by key.
     *
     * @param {string|number} key - The document key.
     * @returns {Promise<Object|null>} The document (cloned), or null if not found.
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
     * Set (insert or update) a document by key.
     * Performs optimistic concurrency control using the _rev property.
     *
     * @param {string|number} key - The document key.
     * @param {Object} document - The document to store (must be a plain object).
     * @param {Object} [options] - Additional options.
     * @param {boolean} [options.checkConsistency=true] - If true, checks _rev for conflicts.
     * @returns {Promise<Object>} The stored document (with updated _rev).
     * @throws {AssertionError} If a revision conflict is detected.
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
     * Update a document by key using an update function.
     * The update function receives a clone of the current document (or undefined).
     * Performs optimistic concurrency control using the _rev property.
     *
     * @param {string|number} key - The document key.
     * @param {Function} updateFunction - Function that receives the current document and returns the updated document.
     * @param {Object} [options] - Additional options.
     * @param {boolean} [options.checkConsistency=true] - If true, checks _rev for conflicts.
     * @returns {Promise<Object>} The updated document (with updated _rev).
     * @throws {AssertionError} If a revision conflict is detected.
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
     * Delete a document by key.
     *
     * @param {string|number} key - The document key.
     * @returns {Promise<string|number>} The deleted key.
     */
    async deleteItem(key) {
        await this.getLock();
        await this.#db.deleteItem(key);
        this.releaseLock();
        return key;
    }

    /**
     * Query keys in the datastore.
     *
     * @param {Object} options - Query options.
     * @param {string|number} [options.startKey] - The start key for the query range.
     * @param {string|number} [options.endKey] - The end key for the query range.
     * @param {string|number} [options.key] - A specific key to query (overrides startKey and endKey).
     * @param {boolean} [options.descending=false] - Whether to sort the results in descending order.
     * @param {number} [options.inclusiveStartIndex=0] - The inclusive start index for pagination.
     * @param {number} [options.limit=10] - The maximum number of items to return.
     * @param {boolean} [options.includeDocuments=false] - Whether to include full documents in the results.
     * @returns {Promise<Object>} An object containing the query results:
     *   - exclusiveEndIndex: The exclusive end index for pagination.
     *   - items: Array of { key, [document] } objects.
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
     * Query a view in the datastore.
     *
     * @param {string} viewId - The ID of the view to query.
     * @param {Object} options - Query options.
     * @param {string|number} [options.startKey] - The start key for the query range.
     * @param {string|number} [options.endKey] - The end key for the query range.
     * @param {string|number} [options.key] - A specific key to query (overrides startKey and endKey).
     * @param {boolean} [options.descending=false] - Whether to sort the results in descending order.
     * @param {number} [options.inclusiveStartIndex=0] - The inclusive start index for pagination.
     * @param {number} [options.limit=10] - The maximum number of items to return.
     * @param {boolean} [options.includeDocuments=false] - Whether to include full documents in the results.
     * @returns {Promise<Object>} An object containing the query results:
     *   - exclusiveEndIndex: The exclusive end index for pagination.
     *   - items: Array of { key, [document] } objects.
     * @throws {WrappedError} If the specified view is not registered with the database.
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
     * Acquire the locking queue for atomic operations.
     * Used internally to serialize async access.
     *
     * @returns {Promise<void>}
     */
    async getLock() {
        if (this.#lockingQueue) {
            await this.#lockingQueue.getLock();
        }
    }

    /**
     * Release the locking queue after an atomic operation.
     * Used internally to serialize async access.
     */
    releaseLock() {
        if (this.#lockingQueue) {
            this.#lockingQueue.releaseLock();
        }
    }
}
