import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { ROLE_ROOT_ADMIN } from '../../../../src/app/lib/roles.js';
import { verifyPassword } from '../../../../src/app/lib/password-hashing.js';
import { createAdminUserAccount } from '../../../../src/app/transaction-scripts/admin-users/create-admin-user-account.js';


const EMAIL_ADDRESS = 'admin@example.com';
const PASSWORD = 'correct horse battery staple';
const INVITE_TOKEN = 'presented-invite-token';
const ROLES = [ 'Developer Admin', 'Site Admin' ];


describe('createAdminUserAccount Transaction Script', ({ it }) => {
    it('requires password-hashing configuration before accessing collections', async () => {
        const harness = makeHarness({ iterations: null });
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('SECRET_ENCRYPTION.PBKDF2_ITERATIONS must be a positive integer', caught.message);
        assertEqual(0, harness.calls.collectionNames.length);
    });

    it('wraps duplicate-email lookup failures before consuming the invite', async () => {
        const cause = new Error('admin user lookup failed');
        const harness = makeHarness({ userLookupError: cause });
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while checking for an existing admin user', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.inviteLookups.length);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('reports an existing email without consuming the invite', async () => {
        const harness = makeHarness({ existingUser: {} });
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('NewUserConflictError', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('Admin user already exists by email address.', caught.message);
        assertEqual(0, harness.calls.inviteLookups.length);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('rejects an invalid invite without creating an admin user', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual('InvalidInvite', caught.code);
        assertEqual(403, caught.httpStatusCode);
        assertEqual('This invite link is invalid, expired, or already used.', caught.message);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('creates an admin with the stored invite roles and a hashed password', async () => {
        const authenticatedUser = makeAuthenticatedUser({ roles: ROLES });
        const createdUser = makeCreatedUser(authenticatedUser);
        const inviteRecord = makeInviteRecord({ roles: ROLES });
        const harness = makeHarness({ inviteRecord, createdUser });
        const result = await createAdminUserAccount(harness.context, makeForm());
        const createCall = harness.calls.userCreates[0];

        assertEqual(authenticatedUser, result.user);
        assertEqual(1, harness.calls.markConsumed.length);
        assertEqual(1, harness.calls.userCreates.length);
        assertEqual(harness.context, createCall.context);
        assertEqual(EMAIL_ADDRESS, createCall.attributes.emailAddress);
        assertEqual(ROLES, createCall.attributes.roles);
        assert(await verifyPassword(PASSWORD, createCall.attributes.passwordHash));
        assertEqual('consume-invite,create-user', harness.calls.events.join(','));
        assertEqual(1, createdUser.calls.toAuthenticatedUser);
    });

    it('creates a Root Admin from the bootstrap invite', async () => {
        const authenticatedUser = makeAuthenticatedUser({ roles: [ ROLE_ROOT_ADMIN ] });
        const createdUser = makeCreatedUser(authenticatedUser);
        const harness = makeHarness({
            bootstrapToken: INVITE_TOKEN,
            createdUser,
        });
        const result = await createAdminUserAccount(harness.context, makeForm());
        const createCall = harness.calls.userCreates[0];

        assertEqual(authenticatedUser, result.user);
        assertEqual(1, harness.calls.bootstrapMarkers.length);
        assertEqual(0, harness.calls.markConsumed.length);
        assertEqual(1, createCall.attributes.roles.length);
        assertEqual(ROLE_ROOT_ADMIN, createCall.attributes.roles[0]);
        assertEqual('consume-bootstrap,create-user', harness.calls.events.join(','));
    });

    it('translates an email race after invite consumption into a distinct conflict', async () => {
        const cause = makeNamedError('DocumentUniqueIndexViolationError');
        const harness = makeHarness({
            inviteRecord: makeInviteRecord(),
            createUserError: cause,
        });
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('InviteSpentInEmailRace', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(
            'Admin user already exists by email address; the invite was spent by the losing signup.',
            caught.message,
        );
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.markConsumed.length);
        assertEqual(1, harness.calls.warnings.length);
        assertEqual('race condition while creating a new admin user', harness.calls.warnings[0].message);
        assertEqual('request-1', harness.calls.warnings[0].details.requestId);
        assertEqual(cause, harness.calls.warnings[0].cause);
    });

    it('preserves the consumed invite when the user write fails unexpectedly', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({
            inviteRecord: makeInviteRecord(),
            createUserError: cause,
        });
        const caught = await catchAsyncError(() => {
            return createAdminUserAccount(harness.context, makeForm());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while creating a new user', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.markConsumed.length);
        assertEqual('consume-invite,create-user', harness.calls.events.join(','));
    });
});

function makeHarness(options) {
    const {
        iterations = 1,
        existingUser = null,
        userLookupError = null,
        inviteRecord = null,
        inviteLookupError = null,
        bootstrapToken,
        createdUser = makeCreatedUser(),
        createUserError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        userLookups: [],
        inviteLookups: [],
        markConsumed: [],
        bootstrapMarkers: [],
        userCreates: [],
        warnings: [],
        events: [],
    };
    const adminUsers = {
        async getByEmailAddress(context, emailAddress) {
            calls.userLookups.push({ context, emailAddress });
            if (userLookupError) {
                throw userLookupError;
            }
            return existingUser;
        },
        async createNewAdminUser(context, attributes) {
            calls.userCreates.push({ context, attributes });
            calls.events.push('create-user');
            if (createUserError) {
                throw createUserError;
            }
            return createdUser;
        },
    };
    const invites = {
        async getByTokenHash(context, tokenHash) {
            calls.inviteLookups.push({ context, tokenHash });
            if (inviteLookupError) {
                throw inviteLookupError;
            }
            return inviteRecord;
        },
        async markConsumed(context, record) {
            calls.markConsumed.push({ context, record });
            calls.events.push('consume-invite');
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
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: iterations },
            },
        },
        logger: {
            warn(message, details, cause) {
                calls.warnings.push({ message, details, cause });
            },
        },
        getCollection(name) {
            calls.collectionNames.push(name);
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
            return bootstrapToken;
        },
    };

    return { context, calls };
}

function makeForm() {
    return {
        email_address: EMAIL_ADDRESS,
        password: PASSWORD,
        invite_token: INVITE_TOKEN,
    };
}

function makeInviteRecord(options) {
    const { roles = ROLES } = options ?? {};

    return {
        getStatus() {
            return 'pending';
        },
        get(name) {
            assertEqual('roles', name);
            return roles;
        },
    };
}

function makeCreatedUser(authenticatedUser = makeAuthenticatedUser()) {
    return {
        calls: { toAuthenticatedUser: 0 },
        toAuthenticatedUser() {
            this.calls.toAuthenticatedUser += 1;
            return authenticatedUser;
        },
    };
}

function makeAuthenticatedUser(options) {
    const { roles = ROLES } = options ?? {};

    return {
        id: 'admin-1',
        type: 'AdminUser',
        emailAddress: EMAIL_ADDRESS,
        userCreationDate: '2026-07-20T12:00:00.000Z',
        roles,
    };
}

function makeNamedError(name) {
    const error = new Error(name);
    error.name = name;
    return error;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
