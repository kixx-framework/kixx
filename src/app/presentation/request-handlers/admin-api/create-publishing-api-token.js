import CreatePublishingApiTokenForm from '../../forms/publishing-api-tokens/create-publishing-api-token-form.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { createPublishingApiToken as createToken } from '../../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';


export async function createPublishingApiToken(context, request, response) {
    assertJsonApiContentType(request);

    // Authentication (Basic credentials → context.user) and authorization
    // (publishing-api-tokens:write) already ran in this route's
    // inboundMiddleware and target-head gate, respectively.
    const resource = await parseJsonApiResource(request, 'PublishingApiToken');
    const form = CreatePublishingApiTokenForm.fromJsonApi(resource);
    form.validate();

    const token = await createToken(context, form, context.user.id);

    // This target's chain has no Hyperview handler after it, so the committed
    // JSON response is terminal without skip(). Returning normally lets any
    // route outbound middleware (e.g. response formatting) still run.
    return response.respondWithJSON(
        201,
        jsonApiResource({
            type: 'PublishingApiToken',
            id: token.id,
            attributes: {
                token: token.token,
                roles: token.roles,
                description: token.description,
                createdBy: token.createdBy,
                tokenCreationDate: token.tokenCreationDate,
                tokenExpirationDate: token.tokenExpirationDate,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
