import WrappedError from './wrapped-error.js';


/**
 * Error used when a resource rejects the request HTTP method.
 * Carries allowed methods for constructing an `Allow` response header.
 * @extends WrappedError
 */
export default class MethodNotAllowedError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'METHOD_NOT_ALLOWED_ERROR';

    /**
     * The HTTP status code for this error type (405).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 405;

    /**
     * @param {string} message - Error message describing the rejected method.
     * @param {Object} [options] - Additional error options.
     * @param {boolean} [options.expected=true] - Marks this as an operational/expected error.
     * @param {string[]} [options.allowedMethods] - Allowed HTTP methods for this resource.
     * @param {string} [options.code] - Custom error code override.
     * @param {string} [options.name] - Custom error name override.
     * @param {Error} [options.cause] - Underlying cause.
     * @param {Function} [sourceFunction] - Function excluded from captured stack frames.
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({}, options);
        if (typeof opts.expected === 'undefined') {
            opts.expected = true;
        }
        super(message, opts, sourceFunction);

        let allowedMethods;
        if (Array.isArray(opts.allowedMethods)) {
            // Make a shallow copy before freezing to prevent mutation.
            allowedMethods = Object.freeze(opts.allowedMethods.slice());
        } else {
            allowedMethods = Object.freeze([]);
        }

        /**
         * Allowed HTTP methods for this resource.
         * @name allowedMethods
         * @type {ReadonlyArray<string>}
         */
        Object.defineProperty(this, 'allowedMethods', {
            enumerable: true,
            value: allowedMethods,
        });
    }
}
