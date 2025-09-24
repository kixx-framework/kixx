/**
 * @fileoverview Document storage engine with file-based persistence and view indexing
 *
 * This module provides a simple document database that stores JSON documents as files
 * on disk, with support for CouchDB-style views and efficient key-based queries.
 * Documents are loaded into memory for fast access, making this suitable for
 * small to medium datasets.
 *
 * @module datastore-engine
 */

import path from 'node:path';
import { ALPHA, OMEGA } from '../lib/constants.js';
import * as fileSystem from './file-system.js';

import {
    isUndefined,
    assert,
    assertNumberNotNaN,
    assertNonEmptyString
} from '../assertions/mod.js';


/**
 * @typedef {Object} DocumentResult
 * @property {string} key - Document key
 * @property {Object|null} document - Document object or null if not found
 */

/**
 * @typedef {Object} ViewSource
 * @property {Function} map - Map function that receives (document, emit) parameters
 * @property {Function} map.document - Document object to process
 * @property {Function} map.emit - Callback function to emit index entries
 * @property {Function} map.emit.key - Index key to emit
 * @property {Function} map.emit.value - Optional value to associate with the key
 */

/**
 * @typedef {Object} IndexItem
 * @property {string} key - Index key (same as documentKey for document queries, or emitted key for views)
 * @property {string} documentKey - Original document key
 * @property {*} [value] - Emitted value (only present for view queries)
 * @property {Object} [document] - Full document object (only when includeDocuments is true)
 */

/**
 * @typedef {Object} QueryOptions
 * @property {string} [key] - Exact key to match (overrides startKey/endKey)
 * @property {boolean} [descending=false] - Whether to sort results in descending order
 * @property {number} inclusiveStartIndex - Zero-based start index for pagination
 * @property {number} limit - Maximum number of results to return
 * @property {boolean} [includeDocuments=false] - Whether to include full document objects
 * @property {string} [startKey] - Inclusive start of key range
 * @property {string} [endKey] - Inclusive end of key range
 */

/**
 * @typedef {Object} QueryResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {IndexItem[]} items - Array of matching items
 */

/**
 * File-based document storage engine with in-memory indexing
 *
 * @example
 * // Initialize and load documents
 * const engine = new DatastoreEngine({ directory: './data' });
 * await engine.loadDocuments();
 *
 * @example
 * // Store and retrieve documents
 * await engine.setItem('user:123', { name: 'Alice', role: 'admin' });
 * const { document } = engine.getItem('user:123');
 *
 * @example
 * // Query documents by key range
 * const results = engine.queryKeys({
 *   startKey: 'user:',
 *   endKey: 'user:\uffff',
 *   inclusiveStartIndex: 0,
 *   limit: 10,
 *   includeDocuments: true
 * });
 */
export default class DatastoreEngine {
    /**
     * @private
     * @type {string|null}
     */
    #directory = null;

    /**
     * @private
     * @type {Object}
     */
    #fileSystem = fileSystem;

    /**
     * @private
     * @type {Map<string, ViewSource>}
     */
    #views = new Map();

    /**
     * @private
     * @type {Map<string, Object>}
     */
    #documentsMap = new Map();

    /**
     * Creates a new DatastoreEngine instance
     *
     * @param {Object} options - Configuration options
     * @param {string} options.directory - Directory path for document storage
     * @param {Object} [options.fileSystem] - Custom file system implementation for testing
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options = {}) {
        assertNonEmptyString(options.directory);

        // Allow dependency injection of file system for testing
        // This lets us mock file operations without touching real disk
        if (options.fileSystem) {
            this.#fileSystem = options.fileSystem;
        }

        this.#directory = options.directory;
    }

    /**
     * Checks if a view is registered
     * @param {string} id - View identifier
     * @returns {boolean} True if the view exists
     */
    hasView(id) {
        return this.#views.has(id);
    }

    /**
     * Registers a view for custom indexing
     *
     * @param {string} id - Unique view identifier
     * @param {ViewSource} source - View source containing map function
     *
     * @example
     * // Register a view that indexes documents by type
     * engine.setView('by_type', {
     *   map: (doc, emit) => {
     *     if (doc.type) emit(doc.type, null);
     *   }
     * });
     *
     * @example
     * // Register a view that emits multiple keys per document
     * engine.setView('by_tags', {
     *   map: (doc, emit) => {
     *     if (doc.tags) {
     *       doc.tags.forEach(tag => emit(tag, doc.id));
     *     }
     *   }
     * });
     */
    setView(id, source) {
        this.#views.set(id, source);
    }

    /**
     * Loads all documents from the storage directory into memory
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} When directory cannot be read or contains invalid JSON files
     *
     * @example
     * const engine = new DatastoreEngine({ directory: './data' });
     * await engine.loadDocuments();
     * // Engine is now ready for queries
     */
    async loadDocuments() {
        // WARNING: This method assumes the caller has acquired a read/write lock
        // to prevent concurrent modifications during the loading process
        const files = await this.#fileSystem.readDocumentDirectory(this.#directory);

        // Load all documents in parallel for better I/O throughput on modern SSDs
        // This trades memory for speed - all file reads happen concurrently
        // For very large datasets, consider batching to avoid EMFILE errors
        const promises = files.map((file) => {
            const encodedKey = path.basename(file.name, '.json');
            const key = decodeURIComponent(encodedKey);
            return this.loadDocument(key);
        });

        await Promise.all(promises);
    }

