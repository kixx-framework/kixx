import WrappedError from './wrapped-error.js';


/**
 * Provide some additional functionality for 406 Not Acceptable
 * responses by including mimetype, encoding, and language information
 * for [content negotiation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation).
 */
export default class NotAcceptableError extends WrappedError {
    static CODE = 'NOT_ACCEPTABLE_ERROR';
    static HTTP_STATUS_CODE = 406;

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
