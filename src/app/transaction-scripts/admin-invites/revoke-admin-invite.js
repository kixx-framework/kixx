import { AssertionError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


/**
 * Permanently revokes a pending admin invite so it can no longer be redeemed.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} inviteId - Invite record id (the token hash) from the management list.
 * @returns {Promise<void>} Resolves once the invite is revoked.
 * @throws {NotFoundError} With code `AdminInviteNotFound` when no invite exists for the id.
 * @throws {ConflictError} With code `AdminInviteConflict` when the invite was modified concurrently.
 * @throws {AssertionError} When inviteId is missing or an unexpected storage failure occurs.
 */
export async function revokeAdminInvite(context, inviteId) {
    assertNonEmptyString(inviteId, 'revokeAdminInvite: inviteId');

    const invites = context.getCollection('AdminInvite');

    let record;
    try {
        record = await invites.getByTokenHash(context, inviteId);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin invite for revocation', { cause });
    }

    if (!record) {
        throw new NotFoundError('Admin invite not found.', { code: 'AdminInviteNotFound' });
    }

    try {
        await invites.revoke(context, record);
    } catch (cause) {
        // A concurrent edit (e.g. the invite was just consumed or revoked) means
        // the caller's view is stale; surface it as a recoverable conflict.
        if (cause.name === 'VersionConflictError') {
            throw new ConflictError(
                'This invite was modified by someone else. Reload and try again.',
                { cause, code: 'AdminInviteConflict' },
            );
        }
        // The invite was deleted between the load and the write.
        if (cause.name === 'DocumentNotFoundError') {
            throw new NotFoundError('Admin invite not found.', { cause, code: 'AdminInviteNotFound' });
        }
        throw new AssertionError('Unexpected error while revoking an admin invite', { cause });
    }
}
