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


export async function acceptAdminInvite(context, request, response, skip) {
    assertJsonApiContentType(request);

    const inviteToken = request.getAuthorizationBearer();
    if (!isNonEmptyString(inviteToken)) {
        throw new UnauthenticatedError('An invite bearer token is required.');
    }

    const { attributes } = await parseJsonApiResource(request, 'AdminUser');
    const form = NewAdminUserForm.fromJsonApi(attributes, inviteToken);

    // Attempt to resolve the invite before form validation to catch invalid
    // invite tokens before responding with a form validation error.
    const resolution = await resolveAdminInvite(context, inviteToken);

    if (!resolution.redeemable) {
        throw new ForbiddenError(INVALID_INVITE_MESSAGE, { code: INVALID_INVITE_CODE });
    }

    form.validate();

    const { user } = await createAdminUserAccount(context, form);

    skip();
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
