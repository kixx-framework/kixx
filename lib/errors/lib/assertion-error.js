import WrappedError from './wrapped-error.js';


/**
 * Represents an error thrown when an assertion fails.
 * Typically used to indicate that an internal invariant or contract has been violated.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * @class
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

    /**
     * Constructs a new AssertionError instance.
     *
     * @param {string} message - The error message describing the failed assertion.
     * @param {Object} [options] - Optional. Additional error options.
     * @param {string} [options.code] - Optional custom error code.
     * @param {string} [options.name] - Optional custom error name.
     * @param {Error} [options.cause] - Optional cause of the error.
     * @param {Function} [sourceFunction] - Optional. Function to use for stack trace capture.
     */
    constructor(message, options, sourceFunction) {
        super(message, options, sourceFunction);
    }
}
