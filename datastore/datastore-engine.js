/**
 * @fileoverview Document storage engine with file-based persistence and view indexing
 *
 * This module provides a simple document database that stores JSON documents as files
 * on disk, with support for CouchDB-style views and efficient key-based queries.
 * Documents are loaded into memory for fast access, making this suitable for
 * small to medium datasets.
 *
 * @module datastore-engine
 * @author Your Team
 * @since 1.0.0
 */

import path from 'node:path';
import * as fileSystem from './file-system.js';

import {
    isUndefined,
    assert,
    assertNumberNotNaN,
    assertNonEmptyString
} from '../assertions/mod.js';


// Unicode boundary characters used as sentinel values for key ranges
// ALPHA (\u0000) represents the lowest possible string in JavaScript's sort order
// OMEGA (\uffff) represents a very high value (though not technically the highest)
// These allow open-ended queries like "all keys from 'foo' onwards"
// We use \uffff instead of the true max (\u{10FFFF}) for compatibility
// with systems that may not handle astral plane characters correctly
const ALPHA = '\u0000';
const OMEGA = '\uffff';


/**
 * @typedef {Object} DocumentResult
 * @property {string} key - Document key
 * @property {Object|null} document - Document object or null if not found
 */

/**
 * @typedef {Object} ViewSource
 * @property {Function} map - Map function that receives (document, emit) parameters
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
        const fileNames = await this.#fileSystem.readDocumentDirectory(this.#directory);

        // Load all documents in parallel for better performance
        const promises = fileNames.map((filename) => {
            const encodedKey = path.basename(filename, '.json');
            const key = decodeURIComponent(encodedKey);
            return this.loadDocument(key);
        });

        await Promise.all(promises);
    }

    /**
     * Retrieves a document by its key
     * @param {string} key - Document key
     * @returns {DocumentResult} Object containing the key and document (or null)
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
        // Write to disk first before updating in-memory state
        await this.writeDocument(key, document);
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
     */
    async deleteItem(key) {
        // Remove from disk first to ensure consistency
        await this.removeDocument(key);
        this.#documentsMap.delete(key);
        return { key };
    }

    /**
     * Queries documents by key range with pagination support
     *
     * @param {QueryOptions} options - Query parameters
     * @returns {QueryResult} Paginated query results
     * @throws {AssertionError} When pagination parameters are invalid
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

        // Validate pagination parameters
        assertNumberNotNaN(inclusiveStartIndex);
        assert(inclusiveStartIndex >= 0);
        assertNumberNotNaN(limit);
        assert(limit > 0);

        // Build index in requested sort order
        const sortedList = descending
            ? this.buildDescendingKeyIndex()
            : this.buildAscendingKeyIndex();

        // Handle different query modes
        if (key) {
            startKey = key;
            endKey = key;
        }

        // Default to full range if bounds not specified
        if (isUndefined(startKey)) {
            startKey = ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = OMEGA;
        }

        // Extract matching items with pagination
        const results = getIndexItemsLeftToRight(sortedList, {
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        // Optionally hydrate results with full document objects
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
     * @throws {AssertionError} When view doesn't exist or pagination parameters are invalid
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

        // Fail fast if view doesn't exist
        assert(view);
        assertNumberNotNaN(inclusiveStartIndex);
        assert(inclusiveStartIndex >= 0);
        assertNumberNotNaN(limit);
        assert(limit > 0);

        // Build view index in requested sort order
        const sortedList = descending
            ? this.buildDescendingViewIndex(view)
            : this.buildAscendingViewIndex(view);

        // Handle different query modes
        if (key) {
            startKey = key;
            endKey = key;
        }

        // Default to full range if bounds not specified
        if (isUndefined(startKey)) {
            startKey = ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = OMEGA;
        }

        // Extract matching items with pagination
        const results = getIndexItemsLeftToRight(sortedList, {
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        // Hydrate with documents if requested
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
     * @private
     * @async
     * @param {string} key - Document key
     * @param {Object} document - Document to write
     * @returns {Promise<void>}
     */
    async writeDocument(key, document) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.writeDocumentFile(filepath, document);
    }

    /**
     * @private
     * @async
     * @param {string} key - Document key
     * @returns {Promise<void>}
     */
    async removeDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.removeDocumentFile(filepath);
    }

    /**
     * @private
     * @async
     * @param {string} key - Document key
     * @returns {Promise<void>}
     */
    async loadDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        const document = await this.#fileSystem.readDocumentFile(filepath);
        this.#documentsMap.set(key, document);
    }

    /**
     * @private
     * @param {string} key - Document key
     * @returns {string} Full file path
     */
    getDocumentFilepath(key) {
        // URL-encode keys to handle special characters
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }

    /**
     * @private
     * @returns {IndexItem[]} Sorted index
     */
    buildAscendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * @private
     * @returns {IndexItem[]} Sorted index
     */
    buildDescendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
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
     * @private
     * @returns {IndexItem[]} Array of index items
     */
    mapDocumentKeys() {
        const index = [];
        for (const key of this.#documentsMap.keys()) {
            index.push(Object.freeze({
                key,
                documentKey: key,
            }));
        }
        return index;
    }

    /**
     * @private
     * @param {ViewSource} view - View containing map function
     * @returns {IndexItem[]} Array of index items emitted by the view
     */
    mapViewDocuments(view) {
        const index = [];

        for (const [ documentKey, document ] of this.#documentsMap) {
            // CouchDB-style map function that can emit multiple entries per document
            view.map(document, function emit(key, value) {
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

    // Handle edge case where pagination starts beyond array bounds
    if (inclusiveStartIndex >= sortedList.length) {
        return { exclusiveEndIndex, items };
    }

    let index = inclusiveStartIndex;

    // Scan through sorted list starting at pagination offset
    for (index; index < sortedList.length; index += 1) {
        const item = sortedList[index];
        const { key } = item;

        // Check if current item falls within the requested key range
        if (isGreaterThanOrEqualTo(key, startKey) && isLessThanOrEqualTo(key, endKey)) {
            items.push(item);
        }

        // Stop when we've collected enough items
        if (items.length === limit) {
            // Set continuation point for next page
            if (index < (sortedList.length - 1)) {
                exclusiveEndIndex = index + 1;
            }

            return { exclusiveEndIndex, items };
        }
    }

    return { exclusiveEndIndex, items };
}

/**
 * Comparator function for sorting index items in ascending order by key
 * @param {IndexItem} a - First item
 * @param {IndexItem} b - Second item
 * @returns {number} Negative if a < b, positive if a > b, zero if equal
 */
export function sortIndexListAscending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    return compare(akey, bkey);
}

/**
 * Comparator function for sorting index items in descending order by key
 * @param {IndexItem} a - First item
 * @param {IndexItem} b - Second item
 * @returns {number} Positive if a < b, negative if a > b, zero if equal
 */
export function sortIndexListDescending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    return compare(bkey, akey);
}

/**
 * Tests if comp is greater than or equal to val using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp >= val
 */
export function isGreaterThanOrEqualTo(comp, val) {
    return compare(comp, val) >= 0;
}

/**
 * Tests if comp is less than or equal to val using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp <= val
 */
export function isLessThanOrEqualTo(comp, val) {
    return compare(comp, val) <= 0;
}

/**
 * Compares two values with locale-aware string comparison
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {number} -1 if a < b, 1 if a > b, 0 if equal
 */
export function compare(a, b) {
    // Use locale-aware string comparison for international support
    if (typeof a === 'string') {
        return a.localeCompare(b);
    } else if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    }
    return 0;
}
