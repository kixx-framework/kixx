import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { authenticatePublishingToken } from '../../../../../src/app/transaction-scripts/publishing-api-tokens/authenticate-publishing-token.js';


const TOKEN = 'kxpat_test-token';
const TOKEN_HASH = '1722d23f669b53e63daf8645866c251f69c7793ab710d46e4eb29ef0c4b75a94';
const UNAUTHENTICATED_MESSAGE = 'Publishing API authentication is required.';


describe('authenticatePublishingToken Transaction Script', ({ it }) => {
    it('rejects a missing token without accessing the collection', async () => {
        for (const token of [ undefined, null, '' ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => {
                return authenticatePublishingToken(harness.context, token);
            });

            assertUnauthenticated(caught);
            assertEqual(0, harness.calls.collectionAccess);
        }
    });

    it('hashes an active token, loads its record, and returns it', async () => {
        const record = makeRecord();
        const harness = makeHarness({ record });
        const result = await authenticatePublishingToken(harness.context, TOKEN);
        const lookupCall = harness.calls.lookup[0];

        assertEqual(record, result);
        assertEqual(1, harness.calls.collectionAccess);
        assertEqual('PublishingApiToken', harness.calls.collectionNames[0]);
        assertEqual(1, harness.calls.lookup.length);
        assertEqual(harness.context, lookupCall.context);
        assertEqual(TOKEN_HASH, lookupCall.tokenHash);
        assertEqual(1, record.calls.isActive);
    });

    it('wraps token lookup failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ lookupError: cause });
        const caught = await catchAsyncError(() => {
            return authenticatePublishingToken(harness.context, TOKEN);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading a publishing API token', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('rejects an unknown token as unauthenticated', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return authenticatePublishingToken(harness.context, TOKEN);
        });

        assertUnauthenticated(caught);
    });

    it('rejects an expired or revoked token as inactive', async () => {
        const record = makeRecord({ isActive: false });
        const harness = makeHarness({ record });
        const caught = await catchAsyncError(() => {
            return authenticatePublishingToken(harness.context, TOKEN);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual('PublishingApiTokenInactive', caught.code);
        assertEqual(403, caught.httpStatusCode);
        assertEqual('The publishing API token is expired or revoked.', caught.message);
        assertEqual(1, record.calls.isActive);
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
        record = null,
        lookupError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        collectionNames: [],
        lookup: [],
    };
    const collection = {
        async getByTokenHash(context, tokenHash) {
            calls.lookup.push({ context, tokenHash });
            if (lookupError) {
                throw lookupError;
            }
            return record;
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            calls.collectionNames.push(name);
            return collection;
        },
    };

    return { context, calls };
}

function makeRecord(options) {
    const { isActive = true } = options ?? {};
    const calls = { isActive: 0 };

    return {
        calls,
        isActive() {
            calls.isActive += 1;
            return isActive;
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
