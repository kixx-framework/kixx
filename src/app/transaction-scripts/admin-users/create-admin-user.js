import { AssertionError, ConflictError, OperationalError } from '../../../kixx/errors/mod.js';
import { ADMIN_SESSION_TTL_SECONDS } from '../../lib/admin-session.js';
import { pbkdf2HashPassword } from '../../lib/crypto.js';
import { consumeAdminInvite } from '../admin-invites/consume-admin-invite.js';


/**
 * Creates an admin account from a validated signup form, spending the invite that
 * authorized it and establishing a session.
 *
 * The invite is consumed only after the duplicate-email fast-fail, so an email
 * that already exists is correctable without burning the invitee's one-time token;
 * consumption happens before the user is written, so a single token never yields
 * two admins.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../presentation/forms/admin-users/new-admin-user-form.js').default} form - Validated signup form carrying `email_address`, `password`, and `invite_token`.
 * @returns {Promise<{ user: Object, sessionId: string }>} The authenticated-user view and new session id.
 * @throws {ConflictError} With code `NewUserConflictError` when an admin already exists for the email.
 * @throws {ForbiddenError} With code `InvalidInvite` when the invite token is missing, expired, revoked, or already used.
 * @throws {OperationalError} With code `SignupSessionFailed` when the account is created but session creation fails.
 */
export async function createAdminUser(context, form) {
    const { requestId } = context;
    const { email_address, password } = form;

    // PBKDF2 iteration count is configured per environment so it can be tuned
    // without a code change. Required here so a misconfigured deployment
    // fails loudly before writing a User or Session.
    const iterations = context.getEnvInteger('PBKDF2_ITERATIONS', { required: true });
    const passwordHash = await pbkdf2HashPassword(password, iterations);

    const adminUsers = context.getCollection('AdminUser');
    const sessions = context.getCollection('UserSession');

    // Fast-fail if the user already exists (races are handled atomically in the create steps below).
    let existingUser;
    try {
        existingUser = await adminUsers.getByEmailAddress(context, email_address);
    } catch (cause) {
        throw new AssertionError('Unexpected error while checking for an existing admin user', { cause });
    }

    if (existingUser) {
        throw new ConflictError(
            'Admin user already exists by email address.',
            { code: 'NewUserConflictError' },
        );
    }

    // Spend the invite after the duplicate-email check but before writing the
    // user: a recoverable email conflict must not consume the token, and a
    // successful consume must gate the account so one token creates one admin.
    await consumeAdminInvite(context, form.invite_token);

    let user;
    try {
        user = await adminUsers.createNewAdminUser(context, {
            emailAddress: email_address,
            passwordHash,
        });
    } catch (cause) {
        if (cause.name === 'DocumentUniqueIndexViolationError') {
            // Another signup claimed this email address between the fast-fail
            // check above and this write.
            context.logger.warn('race condition while creating a new admin user', { requestId }, cause);
            throw new ConflictError(
                'Admin user already exists by email address.',
                { code: 'NewUserConflictError' },
            );
        }

        throw new AssertionError('Unexpected error while creating a new user', { cause });
    }

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

    return { user: user.toAuthenticatedUser(), sessionId: session.id };
}
