import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareDeployVersionCommand from '../../../commands/cloudflare/deploy-version.js';
import CloudflareAPIClient from '../../../lib/cloudflare/cloudflare-api-client.js';
import captureOutput from '../../helpers/capture-output.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';

const PROJECT = '/app';
const STATE_PATH = '/app/.kixx/cloudflare-state.production.json';
const SECRETS = { cloudflare: { accountId: 'account-id', apiToken: 'api-token' } };
const CLOUDFLARE_CONFIG = {
    environments: { production: { WORKER: { name: 'prod-worker' } } },
};


describe('cloudflare deploy-version', ({ it }) => {

    it('declares only --environment and an optional version id', () => {
        assertEqual('environment', Object.keys(CloudflareDeployVersionCommand.options).join(','));
        assertEqual('e', CloudflareDeployVersionCommand.options.environment.short);
        assertEqual(1, CloudflareDeployVersionCommand.positionals.length);
        assertEqual(false, CloudflareDeployVersionCommand.positionals[0].required);
        assertEqual('cloudflare.accountId,cloudflare.apiToken', CloudflareDeployVersionCommand.requiredSecrets.join(','));
        assertEqual(undefined, CloudflareDeployVersionCommand.requiredConfig);
    });

    it('deploys through the Cloudflare API only and prints the result', async () => {
        const fetchMock = makeCloudflareFetch();
        const output = captureOutput();
        const fileSystem = createMemoryFileSystem({
            [STATE_PATH]: JSON.stringify({ workerName: 'prod-worker', versionId: 'v2', deployed: false }),
        });

        const code = await makeCommand({ fetchMock, output, fileSystem }).run({ environment: 'production' });
        const text = output.chunks.join('');

        assertEqual(0, code);
        assertEqual(2, fetchMock.calls.length);
        for (const call of fetchMock.calls) {
            assertEqual('api.cloudflare.com', call.url.host);
        }
        assertEqual('POST', fetchMock.calls[1].init.method);
        assertEqual(null, fetchMock.calls[1].url.searchParams.get('force'));

        assertMatches('Environment: production', text);
        assertMatches('Worker:      prod-worker', text);
        assertMatches('Version:     v2', text);
        assertMatches('BUILD_ID:    build-v2', text);
        assertMatches('Deployed to 100% of traffic.', text);
        assertMatches(`Updated ${ STATE_PATH }`, text);
        assertEqual(true, JSON.parse(fileSystem.files.get(STATE_PATH)).deployed);
    });

    it('prints (none) for a version without a BUILD_ID', async () => {
        const fetchMock = makeCloudflareFetch({ bindings: [] });
        const output = captureOutput();

        await makeCommand({ fetchMock, output }).run({ environment: 'production' }, 'v1');

        const text = output.chunks.join('');
        assertMatches('BUILD_ID:    (none)', text);
        assert(!text.includes('Updated'), 'no state file to update');
    });
});

function makeCommand({ fetchMock, output, fileSystem = createMemoryFileSystem() }) {
    return new CloudflareDeployVersionCommand({
        projectDirectory: PROJECT,
        cloudflareConfig: CLOUDFLARE_CONFIG,
        config: { app: { environments: {} } },
        secrets: SECRETS,
        fileSystem,
        output,
        createClient: (options) => new CloudflareAPIClient({ ...options, fetch: fetchMock }),
    });
}

function makeCloudflareFetch(versionOverrides) {
    const calls = [];

    async function fetchMock(url, init) {
        calls.push({ url, init });

        const versionId = url.pathname.split('/').pop();
        const result = init.method === 'GET'
            ? {
                id: versionId,
                bindings: [ { type: 'plain_text', name: 'BUILD_ID', text: `build-${ versionId }` } ],
                ...versionOverrides,
            }
            : { id: 'deployment-id' };

        return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), { status: 200 });
    }

    fetchMock.calls = calls;
    return fetchMock;
}
