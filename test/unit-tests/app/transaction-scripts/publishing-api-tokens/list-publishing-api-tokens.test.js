import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { listPublishingApiTokens } from '../../../../src/app/transaction-scripts/publishing-api-tokens/list-publishing-api-tokens.js';


const NEXT_CURSOR = 'signed-next-page-cursor';


describe('listPublishingApiTokens Transaction Script', ({ it }) => {
    it('lists an empty first page', async () => {
        const harness = makeHarness();
        const result = await listPublishingApiTokens(harness.context);
        const call = harness.calls.listPage[0];

        assertEqual(1, harness.calls.collectionAccess);
        assertEqual('PublishingApiToken', harness.calls.collectionNames[0]);
        assertEqual(1, harness.calls.listPage.length);
        assertEqual(harness.context, call.context);
        assertEqual(undefined, call.options.cursor);
        assertEqual(0, result.items.length);
        assertEqual(null, result.cursor);
    });

    it('passes the cursor and presents token lifecycle metadata without permission grants', async () => {
        const records = [
            makeRecord({
                id: 'active-token',
                status: 'active',
                description: 'Current deployment',
            }),
            makeRecord({
                id: 'revoked-token',
                status: 'revoked',
                description: null,
                revokedAt: '2026-07-25T13:00:00.000Z',
            }),
        ];
        const harness = makeHarness({
            page: { items: records, cursor: NEXT_CURSOR },
        });
        const result = await listPublishingApiTokens(
            harness.context,
            { cursor: 'current-cursor' },
        );

        assertEqual('current-cursor', harness.calls.listPage[0].options.cursor);
        assertEqual(2, result.items.length);
        assertPresentedToken(result.items[0], {
            id: 'active-token',
            status: 'active',
            description: 'Current deployment',
            revokedAt: null,
        });
        assertPresentedToken(result.items[1], {
            id: 'revoked-token',
            status: 'revoked',
            description: null,
            revokedAt: '2026-07-25T13:00:00.000Z',
        });
        assertEqual(NEXT_CURSOR, result.cursor);
    });

    it('passes invalid cursor errors through unchanged', async () => {
        const cause = makeNamedError('InvalidCursorError');
        const harness = makeHarness({ listError: cause });
        const caught = await catchAsyncError(() => {
            return listPublishingApiTokens(
                harness.context,
                { cursor: 'tampered-cursor' },
            );
        });

        assertEqual(cause, caught);
    });

    it('wraps unexpected listing failures with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ listError: cause });
        const caught = await catchAsyncError(() => {
            return listPublishingApiTokens(harness.context);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while listing publishing API tokens', caught.message);
        assertEqual(cause, caught.cause);
    });
});

function assertPresentedToken(actual, expected) {
    assertEqual(
        'id,status,description,createdBy,createdAt,expiresAt,revokedAt',
        Object.keys(actual).join(','),
    );
    assertEqual(expected.id, actual.id);
    assertEqual(expected.status, actual.status);
    assertEqual(expected.description, actual.description);
    assertEqual('admin-1', actual.createdBy);
    assertEqual('2026-07-25T12:00:00.000Z', actual.createdAt);
    assertEqual('2026-08-24T12:00:00.000Z', actual.expiresAt);
    assertEqual(expected.revokedAt, actual.revokedAt);
}

function makeHarness(options) {
    const {
        page = { items: [], cursor: null },
        listError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        collectionNames: [],
        listPage: [],
    };
    const collection = {
        async listPage(context, listOptions) {
            calls.listPage.push({ context, options: listOptions });
            if (listError) {
                throw listError;
            }
            return page;
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

function makeRecord(overrides) {
    const attributes = {
        description: null,
        createdBy: 'admin-1',
        tokenCreationDate: '2026-07-25T12:00:00.000Z',
        tokenExpirationDate: '2026-08-24T12:00:00.000Z',
        revokedAt: null,
        ...overrides,
    };
    const { id = 'token-hash', status = 'active' } = attributes;

    delete attributes.id;
    delete attributes.status;

    return {
        id,
        get(name) {
            return attributes[name];
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
