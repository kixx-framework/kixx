import { assert, assertNonEmptyString } from '../assertions/mod.js';

export default class BaseForm {

    static NAME = '';

    constructor(context) {
        const name = this.constructor.NAME;

        assert(context, 'A Form requires a Context');
        assertNonEmptyString(name, `Invalid .name for Form "${ this.constructor.name }"`);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            context: {
                enumerable: true,
                value: context,
            },
        });
    }
}
