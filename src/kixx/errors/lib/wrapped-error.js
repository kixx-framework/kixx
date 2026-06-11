/**
 * Base error type for this package.
 * Preserves standard Error behavior while adding stable error metadata used by
 * HTTP handlers and error serialization.
 * @extends Error
 */
export default class WrappedError extends Error {
    /**
     * The default error code for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'WRAPPED_ERROR';

    /**
     * @param {string} message - Error message passed to the native Error constructor.
     * @param {Object} [options] - Additional error options.
     * @param {Error} [options.cause] - Underlying cause.
     * @param {number} [options.httpStatusCode] - HTTP status code associated with the error.
     * @param {string} [options.code] - Custom error code override.
     * @param {string} [options.name] - Custom error name override.
     * @param {boolean} [options.expected=false] - Marks this as an operational/expected error.
     * @param {Function} [sourceFunction] - Function excluded from captured stack frames.
     */
    constructor(message, options, sourceFunction) {
        options = options || {};
        super(message, options);

        const name = options.name || this.constructor.name;
        const causeCode = options.cause && options.cause.code;
        const code = options.code || causeCode || this.constructor.CODE;
        const httpStatusCode = options.httpStatusCode || this.constructor.HTTP_STATUS_CODE;

        // Define public, enumerable, and unwritable properties if they exist.
        if (typeof name !== 'undefined') {
            Object.defineProperty(this, 'name', {
                enumerable: true,
                value: name,
            });
        }
        if (typeof code !== 'undefined') {
            Object.defineProperty(this, 'code', {
                enumerable: true,
                value: code,
            });
        }
        if (typeof httpStatusCode !== 'undefined') {
            Object.defineProperty(this, 'httpStatusCode', {
                enumerable: true,
                value: httpStatusCode,
            });
        }

        Object.defineProperties(this, {
            /**
             * Whether this error is expected during normal operation.
             * @name expected
             * @type {boolean}
             */
            expected: {
                enumerable: true,
                value: Boolean(options.expected),
            },
            /**
             * Whether the error has an associated HTTP status code.
             * @name httpError
             * @type {boolean}
             */
            httpError: {
                enumerable: true,
                value: typeof httpStatusCode !== 'undefined',
            },
        });

        if (Error.captureStackTrace && typeof sourceFunction === 'function') {
            Error.captureStackTrace(this, sourceFunction);
        }
    }
}
