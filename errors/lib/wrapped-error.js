/**
 * @class WrappedError
 * @extends Error
 *
 * @classdesc
 * Extends the native Error class to provide enhanced error handling capabilities:
 *
 * 1. Differentiates between unexpected errors and expected operational errors via the `expected` property.
 * 2. Allows error information to be augmented as errors are caught and rethrown, preserving context from each layer.
 * 3. Supports HTTP-specific constructs (e.g., `httpStatusCode`, `httpError`) to facilitate appropriate HTTP responses.
 *
 * @example
 * throw new WrappedError('Something went wrong', { code: 'MY_ERROR', httpStatusCode: 500 });
 *
 * @property {string} name - The error name (defaults to the class name or provided via options).
 * @property {string} code - The error code (defaults to the class static CODE or provided via options).
 * @property {number} [httpStatusCode] - The HTTP status code associated with the error, if any.
 * @property {boolean} expected - Indicates if the error is expected (operational).
 * @property {boolean} httpError - Indicates if the error is associated with an HTTP status code.
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
     * Constructs a new WrappedError instance.
     *
     * @param {string} message - The error message passed to the native Error constructor.
     * @param {object} [options] - Optional error options.
     * @param {Error} [options.cause] - The underlying cause of this error, if any.
     * @param {number} [options.httpStatusCode] - HTTP status code to associate with this error.
     * @param {string} [options.code] - Custom error code.
     * @param {string} [options.name] - Custom error name.
     * @param {boolean} [options.expected=false] - Whether this error is expected (operational).
     * @param {function} [sourceFunction] - Function to use for stack trace capture.
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
             * Indicates if the error is expected (operational).
             * @type {boolean}
             * @readonly
             */
            expected: {
                enumerable: true,
                value: Boolean(options.expected),
            },
            /**
             * Indicates if the error is associated with an HTTP status code.
             * @type {boolean}
             * @readonly
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
