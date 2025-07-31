import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when the server refuses to accept the request because the payload is in a format not supported by the server.
 * Typically used for HTTP 415 Unsupported Media Type responses.
 * Extends WrappedError to provide additional context and stack trace handling, including the lists of
 * acceptable mimetypes, encodings, and languages for content negotiation.
 *
 * @class
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
     * Constructs a new UnsupportedMediaTypeError instance.
     *
     * @param {string} message - The error message describing why the media type is unsupported.
     * @param {Object} [options] - Optional. Additional error options.
     * @param {Array<string>} [options.accept] - Array of acceptable mimetypes (e.g., ['application/json', 'text/html']).
     * @param {Array<string>} [options.acceptEncoding] - Array of acceptable encodings (e.g., ['gzip', 'deflate']).
     * @param {Array<string>} [options.acceptLanguage] - Array of acceptable languages (e.g., ['en-US', 'fr']).
     * @param {string} [options.code] - Optional custom error code.
     * @param {string} [options.name] - Optional custom error name.
     * @param {Error} [options.cause] - Optional cause of the error.
     * @param {Function} [sourceFunction] - Optional. Function to use for stack trace capture.
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
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
             * The list of acceptable mimetypes for the request, used for constructing the Accept header.
             * @type {ReadonlyArray<string>}
             * @instance
             * @readonly
             */
            accept: {
                enumerable: true,
                value: accept,
            },
            /**
             * The list of acceptable encodings for the request, used for constructing the Accept-Encoding header.
             * @type {ReadonlyArray<string>}
             * @instance
             * @readonly
             */
            acceptEncoding: {
                enumerable: true,
                value: acceptEncoding,
            },
            /**
             * The list of acceptable languages for the request, used for constructing the Accept-Language header.
             * @type {ReadonlyArray<string>}
             * @instance
             * @readonly
             */
            acceptLanguage: {
                enumerable: true,
                value: acceptLanguage,
            },
        });
    }
}