    /**
     * Retrieves a document by its key
     * @param {string} key - Document key
     * @returns {DocumentResult} Object containing the key and document (or null if not found)
     */
    getItem(key) {
        let document = null;
        if (this.#documentsMap.has(key)) {
            document = this.#documentsMap.get(key);
        }
        return { key, document };
    }

    /**
     * Stores or updates a document
     *
     * @async
     * @param {string} key - Document key
     * @param {Object} document - Document to store
     * @returns {Promise<DocumentResult>} The stored document
     * @throws {Error} When file cannot be written to disk
     */
    async setItem(key, document) {
        // Write to disk first for durability - memory state remains unchanged if write fails
        await this.writeDocument(key, document);

        // Update memory only after successful disk write
        this.#documentsMap.set(key, document);
        return { key, document };
    }

    /**
     * Removes a document from the datastore
     *
     * @async
     * @param {string} key - Document key to delete
     * @returns {Promise<{key: string}>} Object containing the deleted key
     * @throws {Error} When file cannot be removed from disk
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async deleteItem(key) {
        // Remove from disk first - if deletion fails, document remains in both places
        await this.removeDocument(key);

        // Remove from memory only after successful disk deletion
        this.#documentsMap.delete(key);
        return { key };
    }

    /**
     * Queries documents by key range with pagination support
     *
     * @param {QueryOptions} options - Query parameters
     * @returns {QueryResult} Paginated query results
     * @throws {AssertionError} When inclusiveStartIndex is negative or NaN
     * @throws {AssertionError} When limit is not positive or NaN
     *
     * @example
     * // Get all documents with keys starting with 'user:'
     * const results = engine.queryKeys({
     *   startKey: 'user:',
     *   endKey: 'user:\uffff',
     *   inclusiveStartIndex: 0,
     *   limit: 20,
     *   includeDocuments: true
     * });
     */
    queryKeys(options) {
        const {
            key,
            descending,
            inclusiveStartIndex,
            limit,
            includeDocuments,
        } = options;

        let { startKey, endKey } = options;

        assertNumberNotNaN(inclusiveStartIndex);
        assert(inclusiveStartIndex >= 0);
        assertNumberNotNaN(limit);
        assert(limit > 0);

        // Build index in memory each time to avoid staleness
        // This trades CPU for simplicity - no index maintenance needed
        const sortedList = descending
            ? this.buildDescendingKeyIndex()
            : this.buildAscendingKeyIndex();

        if (key) {
            startKey = key;
            endKey = key;
        }

        // Default to full range scan when bounds not specified
        if (isUndefined(startKey)) {
            startKey = descending ? OMEGA : ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = OMEGA;
            endKey = descending ? ALPHA : OMEGA;
        }

        const results = getIndexItemsLeftToRight(sortedList, {
            descending,
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        // Include full documents if requested - trades bandwidth for convenience
        if (includeDocuments) {
            for (let i = 0; i < results.items.length; i += 1) {
                const item = results.items[i];
                const document = this.#documentsMap.get(item.documentKey);
                results.items[i] = Object.assign({}, item, { document });
            }
        }

        return results;
    }

    /**
     * Queries a view with key range and pagination support
     *
     * @param {string} viewId - Registered view identifier
     * @param {QueryOptions} options - Query parameters
     * @returns {QueryResult} Paginated view query results
     * @throws {AssertionError} When view doesn't exist
     * @throws {AssertionError} When inclusiveStartIndex is negative or NaN
     * @throws {AssertionError} When limit is not positive or NaN
     *
     * @example
     * // Query documents by type using a view
     * const results = engine.queryView('by_type', {
     *   key: 'user',
     *   inclusiveStartIndex: 0,
     *   limit: 10,
     *   includeDocuments: true
     * });
     */
    queryView(viewId, options) {
        const {
            key,
            descending,
            inclusiveStartIndex,
            limit,
            includeDocuments,
        } = options;

        let { startKey, endKey } = options;

        const view = this.#views.get(viewId);

        assert(view);
        assertNumberNotNaN(inclusiveStartIndex);
        assert(inclusiveStartIndex >= 0);
        assertNumberNotNaN(limit);
        assert(limit > 0);

        // Views are re-indexed on each query for simplicity
        // This ensures fresh results but impacts performance on large datasets
        // Consider caching view results if queries are frequent
        const sortedList = descending
            ? this.buildDescendingViewIndex(view)
            : this.buildAscendingViewIndex(view);

        if (key) {
            startKey = key;
            endKey = key;
        }

        if (isUndefined(startKey)) {
            startKey = descending ? OMEGA : ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = descending ? ALPHA : OMEGA;
        }

        const results = getIndexItemsLeftToRight(sortedList, {
            descending,
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        // Include full documents if requested - trades bandwidth for convenience
        if (includeDocuments) {
            for (let i = 0; i < results.items.length; i += 1) {
                const item = results.items[i];
                const document = this.#documentsMap.get(item.documentKey);
                results.items[i] = Object.assign({}, item, { document });
            }
        }

        return results;
    }

    /**
     * Writes a document to disk
     * @private
     * @async
     * @param {string} key - Document key
     * @param {Object} document - Document to write
     * @returns {Promise<void>}
     * @throws {Error} When file write fails
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async writeDocument(key, document) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.writeDocumentFile(filepath, document);
    }

    /**
     * Removes a document file from disk
     * @private
     * @async
     * @param {string} key - Document key
     * @returns {Promise<void>}
     * @throws {Error} When file removal fails
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async removeDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.removeDocumentFile(filepath);
    }

    /**
     * Loads a document from disk into memory
     * @private
     * @async
     * @param {string} key - Document key
     * @returns {Promise<void>}
     * @throws {Error} When file read fails or contains invalid JSON
     * @throws {Error} When key contains invalid characters for filesystem
     */
    async loadDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        const document = await this.#fileSystem.readDocumentFile(filepath);
        this.#documentsMap.set(key, document);
    }

    /**
     * Generates the file path for a document
     * @private
     * @param {string} key - Document key
     * @returns {string} Full file path
     * @throws {Error} When key contains characters that cannot be URL-encoded
     */
    getDocumentFilepath(key) {
        // URL-encode keys to safely handle special characters like '/', ':', etc.
        // This prevents directory traversal and ensures valid filenames on all platforms
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }

    /**
     * Builds an ascending sorted index of document keys
     * @private
     * @returns {IndexItem[]} Sorted index
     */
    buildAscendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * Builds a descending sorted index of document keys
     * @private
     * @returns {IndexItem[]} Sorted index
     */
    buildDescendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * Builds an ascending sorted index from a view
     * @private
     * @param {ViewSource} view - View to build index for
     * @returns {IndexItem[]} Sorted index
     */
    buildAscendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * Builds a descending sorted index from a view
     * @private
     * @param {ViewSource} view - View to build index for
     * @returns {IndexItem[]} Sorted index
     */
    buildDescendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * Maps all document keys to index items
     * @private
     * @returns {IndexItem[]} Array of index items
     */
    mapDocumentKeys() {
        const index = [];
        for (const key of this.#documentsMap.keys()) {
            // Freeze items to prevent accidental mutation of index entries
            index.push(Object.freeze({
                key,
                documentKey: key,
            }));
        }
        return index;
    }

    /**
     * Maps documents through a view function to generate index items
     * @private
     * @param {ViewSource} view - View containing map function
     * @returns {IndexItem[]} Array of index items emitted by the view
     */
    mapViewDocuments(view) {
        const index = [];

        for (const [ documentKey, document ] of this.#documentsMap) {
            // CouchDB-style map function where each document can emit zero or more
            // index entries via the emit() callback - this allows complex indexing
            // like emitting multiple keys for array fields or computed values
            view.map(document, function emit(key, value) {
                // Freeze to ensure index integrity
                index.push(Object.freeze({
                    key,
                    value,
                    documentKey,
                }));
            });
        }

        return index;
    }
}

/**
 * Extracts a paginated slice of items from a sorted index within a key range
 *
 * @param {IndexItem[]} sortedList - Pre-sorted array of index items
 * @param {Object} options - Query options
 * @param {string} options.startKey - Inclusive start of key range
 * @param {string} options.endKey - Inclusive end of key range
 * @param {number} options.inclusiveStartIndex - Zero-based pagination offset
 * @param {number} options.limit - Maximum items to return
 * @returns {QueryResult} Paginated results with continuation index
 * @throws {Error} When sortedList is not an array
 */
export function getIndexItemsLeftToRight(sortedList, options) {
    const {
        startKey,
        endKey,
        inclusiveStartIndex,
        limit,
    } = options;

    const items = [];
    let exclusiveEndIndex = null;

    // Guard against pagination beyond available data
    if (inclusiveStartIndex >= sortedList.length) {
        return { exclusiveEndIndex, items };
    }

    let index = inclusiveStartIndex;

    // Linear scan from pagination offset - efficient for sorted data
    // We skip items before startKey and after endKey
    for (index; index < sortedList.length; index += 1) {
        const item = sortedList[index];
        const { key } = item;

        if (isGreaterThanOrEqualTo(key, startKey) && isLessThanOrEqualTo(key, endKey)) {
            items.push(item);
        }

        // Check if we've collected the requested page size
        if (items.length === limit) {
            // Set continuation token for next page if more items exist
            // Client uses this as inclusiveStartIndex for subsequent requests
            if (index < (sortedList.length - 1)) {
                exclusiveEndIndex = index + 1;
            }

            return { exclusiveEndIndex, items };
        }
    }

    return { exclusiveEndIndex, items };
}
