import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when a request could not be completed due to a conflict with the current state of the resource.
 * Typically used for HTTP 409 Conflict responses.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class
 * @extends WrappedError
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409
 */
export default class ConflictError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'CONFLICT_ERROR';

    /**
     * The HTTP status code for this error type (409).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 409;

    /**
     * Constructs a new ConflictError instance.
     *
     * @param {string} message - The error message describing the conflict.
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
