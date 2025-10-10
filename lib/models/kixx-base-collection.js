import KixxBaseModel from './kixx-base-model.js';

import {
    isBoolean,
    assert,
    assertArray,
    assertFunction,
    assertNonEmptyString
} from '../assertions/mod.js';

import { ALPHA, OMEGA } from '../lib/constants.js';


export default class KixxBaseCollection {

    // Subclasses need to override the base type.
    static Model = KixxBaseModel;

    constructor(context) {
        const Model = this.constructor.Model;

        assert(context, 'A Collection requires a Context');
        assertFunction(Model, `Invalid .Model for Collection "${ this.constructor.name }"`);
        assertNonEmptyString(Model.name, `Invalid .Model.name for Collection "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            Model: {
                enumerable: true,
                value: Model,
            },
            type: {
                enumerable: true,
                value: Model.name,
            },
            context: {
                value: context,
            },
            logger: {
                value: context.logger.createChild(`${ Model.name }Collection`),
            },
        });
    }

    // Override get datastore() to choose a different datastore.
    get datastore() {
        return this.context.getService('kixx.Datastore');
    }

    async getItem(id) {
        assertNonEmptyString(id, `Invalid id passed to ${ this.constructor.name }#getItem()`);
        const key = this.idToPrimaryKey(id);
        const item = await this.datastore.getItem(key);
        const ModelConstructor = this.Model;
        return ModelConstructor.fromRecord(item);
    }

    async setItem(item, options) {
        assertNonEmptyString(item.id, `Invalid item.id passed to ${ this.constructor.name }#setItem()`);
        assertFunction(item.toRecord, `An item must have a #toRecord() method when passed to ${ this.constructor.name }#setItem()`);

        const key = this.idToPrimaryKey(item.id);
        await this.datastore.setItem(key, item.toRecord(), options);

        return item;
    }

    async batchSetItems(items, options) {
        assertArray(items, `Invalid items array passed to ${ this.constructor.name }#batchSetItems()`);

        const promises = items.map((item) => {
            return this.setItem(item, options);
        });

        await Promise.all(promises);

        return items;
    }

    async updateItem(id, updateFunction, options) {
        assertNonEmptyString(id, `Invalid item id passed to ${ this.constructor.name }#updateItem()`);

        const key = this.idToPrimaryKey(id);
        const ModelConstructor = this.Model;

        const updateHandler = (item) => {
            return updateFunction(ModelConstructor.fromRecord(item));
        };

        const item = await this.datastore.updateItem(key, updateHandler, options);

        return ModelConstructor.fromRecord(item);
    }

    async deleteItem(id) {
        assertNonEmptyString(id, `Invalid item id passed to ${ this.constructor.name }#deleteItem()`);

        const key = this.idToPrimaryKey(id);
        await this.datastore.deleteItem(key);
        return id;
    }

    async scanItems(options) {
        const queryParams = {
            includeDocuments: true,
        };

        Object.assign(queryParams, options);

        const descending = isBoolean(queryParams.descending) ? queryParams.descending : false;

        if (options.startKey) {
            queryParams.startKey = this.idToPrimaryKey(options.startKey);
        } else {
            const suffix = descending ? OMEGA : ALPHA;
            queryParams.startKey = this.idToPrimaryKey(suffix);
        }
        if (options.endKey) {
            queryParams.endKey = this.idToPrimaryKey(options.endKey);
        } else {
            const suffix = descending ? ALPHA : OMEGA;
            queryParams.endKey = this.idToPrimaryKey(suffix);
        }

        const result = await this.datastore.queryKeys(queryParams);

        const ModelConstructor = this.Model;

        result.items = result.items.map(({ document }) => {
            return ModelConstructor.fromRecord(document);
        });

        return result;
    }

    idToPrimaryKey(id) {
        return `${ this.type }__${ id }`;
    }
}
