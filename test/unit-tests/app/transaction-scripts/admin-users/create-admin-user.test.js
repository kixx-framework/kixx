import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ADMIN_SESSION_TTL_SECONDS } from '../../../../src/app/lib/admin-session.js';
import { createAdminUser } from '../../../../src/app/transaction-scripts/admin-users/create-admin-user.js';


const EMAIL_ADDRESS = 'admin@example.com';
const INVITE_TOKEN = 'bootstrap-invite-token';


describe('createAdminUser Transaction Script', ({ it }) => {
    it('creates an admin account and establishes a session', async () => {
        const authenticatedUser = makeAuthenticatedUser();
        const harness = makeHarness({ authenticatedUser });
        const result = await createAdminUser(harness.context, makeForm());
        const sessionCall = harness.calls.sessionCreates[0];

        assertEqual(authenticatedUser, result.user);
        assertEqual('session-1', result.sessionId);
        assertEqual(1, harness.calls.userCreates.length);
        assertEqual(1, harness.calls.bootstrapMarkers.length);
        assertEqual(1, harness.calls.sessionCreates.length);
        assertEqual(harness.context, sessionCall.context);
        assertEqual(authenticatedUser.id, sessionCall.userId);
        assertEqual(ADMIN_SESSION_TTL_SECONDS, sessionCall.ttlSeconds);
        assertEqual('consume-bootstrap,create-user,create-session', harness.calls.events.join(','));
    });

    it('propagates account-creation errors without creating a session', async () => {
        const harness = makeHarness({ existingUser: {} });
        const caught = await catchAsyncError(() => {
            return createAdminUser(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('NewUserConflictError', caught.code);
        assertEqual(0, harness.calls.bootstrapMarkers.length);
        assertEqual(0, harness.calls.userCreates.length);
        assertEqual(0, harness.calls.sessionCreates.length);
    });

    it('reports session failure after preserving the created account', async () => {
        const cause = new Error('session store unavailable');
        const harness = makeHarness({ sessionError: cause });
        const caught = await catchAsyncError(() => {
            return createAdminUser(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('OperationalError', caught.name);
        assertEqual('SignupSessionFailed', caught.code);
        assertEqual('Signup completed but session creation failed.', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.userCreates.length);
        assertEqual(1, harness.calls.sessionCreates.length);
        assertEqual(1, harness.calls.errors.length);
        assertEqual('failed to create session after signup', harness.calls.errors[0].message);
        assertEqual('request-1', harness.calls.errors[0].details.requestId);
        assertEqual(cause, harness.calls.errors[0].cause);
    });
});

function makeHarness(options) {
    const {
        authenticatedUser = makeAuthenticatedUser(),
        existingUser = null,
        sessionError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        userCreates: [],
        bootstrapMarkers: [],
        sessionCreates: [],
        errors: [],
        events: [],
    };
    const sessions = {
        async createForUser(context, userId, ttlSeconds) {
            calls.sessionCreates.push({ context, userId, ttlSeconds });
            calls.events.push('create-session');
            if (sessionError) {
                throw sessionError;
            }
            return { id: 'session-1' };
        },
    };
    const adminUsers = {
        async getByEmailAddress() {
            return existingUser;
        },
        async createNewAdminUser(context, attributes) {
            calls.userCreates.push({ context, attributes });
            calls.events.push('create-user');
            return {
                toAuthenticatedUser() {
                    return authenticatedUser;
                },
            };
        },
    };
    const invites = {
        async getByTokenHash() {
            return null;
        },
        async createConsumedBootstrapMarker(context, tokenHash) {
            calls.bootstrapMarkers.push({ context, tokenHash });
            calls.events.push('consume-bootstrap');
        },
    };
    const context = {
        requestId: 'request-1',
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: 1 },
            },
        },
        logger: {
            error(message, details, cause) {
                calls.errors.push({ message, details, cause });
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
            if (name === 'AdminInvite') {
                return invites;
            }
            throw new Error(`Unexpected collection: ${ name }`);
        },
        getEnvString(name) {
            assertEqual('ADMIN_BOOTSTRAP_TOKEN', name);
            return INVITE_TOKEN;
        },
    };

    return { context, calls };
}

function makeForm() {
    return {
        email_address: EMAIL_ADDRESS,
        password: 'correct horse battery staple',
        invite_token: INVITE_TOKEN,
    };
}

function makeAuthenticatedUser() {
    return {
        id: 'admin-1',
        type: 'AdminUser',
        emailAddress: EMAIL_ADDRESS,
        userCreationDate: '2026-07-20T12:00:00.000Z',
        roles: [ 'Root Admin' ],
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
