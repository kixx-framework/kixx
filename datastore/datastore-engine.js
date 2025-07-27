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
const ALPHA = '\u0000';
const OMEGA = '\uffff';


/**
 * DatastoreEngine
 * ===============
 *
 * The DatastoreEngine class provides a simple, file-based document store with
 * support for views, key-based queries, and document management. Documents are
 * stored as JSON files in a specified directory, and views can be registered
 * to enable map/reduce-style querying.
 *
 * Core Features:
 *   - Load and manage documents from a directory on disk
 *   - Register and query views for custom indexing
 *   - Query documents by key range, with support for pagination and sorting
 *   - Add, update, and delete documents
 *   - In-memory indexing for fast queries
 *
 * Usage Example:
 *   const engine = new DatastoreEngine({ directory: '/data/db' });
 *   await engine.loadDocuments();
 *   await engine.setItem('foo', { name: 'bar' });
 *   const { document } = engine.getItem('foo');
 *   await engine.deleteItem('foo');
 */
export default class DatastoreEngine {
    /**
     * @private
     * @type {string|null}
     * Directory where document files are stored.
     */
    #directory = null;

    /**
     * @private
     * @type {Object}
     * File system abstraction for reading/writing files.
     */
    #fileSystem = fileSystem;

    /**
     * @private
     * @type {Map<string, Object>}
     * Registered views for custom indexing.
     */
    #views = new Map();

    /**
     * @private
     * @type {Map<string, Object>}
     * In-memory map of document key to document object.
     */
    #documentsMap = new Map();

    /**
     * Construct a new DatastoreEngine.
     *
     * @param {Object} options
     * @param {string} options.directory - Directory for document storage (required)
     * @param {Object} [options.fileSystem] - Optional file system abstraction
     */
    constructor(options = {}) {
        assertNonEmptyString(options.directory);

        // Allow dependency injection of file system for testing
        // This enables mocking file operations without touching real disk
        if (options.fileSystem) {
            this.#fileSystem = options.fileSystem;
        }

        this.#directory = options.directory;
    }

    /**
     * Check if a view is registered.
     * @param {string} id - View ID
     * @returns {boolean}
     */
    hasView(id) {
        return this.#views.has(id);
    }

    /**
     * Register a view for custom indexing.
     * @param {string} id - View ID
     * @param {Object} source - View source (must have a .map function)
     */
    setView(id, source) {
        // Views are CouchDB-style map functions that emit key-value pairs
        // They're stored but not executed until a query needs them
        this.#views.set(id, source);
    }

    /**
     * Load all documents from the storage directory into memory.
     * Assumes the caller has acquired any necessary locks.
     * @returns {Promise<void>}
     */
    async loadDocuments() {
        // WARNING: This method assumes the caller has acquired a read/write lock
        // Loading documents without proper locking can lead to race conditions
        // where documents are modified on disk while being loaded
        const fileNames = await this.#fileSystem.readDocumentDirectory(this.#directory);

        // Load all documents in parallel for better performance
        // On large directories this significantly reduces startup time
        const promises = fileNames.map((filename) => {
            // Document keys are URL-encoded in filenames to handle special characters
            const encodedKey = path.basename(filename, '.json');
            const key = decodeURIComponent(encodedKey);
            return this.loadDocument(key);
        });

        await Promise.all(promises);
    }

    /**
     * Get a document by key.
     * @param {string} key
     * @returns {{ key: string, document: Object|null }}
     */
    getItem(key) {
        let document = null;
        if (this.#documentsMap.has(key)) {
            document = this.#documentsMap.get(key);
        }
        // Always return consistent shape even when document doesn't exist
        // This simplifies null checking for callers
        return { key, document };
    }

    /**
     * Add or update a document by key.
     * @param {string} key
     * @param {Object} document
     * @returns {Promise<{ key: string, document: Object }>}
     */
    async setItem(key, document) {
        // Write to disk first before updating in-memory state
        // This ensures data durability - if the process crashes after
        // the write, the document is still persisted
        await this.writeDocument(key, document);
        this.#documentsMap.set(key, document);
        return { key, document };
    }

    /**
     * Delete a document by key.
     * @param {string} key
     * @returns {Promise<{ key: string }>}
     */
    async deleteItem(key) {
        // Remove from disk first to ensure consistency
        // If we removed from memory first and then crashed,
        // the document would reappear on next load
        await this.removeDocument(key);
        this.#documentsMap.delete(key);
        return { key };
    }

