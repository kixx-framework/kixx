import path from 'node:path';
import { WrappedError, ConflictError, AssertionError } from '../errors/mod.js';
import LockingQueue from './locking-queue.js';
import * as fileSystem from './file-system.js';

import {
    sortIndexListAscending,
    sortIndexListDescending,
    getAscendingIndexRange,
    getDescendingIndexRange
} from './binary-search.js';

import {
    isFunction,
    isUndefined,
    isNumberNotNaN,
    isNonEmptyString,
    assertNonEmptyString
} from '../assertions/mod.js';


import { ALPHA, OMEGA } from '../lib/constants.js';

const DEFAULT_QUERY_LIMIT = 10;


/**
 * @typedef {Object} ViewSource
 * @property {Function} map - Map function that receives (document, emit) parameters
 */

/**
 * @typedef {Object} IndexItem
 * @property {string|number} key - Index key
 * @property {*} [value] - Optional value associated with the key
 * @property {string} documentKey - Primary key of the source document
 * @property {Object} [document] - Full document object (only included if includeDocuments=true)
 */

/**
 * @typedef {Object} QueryResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {IndexItem[]} items - Array of matching items
 */

/**
 * @typedef {Object} ScanResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {Object[]} documents - Array of matching document objects
 */

/**
 * File-based document store with CouchDB-style views and indexing.
 *
 * Provides CRUD operations for JSON documents stored as individual files, with support
 * for secondary indexes via map/emit views. Documents are stored in memory for fast access
 * and persisted to disk as JSON files. Uses optimistic locking (_rev field) to detect
 * concurrent modifications.
 *
 * Key features:
 * - Atomic operations using per-document locks
 * - Secondary indexes with flexible map/emit pattern
 * - Pagination support for large result sets
 * - Binary search for efficient range queries
 */
export default class LocalFileDatastore {

    /**
     * Queue providing per-document locking for atomic operations
     * @type {LockingQueue}
     */
    #lockingQueue = null;

    /**
     * File system abstraction for reading/writing document files
     * @type {Object}
     */
    #fileSystem = null;

    /**
     * Directory path where document JSON files are stored
     * @type {string}
     */
    #directory = null;

    /**
     * Registry of view definitions for secondary indexes
     * @type {Map<string, ViewSource>}
     */
    #views = new Map();

    /**
     * In-memory cache of all documents keyed by primary key
     * @type {Map<string, Object>}
     */
    #documentsMap = new Map();

    /**
     * Creates a new LocalFileDatastore instance.
     * @param {Object} options - Configuration options
     * @param {string} options.directory - Directory path where document files will be stored
     * @param {LockingQueue} [options.lockingQueue] - Custom locking queue instance (defaults to new LockingQueue)
     * @param {Object} [options.fileSystem] - Custom file system implementation (defaults to built-in file-system module)
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options) {
        options = options || {};

        assertNonEmptyString(options.directory);

        this.#directory = options.directory;
        this.#lockingQueue = options.lockingQueue || new LockingQueue();
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    setView(key, view) {
        view = view || {};
        if (!isFunction(view.map)) {
            throw new AssertionError('A datastore View must have a map() function', null, this.setView);
        }
        this.#views.set(key, view);
    }

    /**
     * Loads all document files from the directory into memory.
     *
     * !WARNING: The initialize process must be completed before using
     * a LocalFileDatastore instance.
     * @async
     * @public
     * @returns {Promise<void>}
     * @throws {WrappedError} When directory doesn't exist or cannot be read
     */
    async initialize() {
        let files;

        try {
            files = await this.#fileSystem.readDirectory(this.#directory);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while reading the LocalFileDatastore directory (${ this.#directory })`,
                { cause },
                this.initialize
            );
        }

