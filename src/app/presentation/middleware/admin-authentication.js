import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { UnauthenticatedError } from '../../../kixx/errors/mod.js';
import { ADMIN_SESSION_COOKIE_NAME } from '../lib/admin-session-cookie.js';
import { deriveRolePermissions } from '../../lib/roles.js';
import { authenticateAdminSession } from '../../transaction-scripts/admin-users/authenticate-admin-session.js';


const UNAUTHENTICATED_MESSAGE = 'Admin authentication is required.';


/**
 * Authenticates admin requests and stores the authenticated user on the request context.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Response threaded to the next middleware
 * @throws {UnauthenticatedError} When the request does not carry a valid admin session
 */
export async function authenticateAdminUser(context, request, response) {
    const sessionId = request.getCookie(ADMIN_SESSION_COOKIE_NAME);

    if (!isNonEmptyString(sessionId)) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    const user = await authenticateAdminSession(context, sessionId);

    // Grants are derived fresh on every request from the user's stored role
    // names, never persisted; editing a role's grants in code changes every
    // holder's capabilities on the next deploy with no data migration.
    context.setUser(Object.assign({}, user, {
        permissions: deriveRolePermissions(user.roles),
    }));

    return response;
}
