import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { sha256Hex } from '../../../../../src/kixx/utils/crypto.js';
import { resolveAdminInvite } from '../../../../../src/app/transaction-scripts/admin-invites/resolve-admin-invite.js';


const TOKEN = 'presented-invite-token';
const BOOTSTRAP_TOKEN_ENV_KEY = 'ADMIN_BOOTSTRAP_TOKEN';


describe('resolveAdminInvite Transaction Script', ({ it }) => {
    it('rejects an empty token without accessing application state', async () => {
        const harness = makeHarness();
        const result = await resolveAdminInvite(harness.context, '');

        assertNotRedeemable(result);
        assertEqual(0, harness.calls.collectionAccess);
        assertEqual(0, harness.calls.envKeys.length);
    });

    it('resolves a pending stored invite as redeemable', async () => {
        const record = makeRecord('pending');
        const harness = makeHarness({ record });
        const result = await resolveAdminInvite(harness.context, TOKEN);

        assertEqual(true, result.redeemable);
        assertEqual(false, result.isBootstrap);
        assertEqual('pending', result.status);
        assertEqual(record, result.record);
        assertEqual(await sha256Hex(TOKEN), harness.calls.tokenHashes[0]);
        assertEqual(0, harness.calls.envKeys.length);
    });

    it('preserves each terminal stored status as not redeemable', async () => {
        for (const status of [ 'revoked', 'consumed', 'expired' ]) {
            const record = makeRecord(status);
            const harness = makeHarness({ record });
            const result = await resolveAdminInvite(harness.context, TOKEN);

            assertEqual(false, result.redeemable);
            assertEqual(false, result.isBootstrap);
            assertEqual(status, result.status);
            assertEqual(record, result.record);
            assertEqual(0, harness.calls.envKeys.length);
        }
    });

    it('resolves a matching unused bootstrap token as redeemable', async () => {
        const harness = makeHarness({ bootstrapToken: TOKEN });
        const result = await resolveAdminInvite(harness.context, TOKEN);

        assertEqual(true, result.redeemable);
        assertEqual(true, result.isBootstrap);
        assertEqual(null, result.status);
        assertEqual(null, result.record);
        assertEqual(BOOTSTRAP_TOKEN_ENV_KEY, harness.calls.envKeys.join(','));
    });

    it('rejects an unknown token when bootstrap is disabled', async () => {
        const harness = makeHarness();
        const result = await resolveAdminInvite(harness.context, TOKEN);

        assertNotRedeemable(result);
        assertEqual(BOOTSTRAP_TOKEN_ENV_KEY, harness.calls.envKeys.join(','));
    });

    it('rejects an unknown token that does not match the bootstrap token', async () => {
        const harness = makeHarness({ bootstrapToken: 'different-bootstrap-token' });
        const result = await resolveAdminInvite(harness.context, TOKEN);

        assertNotRedeemable(result);
        assertEqual(BOOTSTRAP_TOKEN_ENV_KEY, harness.calls.envKeys.join(','));
    });

    it('wraps invite lookup failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ lookupError: cause });
        const caught = await catchAsyncError(() => resolveAdminInvite(harness.context, TOKEN));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading an admin invite', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.envKeys.length);
    });
});

function assertNotRedeemable(result) {
    assertEqual(false, result.redeemable);
    assertEqual(false, result.isBootstrap);
    assertEqual(null, result.status);
    assertEqual(null, result.record);
}

function makeHarness(options) {
    const {
        record = null,
        bootstrapToken,
        lookupError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        tokenHashes: [],
        envKeys: [],
    };
    const invites = {
        async getByTokenHash(_context, tokenHash) {
            calls.tokenHashes.push(tokenHash);
            if (lookupError) {
                throw lookupError;
            }
            return record;
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            assertEqual('AdminInvite', name);
            return invites;
        },
        getEnvString(key) {
            calls.envKeys.push(key);
            return bootstrapToken;
        },
    };

    return { context, calls };
}

function makeRecord(status) {
    return {
        getStatus() {
            return status;
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
