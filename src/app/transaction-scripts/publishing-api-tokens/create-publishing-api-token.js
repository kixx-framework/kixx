import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Mints a Publishing API token for an authenticated admin user.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js').default} form - Validated token creation form.
 * @param {string} grantingUserId - Authenticated admin user id minting the token.
 * @returns {Promise<Object>} One-time plaintext token plus stored token attributes.
 * @throws {AssertionError} When token persistence unexpectedly fails.
 */
export async function createPublishingApiToken(context, form, grantingUserId) {
    const publishingApiTokens = context.getCollection('PublishingApiToken');
    const {
        permissions,
        description,
        timeToLiveSeconds,
    } = form.toJSON();

    let result;
    try {
        result = await publishingApiTokens.createToken(context, {
            createdBy: grantingUserId,
            permissions,
            description,
            ttlSeconds: timeToLiveSeconds,
        });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating a publishing API token', { cause });
    }

    const { token, record } = result;

    return {
        id: record.id,
        token,
        permissions: record.get('permissions'),
        description: record.get('description'),
        createdBy: record.get('createdBy'),
        tokenCreationDate: record.get('tokenCreationDate'),
        tokenExpirationDate: record.get('tokenExpirationDate'),
    };
}
