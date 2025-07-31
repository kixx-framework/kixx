import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when a request is unauthorized due to missing or invalid credentials.
 * Typically used for HTTP 401 Unauthorized responses, but distinct from UnauthenticatedError
 * in that it may be used for cases where authentication was provided but is insufficient or invalid.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class
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
     * Constructs a new UnauthorizedError instance.
     *
     * @param {string} message - The error message describing the authorization failure.
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
