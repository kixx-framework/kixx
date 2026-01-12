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

    async initialize() {
        let files;

        try {
            files = await this.#fileSystem.readDirectory(this.#directory);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                throw new WrappedError(
                    `The LocalFileDatastore directory has not been created (${ this.#directory })`,
                    { cause },
                    this.initialize
                );
            }
            throw new WrappedError(
                `Unexpected error while reading the LocalFileDatastore directory (${ this.#directory })`,
                { cause },
                this.initialize
            );
        }

        // Ensure we are dealing with actual files.
        files = files.filter((file) => file.isFile());

        // Load files in batches to avoid exceeding the OS open file limit (typically 256-1024
        // on most systems). Batch size of 50 provides a safety margin while still allowing
        // parallel I/O within each batch for faster initialization on large datastores
        const batches = [];
        const batchSize = 50;

        for (let i = 0; i < files.length; i += batchSize) {
            batches.push(files.slice(i, i + batchSize));
        }

        for (const batch of batches) {
            const promises = batch.map(this.#loadDocumentFromFile.bind(this));
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(promises);
        }
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

        // Implement optimistic locking using _rev (revision) field
        // _rev increments on each write, allowing detection of concurrent modifications
        doc._rev = 0;
        if (existingDocument && isNumberNotNaN(existingDocument._rev)) {
            // Check if document._rev exists and matches current stored revision
            // This ensures the caller's version is based on the latest data
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
        // This ensures durability: if disk write fails, memory state remains consistent
        // with what's on disk, and the error propagates to the caller
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

        // Remove from disk first - if deletion fails, document remains in both places,
        // maintaining consistency between disk and memory. This is safer than removing
        // from memory first, which could leave orphaned files on disk
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
            // CouchDB-style map/emit pattern: the view's map function receives each document
            // and an emit() callback. The map function can call emit(key, value) zero or more
            // times per document, enabling:
            // - Filtering (emit nothing for documents that don't match)
            // - One-to-many indexing (emit multiple entries for array fields)
            // - Computed indexes (emit calculated values like fullName = firstName + lastName)
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

    async #loadDocumentFromFile(file) {
        const filepath = path.join(this.#directory, file.name);

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
            const encodedKey = path.basename(file.name, '.json');
            const key = decodeURIComponent(encodedKey);

            this.#documentsMap.set(key, document);
        }
    }

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

    #createPrimaryKey(type, id) {
        // Format: "TypeName__itemId" (e.g., "User__123", "Post__abc")
        // Double underscore (__) chosen as separator because it's unlikely to appear
        // in type names and provides clear visual separation
        return `${ type }__${ id }`;
    }

    #getDocumentFilepath(key) {
        // URL-encode keys to safely handle special characters like '/', ':', etc.
        // This prevents directory traversal attacks (if keys contain '../') and ensures
        // valid filenames across all platforms (Windows, Mac, Linux have different rules).
        // Example: "User__123/admin" becomes "User__123%2Fadmin.json"
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }
}