        // Ensure we are dealing with actual files.
        const filepaths = files.filter((file) => file.isFile()).map((file) => {
            return path.join(this.#directory, file.name);
        });

        // Load files in batches to avoid exceeding the OS open file limit (typically 256-1024
        // on most systems). Batch size of 50 provides a safety margin while still allowing
        // parallel I/O within each batch for faster initialization on large datastores
        const batches = [];
        const batchSize = 50;

        for (let i = 0; i < filepaths.length; i += batchSize) {
            batches.push(filepaths.slice(i, i + batchSize));
        }

        for (const batch of batches) {
            const promises = batch.map(this.#loadDocumentFromFilepath.bind(this));
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(promises);
        }
    }

    /**
     * Retrieves a document by type and ID.
     * @async
     * @public
     * @param {string} type - Document type identifier
     * @param {string} id - Document ID
     * @returns {Promise<Object|null>} Cloned document object or null if not found
     * @throws {AssertionError} When type or id are not non-empty strings
     */
    async getItem(type, id) {
        if (!isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#getItem()', null, this.getItem);
        }
        if (!isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#getItem()', null, this.getItem);
        }

        const key = this.#createPrimaryKey(type, id);

        if (this.#documentsMap.has(key)) {
            return structuredClone(this.#documentsMap.get(key));
        }

        return null;
    }

    /**
     * Creates or updates a document with optimistic locking support.
     * @async
     * @public
     * @param {Object} document - Document to save
     * @param {string} document.type - Document type identifier
     * @param {string} document.id - Document ID
     * @param {number} [document._rev] - Current revision number (for consistency checking)
     * @param {Object} [options] - Save options
     * @param {boolean} [options.checkConsistency=true] - Whether to verify _rev matches before updating
     * @returns {Promise<Object>} Saved document with updated _rev field
     * @throws {AssertionError} When type or id are not non-empty strings
     * @throws {ConflictError} When checkConsistency is true and _rev doesn't match stored revision
     * @throws {WrappedError} When file write operation fails
     */
    async setItem(document, options = {}) {
        const { type, id } = document || {};

        if (!isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#setItem()', null, this.setItem);
        }
        if (!isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#setItem()', null, this.setItem);
        }

        const key = this.#createPrimaryKey(type, id);

        const checkConsistency = options.checkConsistency === false ? false : true;

        await this.#lockingQueue.getLock(key);

        try {
            let existingDocument = null;
            if (this.#documentsMap.has(key)) {
                existingDocument = this.#documentsMap.get(key);
            }

            // Clone the document to avoid mutating or caching the original object.
            const doc = structuredClone(document);

            // Implement optimistic locking using _rev (revision) field
            // _rev increments on each write, allowing detection of concurrent modifications
            doc._rev = 0;
            if (existingDocument && isNumberNotNaN(existingDocument._rev)) {
                // Check if document._rev exists and matches current stored revision
                // This ensures the caller's version is based on the latest data
                if (checkConsistency && !isUndefined(document._rev) && existingDocument._rev !== document._rev) {
                    throw new AssertionError(
                        `The document with key "${ key }" has been modified since it was last read.`,
                        { code: ConflictError.CODE },
                        this.setItem
                    );
                }
                doc._rev = existingDocument._rev + 1;
            }

            await this.#writeDocument(key, doc);

            // Update memory only after successful disk write
            // This ensures durability: if disk write fails, memory state remains consistent
            // with what's on disk, and the error propagates to the caller
            this.#documentsMap.set(key, doc);

            return doc;
        } finally {
            this.#lockingQueue.releaseLock(key);
        }
    }

    /**
     * Deletes a document by type and ID.
     * @async
     * @public
     * @param {string} type - Document type identifier
     * @param {string} id - Document ID
     * @returns {Promise<Object>} Object with deleted document's type and id
     * @throws {AssertionError} When type or id are not non-empty strings
     * @throws {WrappedError} When file deletion fails
     */
    async deleteItem(type, id) {
        if (!isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#deleteItem()', null, this.deleteItem);
        }
        if (!isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#deleteItem()', null, this.deleteItem);
        }

        const key = this.#createPrimaryKey(type, id);

        await this.#lockingQueue.getLock(key);

        try {
            // Remove from disk first - if deletion fails, document remains in both places,
            // maintaining consistency between disk and memory. This is safer than removing
            // from memory first, which could leave orphaned files on disk
            await this.#removeDocument(key);

            // Remove from memory only after successful disk deletion
            this.#documentsMap.delete(key);

            return { type, id };
        } finally {
            this.#lockingQueue.releaseLock(key);
        }
    }

    /**
     * Scans documents of a specific type with optional range and pagination.
     * @async
     * @public
     * @param {string} type - Document type to scan
     * @param {Object} [options] - Query parameters
     * @param {string} [options.startKey] - Inclusive start of ID range
     * @param {string} [options.endKey] - Inclusive end of ID range
     * @param {boolean} [options.descending=false] - Whether to sort results in descending order
     * @param {number} [options.inclusiveStartIndex=0] - Zero-based start index for pagination
     * @param {number} [options.limit=10] - Maximum number of items to return
     * @returns {Promise<ScanResult>} Query results with pagination information
     * @throws {AssertionError} When type is not a non-empty string
     */
    async scanItems(type, options) {
        if (!isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#scanItems()', null, this.scanItems);
        }

        options = options || {};

        const limit = isNumberNotNaN(options.limit)
            ? options.limit
            : DEFAULT_QUERY_LIMIT;

        const inclusiveStartIndex = isNumberNotNaN(options.inclusiveStartIndex)
            ? options.inclusiveStartIndex
            : 0;

        const descending = Boolean(options.descending);

        let startKey;
        let endKey;

        if (options.startKey) {
            startKey = this.#createPrimaryKey(type, options.startKey);
        } else {
            // ALPHA and OMEGA are special boundary values (highest/lowest possible strings)
            // that allow open-ended range scans. For descending order, we start at OMEGA
            // (highest) and go down; for ascending, we start at ALPHA (lowest) and go up
            startKey = this.#createPrimaryKey(type, descending ? OMEGA : ALPHA);
        }

        if (options.endKey) {
            endKey = this.#createPrimaryKey(type, options.endKey);
        } else {
            // ALPHA and OMEGA are special boundary values (highest/lowest possible strings)
            // For descending order, end at ALPHA (lowest); for ascending, end at OMEGA (highest)
            endKey = this.#createPrimaryKey(type, descending ? ALPHA : OMEGA);
        }

        // Build index in memory each time to avoid staleness - this trades CPU cycles
        // for simplicity and correctness. The alternative (maintaining sorted indexes)
        // would require complex logic to keep indexes in sync with document changes,
        // introducing potential for bugs and memory overhead
        const index = this.#mapDocumentKeys();
        if (descending) {
            index.sort(sortIndexListDescending);
        } else {
            index.sort(sortIndexListAscending);
        }

        let range;
        if (descending) {
            range = getDescendingIndexRange(index, startKey, endKey);
        } else {
            range = getAscendingIndexRange(index, startKey, endKey);
        }

        let documents = [];
        let exclusiveEndIndex = null;

        // Guard against pagination beyond available data
        if (inclusiveStartIndex >= range.length) {
            return { exclusiveEndIndex, documents };
        }

        const items = range.slice(inclusiveStartIndex, inclusiveStartIndex + limit);

        if ((inclusiveStartIndex + items.length) < range.length) {
            exclusiveEndIndex = inclusiveStartIndex + limit;
        }

        documents = items.map(({ key }) => {
            return structuredClone(this.#documentsMap.get(key));
        });

        return { exclusiveEndIndex, documents };
    }

    /**
     * Queries a secondary index using a registered view.
     * @async
     * @public
     * @param {string} viewId - Registered view identifier
     * @param {Object} [options] - Query parameters
     * @param {string|number} [options.startKey] - Inclusive start of key range
     * @param {string|number} [options.endKey] - Inclusive end of key range
     * @param {string|number} [options.key] - Exact key to match (overrides startKey/endKey)
     * @param {boolean} [options.descending=false] - Whether to sort results in descending order
     * @param {number} [options.inclusiveStartIndex=0] - Zero-based start index for pagination
     * @param {number} [options.limit=10] - Maximum number of items to return
     * @param {boolean} [options.includeDocuments=false] - Whether to include full document objects in results
     * @returns {Promise<QueryResult>} Query results with pagination information
     * @throws {AssertionError} When the specified view is not registered
     */
    async queryView(viewId, options = {}) {
        if (!this.#views.has(viewId)) {
            throw new AssertionError(
                `The view "${ viewId }" is not registered with this database`,
                null,
                this.queryView
            );
        }

        options = options || {};

        const limit = isNumberNotNaN(options.limit)
            ? options.limit
            : DEFAULT_QUERY_LIMIT;

        const inclusiveStartIndex = isNumberNotNaN(options.inclusiveStartIndex)
            ? options.inclusiveStartIndex
            : 0;

        const includeDocuments = Boolean(options.includeDocuments);

        const descending = Boolean(options.descending);

        let startKey = options.startKey;
        let endKey = options.endKey;

        // If a singular key was provided, then set the start and end keys to the same, which
        // takes advantage of the inclusive index search.
        if (options.key) {
            startKey = options.key;
            endKey = options.key;
        }

        // Default to full range scan when bounds not specified
        // ALPHA/OMEGA provide open-ended boundaries for scanning entire index
        if (isUndefined(startKey)) {
            startKey = descending ? OMEGA : ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = descending ? ALPHA : OMEGA;
        }

        // Build index in memory each time to avoid staleness - indexes always reflect
        // current document state without complex invalidation logic. This trades CPU
        // (re-sorting on each query) for simplicity and correctness
        let index;
        try {
            index = this.#mapViewDocuments(this.#views.get(viewId), includeDocuments);
        } catch (cause) {
            throw new WrappedError(`Error in View "${ viewId }" map() function`, { cause }, this.queryView);
        }

        if (descending) {
            index.sort(sortIndexListDescending);
        } else {
            index.sort(sortIndexListAscending);
        }

        let range;
        if (descending) {
            range = getDescendingIndexRange(index, startKey, endKey);
        } else {
            range = getAscendingIndexRange(index, startKey, endKey);
        }

        let items = [];
        let exclusiveEndIndex = null;

        // Guard against pagination beyond available data
        if (inclusiveStartIndex >= range.length) {
            return { exclusiveEndIndex, items };
        }

        items = range.slice(inclusiveStartIndex, inclusiveStartIndex + limit);

        if ((inclusiveStartIndex + items.length) < range.length) {
            exclusiveEndIndex = inclusiveStartIndex + limit;
        }

        return { exclusiveEndIndex, items };
    }

    /**
     * Builds an array of index entries from all document primary keys.
     * @returns {Array<{key: string}>} Array of objects with key property
     */
    #mapDocumentKeys() {
        const index = [];
        for (const key of this.#documentsMap.keys()) {
            index.push({ key });
        }
        return index;
    }

    /**
     * Builds a secondary index by applying a view's map function to all documents.
     * @param {ViewSource} view - View definition with map function
     * @param {boolean} includeDocuments - Flag to include the full documents
     * @returns {IndexItem[]} Array of index items emitted by the map function
     */
    #mapViewDocuments(view, includeDocuments) {
        const index = [];

        for (const document of this.#documentsMap.values()) {
            // CouchDB-style map/emit pattern: the view's map function receives each document
            // and an emit() callback. The map function can call emit(key, value) zero or more
            // times per document, enabling:
            // - Filtering (emit nothing for documents that don't match)
            // - One-to-many indexing (emit multiple entries for array fields)
            // - Computed indexes (emit calculated values like fullName = firstName + lastName)
            view.map(document, function emit(key, value) {
                const { type, id } = document;

                const item = {
                    key,
                    value,
                    type,
                    id,
                };

                if (includeDocuments) {
                    item.document = document;
                }

                index.push(item);
            });
        }

        return index;
    }

    /**
     * Loads a single document from a file and adds it to the in-memory cache.
     * @async
     * @param {string} filepath - Absolute file path to the document
     * @returns {Promise<void>}
     * @throws {WrappedError} When file cannot be read or parsed
     */
    async #loadDocumentFromFilepath(filepath) {
        let document;
        try {
            document = await this.#fileSystem.readDocumentFile(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while reading LocalFileDatastore file (${ filepath })`,
                { cause }
            );
        }

