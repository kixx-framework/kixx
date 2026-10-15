export default class UsageError extends Error {
    constructor(message, options) {
        super(message, options);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: this.constructor.name,
            },
            code: {
                enumerable: true,
                value: this.constructor.name,
            },
        });
    }
}
