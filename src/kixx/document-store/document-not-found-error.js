/**
 * Error thrown when a document-store operation targets a missing document.
 * @extends Error
 */
export default class DocumentNotFoundError extends Error {
    /**
     * @param {string} type - Document type namespace.
     * @param {string} id - Document identifier within the type namespace.
     */
    constructor(type, id) {
        super(`Document not found: ${ type }/${ id }`);
        Object.defineProperties(this, {
            /**
             * Error class name used by serializers and diagnostics.
             * @name name
             * @type {string}
             */
            name: {
                value: 'DocumentNotFoundError',
                enumerable: true,
            },
            /**
             * Stable application error code for missing document failures.
             * @name code
             * @type {string}
             */
            code: {
                value: 'DocumentNotFoundError',
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
