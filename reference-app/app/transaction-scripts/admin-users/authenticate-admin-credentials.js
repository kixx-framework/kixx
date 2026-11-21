import { AssertionError } from '../../../kixx/errors/mod.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../lib/admin-session.js';
import { verifyAdminCredentials } from './verify-admin-credentials.js';


/**
 * Authenticates an admin user from submitted login credentials and, on success,
 * establishes a session.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context
 * @param {import('../../presentation/forms/admin-users/admin-user-login-form.js').default} form - Validated login form
 * @returns {Promise<{ user: { id: string, type: string, emailAddress: string, userCreationDate: string }, sessionId: string }>}
 *   Safe authenticated-user object and the new session id.
 * @throws {UnauthorizedError} When the email is unknown or the password does not match (code `'InvalidCredentials'`).
 * @throws {AssertionError} When an unexpected storage failure occurs while loading the user or creating the session.
 */
export async function authenticateAdminCredentials(context, form) {
    const { email_address, password } = form;
    const sessions = context.getCollection('UserSession');
    const user = await verifyAdminCredentials(context, {
        emailAddress: email_address,
        password,
    });

    let session;
    try {
        session = await sessions.createForUser(context, user.id, ADMIN_SESSION_TTL_SECONDS);
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin session during login', { cause });
    }

    return { user, sessionId: session.id };
}
