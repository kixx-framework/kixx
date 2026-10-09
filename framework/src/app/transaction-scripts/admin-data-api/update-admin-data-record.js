import {
    assertWritableAttributes,
    authorizeAdminDataAction,
    projectRecord,
    requireRecordAtVersion,
    translateWriteError,
} from './lib.js';


/**
 * Replaces supplied attributes on the version of a record the client observed.
 *
 * Omitted attributes are preserved, and each supplied attribute replaces the
 * stored value whole. The write is conditional on the observed version and is
 * never retried, so two clients that read the same version cannot both
 * succeed: the second gets a conflict instead of silently overwriting.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {import('../../presentation/forms/admin-data-api/admin-data-record-form.js').default} form - Validated record form with `id` and `version`.
 * @returns {Promise<import('./lib.js').AdminDataRecord>} The updated record.
 * @throws {NotFoundError} When the type is not registered, or with code `AdminDataRecordNotFound` when the record is absent.
 * @throws {MethodNotAllowedError} When the registration does not enable `update`.
 * @throws {ForbiddenError} When the token is not granted `update` on the Collection.
 * @throws {ConflictError} With code `AdminDataVersionConflict` when the record changed after `version`.
 * @throws {ValidationError} When the Record rejects the result; nothing is stored.
 */
export async function updateAdminDataRecord(context, form) {
    const { type, id, version, attributes } = form.toJSON();

    const resource = authorizeAdminDataAction(context, type, 'update');
    assertWritableAttributes(resource.operations.update.attributes, attributes);

    const collection = context.getCollection(resource.collection);
    const record = await requireRecordAtVersion(context, collection, id, version);

    // merge() is shallow: supplied nested objects replace the stored value whole.
    record.merge(attributes);

    let updated;
    try {
        updated = await collection.update(context, record);
    } catch (cause) {
        throw translateWriteError(cause);
    }

    return projectRecord(resource, updated);
}
