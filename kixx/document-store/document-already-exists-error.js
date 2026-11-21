/**
 * Error thrown when a document-store create operation targets an existing document.
 * @extends Error
 */
export default class DocumentAlreadyExistsError extends Error {
    /**
     * @param {string} type - Document type namespace.
     * @param {string} id - Document identifier within the type namespace.
     */
    constructor(type, id) {
        super(`Document already exists: ${ type }/${ id }`);
        Object.defineProperties(this, {
            /**
             * Error class name used by serializers and diagnostics.
             * @name name
             * @type {string}
             */
            name: {
                value: 'DocumentAlreadyExistsError',
                enumerable: true,
            },
            /**
             * Stable application error code for duplicate document failures.
             * @name code
             * @type {string}
             */
            code: {
                value: 'DocumentAlreadyExistsError',
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
        });
    }
}
