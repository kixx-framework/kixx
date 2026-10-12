import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { consumeAdminInvite } from '../../../../../src/app/transaction-scripts/admin-invites/consume-admin-invite.js';
import { ROLE_ROOT_ADMIN } from '../../../../../src/app/permissions/roles.js';


const BOOTSTRAP_TOKEN = 'bootstrap-token-value';

// Stands in for a stored invite record: consumeAdminInvite() reads only its
// status and its roles.
function createInviteRecord(roles) {
    return {
        getStatus: () => 'pending',
        get: (name) => (name === 'roles' ? roles : null),
    };
}

function createContext(record) {
    const calls = { markConsumed: 0, bootstrapMarkers: [] };

    const invites = {
        getByTokenHash: () => Promise.resolve(record),
        markConsumed: () => {
            calls.markConsumed += 1;
            return Promise.resolve(record);
        },
        createConsumedBootstrapMarker: (_context, tokenHash) => {
            calls.bootstrapMarkers.push(tokenHash);
            return Promise.resolve({});
        },
    };

    return {
        calls,
        getCollection: () => invites,
        getEnvString: (key) => (key === 'ADMIN_BOOTSTRAP_TOKEN' ? BOOTSTRAP_TOKEN : null),
    };
}

describe('consumeAdminInvite', ({ it }) => {

    it('confers the Root Admin id on the bootstrap path', async () => {
        const context = createContext(null);
        const result = await consumeAdminInvite(context, BOOTSTRAP_TOKEN);

        assertEqual(JSON.stringify([ ROLE_ROOT_ADMIN ]), JSON.stringify(result.roles));
        assertEqual(1, context.calls.bootstrapMarkers.length);
        assertEqual(0, context.calls.markConsumed);
    });

    // The ids come back verbatim so createAdminUserAccount() writes exactly what
    // the invite recorded onto the new admin user.
    it('returns the stored invite role ids verbatim', async () => {
        const context = createContext(createInviteRecord([ 'developer' ]));
        const result = await consumeAdminInvite(context, 'stored-invite-token');

        assertEqual(JSON.stringify([ 'developer' ]), JSON.stringify(result.roles));
        assertEqual(1, context.calls.markConsumed);
        assertEqual(0, context.calls.bootstrapMarkers.length);
    });

    it('refuses a token matching no invite and no bootstrap value', async () => {
        const context = createContext(null);

        try {
            await consumeAdminInvite(context, 'unknown-token');
        } catch (error) {
            assertEqual('InvalidInvite', error.code);
            assertEqual(0, context.calls.bootstrapMarkers.length);
            return;
        }

        assert(false, 'expected an unknown token to be refused');
    });

});
