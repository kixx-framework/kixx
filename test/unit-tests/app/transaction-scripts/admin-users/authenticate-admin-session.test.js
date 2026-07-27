import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { authenticateAdminSession } from '../../../../../src/app/transaction-scripts/admin-users/authenticate-admin-session.js';


const SESSION_ID = 'session-1';
const USER_ID = 'admin-1';
const UNAUTHENTICATED_MESSAGE = 'Admin authentication is required.';


describe('authenticateAdminSession Transaction Script', ({ it }) => {
    it('rejects a missing session id without accessing collections', async () => {
        for (const sessionId of [ undefined, null, '' ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => {
                return authenticateAdminSession(harness.context, sessionId);
            });

            assertUnauthenticated(caught);
            assertEqual(0, harness.calls.collectionNames.length);
        }
    });

    it('wraps session lookup failures with their cause', async () => {
        const cause = new Error('session store unavailable');
        const harness = makeHarness({ sessionError: cause });
        const caught = await catchAsyncError(() => {
            return authenticateAdminSession(harness.context, SESSION_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin session', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.userGet.length);
    });

    it('rejects an unknown session without loading an admin user', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return authenticateAdminSession(harness.context, SESSION_ID);
        });

        assertUnauthenticated(caught);
        assertEqual(0, harness.calls.userGet.length);
    });

    it('rejects an expired session', async () => {
        const session = makeSession({ isExpired: true });
        const harness = makeHarness({ session });
        const caught = await catchAsyncError(() => {
            return authenticateAdminSession(harness.context, SESSION_ID);
        });

        assertUnauthenticated(caught);
        assertEqual(0, harness.calls.userGet.length);
    });

    it('rejects a session without a valid user id', async () => {
        for (const userId of [ undefined, null, '' ]) {
            const session = makeSession({ userId });
            const harness = makeHarness({ session });
            const caught = await catchAsyncError(() => {
                return authenticateAdminSession(harness.context, SESSION_ID);
            });

            assertUnauthenticated(caught);
            assertEqual(0, harness.calls.userGet.length);
        }
    });

    it('wraps admin-user lookup failures with their cause', async () => {
        const cause = new Error('admin user store unavailable');
        const harness = makeHarness({
            session: makeSession(),
            userError: cause,
        });
        const caught = await catchAsyncError(() => {
            return authenticateAdminSession(harness.context, SESSION_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin user for session authentication', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('rejects a session whose admin user no longer exists', async () => {
        const harness = makeHarness({ session: makeSession() });
        const caught = await catchAsyncError(() => {
            return authenticateAdminSession(harness.context, SESSION_ID);
        });

        assertUnauthenticated(caught);
        assertEqual(USER_ID, harness.calls.userGet[0].userId);
    });

    it('returns the safe authenticated-user projection', async () => {
        const authenticatedUser = {
            id: USER_ID,
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
            userCreationDate: '2026-07-20T12:00:00.000Z',
            roles: [ 'Developer Admin' ],
        };
        const user = makeUser(authenticatedUser);
        const harness = makeHarness({
            session: makeSession(),
            user,
        });
        const result = await authenticateAdminSession(harness.context, SESSION_ID);

        assertEqual(authenticatedUser, result);
        assertEqual('UserSession,AdminUser', harness.calls.collectionNames.join(','));
        assertEqual(1, harness.calls.sessionGet.length);
        assertEqual(harness.context, harness.calls.sessionGet[0].context);
        assertEqual(SESSION_ID, harness.calls.sessionGet[0].sessionId);
        assertEqual(1, harness.calls.userGet.length);
        assertEqual(harness.context, harness.calls.userGet[0].context);
        assertEqual(USER_ID, harness.calls.userGet[0].userId);
        assertEqual(1, user.calls.toAuthenticatedUser);
    });
});

function assertUnauthenticated(error) {
    assert(error, 'expected an error to be thrown');
    assertEqual('UnauthenticatedError', error.name);
    assertEqual(401, error.httpStatusCode);
    assertEqual(UNAUTHENTICATED_MESSAGE, error.message);
}

function makeHarness(options) {
    const {
        session = null,
        sessionError = null,
        user = null,
        userError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        sessionGet: [],
        userGet: [],
    };
    const sessions = {
        async get(context, sessionId) {
            calls.sessionGet.push({ context, sessionId });
            if (sessionError) {
                throw sessionError;
            }
            return session;
        },
    };
    const adminUsers = {
        async get(context, userId) {
            calls.userGet.push({ context, userId });
            if (userError) {
                throw userError;
            }
            return user;
        },
    };
    const context = {
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

function makeSession(options) {
    const values = options ?? {};
    const userId = Object.hasOwn(values, 'userId') ? values.userId : USER_ID;
    const isExpired = values.isExpired ?? false;

    return {
        isExpired() {
            return isExpired;
        },
        get(name) {
            if (name === 'userId') {
                return userId;
            }
            throw new Error(`Unexpected session attribute: ${ name }`);
        },
    };
}

function makeUser(authenticatedUser) {
    return {
        calls: { toAuthenticatedUser: 0 },
        toAuthenticatedUser() {
            this.calls.toAuthenticatedUser += 1;
            return authenticatedUser;
        },
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
