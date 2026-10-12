import { AssertionError } from '../../../kixx/errors/mod.js';


/**
 * Mints an Administrative Data API token for an authenticated admin user.
 *
 * The returned plaintext token is the only copy that will ever exist; the
 * caller must show it once and never persist, log, or redirect with it.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js').default} form - Validated token creation form.
 * @param {string} grantingUserId - Authenticated admin user id minting the token.
 * @returns {Promise<Object>} One-time plaintext token plus stored token attributes.
 * @throws {AssertionError} When token persistence unexpectedly fails.
 */
export async function createAdminDataApiToken(context, form, grantingUserId) {
    const tokens = context.getCollection('AdminDataApiToken');
    const {
        grants,
        description,
        timeToLiveSeconds,
    } = form.toJSON();

    let result;
    try {
        result = await tokens.createToken(context, {
            createdBy: grantingUserId,
            grants,
            description,
            ttlSeconds: timeToLiveSeconds,
        });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin data API token', { cause });
    }

    const { token, record } = result;

    return {
        id: record.id,
        token,
        grants: record.get('grants'),
        description: record.get('description'),
        createdBy: record.get('createdBy'),
        tokenCreationDate: record.get('tokenCreationDate'),
        tokenExpirationDate: record.get('tokenExpirationDate'),
    };
}
