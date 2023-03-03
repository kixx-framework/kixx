// @ts-check

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import KixxAssert from 'kixx-assert';

const { isNumberNotNaN } = KixxAssert.helpers;

/**
 * @typedef {Object} GetOptions
 * @prop {Boolean=} include
 */

/**
 * @typedef {Object} GetByTypeOptions
 * @prop {Number} [limit=20]
 * @prop {Number|null} [cursor=0]
 * @prop {String} [sortOrder="FORWARD"] - Accepts "FORWARD" or "REVERSE". Default = "FORWARD"
 */

/**
 * @typedef {Object} Record
 * @prop {String} type
 * @prop {String} id
 * @prop {String} created
 */

export default class LocalFileRecordStore {

    /**
     * @type {String}
     */
    #directory;

    /**
     * @param {{directory:String}} options
     */
    constructor({ directory }) {
        this.#directory = directory;
    }

    /**
     * @return {Promise<LocalFileRecordStore>}
     */
    initialize() {
        fs.mkdirSync(this.#directory, { recursive: true });
        return Promise.resolve(this);
    }

    /**
     * @param  {String} type
     * @param  {String} id
     * @param  {GetOptions} options
     * @return {Promise<Array>}
     */
    async get(type, id, options) {
        options = options || {};

        const [ record, includes ] = await this.#fetchRecord([], type, id, options);

        if (record) {
            return [ record, includes ];
        }

        return [ null, null ];
    }

    /**
     * @param  {String} type
     * @param  {GetByTypeOptions} options
     * @return {Promise<{count:Number,cursor:Number|null,records:Array}>}
     */
    async getByType(type, options) {
        options = options || {};

        const { sortOrder } = options;

        /** @type {Number} */
        // @ts-ignore error TS2322: Type 'number | undefined' is not assignable to type 'number'
        const limit = isNumberNotNaN(options.limit) ? options.limit : 20;
        /** @type {Number} */
        // @ts-ignore error TS2322: Type 'number | undefined' is not assignable to type 'number'
        const cursor = isNumberNotNaN(options.cursor) ? options.cursor : 0;

        const entries = await fsp.readdir(this.#directory);

        const files = entries.filter((entry) => entry.startsWith(type));

        const promises = files.map((entry) => {
            const filepath = path.join(this.#directory, entry);
            return this.#readJsonFile(filepath);
        });

        const records = await Promise.all(promises);

        records.sort(sortDecendingByCreatedDate);

        if (sortOrder === 'REVERSE') {
            records.reverse();
        }

        const subset = records.slice(cursor, cursor + limit);

        /** @type {Number|null} */
        let newCursor = cursor + limit;

        if (typeof records[newCursor] === 'undefined') {
            newCursor = null;
        }

        return {
            count: subset.length,
            cursor: newCursor,
            records: subset,
        };
    }

    /**
     * @template {Record} R
     * @param {R} record
     * @return {Promise<R>}
     */
    async put(record) {
        const { type, id } = record;
        await this.#saveRecord(type, id, record);
        return record;
    }

    /**
     * @param {String} type
     * @param {String} id
     * @return {String}
     */
    #createRecordFilePath(type, id) {
        return path.join(this.#directory, `${ type }_${ id }.json`);
    }

    /**
     * @param {String} filepath
     * @return {Promise<Object|null>}
     */
    async #readJsonFile(filepath) {
        try {
            const stats = await fsp.stat(filepath);

            if (stats.isFile()) {
                const utf8Data = await fsp.readFile(filepath, { encoding: 'utf8' });
                return JSON.parse(utf8Data);
            }

            return null;
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return null;
            }

            throw cause;
        }
    }

    /**
     * @param  {String} filepath
     * @param  {Record} record
     * @return {Promise}
     */
    #writeJsonFile(filepath, record) {
        const utf8Data = JSON.stringify(record, null, 2);
        return fsp.writeFile(filepath, utf8Data, { encoding: 'utf8' });
    }

    /**
     * @param {String} type
     * @param {String} id
     * @param {Record} record
     * @return {Promise}
     */
    #saveRecord(type, id, record) {
        const filepath = this.#createRecordFilePath(type, id);
        return this.#writeJsonFile(filepath, record);
    }

    /**
     * @param {Array} includes - An empty Array
     * @param {String} type
     * @param {String} id
     * @param {GetOptions} options
     * @return {Promise<Array>}
     */
    async #fetchRecord(includes, type, id, options) {
        const filepath = this.#createRecordFilePath(type, id);
        const record = await this.#readJsonFile(filepath);

        if (options.include && record && record.relationships) {

            const promises = Object.keys(record.relationships).map((key) => {
                if (!record.relationships[key]) {
                    return includes;
                }

                return this.#fetchRelatedRecords(includes, options, record.relationships[key]);
            });

            await Promise.all(promises);
        }

        return [ record, includes ];
    }

    /**
     * @param {Array} includes - An empty Array
     * @param {GetOptions} options
     * @param {Array|Object} relationships
     * @return {Promise<Array>}
     */
    async #fetchRelatedRecords(includes, options, relationships) {
        if (!Array.isArray(relationships)) {
            relationships = [ relationships ];
        }

        const promises = relationships.map((relationship) => {
            return this.#fetchRecord(includes, relationship.type, relationship.id, options);
        });

        const results = await Promise.all(promises);

        results.forEach(([ record ]) => {
            if (record) {
                const existing = includes.find(({ type, id }) => {
                    return record.type === type && record.id === id;
                });

                if (!existing) {
                    includes.push(record);
                }
            }
        });

        return includes;
    }
}

function sortDecendingByCreatedDate(a, b) {
    if (a.created === b.created) {
        return 0;
    }
    if (a.created < b.created) {
        return 1;
    }
    return -1;
}
