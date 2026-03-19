import { WrappedError } from '../errors.js';

/**
 * Thrown when a DataStore operation is invoked before initialize() completes.
 */
export class DataStoreNotInitializedError extends WrappedError {
    static CODE = 'DATASTORE_NOT_INITIALIZED';

    /**
     * @name operation
     * @type {string}
     */

    /**
     * @param {string} operation - Public DataStore method the caller attempted to invoke.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(operation, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(
            `DataStore#${ operation }() requires initialize() to complete first`,
            opts,
            sourceFunction
        );
        Object.defineProperties(this, {
            /**
             * Public DataStore method the caller attempted to invoke.
             * @name operation
             * @type {string}
             */
            operation: { enumerable: true, value: operation },
        });
    }
}

/**
 * Thrown when a DataStore operation is invoked after close().
 */
export class DataStoreClosedError extends WrappedError {
    static CODE = 'DATASTORE_CLOSED';

    /**
     * @name operation
     * @type {string}
     */

    /**
     * @param {string} operation - Public DataStore method the caller attempted to invoke.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(operation, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(
            `DataStore#${ operation }() cannot be used after close()`,
            opts,
            sourceFunction
        );
        Object.defineProperties(this, {
            /**
             * Public DataStore method the caller attempted to invoke.
             * @name operation
             * @type {string}
             */
            operation: { enumerable: true, value: operation },
        });
    }
}

/**
 * Thrown when a create operation targets a (type, id) that already exists.
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export class DocumentAlreadyExistsError extends WrappedError {
    static CODE = 'DOCUMENT_EXISTS';
    static HTTP_STATUS_CODE = 409;

    /**
     * @param {string} type - Document type of the conflicting document.
     * @param {string} id - Document id of the conflicting document.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(type, id, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(`Document ${ type }:${ id } already exists`, opts, sourceFunction);
        Object.defineProperties(this, {
            /**
             * Document type of the conflicting document.
             * @name type
             * @type {string}
             */
            type: { enumerable: true, value: type },
            /**
             * Document id of the conflicting document.
             * @name id
             * @type {string}
             */
            id: { enumerable: true, value: id },
        });
    }
}

/**
 * Thrown when an update or delete targets a (type, id) that does not exist.
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export class DocumentNotFoundError extends WrappedError {
    static CODE = 'DOCUMENT_NOT_FOUND';
    static HTTP_STATUS_CODE = 404;

    /**
     * @param {string} type - Document type of the missing document.
     * @param {string} id - Document id of the missing document.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(type, id, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(`Document ${ type }:${ id } not found`, opts, sourceFunction);
        Object.defineProperties(this, {
            /**
             * Document type of the missing document.
             * @name type
             * @type {string}
             */
            type: { enumerable: true, value: type },
            /**
             * Document id of the missing document.
             * @name id
             * @type {string}
             */
            id: { enumerable: true, value: id },
        });
    }
}

/**
 * Thrown when a write or delete is rejected because the expected version does not match
 * the stored version. Carries the expected and actual versions so callers can implement
 * retry or merge logic.
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export class VersionConflictError extends WrappedError {
    static CODE = 'VERSION_CONFLICT';
    static HTTP_STATUS_CODE = 409;

    /**
     * @name type
     * @type {string}
     */

    /**
     * @name id
     * @type {string}
     */

    /**
     * @name expectedVersion
     * @type {number}
     */

    /**
     * @name actualVersion
     * @type {number}
     */

    /**
     * @param {string} type - Document type.
     * @param {string} id - Document id.
     * @param {number} expectedVersion - Version the caller expected to be current.
     * @param {number} actualVersion - Version currently stored.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(type, id, expectedVersion, actualVersion, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(
            `Version conflict on ${ type }:${ id } — expected ${ expectedVersion }, found ${ actualVersion }`,
            opts,
            sourceFunction
        );
        Object.defineProperties(this, {
            /**
             * Document type of the conflicting document.
             * @name type
             * @type {string}
             */
            type: { enumerable: true, value: type },
            /**
             * Document id of the conflicting document.
             * @name id
             * @type {string}
             */
            id: { enumerable: true, value: id },
            /**
             * Version the caller provided.
             * @name expectedVersion
             * @type {number}
             */
            expectedVersion: { enumerable: true, value: expectedVersion },
            /**
             * Version currently stored at the time of the conflict.
             * @name actualVersion
             * @type {number}
             */
            actualVersion: { enumerable: true, value: actualVersion },
        });
    }
}

/**
 * Thrown when a query references a custom index attribute that has not been declared
 * via DataStore#configureIndexes().
 * @see {import('../ports/storage-engine.js').StorageEngine} StorageEngine port
 */
export class IndexNotConfiguredError extends WrappedError {
    static CODE = 'INDEX_NOT_CONFIGURED';
    static HTTP_STATUS_CODE = 400;

    /**
     * @param {string} type - Document type for which the index was requested.
     * @param {string} attribute - Index attribute that is not configured.
     * @param {Object} [options] - WrappedError options (cause, etc.)
     * @param {Function} [sourceFunction] - Strips this function from the stack trace.
     */
    constructor(type, attribute, options, sourceFunction) {
        const opts = Object.assign({ expected: true }, options);
        super(
            `No index configured for "${ attribute }" on type "${ type }"`,
            opts,
            sourceFunction
        );
        Object.defineProperties(this, {
            /**
             * Document type on which the index was requested.
             * @name type
             * @type {string}
             */
            type: { enumerable: true, value: type },
            /**
             * Index attribute that is not configured.
             * @name attribute
             * @type {string}
             */
            attribute: { enumerable: true, value: attribute },
        });
    }
}
