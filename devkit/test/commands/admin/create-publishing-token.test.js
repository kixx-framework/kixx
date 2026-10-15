import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from '../../../lib/vendor/kixx-assert/mod.js';

import AdminCreatePublishingTokenCommand from '../../../commands/admin/create-publishing-token.js';
import captureOutput from '../../helpers/capture-output.js';

const TOKEN = {
    tokenId: 'token-digest',
    token: 'kxpat_secret',
    roles: [ 'editor' ],
    description: null,
    tokenExpirationDate: '2026-09-26T12:00:00.000Z',
};


describe('admin create-publishing-token', ({ it }) => {

    it('prints the one-time token and the secrets key to store it under', async () => {
        const output = captureOutput();
        const received = {};
        const command = makeCommand({
            output,
            createPublishingApiToken: async (options) => {
                Object.assign(received, options);
                return TOKEN;
            },
        });

        const code = await command.run({
            environment: 'production',
            roles: [ 'editor' ],
            ttl: '3600',
            description: 'CI',
        });
        const text = output.chunks.join('');

        assertEqual(0, code);
        assertEqual('editor', received.roles[0]);
        assertEqual(3600, received.ttl);
        assertEqual('CI', received.description);
        assertMatches('\n  kxpat_secret\n', text);
        assertMatches('app.environments.production.publishingToken in .kixx/secrets.json', text);
        assertMatches('Description: (none)', text);
        assertMatches('Expires: 2026-09-26T12:00:00.000Z', text);
    });

    it('leaves unset options undefined so server defaults apply', async () => {
        const received = {};
        const command = makeCommand({
            createPublishingApiToken: async (options) => {
                Object.assign(received, options);
                return TOKEN;
            },
        });

        await command.run({ environment: 'production' });

        assertUndefined(received.roles);
        assertUndefined(received.ttl);
        assertUndefined(received.description);
    });

    it('rejects a --ttl that is not a positive whole number before prompting', async () => {
        for (const ttl of [ 'abc', '0', '-5', '1.5', '' ]) {
            let prompted = false;
            const command = makeCommand({
                onPrompt: () => {
                    prompted = true;
                },
                createPublishingApiToken: async () => TOKEN,
            });

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => command.run({ environment: 'production', ttl }));

            assert(caught, `expected --ttl "${ ttl }" to fail`);
            assertEqual('UsageError', caught.name);
            assertMatches('--ttl', caught.message);
            assertEqual(false, prompted);
        }
    });
});

function makeCommand(args) {
    const { createPublishingApiToken, onPrompt = () => {}, output = captureOutput() } = args;

    return new AdminCreatePublishingTokenCommand({
        output,
        config: { app: { environments: { production: { origin: 'https://admin.example.test' } } } },
        promptForValue: async (options) => {
            onPrompt(options);
            return 'stub-value';
        },
        createClient: () => ({ createPublishingApiToken }),
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
