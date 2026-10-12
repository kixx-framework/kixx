import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import { ForbiddenError, UnauthenticatedError } from '../../../../kixx/errors/mod.js';
import NewAdminUserForm from '../../forms/admin-users/new-admin-user-form.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { createAdminUserAccount } from '../../../transaction-scripts/admin-users/create-admin-user-account.js';
import { resolveAdminInvite } from '../../../transaction-scripts/admin-invites/resolve-admin-invite.js';


const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used.';
const INVALID_INVITE_CODE = 'InvalidInvite';


/**
 * Redeems an admin invite and creates the invited user's account.
 *
 * This route is unauthenticated: the invite bearer token is the credential, and
 * it is single-use, so a successful call cannot be replayed.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 201 response carrying the created AdminUser.
 * @throws {UnsupportedMediaTypeError} When the request is not JSON:API.
 * @throws {UnauthenticatedError} When no invite bearer token is present.
 * @throws {ForbiddenError} When the invite is invalid, expired, or already redeemed.
 * @throws {ValidationError} When the submitted account attributes are invalid.
 */
export async function acceptAdminInvite(context, request, response) {
    assertJsonApiContentType(request);

    const inviteToken = request.getAuthorizationBearer();
    if (!isNonEmptyString(inviteToken)) {
        throw new UnauthenticatedError('An invite bearer token is required.');
    }

    const resource = await parseJsonApiResource(request, 'AdminUser');
    const form = NewAdminUserForm.fromJsonApi(resource, inviteToken);

    // Attempt to resolve the invite before form validation to catch invalid
    // invite tokens before responding with a form validation error.
    const resolution = await resolveAdminInvite(context, inviteToken);

    if (!resolution.redeemable) {
        throw new ForbiddenError(INVALID_INVITE_MESSAGE, { code: INVALID_INVITE_CODE });
    }

    form.validate();

    const { user } = await createAdminUserAccount(context, form);

    // This target's chain has no Hyperview handler after it, so the committed
    // JSON response is terminal without skip(). Returning normally lets any
    // route outbound middleware (e.g. response formatting) still run.
    return response.respondWithJSON(
        201,
        jsonApiResource({
            type: 'AdminUser',
            id: user.id,
            attributes: {
                emailAddress: user.emailAddress,
                userCreationDate: user.userCreationDate,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
