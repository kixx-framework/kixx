import WrappedError from './wrapped-error.js';


/**
 * Error used when a request precondition evaluates to false.
 * @extends WrappedError
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/412
 */
export default class PreconditionFailedError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'PRECONDITION_FAILED_ERROR';

    /**
     * The HTTP status code for this error type (412).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 412;

    /**
     * @param {string} message - Error message describing the failed precondition.
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
