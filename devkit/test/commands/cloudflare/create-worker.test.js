import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareCreateWorkerCommand from '../../../commands/cloudflare/create-worker.js';
import CloudflareUpdateWorkerCommand from '../../../commands/cloudflare/update-worker.js';
import captureOutput from '../../helpers/capture-output.js';

const SECRETS = { cloudflare: { accountId: 'account-id', apiToken: 'api-token' } };
const WORKER_CONFIG = {
    name: 'prod-worker',
    logpush: false,
    observability: { enabled: true },
};
const CLOUDFLARE_CONFIG = {
    environments: {
        production: { WORKER: WORKER_CONFIG, DOCUMENT_STORE: { databaseId: 'd1' } },
    },
};


describe('cloudflare create-worker and update-worker', ({ it }) => {

    it('creates a Worker from the WORKER block only', async () => {
        const client = makeClient();
        const output = captureOutput();

        const code = await makeCommand(CloudflareCreateWorkerCommand, client, output).run({ environment: 'production' });

        assertEqual(0, code);
        assertEqual('createWorker', client.calls[0][0]);
        assertEqual(JSON.stringify(WORKER_CONFIG), JSON.stringify(client.calls[0][1]));
        assertEqual(SECRETS.cloudflare, client.options);
        assertMatches('"id": "worker-id"', output.chunks.join(''));
    });

    it('replaces the Worker keyed by WORKER.name', async () => {
        const client = makeClient();
        const output = captureOutput();

        const code = await makeCommand(CloudflareUpdateWorkerCommand, client, output).run({ environment: 'production' });

        assertEqual(0, code);
        assertEqual('updateWorker', client.calls[0][0]);
        assertEqual('prod-worker', client.calls[0][1]);
        assertEqual(JSON.stringify(WORKER_CONFIG), JSON.stringify(client.calls[0][2]));
    });

    it('requires --environment, the WORKER block, and its name before any request', async () => {
        for (const Command of [ CloudflareCreateWorkerCommand, CloudflareUpdateWorkerCommand ]) {
            const client = makeClient();
            const command = makeCommand(Command, client, captureOutput());
            const noNameCommand = new Command({
                cloudflareConfig: { environments: { production: { WORKER: {} } } },
                secrets: SECRETS,
                createClient: () => client,
            });

            /* eslint-disable no-await-in-loop */
            const noEnvironment = await catchAsyncError(() => command.run({}));
            const noBlock = await catchAsyncError(() => command.run({ environment: 'staging' }));
            const noName = await catchAsyncError(() => noNameCommand.run({ environment: 'production' }));
            /* eslint-enable no-await-in-loop */

            assertEqual('UsageError', noEnvironment.name);
            assertEqual('The --environment option is required', noEnvironment.message);
            assertMatches('environments.staging.WORKER', noBlock.message);
            assertMatches('environments.production.WORKER.name', noName.message);
            assertEqual(0, client.calls.length);
        }
    });
});

function makeCommand(Command, client, output) {
    return new Command({
        cloudflareConfig: CLOUDFLARE_CONFIG,
        secrets: SECRETS,
        output,
        createClient: (options) => {
            client.options = options;
            return client;
        },
    });
}

function makeClient() {
    const calls = [];

    return {
        calls,
        options: null,
        async createWorker(payload) {
            calls.push([ 'createWorker', payload ]);
            return { id: 'worker-id', name: payload.name };
        },
        async updateWorker(name, payload) {
            calls.push([ 'updateWorker', name, payload ]);
            return { id: 'worker-id', name };
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
