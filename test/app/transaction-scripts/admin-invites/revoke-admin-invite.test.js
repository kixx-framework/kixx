import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { revokeAdminInvite } from '../../../../src/app/transaction-scripts/admin-invites/revoke-admin-invite.js';


const INVITE_ID = 'stored-invite-token-hash';


describe('revokeAdminInvite Transaction Script', ({ it }) => {
    it('rejects a missing invite id before accessing the collection', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('revokeAdminInvite: inviteId', caught.message);
        assertEqual(0, harness.calls.collectionAccess);
    });

    it('wraps invite lookup failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ lookupError: cause });
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin invite for revocation', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.revoke.length);
    });

    it('reports an invite that does not exist', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

        assert(caught, 'expected an error to be thrown');
        assertEqual('NotFoundError', caught.name);
        assertEqual('AdminInviteNotFound', caught.code);
        assertEqual(404, caught.httpStatusCode);
        assertEqual('Admin invite not found.', caught.message);
        assertEqual(0, harness.calls.revoke.length);
    });

    it('refuses terminal invite states without writing', async () => {
        for (const status of [ 'consumed', 'revoked' ]) {
            const record = makeRecord({ status, isRevocable: false });
            const harness = makeHarness({ record });
            const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ConflictError', caught.name);
            assertEqual('AdminInviteNotRevocable', caught.code);
            assertEqual(409, caught.httpStatusCode);
            assertEqual(`An invite that is ${ status } can no longer be revoked.`, caught.message);
            assertEqual(0, harness.calls.revoke.length);
        }
    });

    it('revokes pending and expired invites through the collection gateway', async () => {
        for (const status of [ 'pending', 'expired' ]) {
            const record = makeRecord({ status, isRevocable: true });
            const harness = makeHarness({ record });
            const result = await revokeAdminInvite(harness.context, INVITE_ID);
            const lookupCall = harness.calls.lookup[0];
            const revokeCall = harness.calls.revoke[0];

            assertEqual(undefined, result);
            assertEqual(1, harness.calls.collectionAccess);
            assertEqual(harness.context, lookupCall.context);
            assertEqual(INVITE_ID, lookupCall.inviteId);
            assertEqual(1, harness.calls.revoke.length);
            assertEqual(harness.context, revokeCall.context);
            assertEqual(record, revokeCall.record);
        }
    });

    it('translates a concurrent modification into a revocation conflict', async () => {
        const cause = makeNamedError('VersionConflictError');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('AdminInviteConflict', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('This invite was modified by someone else. Reload and try again.', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('translates deletion during revocation into a not-found error', async () => {
        const cause = makeNamedError('DocumentNotFoundError');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

        assert(caught, 'expected an error to be thrown');
        assertEqual('NotFoundError', caught.name);
        assertEqual('AdminInviteNotFound', caught.code);
        assertEqual(404, caught.httpStatusCode);
        assertEqual('Admin invite not found.', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('wraps unexpected revocation failures with their cause', async () => {
        const cause = new Error('invite update failed');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => revokeAdminInvite(harness.context, INVITE_ID));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while revoking an admin invite', caught.message);
        assertEqual(cause, caught.cause);
    });
});

function makeHarness(options) {
    const {
        record = null,
        lookupError = null,
        revokeError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        lookup: [],
        revoke: [],
    };
    const invites = {
        async getByTokenHash(context, inviteId) {
            calls.lookup.push({ context, inviteId });
            if (lookupError) {
                throw lookupError;
            }
            return record;
        },
        async revoke(context, inviteRecord) {
            calls.revoke.push({ context, record: inviteRecord });
            if (revokeError) {
                throw revokeError;
            }
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            assertEqual('AdminInvite', name);
            return invites;
        },
    };

    return { context, calls };
}

function makeRecord(options) {
    const {
        status = 'pending',
        isRevocable = true,
    } = options ?? {};

    return {
        getStatus() {
            return status;
        },
        isRevocable() {
            return isRevocable;
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
