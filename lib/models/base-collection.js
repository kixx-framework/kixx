import {
    isBoolean,
    assert,
    assertEqual,
    assertArray,
    assertNonEmptyString
} from '../assertions/mod.js';

import { ALPHA, OMEGA } from '../lib/constants.js';


export default class BaseCollection {

    // Subclasses need to override the base type.
    static TYPE = '';

    constructor(context) {
        const type = this.constructor.TYPE;

        assert(context, 'A Collection requires a Context');
        assertNonEmptyString(type, `Invalid .TYPE for Collection "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            type: {
                enumerable: true,
                value: type,
            },
            context: {
                value: context,
            },
            datastore: {
                value: this.getDatastore(context),
            },
            logger: {
                value: context.logger.createChild(`${ type }Collection`),
            },
        });
    }

    async getItem(id) {
        assertNonEmptyString(id, `Invalid id passed to ${ this.constructor.name }#getItem()`);
        const key = this.idToPrimaryKey(id);
        const item = await this.datastore.getItem(key);
        return item;
    }

    async setItem(item, options) {
        assertNonEmptyString(item.id, `Invalid item.id passed to ${ this.constructor.name }#setItem()`);
        assertEqual(this.type, item.type, `Invalid item.type passed to ${ this.constructor.name }#setItem()`);

        const key = this.idToPrimaryKey(item.id);
        await this.datastore.setItem(key, item, options);

        return item;
    }

    async batchSetItems(items, options) {
        const constructorName = this.constructor.name;
        const constructorType = this.type;

        assertArray(items, `Invalid items array passed to ${ constructorName }#batchSetItems()`);

        const promises = items.map((item) => {
            assertNonEmptyString(item.id, `Invalid item.id passed to ${ constructorName }#setItem()`);
            assertEqual(constructorType, item.type, `Invalid item.type passed to ${ constructorName }#setItem()`);

            const key = this.idToPrimaryKey(item.id);
            return this.datastore.setItem(key, item, options);
        });

        await Promise.all(promises);

        return items;
    }

    async updateItem(id, updateFunction, options) {
        assertNonEmptyString(id, `Invalid item id passed to ${ this.constructor.name }#updateItem()`);

        const key = this.idToPrimaryKey(id);
        const newItem = await this.datastore.updateItem(key, updateFunction, options);

        return newItem;
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

        result.items = result.items.map(({ document }) => document);

        return result;
    }

    idToPrimaryKey(id) {
        return `${ this.type }__${ id }`;
    }

    // Override getDatastore() to choose a different datastore.
    getDatastore(context) {
        return context.getService('kixx.Datastore');
    }
}
