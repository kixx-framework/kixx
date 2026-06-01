/**
 * Error thrown when a document-store write would violate a configured unique
 * secondary index.
 *
 * Distinct from DocumentAlreadyExistsError, which signals a collision on the
 * primary `(type, id)` key. This error signals that another row already holds
 * the same value on the indicated secondary index.
 *
 * @extends Error
 */
export default class DocumentUniqueIndexViolationError extends Error {
    /**
     * @param {string} type - Document type namespace.
     * @param {string} indexName - Name of the unique index that was violated.
     */
    constructor(type, indexName) {
        super(`Unique index "${ indexName }" violated for type "${ type }"`);
        Object.defineProperties(this, {
            /**
             * Error class name used by serializers and diagnostics.
             * @name name
             * @type {string}
             */
            name: {
                value: 'DocumentUniqueIndexViolationError',
                enumerable: true,
            },
            /**
             * Stable application error code for unique-index conflict failures.
             * @name code
             * @type {string}
             */
            code: {
                value: 'DocumentUniqueIndexViolationError',
                enumerable: true,
            },
            /**
             * Document type namespace used in the failed operation.
             * @name type
             * @type {string}
             */
            type: {
                value: type,
                enumerable: true,
            },
            /**
             * Name of the unique index that rejected the write.
             * @name indexName
             * @type {string}
             */
            indexName: {
                value: indexName,
                enumerable: true,
            },
        });
    }
}
