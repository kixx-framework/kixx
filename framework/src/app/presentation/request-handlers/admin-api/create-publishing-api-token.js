import CreatePublishingApiTokenForm from '../../forms/publishing-api-tokens/create-publishing-api-token-form.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { createPublishingApiToken as createToken } from '../../../transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';


/**
 * Mints a publishing API token for the authenticated admin.
 *
 * The plaintext token is present only on this response and is never retrievable
 * again, so a client that discards it must mint a new one.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context; carries the authenticated user.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 201 response carrying the token, shown once.
 * @throws {UnsupportedMediaTypeError} When the request is not JSON:API.
 * @throws {ValidationError} When the submitted token attributes are invalid.
 */
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
