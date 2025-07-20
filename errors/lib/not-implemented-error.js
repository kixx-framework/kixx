import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when a requested HTTP method or endpoint is not implemented.
 * Typically used for HTTP 501 Not Implemented responses.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class
 * @extends WrappedError
 */
export default class NotImplementedError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'NOT_IMPLEMENTED_ERROR';

    /**
     * The HTTP status code for this error type (501).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 501;

    /**
     * Constructs a new NotImplementedError instance.
     *
     * @param {string} message - The error message describing the unimplemented feature.
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
}
