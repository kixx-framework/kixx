import CreatePublishingApiTokenForm from '../../forms/publishing-api-tokens/create-publishing-api-token-form.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseBasicAuthCredentials,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { verifyAdminCredentials } from '../../../transaction-scripts/admin-users/verify-admin-credentials.js';
import { createPublishingApiToken as createToken } from '../../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';


export async function createPublishingApiToken(context, request, response, skip) {
    assertJsonApiContentType(request);

    const { username, password } = parseBasicAuthCredentials(request);
    // verifyAdminCredentials() canonicalizes the email before lookup, so the raw
    // Basic-auth username does not need to be normalized here.
    const admin = await verifyAdminCredentials(context, {
        emailAddress: username,
        password,
    });

    const resource = await parseJsonApiResource(request, 'PublishingApiToken');
    const form = CreatePublishingApiTokenForm.fromJsonApi(resource);
    form.validate();

    const token = await createToken(context, form, admin.id);

    skip();
    return response.respondWithJSON(
        201,
        jsonApiResource({
            type: 'PublishingApiToken',
            id: token.id,
            attributes: {
                token: token.token,
                permissions: token.permissions,
                description: token.description,
                createdBy: token.createdBy,
                tokenCreationDate: token.tokenCreationDate,
                tokenExpirationDate: token.tokenExpirationDate,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
