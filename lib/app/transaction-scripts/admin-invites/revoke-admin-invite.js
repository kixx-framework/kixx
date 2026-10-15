import { AssertionError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


/**
 * Permanently revokes an admin invite so it can no longer be redeemed.
 *
 * This is a state transition, not a blind stamp: only a `pending` or `expired`
 * invite may be revoked. The invite id is caller-supplied and the list UI renders
 * the Revoke control for pending invites only, so a request naming a consumed,
 * already-revoked, or bootstrap record is either tampering or a stale page — and
 * is refused rather than allowed to rewrite terminal state.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} inviteId - Invite record id (the token hash) from the management list.
 * @returns {Promise<void>} Resolves once the invite is revoked.
 * @throws {NotFoundError} With code `AdminInviteNotFound` when no invite exists for the id.
 * @throws {ConflictError} With code `AdminInviteNotRevocable` when the invite is not in a revocable state.
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

    // Guard the transition before writing. The record owns which states are
    // revocable; this only decides what an illegal transition looks like to the
    // caller. Revoking is not idempotent (it rewrites revokedAt and bumps the
    // version), so a repeat request must be refused, not silently re-applied.
    if (!record.isRevocable()) {
        throw new ConflictError(
            `An invite that is ${ record.getStatus() } can no longer be revoked.`,
            { code: 'AdminInviteNotRevocable' },
        );
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
