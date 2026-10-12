import { toAdminDataPermissions } from '../../permissions/admin-data-api.js';
import { authenticateAdminDataApiToken as authenticateToken } from '../../transaction-scripts/admin-data-api-tokens/authenticate-admin-data-api-token.js';


/**
 * Authenticates Administrative Data API requests and stores the token principal on the request context.
 *
 * Only bearer credentials are read: an absent header, HTTP Basic credentials,
 * a Publishing API token, or any other credential is a 401. The principal's
 * permissions come only from the token's own grants, never from the minting
 * admin's roles, so a token cannot act with more authority than it was given.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Response threaded to the next middleware.
 * @throws {UnauthenticatedError} When the request does not carry an active admin data API token.
 */
export default async function authenticateAdminDataApiToken(context, request, response) {
    const record = await authenticateToken(context, request.getAuthorizationBearer());
    const grants = record.get('grants');

    context.setUser({
        id: record.id,
        type: record.type,
        grants,
        // Derived on every request from the stored grants. Whether each
        // granted Collection is still registered is decided per request by
        // the resource registry, so retired grants confer nothing.
        permissions: toAdminDataPermissions(grants),
        createdBy: record.get('createdBy'),
        tokenCreationDate: record.get('tokenCreationDate'),
        tokenExpirationDate: record.get('tokenExpirationDate'),
    });

    return response;
}