    /**
     * Query document keys with optional range, pagination, and sorting.
     * @param {Object} options
     * @param {string} [options.key] - Exact key to match (overrides startKey/endKey)
     * @param {boolean} [options.descending] - Sort order
     * @param {number} options.inclusiveStartIndex - Start index (inclusive)
     * @param {number} options.limit - Max number of results
     * @param {boolean} [options.includeDocuments] - Include document objects in results
     * @param {string} [options.startKey] - Range start key
     * @param {string} [options.endKey] - Range end key
     * @returns {Object} { exclusiveEndIndex, items }
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

        // Validate pagination parameters to prevent runtime errors
        assertNumberNotNaN(inclusiveStartIndex);
        assert(inclusiveStartIndex >= 0);
        assertNumberNotNaN(limit);
        assert(limit > 0);

        // Build index in requested sort order
        // Index is rebuilt on each query to ensure it reflects current state
        const sortedList = descending
            ? this.buildDescendingKeyIndex()
            : this.buildAscendingKeyIndex();

        // Exact key match overrides range query
        if (key) {
            startKey = key;
            endKey = key;
        }

        // Default to full range if bounds not specified
        // This allows queries like "all documents" or "all documents from 'foo' onwards"
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
        // This is separated from the index query for performance -
        // some queries only need keys, not full documents
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
     * Query a registered view with optional range, pagination, and sorting.
     * @param {string} viewId - Registered view ID
     * @param {Object} options - Same as queryKeys
     * @returns {Object} { exclusiveEndIndex, items }
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
        // Views can emit multiple entries per document, so the index
        // may be larger than the document count
        const sortedList = descending
            ? this.buildDescendingViewIndex(view)
            : this.buildAscendingViewIndex(view);

        // Exact key match overrides range query
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
        // Note: multiple view entries may reference the same document
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
     * Write a document to disk.
     * @private
     * @param {string} key
     * @param {Object} document
     * @returns {Promise<void>}
     */
    async writeDocument(key, document) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.writeDocumentFile(filepath, document);
    }

    /**
     * Remove a document file from disk.
     * @private
     * @param {string} key
     * @returns {Promise<void>}
     */
    async removeDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.removeDocumentFile(filepath);
    }

    /**
     * Load a document from disk and add it to the in-memory map.
     * @private
     * @param {string} key
     * @returns {Promise<void>}
     */
    async loadDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        const document = await this.#fileSystem.readDocumentFile(filepath);
        // Documents are cached in memory for fast access
        // This trades memory for speed - suitable for small to medium datasets
        this.#documentsMap.set(key, document);
    }

    /**
     * Get the file path for a document key.
     * @private
     * @param {string} key
     * @returns {string}
     */
    getDocumentFilepath(key) {
        // URL-encode keys to handle special characters that aren't
        // valid in filenames (e.g., '/', ':', '*')
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }

    /**
     * Build an ascending-sorted index of all document keys.
     * @private
     * @returns {Array<Object>}
     */
    buildAscendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * Build a descending-sorted index of all document keys.
     * @private
     * @returns {Array<Object>}
     */
    buildDescendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * Build an ascending-sorted index for a view.
     * @private
     * @param {Object} view
     * @returns {Array<Object>}
     */
    buildAscendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * Build a descending-sorted index for a view.
     * @private
     * @param {Object} view
     * @returns {Array<Object>}
     */
    buildDescendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * Map all document keys to index objects.
     * @private
     * @returns {Array<Object>}
     */
    mapDocumentKeys() {
        const index = [];
        for (const key of this.#documentsMap.keys()) {
            // Freeze index items to prevent accidental mutation
            // which could corrupt query results
            index.push(Object.freeze({
                key,
                documentKey: key,
            }));
        }
        return index;
    }

    /**
     * Map all documents through a view's map function to index objects.
     * @private
     * @param {Object} view
     * @returns {Array<Object>}
     */
    mapViewDocuments(view) {
        const index = [];

        for (const [ documentKey, document ] of this.#documentsMap) {
            // CouchDB-style map function that can emit multiple key-value pairs
            // per document. This enables complex indexing scenarios like
            // indexing by multiple fields or creating compound keys
            view.map(document, function emit(key, value) {
                // Freeze to prevent mutation of index entries
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
 * Get a slice of index items from a sorted list, left-to-right, within a key range.
 * @param {Array<Object>} sortedList
 * @param {Object} options
 * @param {string} options.startKey
 * @param {string} options.endKey
 * @param {number} options.inclusiveStartIndex
 * @param {number} options.limit
 * @returns {{ exclusiveEndIndex: number|null, items: Array<Object> }}
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

        // Only include items within the specified key range
        if (isGreaterThanOrEqualTo(key, startKey) && isLessThanOrEqualTo(key, endKey)) {
            items.push(item);
        }

        // Stop when we've collected enough items
        if (items.length === limit) {
            // Set continuation point for next page of results
            // null indicates we've reached the end of available data
            if (index < (sortedList.length - 1)) {
                exclusiveEndIndex = index + 1;
            }

            return { exclusiveEndIndex, items };
        }
    }

    return { exclusiveEndIndex, items };
}

/**
 * Sort comparator for ascending order by key.
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function sortIndexListAscending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    return compare(akey, bkey);
}

/**
 * Sort comparator for descending order by key.
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function sortIndexListDescending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    // Reverse comparison order for descending sort
    return compare(bkey, akey);
}

/**
 * Compare if comp >= val.
 * @param {*} comp
 * @param {*} val
 * @returns {boolean}
 */
export function isGreaterThanOrEqualTo(comp, val) {
    return compare(comp, val) >= 0;
}

/**
 * Compare if comp <= val.
 * @param {*} comp
 * @param {*} val
 * @returns {boolean}
 */
export function isLessThanOrEqualTo(comp, val) {
    return compare(comp, val) <= 0;
}

/**
 * Generic comparison function for keys.
 * @param {*} a
 * @param {*} b
 * @returns {number}
 */
export function compare(a, b) {
    // Use locale-aware string comparison for better international support
    // This handles accented characters and different alphabets correctly
    if (typeof a === 'string') {
        return a.localeCompare(b);
    } else if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    }
    return 0;
}