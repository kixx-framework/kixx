import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { AssertionError, UnauthorizedError } from '../../../kixx/errors/mod.js';
import { pbkdf2HashPassword, verifyPassword } from '../../lib/crypto.js';
import { getPbkdf2Iterations } from '../../lib/secret-encryption-config.js';


// A single generic outcome is surfaced for both an unknown email address and a
// wrong password so the response never reveals which factor failed (avoids
// account enumeration). The custom code lets callers distinguish this expected
// authentication failure from other 401s.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const INVALID_CREDENTIALS_CODE = 'InvalidCredentials';


/**
 * Verifies admin credentials without establishing a session.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} credentials - Credentials to verify.
 * @param {string} credentials.emailAddress - Normalized admin email address.
 * @param {string} credentials.password - Plaintext password to verify.
 * @returns {Promise<{ id: string, type: string, emailAddress: string, userCreationDate: string }>}
 *   Safe authenticated-user object.
 * @throws {UnauthorizedError} When the email is unknown or the password does not match (code `'InvalidCredentials'`).
 * @throws {AssertionError} When an unexpected storage failure occurs while loading the user.
 */
export async function verifyAdminCredentials(context, credentials) {
    const {
        emailAddress,
        password,
    } = credentials ?? {};

    if (!isNonEmptyString(emailAddress) || !isNonEmptyString(password)) {
        throw createInvalidCredentialsError();
    }

    // Admin emails are stored lowercased+trimmed at signup, and the email index
    // lookup is an exact match. Canonicalize the presented email the same way so
    // a credential source that does not normalize (e.g. an HTTP Basic-auth
    // username) still matches a valid account. This must mirror the form's
    // normalizeLowerCaseStringAttribute() canonicalization.
    const normalizedEmailAddress = emailAddress.trim().toLowerCase();

    // Required so a misconfigured deployment fails loudly rather than silently
    // weakening the no-user timing-equalization hash below.
    const iterations = getPbkdf2Iterations(context);

    const adminUsers = context.getCollection('AdminUser');

    let user;
    try {
        user = await adminUsers.getByEmailAddress(context, normalizedEmailAddress);
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

    return user.toAuthenticatedUser();
}

function createInvalidCredentialsError() {
    return new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE, { code: INVALID_CREDENTIALS_CODE });
}
