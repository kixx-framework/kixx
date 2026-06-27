import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import {
    ForbiddenError,
    UnauthenticatedError,
} from '../../../kixx/errors/mod.js';
import { evaluatePermissions } from '../../lib/publishing-permissions.js';
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
export async function authenticatePublishingToken(context, request, response) {
    const token = request.getAuthorizationBearer();

    if (!isNonEmptyString(token)) {
        throw new UnauthenticatedError(UNAUTHENTICATED_MESSAGE);
    }

    const record = await authenticatePublishingTokenScript(context, token);

    context.setUser({
        id: record.id,
        type: record.type,
        permissions: structuredClone(record.get('permissions')),
        createdBy: record.get('createdBy'),
        tokenCreationDate: record.get('tokenCreationDate'),
        tokenExpirationDate: record.get('tokenExpirationDate'),
    });

    return response;
}

/**
 * Verifies the authenticated publishing principal can perform an action.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} decision - Authorization decision request.
 * @param {string} decision.action - Action being attempted.
 * @param {string} decision.resource - Resource being accessed.
 * @returns {void}
 * @throws {ForbiddenError} When the publishing token is not authorized.
 */
export function assertPublishingPermission(context, decision) {
    const isAllowed = evaluatePermissions(context.user?.permissions, decision);

    if (!isAllowed) {
        throw new ForbiddenError('The publishing API token is not authorized for this request.', {
            code: 'PublishingApiTokenForbidden',
        });
    }
}
