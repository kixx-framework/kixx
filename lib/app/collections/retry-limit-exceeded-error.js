import { WrappedError } from '../../kixx/errors/mod.js';


/**
 * Error thrown when a bounded data-source retry loop cannot complete.
 * @extends WrappedError
 */
export default class RetryLimitExceededError extends WrappedError {

    /**
     * Stable application error code for exhausted retry loops.
     * @type {string}
     * @static
     * @readonly
     */
    static CODE = 'RetryLimitExceededError';

    /**
     * @param {string} type - Document type namespace.
     * @param {string} id - Document identifier within the type namespace.
     * @param {number} retryLimit - Number of retries allowed after the initial failed write.
     * @param {Object} [options] - Error options.
     * @param {Error} [options.cause] - Last conflict error observed before the limit was exceeded.
     */
    constructor(type, id, retryLimit, options) {
        // WrappedError derives `name` from the constructor name and `code` from
        // the static CODE, so only `cause` is forwarded through options here.
        super(
            `Retry limit exceeded: ${ type }/${ id } could not be updated after ${ retryLimit } retries`,
            { cause: options?.cause },
            RetryLimitExceededError,
        );

        Object.defineProperties(this, {
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
