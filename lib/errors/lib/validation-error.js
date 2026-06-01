import WrappedError from './wrapped-error.js';


/**
 * Error used to aggregate multiple validation failures in one response.
 * @extends WrappedError
 */
export default class ValidationError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'VALIDATION_ERROR';

    /**
     * The HTTP status code for this error type (422).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 422;

    /**
     * Validation failure entries collected for the current error.
     * @type {Array<{message: string, source: string}>}
     */
    errors = [];

    /**
     * @param {string} message - Error message describing validation failures.
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

    /**
     * Number of collected validation failure entries.
     * @returns {number}
     */
    get length() {
        return this.errors.length;
    }

    /**
     * Adds one validation failure entry.
     * @param {string} message - Validation failure message.
     * @param {string} source - Field path or subsystem that produced the failure.
     */
    push(message, source) {
        this.errors.push({
            message,
            source,
        });
    }
}
