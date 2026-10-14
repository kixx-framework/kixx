import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import AdminAcceptInviteCommand from '../../../commands/admin/accept-invite.js';
import {
    InvalidInviteError,
    InviteSpentInEmailRaceError,
    NewUserConflictError,
} from '../../../lib/admin/admin-api-error.js';
import captureOutput from '../../helpers/capture-output.js';

const ANSWERS = {
    'Invite token': 'invite-secret',
    'New admin email address': 'new-admin@example.test',
};


describe('admin accept-invite', ({ it }) => {

    it('creates the account and prints its id, email, and creation date', async () => {
        const output = captureOutput();
        const received = {};
        const command = makeCommand({
            output,
            password: 'a-strong-password',
            client: {
                acceptInvite: async (inviteToken, account) => {
                    received.inviteToken = inviteToken;
                    received.account = account;
                    return {
                        adminUserId: 'admin-id',
                        emailAddress: account.emailAddress,
                        userCreationDate: '2026-08-27T12:00:00.000Z',
                    };
                },
            },
        });

        const code = await command.run({ environment: 'production' });

        assertEqual(0, code);
        assertEqual('invite-secret', received.inviteToken);
        assertEqual('new-admin@example.test', received.account.emailAddress);
        assertEqual('a-strong-password', received.account.password);
        assertMatches('admin-id', output.chunks[0]);
        assertMatches('new-admin@example.test', output.chunks[0]);
        assert(!output.chunks.join('').includes('invite-secret'), 'printed the invite token');
        assert(!output.chunks.join('').includes('a-strong-password'), 'printed the password');
    });

    it('accepts a 12-character password', async () => {
        let called = false;
        const command = makeCommand({
            password: 'x'.repeat(12),
            client: {
                acceptInvite: async (_inviteToken, account) => {
                    called = true;
                    return { adminUserId: 'id', emailAddress: account.emailAddress, userCreationDate: 'now' };
                },
            },
        });

        await command.run({ environment: 'production' });

        assertEqual(true, called);
    });

    it('rejects 11- and 257-character passwords locally, sending no request', async () => {
        for (const length of [ 11, 257 ]) {
            let called = false;
            const command = makeCommand({
                password: 'x'.repeat(length),
                client: {
                    acceptInvite: async () => {
                        called = true;
                    },
                },
            });

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => command.run({ environment: 'production' }));

            assert(caught, `expected a ${ length }-character password to fail`);
            assertEqual('UsageError', caught.name);
            assertMatches('12 to 256 characters', caught.message);
            assertEqual(false, called);
        }
    });

    it('fails on a bad environment before prompting for any secret', async () => {
        let prompted = false;
        const command = new AdminAcceptInviteCommand({
            config: {},
            createClient: () => ({}),
            promptForValue: async () => {
                prompted = true;
            },
            promptForValueTwice: async () => {
                prompted = true;
            },
        });

        const caught = await catchAsyncError(() => command.run({ environment: 'staging' }));

        assertEqual('UsageError', caught.name);
        assertMatches('app.environments.staging.origin', caught.message);
        assertEqual(false, prompted);
    });

    it('maps each invite and conflict code to a distinct message', async () => {
        const cases = [
            [ InvalidInviteError, 'unknown, expired, revoked, or already used' ],
            [ NewUserConflictError, 'was not used; retry with a different email' ],
            [ InviteSpentInEmailRaceError, 'A new invite is required' ],
        ];

        const messages = new Set();

        for (const [ ErrorClass, expectedPhrase ] of cases) {
            const command = makeCommand({
                password: 'a-strong-password',
                client: {
                    acceptInvite: async () => {
                        throw new ErrorClass('rejected', {
                            status: 409, method: 'POST', url: 'https://x', attempts: 1,
                        });
                    },
                },
            });

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => command.run({ environment: 'production' }));

            assert(caught, `expected an error for ${ ErrorClass.name }`);
            assertEqual('UsageError', caught.name);
            assertMatches(expectedPhrase, caught.message);
            messages.add(caught.message);
        }

        assertEqual(3, messages.size);
    });

    it('rethrows other API errors unchanged', async () => {
        const failure = new Error('boom');
        const command = makeCommand({
            password: 'a-strong-password',
            client: {
                acceptInvite: async () => {
                    throw failure;
                },
            },
        });

        const caught = await catchAsyncError(() => command.run({ environment: 'production' }));

        assertEqual(failure, caught);
    });
});

function makeCommand(args) {
    const { password, client, output = captureOutput() } = args;

    return new AdminAcceptInviteCommand({
        output,
        config: { app: { environments: { production: { origin: 'https://admin.example.test' } } } },
        createClient: () => client,
        promptForValue: async (options) => ANSWERS[options.label],
        promptForValueTwice: async () => password,
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
