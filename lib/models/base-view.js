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
            logger: {
                value: context.logger.createChild(`${ name }View`),
            },
        });
    }
}
