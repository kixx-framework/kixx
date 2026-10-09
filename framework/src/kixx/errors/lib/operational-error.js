import WrappedError from './wrapped-error.js';


/**
 * Base error for expected runtime failures such as I/O or integration issues.
 * Sets `expected` to `true` by default for operational error handling flows.
 * @extends WrappedError
 */
export default class OperationalError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'OPERATIONAL_ERROR';

    /**
     * @param {string} message - Error message describing the operational failure.
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
