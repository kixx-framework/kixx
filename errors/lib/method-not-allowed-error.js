import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when an HTTP request uses a method not allowed on the target resource.
 * Typically used for HTTP 405 Method Not Allowed responses.
 * Extends WrappedError to provide additional context and stack trace handling, including the list
 * of allowed HTTP methods for constructing the "Allow" header in the HTTP response.
 *
 * @class
 * @extends WrappedError
 */
export default class MethodNotAllowedError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'METHOD_NOT_ALLOWED_ERROR';

    /**
     * The HTTP status code for this error type (405).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 405;

    /**
     * Constructs a new MethodNotAllowedError instance.
     *
     * @param {string} message - The error message describing the method not allowed.
     * @param {Object} [options] - Optional. Additional error options.
     * @param {Array<string>} [options.allowedMethods] - Array of allowed HTTP method names (e.g., ['GET', 'POST']).
     * @param {string} [options.code] - Optional custom error code.
     * @param {string} [options.name] - Optional custom error name.
     * @param {Error} [options.cause] - Optional cause of the error.
     * @param {Function} [sourceFunction] - Optional. Function to use for stack trace capture.
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);

        let allowedMethods;
        if (Array.isArray(opts.allowedMethods)) {
            // Make a shallow copy before freezing to prevent mutation.
            allowedMethods = Object.freeze(opts.allowedMethods.slice());
        } else {
            allowedMethods = Object.freeze([]);
        }

        /**
         * The array of allowed HTTP method names for this resource.
         * Used to construct the "Allow" header in HTTP responses.
         * @type {ReadonlyArray<string>}
         * @readonly
         */
        Object.defineProperty(this, 'allowedMethods', {
            enumerable: true,
            value: allowedMethods,
        });
    }
}
