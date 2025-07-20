import path from 'node:path';
import * as fileSystem from './file-system.js';

import {
    isUndefined,
    assert,
    assertNumberNotNaN,
    assertNonEmptyString
} from '../assertions/mod.js';


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
        this.#views.set(id, source);
    }

    /**
     * Load all documents from the storage directory into memory.
     * Assumes the caller has acquired any necessary locks.
     * @returns {Promise<void>}
     */
    async loadDocuments() {
        // Assume the read/write lock has already been acquired by the caller.
        const fileNames = await this.#fileSystem.readDocumentDirectory(this.#directory);

        const promises = fileNames.map((filename) => {
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
        return { key, document };
    }

    /**
     * Add or update a document by key.
     * @param {string} key
     * @param {Object} document
     * @returns {Promise<{ key: string, document: Object }>}
     */
    async setItem(key, document) {
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
            // The "key" will override startKey and endKey if it exists.
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

        const sortedList = descending
            ? this.buildDescendingKeyIndex()
            : this.buildAscendingKeyIndex();

        if (key) {
            startKey = key;
            endKey = key;
        }

        if (isUndefined(startKey)) {
            startKey = ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = OMEGA;
        }

        const results = getIndexItemsLeftToRight(sortedList, {
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        if (includeDocuments) {
            for (const item of results.items) {
                const document = this.#documentsMap.get(item.documentKey);
                item.document = document;
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
            // The "key" will override startKey and endKey if it exists.
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

        const sortedList = descending
            ? this.buildDescendingViewIndex(view)
            : this.buildAscendingViewIndex(view);

        if (key) {
            startKey = key;
            endKey = key;
        }

        if (isUndefined(startKey)) {
            startKey = ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = OMEGA;
        }

        const results = getIndexItemsLeftToRight(sortedList, {
            startKey,
            endKey,
            inclusiveStartIndex,
            limit,
        });

        if (includeDocuments) {
            for (const item of results.items) {
                item.document = this.#documentsMap.get(item.documentKey);
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
        this.#documentsMap.set(key, document);
    }

    /**
     * Get the file path for a document key.
     * @private
     * @param {string} key
     * @returns {string}
     */
    getDocumentFilepath(key) {
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

    if (inclusiveStartIndex >= sortedList.length) {
        return { exclusiveEndIndex, items };
    }

    let index = inclusiveStartIndex;

    for (index; index < sortedList.length; index += 1) {
        const item = sortedList[index];
        const { key } = item;

        if (isGreaterThanOrEqualTo(key, startKey) && isLessThanOrEqualTo(key, endKey)) {
            items.push(item);
        }

        if (items.length === limit) {
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
    // Each index item is of the form [ key, value, doc.id ]
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
    // Each index item is of the form [ key, value, doc.id ]
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
    if (typeof a === 'string') {
        return a.localeCompare(b);
    } else if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    }
    return 0;
}
