import { AssertionError, ForbiddenError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { isRoleId } from '../../permissions/roles.js';


const ROLE_FORBIDDEN_MESSAGE = 'The selected role cannot be granted.';
const ROLE_FORBIDDEN_CODE = 'AdminInviteRoleForbidden';
const ADMIN_ROLE_CATEGORY = 'admin';


/**
 * Mints a new pending admin invite on behalf of an authenticated admin.
 *
 * The returned `token` is the raw bearer token and is available only here, at
 * creation time; it is never stored in plaintext, so the caller must surface it
 * (as a signup link) immediately and cannot retrieve it later.
 *
 * A request names one role id, and this function is the sole place that id is
 * accepted. Root Admin is unreachable here by construction rather than by a
 * runtime check: it carries no category, so it satisfies no category check on
 * any attachment path.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Creation arguments.
 * @param {string} args.createdBy - Admin user id authoring the invite.
 * @param {string} args.roleId - Id of the role the invite will confer.
 * @returns {Promise<{ token: string, invite: Object }>} The one-time raw token and the stored invite as a plain object.
 * @throws {AssertionError} When createdBy is missing or an unexpected storage failure occurs.
 * @throws {ForbiddenError} With code `AdminInviteRoleForbidden` when the id is not an attachable admin role.
 */
export async function createAdminInvite(context, args) {
    const { createdBy, roleId } = args ?? {};
    assertNonEmptyString(createdBy, 'createAdminInvite: createdBy');

    // This check is the authorization decision: the id it admits lands on the
    // invite and is copied verbatim onto the new admin user at redemption. The
    // form only ever renders attachable admin roles, so anything else here is
    // tampering and must fail closed as a 403 rather than a 422 field error.
    if (!isRoleId(roleId, ADMIN_ROLE_CATEGORY)) {
        throw new ForbiddenError(ROLE_FORBIDDEN_MESSAGE, { code: ROLE_FORBIDDEN_CODE });
    }

    const invites = context.getCollection('AdminInvite');

    let result;
    try {
        result = await invites.createInvite(context, { createdBy, roles: [ roleId ] });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin invite', { cause });
    }

    return {
        token: result.token,
        invite: result.record.toObject(),
    };
}
