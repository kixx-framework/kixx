import { AssertionError, ForbiddenError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { ROLE_ROOT_ADMIN, canGrantRole, isRoleName } from '../../lib/roles.js';


const ADMIN_ROLE_CATEGORY = 'admin';
const ROLE_FORBIDDEN_MESSAGE = 'The selected role cannot be granted.';
const ROLE_FORBIDDEN_CODE = 'AdminInviteRoleForbidden';


/**
 * Mints a new pending admin invite on behalf of an authenticated admin.
 *
 * The returned `token` is the raw bearer token and is available only here, at
 * creation time; it is never stored in plaintext, so the caller must surface it
 * (as a signup link) immediately and cannot retrieve it later.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Creation arguments.
 * @param {string} args.createdBy - Admin user id authoring the invite.
 * @param {string} args.role - Single admin role name the invite will confer.
 * @returns {Promise<{ token: string, invite: Object }>} The one-time raw token and the stored invite as a plain object.
 * @throws {AssertionError} When createdBy is missing or an unexpected storage failure occurs.
 * @throws {ForbiddenError} With code `AdminInviteRoleForbidden` when the role is `Root Admin`,
 * unregistered outside the admin category, or beyond what the authenticated admin may grant.
 */
export async function createAdminInvite(context, args) {
    const { createdBy, role } = args ?? {};
    assertNonEmptyString(createdBy, 'createAdminInvite: createdBy');

    // Delegation is an authorization decision, not a data-shape one: the invite
    // form (T10) only ever renders roles this principal may grant, so anything
    // else reaching here is tampering and must fail closed as 403 rather than a
    // 422 field error.
    const isGrantable = role !== ROLE_ROOT_ADMIN
        && isRoleName(role, ADMIN_ROLE_CATEGORY)
        && canGrantRole(context.user?.permissions, role);

    if (!isGrantable) {
        throw new ForbiddenError(ROLE_FORBIDDEN_MESSAGE, { code: ROLE_FORBIDDEN_CODE });
    }

    const invites = context.getCollection('AdminInvite');

    let result;
    try {
        result = await invites.createInvite(context, { createdBy, roles: [ role ] });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin invite', { cause });
    }

    return {
        token: result.token,
        invite: result.record.toObject(),
    };
}
