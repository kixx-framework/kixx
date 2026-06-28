import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { resolveAdminInvite } from './resolve-admin-invite.js';
import { AssertionError, ForbiddenError } from '../../../kixx/errors/mod.js';


// Client-safe, non-enumerating message: the same text covers invalid, expired,
// revoked, and already-used tokens so a probe cannot distinguish the cases.
const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used.';
const INVALID_INVITE_CODE = 'InvalidInvite';


/**
 * Spends a presented token exactly once, covering both stored invites and the env
 * bootstrap token.
 *
 * Resolves the token first, then performs the consuming write: a stored pending
 * invite is marked consumed under optimistic concurrency, while the bootstrap
 * token is recorded as a consumed marker. Concurrency races on either path are
 * translated to the expected `InvalidInvite` error rather than a server fault.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} token - Raw bearer token presented by the signup request.
 * @returns {Promise<void>} Resolves when the token has been spent.
 * @throws {ForbiddenError} With code `InvalidInvite` when the token is not redeemable or was spent concurrently.
 * @throws {AssertionError} When an unexpected storage failure occurs while consuming the token.
 */
export async function consumeAdminInvite(context, token) {
    const resolution = await resolveAdminInvite(context, token);

    if (!resolution.redeemable) {
        throw new ForbiddenError(INVALID_INVITE_MESSAGE, { code: INVALID_INVITE_CODE });
    }

    const invites = context.getCollection('AdminInvite');

    // Bootstrap path: no stored invite exists to mutate. Writing the consumed
    // marker keyed by the token hash makes the env token single-use; a concurrent
    // second redemption loses the create() race and is rejected.
    if (resolution.isBootstrap) {
        const tokenHash = await sha256Hex(token);
        try {
            await invites.createConsumedBootstrapMarker(context, tokenHash);
        } catch (cause) {
            if (cause.name === 'DocumentAlreadyExistsError') {
                throw new ForbiddenError(INVALID_INVITE_MESSAGE, { cause, code: INVALID_INVITE_CODE });
            }
            throw new AssertionError('Unexpected error while consuming the admin bootstrap token', { cause });
        }
        return;
    }

    // Stored invite path: mark the pending invite consumed under optimistic
    // concurrency. A racing redemption surfaces VersionConflictError, treated as
    // "already used" so two redemptions of one token cannot both succeed.
    try {
        await invites.markConsumed(context, resolution.record);
    } catch (cause) {
        if (cause.name === 'VersionConflictError') {
            throw new ForbiddenError(INVALID_INVITE_MESSAGE, { cause, code: INVALID_INVITE_CODE });
        }
        throw new AssertionError('Unexpected error while consuming an admin invite', { cause });
    }
}
