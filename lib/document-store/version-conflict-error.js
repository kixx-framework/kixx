/**
 * Error thrown when a versioned document-store write sees a different version.
 * @extends Error
 */
export default class VersionConflictError extends Error {
    /**
     * @param {string} type - Document type namespace.
     * @param {string} id - Document identifier within the type namespace.
     * @param {number} expectedVersion - Version required by the caller.
     * @param {number} actualVersion - Version currently stored.
     */
    constructor(type, id, expectedVersion, actualVersion) {
        super(`Document version conflict: ${ type }/${ id } expected version ${ expectedVersion } but found version ${ actualVersion }`);
        Object.defineProperties(this, {
            /**
             * Error class name used by serializers and diagnostics.
             * @name name
             * @type {string}
             */
            name: {
                value: 'VersionConflictError',
                enumerable: true,
            },
            /**
             * Stable application error code for document version conflicts.
             * @name code
             * @type {string}
             */
            code: {
                value: 'VersionConflictError',
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
             * Version required by the caller.
             * @name expectedVersion
             * @type {number}
             */
            expectedVersion: {
                value: expectedVersion,
                enumerable: true,
            },
            /**
             * Version currently stored.
             * @name actualVersion
             * @type {number}
             */
            actualVersion: {
                value: actualVersion,
                enumerable: true,
            },
        });
    }
}
