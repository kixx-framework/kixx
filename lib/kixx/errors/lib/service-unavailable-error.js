import WrappedError from './wrapped-error.js';


/**
 * Error used when a backing service is temporarily unable to handle the request.
 * Carries an optional retry hint for constructing a `Retry-After` response header.
 * @extends WrappedError
 */
export default class ServiceUnavailableError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'SERVICE_UNAVAILABLE_ERROR';

    /**
     * The HTTP status code for this error type (503).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 503;

    /**
     * @param {string} message - Error message describing the unavailable service.
     * @param {Object} [options] - Additional error options.
     * @param {boolean} [options.expected=true] - Marks this as an operational/expected error.
     * @param {number} [options.retryAfterSeconds] - Non-negative integer seconds a client should wait before retrying.
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

        // Drop an invalid hint rather than throw, like allowedMethods on
        // MethodNotAllowedError.
        const { retryAfterSeconds } = opts;
        const isValidHint = Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0;

        /**
         * Seconds a client should wait before retrying, or null when unknown.
         * @name retryAfterSeconds
         * @type {number|null}
         */
        Object.defineProperty(this, 'retryAfterSeconds', {
            enumerable: true,
            value: isValidHint ? retryAfterSeconds : null,
        });
    }
}
