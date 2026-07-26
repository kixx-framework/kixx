import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { listAdminInvites } from '../../../../../src/app/transaction-scripts/admin-invites/list-admin-invites.js';


const NEXT_CURSOR = 'signed-next-page-cursor';


describe('listAdminInvites Transaction Script', ({ it }) => {
    it('lists an empty first page with the management page size', async () => {
        const harness = makeHarness();
        const result = await listAdminInvites(harness.context);
        const call = harness.calls.listPage[0];

        assertEqual('AdminInvite,AdminUser', harness.calls.collectionNames.join(','));
        assertEqual(1, harness.calls.listPage.length);
        assertEqual(harness.context, call.context);
        assertEqual(undefined, call.options.cursor);
        assertEqual(10, call.options.limit);
        assertEqual(0, harness.calls.adminUserGet.length);
        assertEqual(0, result.items.length);
        assertEqual(null, result.cursor);
    });

    it('presents invite status and resolves each distinct author once', async () => {
        const records = [
            makeRecord({
                id: 'invite-1',
                createdBy: 'admin-1',
                status: 'pending',
            }),
            makeRecord({
                id: 'invite-2',
                createdBy: 'admin-1',
                status: 'expired',
                rolePreset: 'Editor Admin',
            }),
            makeRecord({
                id: 'invite-3',
                createdBy: 'deleted-admin',
                status: 'consumed',
                consumedAt: '2026-07-20T14:00:00.000Z',
            }),
        ];
        const users = new Map([
            [ 'admin-1', { emailAddress: 'owner@example.com' } ],
        ]);
        const harness = makeHarness({
            page: { items: records, cursor: NEXT_CURSOR },
            users,
        });
        const result = await listAdminInvites(harness.context, { cursor: 'current-cursor' });
        const listCall = harness.calls.listPage[0];

        assertEqual('current-cursor', listCall.options.cursor);
        assertEqual(10, listCall.options.limit);
        assertEqual('admin-1,deleted-admin', harness.calls.adminUserGet.join(','));
        assertEqual('admin-1', harness.calls.adminUserToObject.join(','));
        assertEqual(3, result.items.length);
        assertPresentedInvite(result.items[0], {
            id: 'invite-1',
            status: 'pending',
            createdBy: 'owner@example.com',
            rolePreset: 'Owner Admin',
            consumedAt: null,
        });
        assertPresentedInvite(result.items[1], {
            id: 'invite-2',
            status: 'expired',
            createdBy: 'owner@example.com',
            rolePreset: 'Editor Admin',
            consumedAt: null,
        });
        assertPresentedInvite(result.items[2], {
            id: 'invite-3',
            status: 'consumed',
            createdBy: 'deleted-admin',
            rolePreset: 'Owner Admin',
            consumedAt: '2026-07-20T14:00:00.000Z',
        });
        assertEqual(NEXT_CURSOR, result.cursor);
    });

    it('passes invalid cursor errors through unchanged', async () => {
        const cause = makeNamedError('InvalidCursorError');
        const harness = makeHarness({ listError: cause });
        const caught = await catchAsyncError(() => {
            return listAdminInvites(harness.context, { cursor: 'tampered-cursor' });
        });

        assertEqual(cause, caught);
        assertEqual(1, harness.calls.listPage.length);
        assertEqual(0, harness.calls.adminUserGet.length);
    });

    it('wraps unexpected invite listing failures with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ listError: cause });
        const caught = await catchAsyncError(() => listAdminInvites(harness.context));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while listing admin invites', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(0, harness.calls.adminUserGet.length);
    });

    it('wraps unexpected author lookup failures with their cause', async () => {
        const cause = new Error('admin user lookup failed');
        const record = makeRecord({ createdBy: 'admin-1' });
        const harness = makeHarness({
            page: { items: [ record ], cursor: null },
            userErrors: new Map([ [ 'admin-1', cause ] ]),
        });
        const caught = await catchAsyncError(() => listAdminInvites(harness.context));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while listing admin invites', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual('admin-1', harness.calls.adminUserGet.join(','));
    });
});

function assertPresentedInvite(actual, expected) {
    assertEqual(
        'id,kind,status,createdBy,rolePreset,createdAt,expiresAt,consumedAt,revokedAt',
        Object.keys(actual).join(','),
    );
    assertEqual(expected.id, actual.id);
    assertEqual('invite', actual.kind);
    assertEqual(expected.status, actual.status);
    assertEqual(expected.createdBy, actual.createdBy);
    assertEqual(expected.rolePreset, actual.rolePreset);
    assertEqual('2026-07-20T12:00:00.000Z', actual.createdAt);
    assertEqual('2026-07-23T12:00:00.000Z', actual.expiresAt);
    assertEqual(expected.consumedAt, actual.consumedAt);
    assertEqual(null, actual.revokedAt);
}

function makeHarness(options) {
    const {
        page = { items: [], cursor: null },
        listError = null,
        users = new Map(),
        userErrors = new Map(),
    } = options ?? {};
    const calls = {
        collectionNames: [],
        listPage: [],
        adminUserGet: [],
        adminUserToObject: [],
    };
    const invites = {
        async listPage(context, listOptions) {
            calls.listPage.push({ context, options: listOptions });
            if (listError) {
                throw listError;
            }
            return page;
        },
    };
    const adminUsers = {
        async get(_context, id) {
            calls.adminUserGet.push(id);
            if (userErrors.has(id)) {
                throw userErrors.get(id);
            }
            if (!users.has(id)) {
                return null;
            }
            return {
                toObject() {
                    calls.adminUserToObject.push(id);
                    return users.get(id);
                },
            };
        },
    };
    const context = {
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
    };

    return { context, calls };
}

function makeRecord(overrides) {
    const attributes = {
        kind: 'invite',
        createdBy: 'admin-1',
        rolePreset: 'Owner Admin',
        inviteCreationDate: '2026-07-20T12:00:00.000Z',
        inviteExpirationDate: '2026-07-23T12:00:00.000Z',
        consumedAt: null,
        revokedAt: null,
        ...overrides,
    };
    const { id = 'invite-1', status = 'pending' } = attributes;

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
