import { assertNonEmptyString } from '../assertions/mod.js';

export default class BaseForm {

    static NAME = '';

    constructor() {
        const name = this.constructor.NAME;

        assertNonEmptyString(name, `Invalid .name for Form "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
        });
    }
}
