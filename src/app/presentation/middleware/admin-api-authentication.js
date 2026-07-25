import { parseBasicAuthCredentials } from '../lib/json-api.js';
import { deriveRolePermissions } from '../../lib/roles.js';
import { verifyAdminCredentials } from '../../transaction-scripts/admin-users/verify-admin-credentials.js';


/**
 * Authenticates an admin API request with HTTP Basic credentials.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Response threaded to the target handler.
 * @throws {UnauthenticatedError} When Basic credentials are absent or malformed.
 * @throws {UnauthorizedError} When the credentials are rejected.
 */
export async function authenticateAdminApiRequest(context, request, response) {
    const { username, password } = parseBasicAuthCredentials(request);
    const admin = await verifyAdminCredentials(context, {
        emailAddress: username,
        password,
    });

    // Grants are derived fresh on every request from the user's stored role
    // names, never persisted; editing a role's grants in code changes every
    // holder's capabilities on the next deploy with no data migration.
    context.setUser(Object.assign({}, admin, {
        permissions: deriveRolePermissions(admin.roles),
    }));

    return response;
}
