import { OperationalError } from '../../../kixx/errors/mod.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../lib/admin-session.js';
import { createAdminUserAccount } from './create-admin-user-account.js';


/**
 * Creates an admin account from a validated signup form and establishes a session.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../presentation/forms/admin-users/new-admin-user-form.js').default} form - Validated signup form carrying `email_address`, `password`, and `invite_token`.
 * @returns {Promise<{ user: Object, sessionId: string }>} The authenticated-user view and new session id.
 * @throws {ConflictError} With code `NewUserConflictError` when an admin already exists for the email; the invite is untouched and the submission is retryable.
 * @throws {ConflictError} With code `InviteSpentInEmailRace` when a concurrent signup claimed the email after the invite was consumed; the invite is gone and the submission is not retryable.
 * @throws {ForbiddenError} With code `InvalidInvite` when the invite token is missing, expired, revoked, or already used.
 * @throws {OperationalError} With code `SignupSessionFailed` when the account is created but session creation fails.
 */
export async function createAdminUser(context, form) {
    const { requestId } = context;
    const sessions = context.getCollection('UserSession');
    const { user } = await createAdminUserAccount(context, form);

    let session;
    try {
        session = await sessions.createForUser(context, user.id, ADMIN_SESSION_TTL_SECONDS);
    } catch (cause) {
        context.logger.error('failed to create session after signup', { requestId }, cause);
        // Session creation is best-effort: failure here does not roll back
        // the user signup, and the caller redirects the user to the
        // login page to recover.
        throw new OperationalError(
            'Signup completed but session creation failed.',
            { cause, code: 'SignupSessionFailed' },
        );
    }

    return { user, sessionId: session.id };
}
