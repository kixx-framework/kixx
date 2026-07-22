import { parseBasicAuthCredentials } from '../lib/json-api.js';
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

    context.setUser(admin);
    return response;
}
