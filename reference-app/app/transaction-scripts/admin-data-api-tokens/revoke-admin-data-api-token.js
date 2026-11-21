import { AssertionError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


/**
 * Permanently revokes an Administrative Data API token so it can no longer authenticate.
 *
 * Requests that authenticated before the revocation was stored are not
 * cancelled; every later authentication sees the revoked state.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} tokenId - Token record id (the token hash) from the management list.
 * @returns {Promise<void>} Resolves once the token is revoked.
 * @throws {NotFoundError} With code `AdminDataApiTokenNotFound` when no token exists for the id.
 * @throws {ConflictError} With code `AdminDataApiTokenNotRevocable` when the token is already revoked or expired.
 * @throws {ConflictError} With code `AdminDataApiTokenConflict` when the token was modified concurrently.
 * @throws {AssertionError} When tokenId is missing or an unexpected storage failure occurs.
 */
export async function revokeAdminDataApiToken(context, tokenId) {
    assertNonEmptyString(tokenId, 'revokeAdminDataApiToken: tokenId');

    const tokens = context.getCollection('AdminDataApiToken');

    let record;
    try {
        record = await tokens.getByTokenHash(context, tokenId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin data API token for revocation', { cause });
    }

    if (!record) {
        throw new NotFoundError('Admin data API token not found.', { code: 'AdminDataApiTokenNotFound' });
    }

    // Stale or forged requests can target a token that is no longer active.
    // Re-stamping would overwrite the original revokedAt audit timestamp.
    if (!record.isRevocable()) {
        throw new ConflictError(
            `A token that is ${ record.getStatus() } can no longer be revoked.`,
            { code: 'AdminDataApiTokenNotRevocable' },
        );
    }

    try {
        await tokens.revoke(context, record);
    } catch (cause) {
        // Another admin revoked (or otherwise changed) the token after we
        // loaded it. Not retrying preserves their original revocation event.
        if (cause.name === 'VersionConflictError') {
            throw new ConflictError(
                'This token was modified by someone else. Reload and try again.',
                { cause, code: 'AdminDataApiTokenConflict' },
            );
        }
        if (cause.name === 'DocumentNotFoundError') {
            throw new NotFoundError('Admin data API token not found.', { cause, code: 'AdminDataApiTokenNotFound' });
        }
        throw new AssertionError('Unexpected error while revoking an admin data API token', { cause });
    }
}
