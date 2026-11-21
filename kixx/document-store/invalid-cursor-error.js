/**
 * Expected input error thrown when a public document-store cursor cannot be
 * verified or decoded by the DocumentStore facade.
 *
 * Callers may catch this error to translate an invalid, expired-if-applicable,
 * or signature-mismatched cursor into their transport's input-error response.
 * @extends Error
 */
export default class InvalidCursorError extends Error {
    constructor() {
        super('Invalid document store cursor');
        Object.defineProperties(this, {
            /**
             * Error class name used by callers that translate expected cursor input failures.
             * @name name
             * @type {string}
             */
            name: {
                value: 'InvalidCursorError',
                enumerable: true,
            },
            /**
             * Stable application error code for invalid public cursor failures.
             * @name code
             * @type {string}
             */
            code: {
                value: 'InvalidCursorError',
                enumerable: true,
            },
            /**
             * Identifies this as an operational input failure rather than an internal storage fault.
             * @name expected
             * @type {boolean}
             */
            expected: {
                value: true,
                enumerable: true,
            },
        });
    }
}
