import { AssertionError, ConflictError, OperationalError } from '../../../kixx/errors/mod.js';
import { pbkdf2HashPassword } from '../../lib/crypto.js';


export async function createAdminUser(context, form) {
    const { email_address, username, password } = form;

    // PBKDF2 iteration count is configured per environment so it can be tuned
    // without a code change. Required here so a misconfigured deployment
    // fails loudly before writing a User or Session.
    const iterations = context.getEnvInteger('PBKDF2_ITERATIONS', { required: true });
    const passwordHash = await pbkdf2HashPassword(password, iterations);

    const adminUsers = context.getCollection('AdminUser');
    const sessions = context.getCollection('UserSession');

    // Fast-fail if the user already exists (races are handled atomically in the create steps below).
    const existingUser = await adminUsers.getByEmailAddress(context, email_address);
    if (existingUser) {
        throw new ConflictError(
            'Admin user already exists by email address.',
            { code: 'NewUserConflictError' },
        );
    }

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
            context.logger.warn('race condition while creating a new admin user', null, cause);
            throw new ConflictError(
                'Admin user already exists by email address.',
                { code: 'NewUserConflictError' },
            );
        }

        context.logger.error('unexpected error while creating a new admin user', null, cause);
        throw new AssertionError('Unexpected error while creating a new user', { cause });
    }

    let session;
    try {
        session = await sessions.createForUser(context, user.id);
    } catch (cause) {
        context.logger.error('failed to create session after signup', { username }, cause);
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
