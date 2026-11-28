/**
 * A mistake the user can fix by changing arguments, settings, or the outside
 * world. The runner prints its message alone, with no stack, and exits 2
 * unless the error's `code` has its own row in `lib/exit-codes.js`.
 *
 * `code` is the class name. A subclass that needs a stable code of its own,
 * one that survives renaming the class, declares it as `static code`.
 */
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
                value: this.constructor.code ?? this.constructor.name,
            },
        });
    }
}
