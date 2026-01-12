import path from 'node:path';
import { ConflictError, AssertionError } from '../errors/mod.js';
import LockingQueue from './locking-queue.js';
import * as fileSystem from './file-system.js';

import {
    sortIndexListAscending,
    sortIndexListDescending,
    getAscendingIndexRange,
    getDescendingIndexRange
} from './binary-search.js';

import {
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
 * @property {Function} map.document - Document object to process
 * @property {Function} map.emit - Callback function to emit index entries
 * @property {Function} map.emit.key - Index key to emit
 * @property {Function} map.emit.value - Optional value to associate with the key
 */

/**
 * @typedef {Object} QueryResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {IndexItem[]} items - Array of matching items
 */

export default class LocalFileDatastore {

    #lockingQueue = null;
    #fileSystem = null;
    #directory = null;

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

    constructor(options) {
        options = options || {};

        assertNonEmptyString(options.directory);

        this.#directory = options.directory;
        this.#lockingQueue = options.lockingQueue || new LockingQueue();
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    async getItem(type, id) {
        if (isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#getItem()', null, this.getItem);
        }
        if (isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#getItem()', null, this.getItem);
        }

        const key = this.#createPrimaryKey(type, id);

        if (this.#documentsMap.has(key)) {
            return structuredClone(this.#documentsMap.get(key));
        }

        return null;
    }

    async setItem(document, options = {}) {
        const { type, id } = document || {};

        if (isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#setItem()', null, this.setItem);
        }
        if (isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#setItem()', null, this.setItem);
        }

        const key = this.#createPrimaryKey(type, id);

        const checkConsistency = options.checkConsistency === false ? false : true;

        await this.#lockingQueue.getLock(key);

        let existingDocument = null;
        if (this.#documentsMap.has(key)) {
            existingDocument = this.#documentsMap.get(key);
        }

        // Clone the document to avoid mutating or caching the original object.
        const doc = structuredClone(document);

        doc._rev = 0;
        if (existingDocument && isNumberNotNaN(existingDocument._rev)) {
            if (checkConsistency && !isUndefined(document._rev) && existingDocument._rev !== document._rev) {
                this.#lockingQueue.releaseLock(key);
                throw new AssertionError(
                    `The document with key "${ key }" has been modified since it was last read.`,
                    { code: ConflictError.CODE },
                    this.setItem
                );
            }
            doc._rev = existingDocument._rev + 1;
        }

        await this.#writeDocument(key, doc);

        this.#lockingQueue.releaseLock(key);

        // Update memory only after successful disk write
        this.#documentsMap.set(key, doc);

        return doc;
    }

    async deleteItem(type, id) {
        if (isNonEmptyString(type)) {
            throw new AssertionError('Invalid type passed to FileDatastore#deleteItem()', null, this.deleteItem);
        }
        if (isNonEmptyString(id)) {
            throw new AssertionError('Invalid id passed to FileDatastore#deleteItem()', null, this.deleteItem);
        }

        const key = this.#createPrimaryKey(type, id);

        await this.#lockingQueue.getLock(key);

        // Remove from disk first - if deletion fails, document remains in both places
        await this.#removeDocument(key);

        // Remove from memory only after successful disk deletion
        this.#documentsMap.delete(key);

        this.#lockingQueue.releaseLock(key);

        return { type, id };
    }

    /**
     * @param {string} type - The document type string.
     * @param {Object} options - Query parameters
     * @param {string} [options.startKey] - Inclusive start of key range
     * @param {string} [options.endKey] - Inclusive end of key range
     * @param {boolean} [options.descending=false] - Whether to sort results in descending order
     * @param {number} [options.inclusiveStartIndex=0] - Zero-based start index for pagination
     * @param {number} [options.limit=10] - Maximum number of items to return
     * @returns {Promise<QueryKeysResult>} Query results with pagination information
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
            // Default to full range scan when bounds not specified
            startKey = this.#createPrimaryKey(type, descending ? OMEGA : ALPHA);
        }

        if (options.endKey) {
            endKey = this.#createPrimaryKey(type, options.endKey);
        } else {
            // Default to full range scan when bounds not specified
            endKey = this.#createPrimaryKey(type, descending ? ALPHA : OMEGA);
        }

        // Build index in memory each time to avoid staleness
        // This trades CPU for simplicity - no index maintenance needed
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

        const documents = items.map(({ key }) => {
            return structuredClone(this.#documentsMap.get(key));
        });

        return { exclusiveEndIndex, documents };
    }

    /**
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
        if (isUndefined(startKey)) {
            startKey = descending ? OMEGA : ALPHA;
        }
        if (isUndefined(endKey)) {
            endKey = descending ? ALPHA : OMEGA;
        }

        // Build index in memory each time to avoid staleness
        // This trades CPU for simplicity - no index maintenance needed
        const index = this.#mapViewDocuments(this.#views.get(viewId));
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

        // Include full documents if requested
        if (includeDocuments) {
            for (let i = 0; i < items.length; i += 1) {
                const { documentKey } = items[i];
                items[i].document = structuredClone(this.#documentsMap.get(documentKey));
            }
        }

        return { exclusiveEndIndex, items };
    }

    #mapDocumentKeys() {
        const index = [];
        for (const key of this.#documentsMap.keys()) {
            index.push({ key });
        }
        return index;
    }

    #mapViewDocuments(view) {
        const index = [];

        for (const [ documentKey, document ] of this.#documentsMap) {
            // CouchDB-style map function where each document can emit zero or more
            // index entries via the emit() callback - this allows complex indexing
            // like emitting multiple keys for array fields or computed values
            view.map(document, function emit(key, value) {
                index.push({
                    key,
                    value,
                    documentKey,
                });
            });
        }

        return index;
    }

    async #writeDocument(key, doc) {
        const filepath = this.#getDocumentFilepath(key);
        await this.#fileSystem.writeDocumentFile(filepath, doc);
    }

    async #removeDocument(key, doc) {
        const filepath = this.#getDocumentFilepath(key);
        await this.#fileSystem.removeDocumentFile(filepath, doc);
    }

    #createPrimaryKey(type, id) {
        // Format: "TypeName__itemId" (e.g., "User__123", "Post__abc")
        return `${ type }__${ id }`;
    }

    #getDocumentFilepath(key) {
        // URL-encode keys to safely handle special characters like '/', ':', etc.
        // This prevents directory traversal and ensures valid filenames on all platforms
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }
}
