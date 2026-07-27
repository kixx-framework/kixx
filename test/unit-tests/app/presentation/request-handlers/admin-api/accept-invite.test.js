import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';
import { acceptAdminInvite } from '../../../../../../src/app/presentation/request-handlers/admin-api/accept-invite.js';


const EMAIL_ADDRESS = 'invited@example.com';
const PASSWORD = 'correct horse battery staple';
const INVITE_TOKEN = 'presented-invite-token';
const ROLES = [ 'Site Admin' ];
const USER_CREATION_DATE = '2026-07-21T09:30:00.000Z';
const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used.';


describe('acceptAdminInvite admin API handler', ({ it }) => {
    it('creates the invited account and returns it as a committed JSON API resource', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const response = makeResponse();

        await acceptAdminInvite(harness.context, makeRequest(), response);

        assertEqual(201, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('AdminUser', response.document.data.type);
        assertEqual('admin-1', response.document.data.id);
        assertEqual(EMAIL_ADDRESS, response.document.data.attributes.emailAddress);
        assertEqual(USER_CREATION_DATE, response.document.data.attributes.userCreationDate);
        assertEqual(1, harness.calls.userCreates.length);
        assertEqual(EMAIL_ADDRESS, harness.calls.userCreates[0].attributes.emailAddress);
        assertEqual(ROLES, harness.calls.userCreates[0].attributes.roles);
    });

    it('withholds role and credential attributes from the created resource', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const response = makeResponse();

        await acceptAdminInvite(harness.context, makeRequest(), response);

        // The invite bearer, not a session, authorizes this call, so the
        // response is deliberately narrower than the authenticated-user view.
        const { attributes } = response.document.data;
        assertUndefined(attributes.roles);
        assertUndefined(attributes.passwordHash);
        assertUndefined(attributes.password);
    });

    it('spends the invite exactly once for a successful signup', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });

        await acceptAdminInvite(harness.context, makeRequest(), makeResponse());

        // The handler resolves the invite itself and the Transaction Script
        // resolves it again before consuming, but only one consuming write
        // may ever reach the collection.
        assertEqual(1, harness.calls.markConsumed.length);
        assertEqual('create-user', harness.calls.events.slice(-1)[0]);
    });

    it('rejects a request body which is not JSON API before reading the body', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const request = makeRequest({ contentType: 'application/json' });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
        assertEqual(0, request.calls.json);
        assertEqual(0, harness.calls.collectionNames.length);
    });

    it('requires an invite bearer token', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const request = makeRequest({ inviteToken: null });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnauthenticatedError', caught.name);
        assertEqual(401, caught.httpStatusCode);
        assertEqual('An invite bearer token is required.', caught.message);
        assertEqual(0, request.calls.json);
        assertEqual(0, harness.calls.collectionNames.length);
    });

    it('rejects a JSON API resource type which is not AdminUser', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const request = makeRequest({ type: 'AdminInvite' });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('JsonApiResourceTypeMismatch', caught.code);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('reports an unredeemable invite with the non-enumerating message', async () => {
        const harness = makeHarness({ inviteRecord: null });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, makeRequest(), makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual(403, caught.httpStatusCode);
        assertEqual('InvalidInvite', caught.code);
        assertEqual(INVALID_INVITE_MESSAGE, caught.message);
        assertEqual(0, harness.calls.markConsumed.length);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('reports an already consumed invite as unredeemable', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord({ status: 'consumed' }) });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, makeRequest(), makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual('InvalidInvite', caught.code);
        assertEqual(INVALID_INVITE_MESSAGE, caught.message);
        assertEqual(0, harness.calls.markConsumed.length);
    });

    it('prefers the invite failure over form validation errors', async () => {
        const harness = makeHarness({ inviteRecord: null });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(
                harness.context,
                makeRequest({ attributes: { emailAddress: 'not-an-email', password: 'short' } }),
                makeResponse(),
            );
        });

        // Reporting field errors for a dead invite link would tell the caller
        // their token was good; the invite check must win.
        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual('InvalidInvite', caught.code);
    });

    it('rejects invalid account attributes once the invite is redeemable', async () => {
        const harness = makeHarness({ inviteRecord: makeInviteRecord() });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(
                harness.context,
                makeRequest({ attributes: { emailAddress: EMAIL_ADDRESS, password: 'too-short' } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(422, caught.httpStatusCode);
        assertEqual(0, harness.calls.markConsumed.length);
        assertEqual(0, harness.calls.userCreates.length);
    });

    it('surfaces a duplicate email conflict without spending the invite', async () => {
        const harness = makeHarness({
            inviteRecord: makeInviteRecord(),
            existingUser: {},
        });
        const caught = await catchAsyncError(() => {
            return acceptAdminInvite(harness.context, makeRequest(), makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('NewUserConflictError', caught.code);
        assertEqual(0, harness.calls.markConsumed.length);
    });
});

function makeHarness(options) {
    const {
        iterations = 1,
        existingUser = null,
        inviteRecord = null,
        createdUser = makeCreatedUser(),
        createUserError = null,
    } = options ?? {};
    const calls = {
        collectionNames: [],
        inviteLookups: [],
        markConsumed: [],
        userCreates: [],
        events: [],
    };
    const invites = {
        async getByTokenHash(context, tokenHash) {
            calls.inviteLookups.push({ context, tokenHash });
            return inviteRecord;
        },
        async markConsumed(context, record) {
            calls.markConsumed.push({ context, record });
            calls.events.push('consume-invite');
        },
    };
    const adminUsers = {
        async getByEmailAddress(_context, emailAddress) {
            calls.events.push('lookup-user');
            assertEqual(EMAIL_ADDRESS, emailAddress);
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
    const context = {
        requestId: 'request-1',
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: iterations },
            },
        },
        logger: {
            warn() {},
        },
        getCollection(name) {
            calls.collectionNames.push(name);
            if (name === 'AdminInvite') {
                return invites;
            }
            if (name === 'AdminUser') {
                return adminUsers;
            }
            throw new Error(`Unexpected collection: ${ name }`);
        },
        getEnvString() {
            // No bootstrap token configured; stored invites are the only path.
            return null;
        },
    };

    return { context, calls };
}

function makeRequest(options) {
    const {
        contentType = JSON_API_CONTENT_TYPE,
        inviteToken = INVITE_TOKEN,
        type = 'AdminUser',
        attributes = { emailAddress: EMAIL_ADDRESS, password: PASSWORD },
    } = options ?? {};

    return {
        calls: { json: 0 },
        getContentMediaType() {
            return contentType;
        },
        getAuthorizationBearer() {
            return inviteToken;
        },
        async json() {
            this.calls.json += 1;
            return { data: { type, attributes } };
        },
    };
}

function makeResponse() {
    return {
        respondWithJSON(status, document, options) {
            this.status = status;
            this.document = document;
            this.options = options;
            return this;
        },
    };
}

function makeInviteRecord(options) {
    const { status = 'pending', roles = ROLES } = options ?? {};

    return {
        getStatus() {
            return status;
        },
        get(name) {
            assertEqual('roles', name);
            return roles;
        },
    };
}

function makeCreatedUser() {
    return {
        toAuthenticatedUser() {
            return {
                id: 'admin-1',
                type: 'AdminUser',
                emailAddress: EMAIL_ADDRESS,
                userCreationDate: USER_CREATION_DATE,
                roles: ROLES,
            };
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
