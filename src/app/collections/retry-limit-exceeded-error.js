/**
 * Error thrown when a bounded data-source retry loop cannot complete.
 * @extends Error
 */
export default class RetryLimitExceededError extends Error {
    /**
     * @param {string} type - Document type namespace.
     * @param {string} id - Document identifier within the type namespace.
     * @param {number} retryLimit - Number of retries allowed after the initial failed write.
     * @param {Object} [options] - Error options.
     * @param {Error} [options.cause] - Last conflict error observed before the limit was exceeded.
     */
    constructor(type, id, retryLimit, options) {
        super(
            `Retry limit exceeded: ${ type }/${ id } could not be updated after ${ retryLimit } retries`,
            { cause: options?.cause },
        );

        Object.defineProperties(this, {
            /**
             * Error class name used by serializers and diagnostics.
             * @name name
             * @type {string}
             */
            name: {
                value: 'RetryLimitExceededError',
                enumerable: true,
            },
            /**
             * Stable application error code for exhausted retry loops.
             * @name code
             * @type {string}
             */
            code: {
                value: 'RetryLimitExceededError',
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
             * Document identifier used in the failed operation.
             * @name id
             * @type {string}
             */
            id: {
                value: id,
                enumerable: true,
            },
            /**
             * Number of retries allowed after the initial failed write.
             * @name retryLimit
             * @type {number}
             */
            retryLimit: {
                value: retryLimit,
                enumerable: true,
            },
        });
    }
}
