import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    PRESET_OWNER_ADMIN,
    ROLE_EDITOR,
    ROLE_SUPER_ADMIN,
} from '../../../../src/app/lib/roles.js';
import { createAdminInvite } from '../../../../src/app/transaction-scripts/admin-invites/create-admin-invite.js';


const CREATED_BY = 'admin-1';
const TOKEN = 'one-time-raw-token';


describe('createAdminInvite Transaction Script', ({ it }) => {
    it('rejects a missing creator before accessing the invite collection', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => createAdminInvite(harness.context));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('createAdminInvite: createdBy', caught.message);
        assertEqual(0, harness.calls.collectionAccess);
    });

    it('rejects an unregistered preset before accessing the invite collection', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => createAdminInvite(harness.context, {
            createdBy: CREATED_BY,
            rolePreset: 'Root Admin',
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ForbiddenError', caught.name);
        assertEqual('AdminInvitePresetForbidden', caught.code);
        assertEqual(403, caught.httpStatusCode);
        assertEqual('The selected role preset cannot be granted.', caught.message);
        assertEqual(0, harness.calls.collectionAccess);
        assertEqual(0, harness.calls.createInvite.length);
    });

    it('creates an invite from the selected preset and returns its one-time token', async () => {
        const invite = { id: 'stored-invite', status: 'pending' };
        const harness = makeHarness({ invite });
        const result = await createAdminInvite(harness.context, {
            createdBy: CREATED_BY,
            rolePreset: PRESET_OWNER_ADMIN,
        });
        const call = harness.calls.createInvite[0];

        assertEqual(1, harness.calls.collectionAccess);
        assertEqual('AdminInvite', harness.calls.collectionNames[0]);
        assertEqual(1, harness.calls.createInvite.length);
        assertEqual(harness.context, call.context);
        assertEqual(CREATED_BY, call.args.createdBy);
        assertEqual(PRESET_OWNER_ADMIN, call.args.rolePreset);
        assertEqual(2, call.args.roles.length);
        assertEqual(ROLE_SUPER_ADMIN, call.args.roles[0]);
        assertEqual(ROLE_EDITOR, call.args.roles[1]);
        assertEqual(1, harness.calls.toObject);
        assertEqual(TOKEN, result.token);
        assertEqual(invite, result.invite);
    });

    it('wraps invite collection failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ createError: cause });
        const caught = await catchAsyncError(() => createAdminInvite(harness.context, {
            createdBy: CREATED_BY,
            rolePreset: PRESET_OWNER_ADMIN,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while creating an admin invite', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.collectionAccess);
        assertEqual(1, harness.calls.createInvite.length);
        assertEqual(0, harness.calls.toObject);
    });
});

function makeHarness(options) {
    const {
        invite = { id: 'stored-invite' },
        createError = null,
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        collectionNames: [],
        createInvite: [],
        toObject: 0,
    };
    const record = {
        toObject() {
            calls.toObject += 1;
            return invite;
        },
    };
    const collection = {
        async createInvite(context, args) {
            calls.createInvite.push({ context, args });
            if (createError) {
                throw createError;
            }
            return { token: TOKEN, record };
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

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
