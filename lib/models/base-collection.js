import { assert, assertEqual, assertNonEmptyString } from '../assertions/mod.js';


export default class BaseCollection {

    // Subclasses need to override the base type.
    static TYPE = '';

    constructor(context) {
        const type = this.constructor.TYPE;

        assert(context, 'A Collection requires a Context');
        assertNonEmptyString(type, `Invalid .type for Collection "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            type: {
                enumerable: true,
                value: type,
            },
            context: {
                enumerable: true,
                value: context,
            },
            datastore: {
                enumerable: true,
                value: this.getDatastore(context),
            },
        });
    }

    async setItem(item, options) {
        assertNonEmptyString(item.id, `Invalid item.id passed to ${ this.constructor.name }#setItem()`);
        assertEqual(this.type, item.type, `Invalid item.type passed to ${ this.constructor.name }#setItem()`);

        const key = this.idToPrimaryKey(item.id);
        await this.datastore.setItem(key, item, options);

        return item;
    }

    idToPrimaryKey(id) {
        return `${ this.type }__${ id }`;
    }

    // Override getDatastore() to choose a different datastore.
    getDatastore(context) {
        return context.getService('kixx.Datastore');
    }
}
