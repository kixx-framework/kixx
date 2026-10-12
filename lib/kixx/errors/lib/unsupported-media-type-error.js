import WrappedError from './wrapped-error.js';


/**
 * Error used when request payload metadata does not match supported formats.
 * Carries acceptable negotiation values for constructing response headers.
 * @extends WrappedError
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/415
 */
export default class UnsupportedMediaTypeError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'UNSUPPORTED_MEDIA_TYPE_ERROR';

    /**
     * The HTTP status code for this error type (415).
     * @type {number}
     * @static
     * @readonly
     */
    static HTTP_STATUS_CODE = 415;

    /**
     * @param {string} message - Error message describing unsupported media metadata.
     * @param {Object} [options] - Additional error options.
     * @param {boolean} [options.expected=true] - Marks this as an operational/expected error.
     * @param {string[]} [options.accept] - Acceptable request media types.
     * @param {string[]} [options.acceptEncoding] - Acceptable content encodings.
     * @param {string[]} [options.acceptLanguage] - Acceptable content languages.
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

        let accept;
        if (Array.isArray(opts.accept)) {
            // Make a shallow copy before freezing to prevent mutation.
            accept = Object.freeze(opts.accept.slice());
        } else {
            accept = Object.freeze([]);
        }

        let acceptEncoding;
        if (Array.isArray(opts.acceptEncoding)) {
            // Make a shallow copy before freezing to prevent mutation.
            acceptEncoding = Object.freeze(opts.acceptEncoding.slice());
        } else {
            acceptEncoding = Object.freeze([]);
        }

        let acceptLanguage;
        if (Array.isArray(opts.acceptLanguage)) {
            // Make a shallow copy before freezing to prevent mutation.
            acceptLanguage = Object.freeze(opts.acceptLanguage.slice());
        } else {
            acceptLanguage = Object.freeze([]);
        }

        Object.defineProperties(this, {
            /**
             * Acceptable request media types.
             * @name accept
             * @type {ReadonlyArray<string>}
             */
            accept: {
                enumerable: true,
                value: accept,
            },
            /**
             * Acceptable content encodings.
             * @name acceptEncoding
             * @type {ReadonlyArray<string>}
             */
            acceptEncoding: {
                enumerable: true,
                value: acceptEncoding,
            },
            /**
             * Acceptable content languages.
             * @name acceptLanguage
             * @type {ReadonlyArray<string>}
             */
            acceptLanguage: {
                enumerable: true,
                value: acceptLanguage,
            },
        });
    }
}
