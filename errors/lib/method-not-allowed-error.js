import WrappedError from './wrapped-error.js';


/**
 * Provide some additional functionality for 405 Method Not Allowed
 * responses by including the allowed method names to construct the
 * required Allowed HTTP header in the HTTP response.
 */
export default class MethodNotAllowedError extends WrappedError {
    static CODE = 'METHOD_NOT_ALLOWED_ERROR';
    static HTTP_STATUS_CODE = 405;

    /**
     * @param  {string} message Will become the message string passed to the native Error constructor.
     * @param  {object} [spec] Object with shape { cause, allowedMethods, code, name }
     * @param  {Array} [spec.allowedMethods] Array of allowed HTTP method name strings.
     * @param  {function} [sourceFunction] Will be passed to the native Error.captureStackTrace
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);

        let allowedMethods;
        if (Array.isArray(opts.allowedMethods)) {
            // Make a copy before freezing.
            allowedMethods = Object.freeze(opts.allowedMethods.slice());
        } else {
            allowedMethods = Object.freeze([]);
        }

        Object.defineProperty(this, 'allowedMethods', {
            enumerable: true,
            value: allowedMethods,
        });
    }
}
