import { AssertionError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';


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
 * @returns {Promise<{ token: string, invite: Object }>} The one-time raw token and the stored invite as a plain object.
 * @throws {AssertionError} When createdBy is missing or an unexpected storage failure occurs.
 */
export async function createAdminInvite(context, args) {
    const { createdBy } = args ?? {};
    assertNonEmptyString(createdBy, 'createAdminInvite: createdBy');

    const invites = context.getCollection('AdminInvite');

    let result;
    try {
        result = await invites.createInvite(context, { createdBy });
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin invite', { cause });
    }

    return {
        token: result.token,
        invite: result.record.toObject(),
    };
}
