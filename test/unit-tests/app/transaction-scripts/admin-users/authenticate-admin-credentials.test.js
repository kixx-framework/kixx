import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ADMIN_SESSION_TTL_SECONDS } from '../../../../../src/app/lib/admin-session.js';
import { pbkdf2HashPassword } from '../../../../../src/app/lib/password-hashing.js';
import { authenticateAdminCredentials } from '../../../../../src/app/transaction-scripts/admin-users/authenticate-admin-credentials.js';


const EMAIL_ADDRESS = 'admin@example.com';
const PASSWORD = 'correct horse battery staple';


describe('authenticateAdminCredentials Transaction Script', ({ it }) => {
    it('verifies credentials and creates an admin session', async () => {
        const passwordHash = await pbkdf2HashPassword(PASSWORD, 1);
        const authenticatedUser = makeAuthenticatedUser();
        const user = makeUser({ passwordHash, authenticatedUser });
        const harness = makeHarness({ user });
        const result = await authenticateAdminCredentials(
            harness.context,
            { email_address: EMAIL_ADDRESS, password: PASSWORD },
        );
        const sessionCall = harness.calls.sessionCreates[0];

        assertEqual(authenticatedUser, result.user);
        assertEqual('session-1', result.sessionId);
        assertEqual('UserSession,AdminUser', harness.calls.collectionNames.join(','));
        assertEqual(1, harness.calls.sessionCreates.length);
        assertEqual(harness.context, sessionCall.context);
        assertEqual(authenticatedUser.id, sessionCall.userId);
        assertEqual(ADMIN_SESSION_TTL_SECONDS, sessionCall.ttlSeconds);
    });

    it('propagates invalid credentials without creating a session', async () => {
        const passwordHash = await pbkdf2HashPassword(PASSWORD, 1);
        const user = makeUser({ passwordHash });
        const harness = makeHarness({ user });
        const caught = await catchAsyncError(() => {
            return authenticateAdminCredentials(
                harness.context,
                { email_address: EMAIL_ADDRESS, password: 'wrong password' },
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnauthorizedError', caught.name);
        assertEqual('InvalidCredentials', caught.code);
        assertEqual(0, harness.calls.sessionCreates.length);
    });

    it('propagates credential lookup failures without creating a session', async () => {
        const cause = new Error('admin user store unavailable');
        const harness = makeHarness({ userLookupError: cause });
        const caught = await catchAsyncError(() => {
            return authenticateAdminCredentials(
                harness.context,
                { email_address: EMAIL_ADDRESS, password: PASSWORD },
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin user for login', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.sessionCreates.length);
    });

    it('wraps session creation failures with their cause', async () => {
        const passwordHash = await pbkdf2HashPassword(PASSWORD, 1);
        const user = makeUser({ passwordHash });
        const cause = new Error('session store unavailable');
        const harness = makeHarness({ user, sessionError: cause });
        const caught = await catchAsyncError(() => {
            return authenticateAdminCredentials(
                harness.context,
                { email_address: EMAIL_ADDRESS, password: PASSWORD },
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while creating an admin session during login', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.sessionCreates.length);
    });
});

function makeHarness(options) {
    const {
        user = null,
        userLookupError = null,
        sessionError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        sessionCreates: [],
        userLookups: [],
    };
    const sessions = {
        async createForUser(context, userId, ttlSeconds) {
            calls.sessionCreates.push({ context, userId, ttlSeconds });
            if (sessionError) {
                throw sessionError;
            }
            return { id: 'session-1' };
        },
    };
    const adminUsers = {
        async getByEmailAddress(context, emailAddress) {
            calls.userLookups.push({ context, emailAddress });
            if (userLookupError) {
                throw userLookupError;
            }
            return user;
        },
    };
    const context = {
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: 1 },
            },
        },
        getCollection(name) {
            calls.collectionNames.push(name);
            if (name === 'UserSession') {
                return sessions;
            }
            if (name === 'AdminUser') {
                return adminUsers;
            }
            throw new Error(`Unexpected collection: ${ name }`);
        },
    };

    return { context, calls };
}

function makeUser(options) {
    const {
        passwordHash,
        authenticatedUser = makeAuthenticatedUser(),
    } = options ?? {};

    return {
        id: authenticatedUser.id,
        get(name) {
            assertEqual('passwordHash', name);
            return passwordHash;
        },
        toAuthenticatedUser() {
            return authenticatedUser;
        },
    };
}

function makeAuthenticatedUser() {
    return {
        id: 'admin-1',
        type: 'AdminUser',
        emailAddress: EMAIL_ADDRESS,
        userCreationDate: '2026-07-20T12:00:00.000Z',
        roles: [ 'Developer Admin' ],
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
