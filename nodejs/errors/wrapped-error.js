import { getFullStack } from './utils.js';


/**
 * Extends the native Error class with some useful properties.
 */
export default class WrappedError extends Error {

    static CODE = 'WRAPPED_ERROR';

    /**
     * @param  {string} message Will become the message string passed to the native Error constructor.
     * @param  {object} [spec] Object with shape { cause, httpStatusCode, code, name }
     * @param  {function} [sourceFunction] Will be passed to the native Error.captureStackTrace
     */
    constructor(message, spec, sourceFunction) {
        spec = spec || {};
        const cause = spec.cause || null;

        super(message, { cause });

        const causeCode = cause && cause.code;

        // Use Object.defineProperties so we can have public, enumerable
        // properties, but make them unwritable.
        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: spec.name || this.name || this.constructor.name,
            },
            code: {
                enumerable: true,
                value: spec.code || causeCode || this.constructor.CODE,
            },
            httpStatusCode: {
                enumerable: true,
                value: spec.httpStatusCode || this.constructor.HTTP_STATUS_CODE,
            },
            isWrappedError: {
                enumerable: true,
                value: true,
            },
        });

        if (typeof sourceFunction === 'function') {
            Error.captureStackTrace(this, sourceFunction);
        }
    }

    /**
     * Does this error contain an HTTP status code?
     * @return {Boolean}
     */
    get isHttpError() {
        return Number.isInteger(this.httpStatusCode);
    }

    /**
     * Get the stack trace from this error and all its descendant causes.
     * @return {string}
     */
    get fullStackTrace() {
        return getFullStack(this);
    }
}
