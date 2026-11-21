import { authorizeAdminDataAction, findRecord, projectRecord } from './lib.js';


/**
 * Reads one record through its resource registration.
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {string} type - Public JSON:API resource type.
 * @param {string} id - Record id.
 * @returns {Promise<import('./lib.js').AdminDataRecord|null>} Projected record, or null when absent.
 * @throws {NotFoundError} When the type is not registered.
 * @throws {MethodNotAllowedError} When the registration does not enable `get`.
 * @throws {ForbiddenError} When the token is not granted `get` on the Collection.
 */
export async function getAdminDataRecord(context, type, id) {
    const resource = authorizeAdminDataAction(context, type, 'get');
    const collection = context.getCollection(resource.collection);

    const record = await findRecord(context, collection, id);

    return record ? projectRecord(resource, record) : null;
}
