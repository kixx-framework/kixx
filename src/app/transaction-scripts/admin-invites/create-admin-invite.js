import { AssertionError, ForbiddenError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { resolveRolePreset } from '../../lib/roles.js';


const PRESET_FORBIDDEN_MESSAGE = 'The selected role preset cannot be granted.';
const PRESET_FORBIDDEN_CODE = 'AdminInvitePresetForbidden';


/**
 * Mints a new pending admin invite on behalf of an authenticated admin.
 *
 * The returned `token` is the raw bearer token and is available only here, at
 * creation time; it is never stored in plaintext, so the caller must surface it
 * (as a signup link) immediately and cannot retrieve it later.
 *
 * Only an opaque preset name crosses the presentation boundary; this function is
 * the sole place a preset becomes role names, so no request can name a role
 * directly. `Root Admin` is unreachable here by construction — the preset
 * registry's load-time invariant guarantees no preset contains it — so there is
 * no runtime check for it.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Creation arguments.
 * @param {string} args.createdBy - Admin user id authoring the invite.
 * @param {string} args.rolePreset - Name of the role preset the invite will confer.
 * @returns {Promise<{ token: string, invite: Object }>} The one-time raw token and the stored invite as a plain object.
 * @throws {AssertionError} When createdBy is missing or an unexpected storage failure occurs.
 * @throws {ForbiddenError} With code `AdminInvitePresetForbidden` when the name is not a registered role preset.
 */
export async function createAdminInvite(context, args) {
    const { createdBy, rolePreset } = args ?? {};
    assertNonEmptyString(createdBy, 'createAdminInvite: createdBy');

    // Expansion is the authorization decision: whatever it yields lands on the
    // invite and is copied verbatim onto the new admin user at redemption. The
    // form only ever renders registered presets, so an unregistered name here is
    // tampering and must fail closed as a 403 rather than a 422 field error.
    const roles = resolveRolePreset(rolePreset);

    if (!roles) {
        throw new ForbiddenError(PRESET_FORBIDDEN_MESSAGE, { code: PRESET_FORBIDDEN_CODE });
    }

    const invites = context.getCollection('AdminInvite');

    let result;
    try {
        result = await invites.createInvite(context, { createdBy, roles, rolePreset });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin invite', { cause });
    }

    return {
        token: result.token,
        invite: result.record.toObject(),
    };
}
