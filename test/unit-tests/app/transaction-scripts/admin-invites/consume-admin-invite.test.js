import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ROLE_EDITOR, ROLE_SUPER_ADMIN, ROLE_ROOT_ADMIN } from '../../../../../src/app/lib/roles.js';
import { sha256Hex } from '../../../../../src/kixx/utils/crypto.js';
import { consumeAdminInvite } from '../../../../../src/app/transaction-scripts/admin-invites/consume-admin-invite.js';


const TOKEN = 'presented-invite-token';
const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used.';


describe('consumeAdminInvite Transaction Script', ({ it }) => {
    it('rejects an empty token without accessing the invite collection', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, ''));

        assertInvalidInvite(caught);
        assertEqual(0, harness.calls.collectionAccess);
        assertEqual(0, harness.calls.markConsumed.length);
        assertEqual(0, harness.calls.bootstrapMarkers.length);
    });

    it('rejects a stored invite that is no longer pending without consuming it', async () => {
        const record = makeRecord({ status: 'expired' });
        const harness = makeHarness({ record });
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, TOKEN));

        assertInvalidInvite(caught);
        assertEqual(1, harness.calls.collectionAccess);
        assertEqual(0, harness.calls.markConsumed.length);
        assertEqual(0, harness.calls.bootstrapMarkers.length);
    });

    it('marks a pending stored invite consumed and returns its roles', async () => {
        const roles = [ ROLE_SUPER_ADMIN, ROLE_EDITOR ];
        const record = makeRecord({ roles });
        const harness = makeHarness({ record });
        const result = await consumeAdminInvite(harness.context, TOKEN);
        const call = harness.calls.markConsumed[0];

        assertEqual(2, harness.calls.collectionAccess);
        assertEqual(1, harness.calls.markConsumed.length);
        assertEqual(harness.context, call.context);
        assertEqual(record, call.record);
        assertEqual(roles, result.roles);
        assertEqual(0, harness.calls.bootstrapMarkers.length);
    });

    it('records bootstrap consumption and grants only Root Admin', async () => {
        const harness = makeHarness({ bootstrapToken: TOKEN });
        const result = await consumeAdminInvite(harness.context, TOKEN);
        const call = harness.calls.bootstrapMarkers[0];

        assertEqual(2, harness.calls.collectionAccess);
        assertEqual(1, harness.calls.bootstrapMarkers.length);
        assertEqual(harness.context, call.context);
        assertEqual(await sha256Hex(TOKEN), call.tokenHash);
        assertEqual(1, result.roles.length);
        assertEqual(ROLE_ROOT_ADMIN, result.roles[0]);
        assertEqual(0, harness.calls.markConsumed.length);
    });

    it('translates a concurrent bootstrap redemption into an invalid invite', async () => {
        const cause = makeNamedError('DocumentAlreadyExistsError');
        const harness = makeHarness({
            bootstrapToken: TOKEN,
            bootstrapMarkerError: cause,
        });
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, TOKEN));

        assertInvalidInvite(caught, cause);
        assertEqual(1, harness.calls.bootstrapMarkers.length);
    });

    it('wraps unexpected bootstrap consumption failures with their cause', async () => {
        const cause = new Error('bootstrap marker write failed');
        const harness = makeHarness({
            bootstrapToken: TOKEN,
            bootstrapMarkerError: cause,
        });
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, TOKEN));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while consuming the admin bootstrap token', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('translates a concurrent stored redemption into an invalid invite', async () => {
        const cause = makeNamedError('VersionConflictError');
        const harness = makeHarness({
            record: makeRecord(),
            markConsumedError: cause,
        });
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, TOKEN));

        assertInvalidInvite(caught, cause);
        assertEqual(1, harness.calls.markConsumed.length);
    });

    it('wraps unexpected stored invite consumption failures with their cause', async () => {
        const cause = new Error('invite update failed');
        const harness = makeHarness({
            record: makeRecord(),
            markConsumedError: cause,
        });
        const caught = await catchAsyncError(() => consumeAdminInvite(harness.context, TOKEN));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while consuming an admin invite', caught.message);
        assertEqual(cause, caught.cause);
    });
});

function assertInvalidInvite(error, cause) {
    assert(error, 'expected an error to be thrown');
    assertEqual('ForbiddenError', error.name);
    assertEqual('InvalidInvite', error.code);
    assertEqual(403, error.httpStatusCode);
    assertEqual(INVALID_INVITE_MESSAGE, error.message);
    if (cause) {
        assertEqual(cause, error.cause);
    }
}

function makeHarness(options) {
    const {
        record = null,
        bootstrapToken,
        bootstrapMarkerError = null,
        markConsumedError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        lookupHashes: [],
        bootstrapMarkers: [],
        markConsumed: [],
    };
    const invites = {
        async getByTokenHash(_context, tokenHash) {
            calls.lookupHashes.push(tokenHash);
            return record;
        },
        async createConsumedBootstrapMarker(context, tokenHash) {
            calls.bootstrapMarkers.push({ context, tokenHash });
            if (bootstrapMarkerError) {
                throw bootstrapMarkerError;
            }
        },
        async markConsumed(context, inviteRecord) {
            calls.markConsumed.push({ context, record: inviteRecord });
            if (markConsumedError) {
                throw markConsumedError;
            }
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            assertEqual('AdminInvite', name);
            return invites;
        },
        getEnvString(key) {
            assertEqual('ADMIN_BOOTSTRAP_TOKEN', key);
            return bootstrapToken;
        },
    };

    return { context, calls };
}

function makeRecord(options) {
    const {
        status = 'pending',
        roles = [ ROLE_EDITOR ],
    } = options ?? {};

    return {
        get(name) {
            assertEqual('roles', name);
            return roles;
        },
        getStatus() {
            return status;
        },
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
