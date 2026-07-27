import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { revokePublishingApiToken } from '../../../../../src/app/transaction-scripts/publishing-api-tokens/revoke-publishing-api-token.js';


const TOKEN_ID = 'stored-token-hash';


describe('revokePublishingApiToken Transaction Script', ({ it }) => {
    it('rejects a missing token id before accessing the collection', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('revokePublishingApiToken: tokenId', caught.message);
        assertEqual(0, harness.calls.collectionAccess);
    });

    it('wraps token lookup failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ lookupError: cause });
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context, TOKEN_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while loading a publishing API token for revocation', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.revoke.length);
    });

    it('reports a token that does not exist', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context, TOKEN_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('NotFoundError', caught.name);
        assertEqual('PublishingApiTokenNotFound', caught.code);
        assertEqual(404, caught.httpStatusCode);
        assertEqual('Publishing API token not found.', caught.message);
        assertEqual(0, harness.calls.revoke.length);
    });

    it('refuses expired and revoked tokens without rewriting terminal state', async () => {
        for (const status of [ 'expired', 'revoked' ]) {
            const record = makeRecord({ status, isRevocable: false });
            const harness = makeHarness({ record });
            const caught = await catchAsyncError(() => {
                return revokePublishingApiToken(harness.context, TOKEN_ID);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ConflictError', caught.name);
            assertEqual('PublishingApiTokenNotRevocable', caught.code);
            assertEqual(409, caught.httpStatusCode);
            assertEqual(`A token that is ${ status } can no longer be revoked.`, caught.message);
            assertEqual(1, record.calls.isRevocable);
            assertEqual(1, record.calls.getStatus);
            assertEqual(0, harness.calls.revoke.length);
        }
    });

    it('revokes an active token through the collection gateway', async () => {
        const record = makeRecord();
        const harness = makeHarness({ record });
        const result = await revokePublishingApiToken(harness.context, TOKEN_ID);
        const lookupCall = harness.calls.lookup[0];
        const revokeCall = harness.calls.revoke[0];

        assertEqual(undefined, result);
        assertEqual(1, harness.calls.collectionAccess);
        assertEqual('PublishingApiToken', harness.calls.collectionNames[0]);
        assertEqual(harness.context, lookupCall.context);
        assertEqual(TOKEN_ID, lookupCall.tokenId);
        assertEqual(1, record.calls.isRevocable);
        assertEqual(0, record.calls.getStatus);
        assertEqual(1, harness.calls.revoke.length);
        assertEqual(harness.context, revokeCall.context);
        assertEqual(record, revokeCall.record);
    });

    it('translates a concurrent modification into a revocation conflict', async () => {
        const cause = makeNamedError('VersionConflictError');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context, TOKEN_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('PublishingApiTokenConflict', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('This token was modified by someone else. Reload and try again.', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('translates deletion during revocation into a not-found error', async () => {
        const cause = makeNamedError('DocumentNotFoundError');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context, TOKEN_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('NotFoundError', caught.name);
        assertEqual('PublishingApiTokenNotFound', caught.code);
        assertEqual(404, caught.httpStatusCode);
        assertEqual('Publishing API token not found.', caught.message);
        assertEqual(cause, caught.cause);
    });

    it('wraps unexpected revocation failures with their cause', async () => {
        const cause = new Error('token update failed');
        const harness = makeHarness({
            record: makeRecord(),
            revokeError: cause,
        });
        const caught = await catchAsyncError(() => {
            return revokePublishingApiToken(harness.context, TOKEN_ID);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while revoking a publishing API token', caught.message);
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
        collectionNames: [],
        lookup: [],
        revoke: [],
    };
    const collection = {
        async getByTokenHash(context, tokenId) {
            calls.lookup.push({ context, tokenId });
            if (lookupError) {
                throw lookupError;
            }
            return record;
        },
        async revoke(context, tokenRecord) {
            calls.revoke.push({ context, record: tokenRecord });
            if (revokeError) {
                throw revokeError;
            }
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
    const {
        status = 'active',
        isRevocable = true,
    } = options ?? {};
    const calls = {
        getStatus: 0,
        isRevocable: 0,
    };

    return {
        calls,
        getStatus() {
            calls.getStatus += 1;
            return status;
        },
        isRevocable() {
            calls.isRevocable += 1;
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
