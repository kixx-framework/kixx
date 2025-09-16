export default class BaseCollection {

    // Override the base type.
    static TYPE = 'baseType';

    constructor() {
        const type = this.constructor.TYPE;

        Object.defineProperties(this, {
            type: {
                enumerable: true,
                value: type,
            },
        });
    }

    async setItem() {
    }
}
