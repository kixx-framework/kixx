// @ts-check
import { OperationalError, ProgrammerError, NotFoundError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';
import { v4 as uuidv4 } from 'uuid';


const { isNonEmptyString } = KixxAssert.helpers;

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
 * @prop {String|null|undefined} id
 * @prop {String} created
 */


export default class RecordStore {

    scope;
    storageEngine;
    #modelConstructorsByType = new Map();

    /**
     * @param {{scope:String,storageEngine:Object,modelTypes:Array}} spec
     */
    constructor(spec) {
        Object.defineProperties(this, {
            scope: {
                enumerable: true,
                value: spec.scope,
            },
            storageEngine: {
                enumerable: true,
                value: spec.storageEngine,
            },
        });

        spec.modelTypes.forEach((ModelConstructor) => {
            this.#modelConstructorsByType.set(ModelConstructor.type, ModelConstructor);
        });
    }

    initialize() {
        return this.storageEngine.initialize().then(() => {
            return this;
        });
    }

    /**
     * @param  {String} type
     * @param  {String} id
     * @param  {GetOptions} options
     * @return {Promise<Array>}
     */
    async get(type, id, options) {
        options = options || {};

        if (!isNonEmptyString(type)) {
            throw new ProgrammerError(
                'The .get() "type" parameter must be a non empty string.'
            );
        }
        if (!isNonEmptyString(id)) {
            throw new ProgrammerError(
                'The .get() "id" parameter must be a non empty string.'
            );
        }
        if (!this.#modelConstructorsByType.has(type)) {
            throw new ProgrammerError(
                `The type "${ type }" has not be registered`
            );
        }

        const [ recordData, includesData ] = await this.storageEngine.get(
            type,
            id,
            options
        );

        if (!recordData) {
            throw new NotFoundError(
                `Requested record ${ type }:${ id } could not be found`
            );
        }

        const record = this.#mapRecordToModelConstructor(recordData);

        const includes = includesData.map((rec) => {
            return this.#mapRecordToModelConstructor(rec);
        });

        return [ record, includes ];
    }

    /**
     * @param  {String} type
     * @param  {GetByTypeOptions} options
     * @return {Promise<{count:Number,cursor:any|null,records:Array}>}
     */
    async getByType(type, options) {
        options = options || {};

        if (!isNonEmptyString(type)) {
            throw new ProgrammerError(
                'The .getByType() "type" parameter must be a non empty string.'
            );
        }
        if (!this.#modelConstructorsByType.has(type)) {
            throw new ProgrammerError(
                `The type "${ type }" has not be registered`
            );
        }

        const result = await this.storageEngine.getByType(type, options);

        const records = result.records.map((rec) => {
            return this.#mapRecordToModelConstructor(rec);
        });

        return {
            count: result.count,
            cursor: result.cursor,
            records,
        };
    }

    /**
     * @param {Record} record
     * @return {Promise<Record>}
     */
    async create(record) {
        if (!isNonEmptyString(record.type)) {
            throw new ProgrammerError(
                'The record.type must be a non empty string for create().'
            );
        }
        if (!this.#modelConstructorsByType.has(record.type)) {
            throw new ProgrammerError(
                `The type "${ record.type }" has not be registered`
            );
        }
        if (record.id) {
            throw new ProgrammerError(
                'The record.id must not be defined for create().'
            );
        }

        const ModelConstructor = this.#modelConstructorsByType.get(record.type);
        const isoDateString = new Date().toISOString();

        const meta = {
            scope: this.scope,
            type: ModelConstructor.type,
            id: uuidv4(),
            created: isoDateString,
            updated: isoDateString,
        };

        record = Object.assign({}, record, meta);

        await this.storageEngine.put(record);

        return record;
    }

    /**
     * @template {Record} R
     * @param {R} record
     * @return {Promise<R>}
     */
    async update(record) {
        if (!isNonEmptyString(record.type)) {
            throw new ProgrammerError(
                'The record.type must be a non empty string for update().'
            );
        }
        if (!this.#modelConstructorsByType.has(record.type)) {
            throw new ProgrammerError(
                `The type "${ record.type }" has not be registered`
            );
        }
        if (!isNonEmptyString(record.id)) {
            throw new ProgrammerError(
                'The record.id must be a non empty string for update().'
            );
        }

        const ModelConstructor = this.#modelConstructorsByType.get(record.type);

        const meta = {
            scope: this.scope,
            type: ModelConstructor.type,
            id: record.id,
            created: record.created,
            updated: new Date().toISOString(),
        };

        record = Object.assign({}, record, meta);

        await this.storageEngine.put(record);

        return record;
    }

    #mapRecordToModelConstructor(record) {
        const ModelConstructor = this.#modelConstructorsByType.get(record.type);

        if (!ModelConstructor) {
            throw new OperationalError(
                `The type "${ record.type }" has not be registered`
            );
        }

        return ModelConstructor.fromDatabaseRecord(record);
    }
}
