import { AssertionError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


/**
 * Permanently revokes a Publishing API token so it can no longer authenticate.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} tokenId - Token record id (the token hash) from the management list.
 * @returns {Promise<void>} Resolves once the token is revoked.
 * @throws {NotFoundError} With code `PublishingApiTokenNotFound` when no token exists for the id.
 * @throws {ConflictError} With code `PublishingApiTokenConflict` when the token was modified concurrently.
 * @throws {AssertionError} When tokenId is missing or an unexpected storage failure occurs.
 */
export async function revokePublishingApiToken(context, tokenId) {
    assertNonEmptyString(tokenId, 'revokePublishingApiToken: tokenId');

    const publishingApiTokens = context.getCollection('PublishingApiToken');

    let record;
    try {
        record = await publishingApiTokens.getByTokenHash(context, tokenId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading a publishing API token for revocation', { cause });
    }

    if (!record) {
        throw new NotFoundError('Publishing API token not found.', { code: 'PublishingApiTokenNotFound' });
    }

    try {
        await publishingApiTokens.revoke(context, record);
    } catch (cause) {
        // A concurrent edit (e.g. the token was just revoked by another admin) means
        // the caller's view is stale; surface it as a recoverable conflict.
        if (cause.name === 'VersionConflictError') {
            throw new ConflictError(
                'This token was modified by someone else. Reload and try again.',
                { cause, code: 'PublishingApiTokenConflict' },
            );
        }
        // The token was deleted between the load and the write.
        if (cause.name === 'DocumentNotFoundError') {
            throw new NotFoundError('Publishing API token not found.', { cause, code: 'PublishingApiTokenNotFound' });
        }
        throw new AssertionError('Unexpected error while revoking a publishing API token', { cause });
    }
}
