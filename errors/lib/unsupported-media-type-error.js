import WrappedError from './wrapped-error.js';


/**
 * Provide some additional functionality for 415 Unsupported Media Type
 * responses by including mimetype, encoding, and language information
 * for [content negotiation](https://httpwg.org/specs/rfc9110.html#status.415).
 */
export default class UnsupportedMediaTypeError extends WrappedError {
    static CODE = 'UNSUPPORTED_MEDIA_TYPE_ERROR';
    static HTTP_STATUS_CODE = 415;

    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);

        let accept;
        if (Array.isArray(opts.accept)) {
            // Make a copy before freezing.
            accept = Object.freeze(opts.accept.slice());
        } else {
            accept = Object.freeze([]);
        }

        let acceptEncoding;
        if (Array.isArray(opts.acceptEncoding)) {
            // Make a copy before freezing.
            acceptEncoding = Object.freeze(opts.acceptEncoding.slice());
        } else {
            acceptEncoding = Object.freeze([]);
        }

        let acceptLanguage;
        if (Array.isArray(opts.acceptLanguage)) {
            acceptLanguage = opts.acceptLanguage;
            // Make a copy before freezing.
            acceptLanguage = Object.freeze(opts.acceptLanguage.slice());
        } else {
            acceptLanguage = Object.freeze([]);
        }

        Object.defineProperties(this, {
            accept: {
                enumerable: true,
                value: accept,
            },
            acceptEncoding: {
                enumerable: true,
                value: acceptEncoding,
            },
            acceptLanguage: {
                enumerable: true,
                value: acceptLanguage,
            },
        });
    }
}
