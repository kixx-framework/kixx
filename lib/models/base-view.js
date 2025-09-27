import { assertNonEmptyString } from '../assertions/mod.js';

export default class BaseView {

    static NAME = '';

    constructor(context) {
        const name = this.constructor.NAME;

        assertNonEmptyString(name, `Invalid .name for View "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            context: {
                value: context,
            },
            logger: {
                value: context.logger.createChild(`${ name }View`),
            },
        });
    }

    async getItem(params) {
        assertNonEmptyString(params.type);
        assertNonEmptyString(params.id);

        const collection = this.context.getCollection(params.type);
        const item = await collection.getItem(params.id);
        return item;
    }
}
