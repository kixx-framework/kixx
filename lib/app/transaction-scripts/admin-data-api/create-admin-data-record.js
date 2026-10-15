import {
    assertWritableAttributes,
    authorizeAdminDataAction,
    projectRecord,
    translateWriteError,
} from './lib.js';


/**
 * Creates a record directly in its Collection, bypassing application
 * workflows but never Record validation or the registration's restrictions.
 *
 * The server always generates the id: the registration's `persist` hook does
 * so when present, and otherwise the Collection's own id generator does.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {import('../../presentation/forms/admin-data-api/admin-data-record-form.js').default} form - Validated record form.
 * @returns {Promise<import('./lib.js').AdminDataRecord>} The created record.
 * @throws {NotFoundError} When the type is not registered.
 * @throws {MethodNotAllowedError} When the registration does not enable `create`.
 * @throws {ForbiddenError} When the token is not granted `create` on the Collection.
 * @throws {ValidationError} When the Record rejects the attributes; nothing is stored.
 * @throws {ConflictError} With code `AdminDataUniqueConflict` when a unique index rejects the record.
 */
export async function createAdminDataRecord(context, form) {
    const { type, attributes } = form.toJSON();

    const resource = authorizeAdminDataAction(context, type, 'create');
    const { persist } = resource.operations.create;
    assertWritableAttributes(resource.operations.create.attributes, attributes);

    const collection = context.getCollection(resource.collection);

    let record;
    try {
        record = persist
            ? await persist(context, collection, attributes)
            : await collection.create(context, attributes);
    } catch (cause) {
        throw translateWriteError(cause);
    }

    return projectRecord(resource, record);
}
