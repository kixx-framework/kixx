import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { pbkdf2HashPassword } from '../../../../../src/app/lib/password-hashing.js';
import { verifyAdminCredentials } from '../../../../../src/app/transaction-scripts/admin-users/verify-admin-credentials.js';


const PASSWORD = 'correct horse battery staple';
const EMAIL_ADDRESS = 'admin@example.com';
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';


describe('verifyAdminCredentials Transaction Script', ({ it }) => {
    it('rejects incomplete credentials before reading configuration or collections', async () => {
        for (const credentials of [
            undefined,
            null,
            {},
            { emailAddress: EMAIL_ADDRESS },
            { password: PASSWORD },
            { emailAddress: '', password: PASSWORD },
            { emailAddress: EMAIL_ADDRESS, password: '' },
        ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => {
                return verifyAdminCredentials(harness.context, credentials);
            });

            assertInvalidCredentials(caught);
            assertEqual(0, harness.calls.collectionNames.length);
        }
    });

    it('requires valid password-hashing configuration before loading a user', async () => {
        const harness = makeHarness({ iterations: null });
        const caught = await catchAsyncError(() => {
            return verifyAdminCredentials(harness.context, {
                emailAddress: EMAIL_ADDRESS,
                password: PASSWORD,
            });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('SECRET_ENCRYPTION.PBKDF2_ITERATIONS must be a positive integer', caught.message);
        assertEqual(0, harness.calls.collectionNames.length);
    });

    it('normalizes the email address and returns the safe user projection', async () => {
        const passwordHash = await pbkdf2HashPassword(PASSWORD, 1);
        const authenticatedUser = makeAuthenticatedUser();
        const user = makeUser({ passwordHash, authenticatedUser });
        const harness = makeHarness({ user });
        const result = await verifyAdminCredentials(harness.context, {
            emailAddress: '  ADMIN@EXAMPLE.COM  ',
            password: PASSWORD,
        });

        assertEqual(authenticatedUser, result);
        assertEqual('AdminUser', harness.calls.collectionNames.join(','));
        assertEqual(1, harness.calls.userLookups.length);
        assertEqual(harness.context, harness.calls.userLookups[0].context);
        assertEqual(EMAIL_ADDRESS, harness.calls.userLookups[0].emailAddress);
        assertEqual(1, user.calls.passwordHashReads);
        assertEqual(1, user.calls.toAuthenticatedUser);
    });

    it('rejects an unknown email with the generic credentials error', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return verifyAdminCredentials(harness.context, {
                emailAddress: EMAIL_ADDRESS,
                password: PASSWORD,
            });
        });

        assertInvalidCredentials(caught);
        assertEqual(1, harness.calls.userLookups.length);
    });

    it('rejects a wrong password with the same generic credentials error', async () => {
        const passwordHash = await pbkdf2HashPassword(PASSWORD, 1);
        const user = makeUser({ passwordHash });
        const harness = makeHarness({ user });
        const caught = await catchAsyncError(() => {
            return verifyAdminCredentials(harness.context, {
                emailAddress: EMAIL_ADDRESS,
                password: 'wrong password',
            });
        });

        assertInvalidCredentials(caught);
        assertEqual(0, user.calls.toAuthenticatedUser);
    });

    it('wraps admin-user lookup failures with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ lookupError: cause });
        const caught = await catchAsyncError(() => {
            return verifyAdminCredentials(harness.context, {
                emailAddress: EMAIL_ADDRESS,
                password: PASSWORD,
            });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin user for login', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('propagates an assertion when a stored password hash is malformed', async () => {
        const user = makeUser({ passwordHash: 'malformed-password-hash' });
        const harness = makeHarness({ user });
        const caught = await catchAsyncError(() => {
            return verifyAdminCredentials(harness.context, {
                emailAddress: EMAIL_ADDRESS,
                password: PASSWORD,
            });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('verifyPassword: malformed PHC string — wrong number of segments', caught.message);
        assertEqual(0, user.calls.toAuthenticatedUser);
    });
});

function assertInvalidCredentials(error) {
    assert(error, 'expected an error to be thrown');
    assertEqual('UnauthorizedError', error.name);
    assertEqual('InvalidCredentials', error.code);
    assertEqual(401, error.httpStatusCode);
    assertEqual(INVALID_CREDENTIALS_MESSAGE, error.message);
}

function makeHarness(options) {
    const {
        iterations = 1,
        user = null,
        lookupError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        userLookups: [],
    };
    const adminUsers = {
        async getByEmailAddress(context, emailAddress) {
            calls.userLookups.push({ context, emailAddress });
            if (lookupError) {
                throw lookupError;
            }
            return user;
        },
    };
    const context = {
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: iterations },
            },
        },
        getCollection(name) {
            calls.collectionNames.push(name);
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
        calls: {
            passwordHashReads: 0,
            toAuthenticatedUser: 0,
        },
        get(name) {
            assertEqual('passwordHash', name);
            this.calls.passwordHashReads += 1;
            return passwordHash;
        },
        toAuthenticatedUser() {
            this.calls.toAuthenticatedUser += 1;
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
