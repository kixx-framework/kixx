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


export default class DatastoreEngine {

    #directory = null;
    #fileSystem = fileSystem;
    #views = new Map();
    #documentsMap = new Map();

    constructor(options = {}) {
        assertNonEmptyString(options.directory);

        if (options.fileSystem) {
            this.#fileSystem = options.fileSystem;
        }

        this.#directory = options.directory;
    }

    hasView(id) {
        return this.#views.has(id);
    }

    setView(id, source) {
        this.#views.set(id, source);
    }

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

    getItem(key) {
        let document = null;
        if (this.#documentsMap.has(key)) {
            document = this.#documentsMap.get(key);
        }
        return { key, document };
    }

    async setItem(key, document) {
        await this.writeDocument(key, document);
        this.#documentsMap.set(key, document);
        return { key, document };
    }

    async deleteItem(key) {
        await this.removeDocument(key);
        this.#documentsMap.delete(key);
        return { key };
    }

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
     * @private
     */
    async writeDocument(key, document) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.writeDocumentFile(filepath, document);
    }

    /**
     * @private
     */
    async removeDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        await this.#fileSystem.removeDocumentFile(filepath);
    }

    /**
     * @private
     */
    async loadDocument(key) {
        const filepath = this.getDocumentFilepath(key);
        const document = await this.#fileSystem.readDocumentFile(filepath);
        this.#documentsMap.set(key, document);
    }

    /**
     * @private
     */
    getDocumentFilepath(key) {
        const filename = `${ encodeURIComponent(key) }.json`;
        return path.join(this.#directory, filename);
    }

    /**
     * @private
     */
    buildAscendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * @private
     */
    buildDescendingKeyIndex() {
        const index = this.mapDocumentKeys();
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * @private
     */
    buildAscendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListAscending);
        return index;
    }

    /**
     * @private
     */
    buildDescendingViewIndex(view) {
        const index = this.mapViewDocuments(view);
        index.sort(sortIndexListDescending);
        return index;
    }

    /**
     * @private
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

export function sortIndexListAscending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    // Each index item is of the form [ key, value, doc.id ]
    return compare(akey, bkey);
}

export function sortIndexListDescending(a, b) {
    const akey = a.key;
    const bkey = b.key;
    // Each index item is of the form [ key, value, doc.id ]
    return compare(bkey, akey);
}

export function isGreaterThanOrEqualTo(comp, val) {
    return compare(comp, val) >= 0;
}

export function isLessThanOrEqualTo(comp, val) {
    return compare(comp, val) <= 0;
}

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

