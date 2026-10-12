import WrappedError from './wrapped-error.js';


/**
 * Error used when an internal invariant or assertion fails.
 * @extends WrappedError
 */
export default class AssertionError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'ASSERTION_ERROR';
}
