import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { AssertionError } from '../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../kixx/assertions/mod.js';


const BOOTSTRAP_TOKEN_ENV_KEY = 'ADMIN_BOOTSTRAP_TOKEN';


/**
 * @typedef {Object} AdminInviteResolution
 * @property {boolean} redeemable - True when the token can still be used to create an admin.
 * @property {boolean} isBootstrap - True when the token matched the env bootstrap token rather than a stored invite.
 * @property {('revoked'|'consumed'|'expired'|'pending'|null)} status - Derived status of a stored invite, or null for a bootstrap or unrecognized token.
 * @property {import('../../collections/admin-invite-record.js').default|null} record - Stored invite when one exists, otherwise null.
 */


/**
 * Resolves a presented token to its redeemability without mutating any state.
 *
 * A stored invite resolves by its SHA-256 hex digest (the record id); an unknown
 * token may still be the env `ADMIN_BOOTSTRAP_TOKEN`, which authorizes the first
 * admin. This is purely a read: callers that intend to spend the token must call
 * `consumeAdminInvite`.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {string} token - Raw bearer token presented by the signup request.
 * @returns {Promise<AdminInviteResolution>} Resolution describing whether and how the token may be redeemed.
 * @throws {AssertionError} When an unexpected storage failure occurs while loading the invite.
 */
export async function resolveAdminInvite(context, token) {
    if (!isNonEmptyString(token)) {
        return notRedeemable();
    }

    const invites = context.getCollection('AdminInvite');
    const tokenHash = await sha256Hex(token);

    let record;
    try {
        record = await invites.getByTokenHash(context, tokenHash);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin invite', { cause });
    }

    if (record) {
        const status = record.getStatus();
        return {
            redeemable: status === 'pending',
            isBootstrap: false,
            status,
            record,
        };
    }

    // No stored invite for this token. A spent bootstrap token is recorded as a
    // consumed marker keyed by the same hash, so reaching here with no record
    // means a matching bootstrap token is still unused.
    if (await matchesBootstrapToken(context, token)) {
        return {
            redeemable: true,
            isBootstrap: true,
            status: null,
            record: null,
        };
    }

    return notRedeemable();
}

function notRedeemable() {
    return {
        redeemable: false,
        isBootstrap: false,
        status: null,
        record: null,
    };
}

async function matchesBootstrapToken(context, token) {
    const bootstrapToken = context.getEnvString(BOOTSTRAP_TOKEN_ENV_KEY);

    // An unset bootstrap token disables the bootstrap path entirely, which is the
    // correct posture once real admins exist and the operator removes the value.
    if (!isNonEmptyString(bootstrapToken)) {
        return false;
    }

    // Compare digests rather than raw values, matching the CsrfToken precedent of
    // checking SHA-256 hashes; the env secret is never compared in plaintext.
    const presentedHash = await sha256Hex(token);
    const bootstrapHash = await sha256Hex(bootstrapToken);
    return presentedHash === bootstrapHash;
}
