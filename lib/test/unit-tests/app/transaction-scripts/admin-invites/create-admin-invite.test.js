import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createAdminInvite } from '../../../../../src/app/transaction-scripts/admin-invites/create-admin-invite.js';


function createContext() {
    const calls = [];

    const invites = {
        createInvite(_context, args) {
            calls.push(args);

            return Promise.resolve({
                token: 'raw-token',
                record: { toObject: () => ({ id: 'token-hash', roles: args.roles }) },
            });
        },
    };

    return {
        calls,
        getCollection() {
            return invites;
        },
    };
}

async function createInviteError(context, roleId) {
    try {
        await createAdminInvite(context, { createdBy: 'admin-user-id', roleId });
    } catch (error) {
        return error;
    }

    return null;
}

describe('createAdminInvite', ({ it }) => {

    it('confers an attachable admin role id', async () => {
        for (const roleId of [ 'admin', 'developer', 'editor' ]) {
            const context = createContext();
            const result = await createAdminInvite(context, { createdBy: 'admin-user-id', roleId });

            assertEqual(1, context.calls.length);
            assertEqual(JSON.stringify([ roleId ]), JSON.stringify(context.calls[0].roles));
            assertEqual('admin-user-id', context.calls[0].createdBy);
            assertEqual('raw-token', result.token);
        }
    });

    // Root Admin is refused by the same category check that refuses an unknown
    // id: it carries no category at all, so it needs no rule of its own here.
    it('refuses a role id no invite may confer', async () => {
        for (const roleId of [ 'root-admin', 'not-a-role', 'Developer Admin', '', undefined ]) {
            const context = createContext();
            const error = await createInviteError(context, roleId);

            assert(error, `expected '${ roleId }' to be refused`);
            assertEqual('ForbiddenError', error.name);
            assertEqual('AdminInviteRoleForbidden', error.code);
            assertEqual(0, context.calls.length, 'expected no invite to be written');
        }
    });

});
