import WrappedError from './wrapped-error.js';


/**
 * Represents an operational error that occurs during normal application operation,
 * such as network failures, database errors, or other recoverable issues.
 * Extends WrappedError to provide additional context and stack trace handling.
 *
 * Note: Sets the `expected` flag to `true` by default.
 *
 * @class
 * @extends WrappedError
 */
export default class OperationalError extends WrappedError {
    /**
     * The error code string for this error type.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'OPERATIONAL_ERROR';

    /**
     * Constructs a new OperationalError instance.
     *
     * @param {string} message - The error message describing the operational error.
     * @param {Object} [options] - Optional. Additional error options.
     * @param {string} [options.code] - Optional custom error code.
     * @param {string} [options.name] - Optional custom error name.
     * @param {Error} [options.cause] - Optional cause of the error.
     * @param {Function} [sourceFunction] - Optional. Function to use for stack trace capture.
     */
    constructor(message, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(message, opts, sourceFunction);
    }
}
