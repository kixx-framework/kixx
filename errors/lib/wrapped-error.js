/**
 * Extends the native Error class with some useful capabilities to help achieve these goals:
 *
 * 1. Make it easy to differentiate between unexpected errors and expected operational errors.
 * 2. Provide a mechanism to augment error information as it is caught and rethrown with the added context from each layer.
 * 3. Throw errors with specific HTTP application constructs which can help formulate an appropriate HTTP response to clients.
 */
export default class WrappedError extends Error {

    static CODE = 'WRAPPED_ERROR';

    /**
     * @param  {string} message Will become the message string passed to the native Error constructor.
     * @param  {object} [options] Object with shape { cause, httpStatusCode, code, name }
     * @param  {function} [sourceFunction] Will be passed to the native Error.captureStackTrace
     */
    constructor(message, options, sourceFunction) {
        options = options || {};
        super(message, options);

        const name = options.name || this.constructor.name;

        const causeCode = options.cause && options.cause.code;
        const code = options.code || causeCode || this.constructor.CODE;

        const httpStatusCode = options.httpStatusCode || this.constructor.HTTP_STATUS_CODE;

        // Use Object.defineProperty() so we can have public, enumerable
        // properties, but make them unwritable.
        // Secondly, only define properties if they exist.

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
            expected: {
                enumerable: true,
                value: Boolean(options.expected),
            },
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
