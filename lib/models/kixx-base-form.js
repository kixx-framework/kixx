import { assert, assertNonEmptyString } from '../assertions/mod.js';

export default class KixxBaseForm {

    constructor(context) {
        const name = this.constructor.name;

        assert(context, 'A Form requires a Context');

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            context: {
                value: context,
            },
            logger: {
                value: context.logger.createChild(`${ name }Form`),
            },
        });
    }

    async save(data) {
        const collectionName = this.constructor.COLLECTION;
        assertNonEmptyString(collectionName, `A .COLLECTION name is required for #save() on ${ this.constructor.name } Form`);

        const collection = this.context.getCollection(collectionName);
        const result = await collection.setItem(data);
        return result;
    }
}
