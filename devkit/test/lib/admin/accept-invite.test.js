import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import acceptInvite from '../../../lib/admin/accept-invite.js';
import {
    InvalidInviteError,
    InviteSpentInEmailRaceError,
    NewUserConflictError,
} from '../../../lib/admin/admin-api-error.js';

const EMAIL = 'root@alpha.local';
const PASSWORD = 'a-strong-password';


describe('acceptInvite()', ({ it }) => {

    it('returns the created account', async () => {
        const received = {};
        const client = {
            acceptInvite: async (inviteToken, account) => {
                received.inviteToken = inviteToken;
                received.account = account;
                return { adminUserId: 'admin-id', emailAddress: account.emailAddress };
            },
        };

        const account = await acceptInvite({ client, inviteToken: 'invite', emailAddress: EMAIL, password: PASSWORD });

        assertEqual('admin-id', account.adminUserId);
        assertEqual('invite', received.inviteToken);
        assertEqual(EMAIL, received.account.emailAddress);
        assertEqual(PASSWORD, received.account.password);
    });

    it('rejects 11- and 257-character passwords before calling the client', async () => {
        for (const length of [ 11, 257 ]) {
            let called = false;
            const client = {
                acceptInvite: async () => {
                    called = true;
                },
            };

            // eslint-disable-next-line no-await-in-loop
            const error = await catchAsyncError(() => acceptInvite({
                client,
                inviteToken: 'invite',
                emailAddress: EMAIL,
                password: 'x'.repeat(length),
            }));

            assertEqual('UsageError', error?.name);
            assertEqual('New admin password must be 12 to 256 characters', error.message);
            assertEqual(false, called);
        }
    });

    it('maps each typed invite error to its message', async () => {
        const cases = [
            [ InvalidInviteError, 'The invite token is unknown, expired, revoked, or already used.' ],
            [
                NewUserConflictError,
                `An admin account already exists for ${ EMAIL }. `
                + 'The invite was not used; retry with a different email address.',
            ],
            [
                InviteSpentInEmailRaceError,
                `A concurrent signup claimed ${ EMAIL } and the invite was consumed. A new invite is required.`,
            ],
        ];

        for (const [ ErrorClass, expected ] of cases) {
            const client = {
                acceptInvite: async () => {
                    throw new ErrorClass('rejected', { status: 409, method: 'POST', url: 'https://x', attempts: 1 });
                },
            };

            // eslint-disable-next-line no-await-in-loop
            const error = await catchAsyncError(() => acceptInvite({
                client,
                inviteToken: 'invite',
                emailAddress: EMAIL,
                password: PASSWORD,
            }));

            assertEqual('UsageError', error?.name);
            assertEqual(expected, error.message);
        }
    });

    it('propagates other errors unchanged', async () => {
        const failure = new Error('network down');
        const client = {
            acceptInvite: async () => {
                throw failure;
            },
        };

        const error = await catchAsyncError(() => acceptInvite({
            client,
            inviteToken: 'invite',
            emailAddress: EMAIL,
            password: PASSWORD,
        }));

        assert(error === failure, 'expected the original error');
    });
});


async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
