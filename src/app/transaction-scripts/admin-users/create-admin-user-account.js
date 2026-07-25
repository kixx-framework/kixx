import { AssertionError, ConflictError } from '../../../kixx/errors/mod.js';
import { pbkdf2HashPassword } from '../../lib/password-hashing.js';
import { getPbkdf2Iterations } from '../../lib/secret-encryption-config.js';
import { consumeAdminInvite } from '../admin-invites/consume-admin-invite.js';


/**
 * Creates an admin account from a validated signup form without establishing a session.
 *
 * The invite is consumed only after the duplicate-email fast-fail, so an email
 * that already exists is correctable without burning the invitee's one-time token;
 * consumption happens before the user is written, so a single token never yields
 * two admins.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../presentation/forms/admin-users/new-admin-user-form.js').default} form - Validated signup form carrying `email_address`, `password`, and `invite_token`.
 * @returns {Promise<{ user: Object }>} The authenticated-user view of the created account.
 * @throws {ConflictError} With code `NewUserConflictError` when an admin already exists for the email; the invite is untouched and the submission is retryable.
 * @throws {ConflictError} With code `InviteSpentInEmailRace` when a concurrent signup claimed the email after the invite was consumed; the invite is gone and the submission is not retryable.
 * @throws {ForbiddenError} With code `InvalidInvite` when the invite token is missing, expired, revoked, or already used.
 */
export async function createAdminUserAccount(context, form) {
    const { requestId } = context;
    const { email_address, password } = form;

    // PBKDF2 iteration count is configured per environment so it can be tuned
    // without a code change. Required here so a misconfigured deployment fails
    // loudly before writing an AdminUser.
    const iterations = getPbkdf2Iterations(context);
    const passwordHash = await pbkdf2HashPassword(password, iterations);

    const adminUsers = context.getCollection('AdminUser');

    // Fast-fail if the user already exists (races are handled atomically in the create step below).
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
    const { roles } = await consumeAdminInvite(context, form.invite_token);

    let user;
    try {
        user = await adminUsers.createNewAdminUser(context, {
            emailAddress: email_address,
            passwordHash,
            roles,
        });
    } catch (cause) {
        if (cause.name === 'DocumentUniqueIndexViolationError') {
            // Another signup claimed this email address between the fast-fail
            // check above and this write. Unlike the fast-fail conflict, the
            // invite has already been spent by this point and cannot be returned,
            // so this is NOT retryable: offering the form again would send the
            // user into a second attempt that can only end in "invalid invite",
            // with no way to tell that from a link they had already used. The
            // distinct code exists so the caller can say what actually happened
            // and tell them to ask for a new invite.
            context.logger.warn('race condition while creating a new admin user', { requestId }, cause);
            throw new ConflictError(
                'Admin user already exists by email address; the invite was spent by the losing signup.',
                { code: 'InviteSpentInEmailRace' },
            );
        }

        throw new AssertionError('Unexpected error while creating a new user', { cause });
    }

    return { user: user.toAuthenticatedUser() };
}
