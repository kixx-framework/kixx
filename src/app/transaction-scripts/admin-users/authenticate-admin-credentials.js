import { AssertionError, UnauthorizedError } from '../../../kixx/errors/mod.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../lib/admin-session.js';
import { pbkdf2HashPassword, verifyPassword } from '../../lib/crypto.js';


// A single generic outcome is surfaced for both an unknown email address and a
// wrong password so the response never reveals which factor failed (avoids
// account enumeration). The custom code lets the request handler re-render the
// login form instead of emitting a bare 401.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const INVALID_CREDENTIALS_CODE = 'InvalidCredentials';


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

    // Required so a misconfigured deployment fails loudly rather than silently
    // weakening the no-user timing-equalization hash below.
    const iterations = context.getEnvInteger('PBKDF2_ITERATIONS', { required: true });

    const adminUsers = context.getCollection('AdminUser');
    const sessions = context.getCollection('UserSession');

    let user;
    try {
        user = await adminUsers.getByEmailAddress(context, email_address);
    } catch (cause) {
        throw new AssertionError('Unexpected error while loading an admin user for login', { cause });
    }

    if (!user) {
        // Perform equivalent key-derivation work before failing so response
        // latency does not reveal whether an account exists for this email
        // address. The derived hash is intentionally discarded.
        await pbkdf2HashPassword(password, iterations);
        throw createInvalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(password, user.get('passwordHash'));
    if (!passwordMatches) {
        throw createInvalidCredentialsError();
    }

    let session;
    try {
        session = await sessions.createForUser(context, user.id, ADMIN_SESSION_TTL_SECONDS);
    } catch (cause) {
        throw new AssertionError('Unexpected error while creating an admin session during login', { cause });
    }

    return { user: user.toAuthenticatedUser(), sessionId: session.id };
}

function createInvalidCredentialsError() {
    return new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE, { code: INVALID_CREDENTIALS_CODE });
}
