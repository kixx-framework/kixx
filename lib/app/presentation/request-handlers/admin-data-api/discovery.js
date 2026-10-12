import { adminDataResources } from '../../../admin-data-api/mod.js';
import { respondWithJsonApi } from '../../lib/json-api.js';
import { assertNoQueryParameters } from './protocol.js';


/**
 * Describes the resources, fields, and query plans the calling token can use.
 *
 * Only the intersection of current registrations and the token's grants is
 * described. Discovery is advisory: every request is authorized on its own.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {Object} request - Incoming request.
 * @param {Object} response - Response to populate.
 * @returns {Object} JSON:API document with resources under `meta.resources`.
 * @throws {BadRequestError} When a query parameter is supplied.
 */
export function getDiscovery(context, request, response) {
    assertNoQueryParameters(request);

    return respondWithJsonApi(response, 200, {
        meta: {
            resources: adminDataResources.describeAccessibleResources(context.user.permissions),
        },
    });
}