        if (document) {
            const encodedKey = path.basename(filepath, '.json');
            const key = decodeURIComponent(encodedKey);

            this.#documentsMap.set(key, document);
        }
    }

    /**
     * Writes a document to disk as a JSON file.
     * @async
     * @param {string} key - Primary key of the document
     * @param {Object} doc - Document object to write
     * @returns {Promise<void>}
     * @throws {WrappedError} When file write operation fails
     */
    async #writeDocument(key, doc) {
        const filepath = this.#getDocumentFilepath(key);

        try {
            await this.#fileSystem.writeDocumentFile(filepath, doc);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while writing LocalFileDatastore file (${ filepath })`,
                { cause }
            );
        }
    }

    /**
     * Removes a document file from disk.
     * @async
     * @param {string} key - Primary key of the document to remove
     * @returns {Promise<void>}
     * @throws {WrappedError} When file deletion fails
     */
    async #removeDocument(key, doc) {
        const filepath = this.#getDocumentFilepath(key);

        try {
            await this.#fileSystem.removeDocumentFile(filepath, doc);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while removing LocalFileDatastore file (${ filepath })`,
                { cause }
            );
        }
    }

    /**
     * Creates a primary key from document type and ID.
     * @param {string} type - Document type
     * @param {string} id - Document ID
     * @returns {string} Primary key in format "type__id"
     */
    #createPrimaryKey(type, id) {
        // Format: "TypeName__itemId" (e.g., "User__123", "Post__abc")
        // Double underscore (__) chosen as separator because it's unlikely to appear
        // in type names and provides clear visual separation
        return `${ type }__${ id }`;
    }

    /**
     * Converts a document key to a safe filesystem path.
     * @param {string} key - Primary key of the document
     * @returns {string} Absolute path to the document's JSON file
     */
    #getDocumentFilepath(key) {
        // URL-encode keys to safely handle special characters like '/', ':', etc.
        // This prevents directory traversal attacks (if keys contain '../') and ensures
        // valid filenames across all platforms (Windows, Mac, Linux have different rules).
        // Example: "User__123/admin" becomes "User__123%2Fadmin.json"
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }
}
