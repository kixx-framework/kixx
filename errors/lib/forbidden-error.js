import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when a request is forbidden due to insufficient permissions.
 * Typically used for HTTP 403 Forbidden responses.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class ForbiddenError
 * @extends WrappedError
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403
 */
export default class ForbiddenError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'FORBIDDEN_ERROR';

    /**
     * The HTTP status code for this error type (403).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 403;

    /**
     * Constructs a new ForbiddenError instance.
     *
     * @param {string} message - The error message describing the forbidden request.
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
