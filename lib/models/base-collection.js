import { assertEqual, assertNonEmptyString } from '../assertions/mod.js';


export default class BaseCollection {

    // Subclasses need to override the base type.
    static TYPE = '';

    constructor() {
        const type = this.constructor.TYPE;

        assertNonEmptyString(type, `Invalid .type for Collection "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            type: {
                enumerable: true,
                value: type,
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
}
