import WrappedError from './wrapped-error.js';


/**
 * Error used when provided credentials are invalid for the requested action.
 * Use this when authentication was attempted but not accepted.
 * @extends WrappedError
 */
export default class UnauthorizedError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'UNAUTHORIZED_ERROR';

    /**
     * The HTTP status code for this error type (401).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 401;

    /**
     * @param {string} message - Error message describing the authorization failure.
     * @param {Object} [options] - Additional error options.
     * @param {boolean} [options.expected=true] - Marks this as an operational/expected error.
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
    }
}
