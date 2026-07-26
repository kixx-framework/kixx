import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { UnauthenticatedError } from '../../../kixx/errors/mod.js';
import { deriveRolePermissions } from '../../lib/roles.js';
import { authenticatePublishingToken as authenticatePublishingTokenScript } from '../../transaction-scripts/publishing-api-tokens/authenticate-publishing-token.js';


const UNAUTHENTICATED_MESSAGE = 'Publishing API authentication is required.';


/**
 * Authenticates Publishing API requests and stores the token principal on the request context.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Response threaded to the next middleware.
 * @throws {UnauthenticatedError} When the request does not carry a valid publishing token.
 */
export default async function authenticatePublishingToken(context, request, response) {
    const token = request.getAuthorizationBearer();

    if (!isNonEmptyString(token)) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    const record = await authenticatePublishingTokenScript(context, token);
    const roles = record.get('roles');

    context.setUser({
        id: record.id,
        type: record.type,
        roles,
        // Derived fresh on every request from the stored role names, never
        // persisted; editing a role's grants in code changes every holder's
        // capabilities on the next deploy with no data migration.
        permissions: deriveRolePermissions(roles),
        createdBy: record.get('createdBy'),
        tokenCreationDate: record.get('tokenCreationDate'),
        tokenExpirationDate: record.get('tokenExpirationDate'),
    });

    return response;
}
