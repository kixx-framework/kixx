import {
    authorizeAdminDataAction,
    requireRecordAtVersion,
    translateWriteError,
} from './lib.js';


/**
 * Deletes the version of a record the client observed, bypassing application
 * workflows such as publication guards or content cleanup.
 *
 * The delete is conditional on the observed version and is never retried, so
 * a record changed by someone else after the client read it is not removed.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {string} type - Public JSON:API resource type.
 * @param {string} id - Record id.
 * @param {number} version - Version the client observed.
 * @returns {Promise<void>} Resolves once the record is deleted.
 * @throws {NotFoundError} When the type is not registered, or with code `AdminDataRecordNotFound` when the record is absent.
 * @throws {MethodNotAllowedError} When the registration does not enable `delete`.
 * @throws {ForbiddenError} When the token is not granted `delete` on the Collection.
 * @throws {ConflictError} With code `AdminDataVersionConflict` when the record changed after `version`.
 */
export async function deleteAdminDataRecord(context, type, id, version) {
    const resource = authorizeAdminDataAction(context, type, 'delete');
    const collection = context.getCollection(resource.collection);

    const record = await requireRecordAtVersion(context, collection, id, version);

    try {
        await collection.deleteStrict(context, record);
    } catch (cause) {
        throw translateWriteError(cause);
    }
}
