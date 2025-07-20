import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when one or more validations fail.
 * Particularly useful for aggregating multiple validation failures, as it exposes
 * the `errors` array and provides a `.push()` method to add new validation errors.
 *
 * Typically used for HTTP 422 Unprocessable Entity responses.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class
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
     * The array of validation failure details.
     * Each entry is an object with at least a `message` and `source` property.
     * @type {Array<{message: string, source: string}>}
     * @instance
     * @readonly
     */
    errors = [];

    /**
     * Constructs a new ValidationError instance.
     *
     * @param {string} message - The error message describing the validation failure(s).
     * @param {Object} [options] - Optional. Additional error options.
     * @param {string} [options.code] - Optional custom error code.
     * @param {string} [options.name] - Optional custom error name.
     * @param {Error} [options.cause] - Optional cause of the error.
     * @param {Function} [sourceFunction] - Optional. Function to use for stack trace capture.
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }

    /**
     * The number of validation errors in the `errors` array.
     * @return {number}
     */
    get length() {
        return this.errors.length;
    }

    /**
     * Adds a new validation failure to the `errors` array.
     *
     * @param {string} message - The validation failure message.
     * @param {string} source - The property path or source that caused the validation to fail.
     */
    push(message, source) {
        this.errors.push({
            message,
            source,
        });
    }
}
