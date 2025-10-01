import { assert } from '../assertions/mod.js';

export default class BaseForm {

    constructor(context) {
        const name = this.constructor.name;

        assert(context, 'A Form requires a Context');

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            context: {
                enumerable: true,
                value: context,
            },
            logger: {
                value: context.logger.createChild(`${ name }Form`),
            },
        });
    }
}
