import WrappedError from './wrapped-error.js';


export class BadRequestError extends WrappedError {
    static CODE = 'BAD_REQUEST_ERROR';
    static HTTP_STATUS_CODE = 400;
}

export class ConflictError extends WrappedError {
    static CODE = 'CONFLICT_ERROR';
    static HTTP_STATUS_CODE = 409;
}

export class ForbiddenError extends WrappedError {
    static CODE = 'FORBIDDEN_ERROR';
    static HTTP_STATUS_CODE = 403;
}

/**
 * Provide some additional functionality for 405 Method Not Allowed
 * responses by including the allowed method names to construct the
 * required Allowed HTTP header in the HTTP response.
 */
export class MethodNotAllowedError extends WrappedError {
    static CODE = 'METHOD_NOT_ALLOWED_ERROR';
    static HTTP_STATUS_CODE = 405;

    /**
     * @param  {string} message Will become the message string passed to the native Error constructor.
     * @param  {object} [spec] Object with shape { cause, allowedMethods, code, name }
     * @param  {Array} [spec.allowedMethods] Array of allowed HTTP method name strings.
     * @param  {function} [sourceFunction] Will be passed to the native Error.captureStackTrace
     */
    constructor(message, spec, sourceFunction) {
        spec = spec || {};
        super(message, spec, sourceFunction);

        let allowedMethods;
        if (Array.isArray(spec.allowedMethods)) {
            // Make a copy before freezing.
            allowedMethods = Object.freeze(spec.allowedMethods.slice());
        } else {
            allowedMethods = Object.freeze([]);
        }

        Object.defineProperties(this, {
            allowedMethods: {
                enumerable: true,
                value: allowedMethods,
            },
        });
    }
}

/**
 * Provide some additional functionality for 406 Not Acceptable
 * responses by including mimetype, encoding, and language information
 * for [content negotiation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation).
 */
export class NotAcceptableError extends WrappedError {
    static CODE = 'NOT_ACCEPTABLE_ERROR';
    static HTTP_STATUS_CODE = 406;

    constructor(message, spec, sourceFunction) {
        spec = spec || {};
        super(message, spec, sourceFunction);

        let accept;
        if (Array.isArray(spec.accept)) {
            // Make a copy before freezing.
            accept = Object.freeze(spec.accept.slice());
        } else {
            accept = Object.freeze([]);
        }

        let acceptEncoding;
        if (Array.isArray(spec.acceptEncoding)) {
            // Make a copy before freezing.
            acceptEncoding = Object.freeze(spec.acceptEncoding.slice());
        } else {
            acceptEncoding = Object.freeze([]);
        }

        let acceptLanguage;
        if (Array.isArray(spec.acceptLanguage)) {
            acceptLanguage = spec.acceptLanguage;
            // Make a copy before freezing.
            acceptLanguage = Object.freeze(spec.acceptLanguage.slice());
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

export class NotFoundError extends WrappedError {
    static CODE = 'NOT_FOUND_ERROR';
    static HTTP_STATUS_CODE = 404;
}

export class NotImplementedError extends WrappedError {
    static CODE = 'NOT_IMPLEMENTED_ERROR';
    static HTTP_STATUS_CODE = 501;
}

export class UnauthenticatedError extends WrappedError {
    static CODE = 'UNAUTHENTICATED_ERROR';
    static HTTP_STATUS_CODE = 401;
}

export class UnauthorizedError extends WrappedError {
    static CODE = 'UNAUTHORIZED_ERROR';
    static HTTP_STATUS_CODE = 401;
}

/**
 * Provide some additional functionality for 415 Unsupported Media Type
 * responses by including mimetype, encoding, and language information
 * for [content negotiation](https://httpwg.org/specs/rfc9110.html#status.415).
 */
export class UnsupportedMediaTypeError extends WrappedError {
    static CODE = 'UNSUPPORTED_MEDIA_TYPE_ERROR';
    static HTTP_STATUS_CODE = 415;

    constructor(message, spec, sourceFunction) {
        spec = spec || {};
        super(message, spec, sourceFunction);

        let accept;
        if (Array.isArray(spec.accept)) {
            // Make a copy before freezing.
            accept = Object.freeze(spec.accept.slice());
        } else {
            accept = Object.freeze([]);
        }

        let acceptEncoding;
        if (Array.isArray(spec.acceptEncoding)) {
            // Make a copy before freezing.
            acceptEncoding = Object.freeze(spec.acceptEncoding.slice());
        } else {
            acceptEncoding = Object.freeze([]);
        }

        let acceptLanguage;
        if (Array.isArray(spec.acceptLanguage)) {
            acceptLanguage = spec.acceptLanguage;
            // Make a copy before freezing.
            acceptLanguage = Object.freeze(spec.acceptLanguage.slice());
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

/**
 * A ValidationError is particularly useful when multiple validations fail
 * as it makes the ValidationError:errors Array availble and provides
 * the .push() method.
 */
export class ValidationError extends WrappedError {
    static CODE = 'VALIDATION_ERROR';
    static HTTP_STATUS_CODE = 422;

    errors = [];

    /**
     * @return {number} The length of the .errors Array.
     */
    get length() {
        return this.errors.length;
    }

    /**
     * Push a new validation failure error onto the .errors Array. This will
     * create a new Error instance and push it onto the .errors Array.
     * @param  {string}
     * @param  {string} The property path which caused the validation to fail.
     */
    push(message, source) {
        const err = new Error(message);
        err.source = source;
        this.errors.push(err);
    }
}
