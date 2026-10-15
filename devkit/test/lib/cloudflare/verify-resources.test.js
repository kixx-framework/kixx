import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareApiError from '../../../lib/cloudflare/cloudflare-api-error.js';
import UsageError from '../../../lib/usage-error.js';
import { verifyResources } from '../../../lib/cloudflare/verify-resources.js';
import createFakeCloudflareClient from '../../helpers/fake-cloudflare-client.js';

const ENVIRONMENT_CONFIG = {
    WORKER: { name: 'fixture-worker' },
    DOCUMENT_STORE: { bindingName: 'DOCUMENT_STORE', databaseId: 'd1-id' },
    KEY_VALUE_STORE: { bindingName: 'KEY_VALUE_STORE', namespaceId: 'kv-id' },
    CONTENT_STORE: {
        kvBindingName: 'CA_STORE_KV_STORE',
        kvNamespaceId: 'content-kv-id',
        durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
        durableObjectClassName: 'ContentAddressableIndexStore',
    },
    OBJECT_STORE: {
        buckets: {
            files: { bindingName: 'OBJECT_STORE_FILES', bucketName: 'fixture-files', jurisdiction: 'eu' },
            media: { bindingName: 'OBJECT_STORE_MEDIA', bucketName: 'fixture-media' },
        },
    },
};

const ALL_EXIST = {
    d1: [ 'd1-id' ],
    kv: [ 'kv-id', 'content-kv-id' ],
    r2: [ 'fixture-files|eu', 'fixture-media' ],
};


describe('cloudflare/verify-resources', ({ it }) => {

    it('returns no problems when every resource exists, looking each one up', async () => {
        const apiClient = createFakeCloudflareClient(ALL_EXIST);

        const problems = await verify(apiClient);

        assertEqual(0, problems.length);
        assertEqual([
            'getD1Database:d1-id',
            'getKVNamespace:kv-id',
            'getKVNamespace:content-kv-id',
            'getR2Bucket:fixture-files:eu',
            'getR2Bucket:fixture-media:',
        ].join(','), apiClient.calls.map(describeCall).join(','));
        assertEqual(0, apiClient.forbiddenCalls().length);
    });

    it('reports missing IDs, empty IDs, and 404s together, in config order', async () => {
        const apiClient = createFakeCloudflareClient({ d1: [], kv: [ 'content-kv-id' ], r2: [ 'fixture-media' ] });

        const problems = await verify(apiClient, {
            KEY_VALUE_STORE: { bindingName: 'KEY_VALUE_STORE', namespaceId: '' },
            CONTENT_STORE: { ...ENVIRONMENT_CONFIG.CONTENT_STORE, kvNamespaceId: 'missing-kv-id' },
        });

        assertEqual([
            'environments.production.DOCUMENT_STORE.databaseId | D1 database "d1-id" | not found in Cloudflare',
            'environments.production.KEY_VALUE_STORE.namespaceId | KV namespace | no ID configured',
            'environments.production.CONTENT_STORE.kvNamespaceId | KV namespace "missing-kv-id" | not found in Cloudflare',
            'environments.production.OBJECT_STORE.buckets.files.bucketName | R2 bucket "fixture-files" (jurisdiction eu) | not found in Cloudflare',
        ].join('\n'), problems.map((p) => `${ p.configPath } | ${ p.resource } | ${ p.cause }`).join('\n'));

        // The empty ID is never looked up.
        assertEqual(0, apiClient.callsTo('getKVNamespace').filter((call) => call.args[0] === '').length);
        assertEqual(0, apiClient.forbiddenCalls().length);
    });

    it('reports an absent ID as not configured', async () => {
        const apiClient = createFakeCloudflareClient(ALL_EXIST);

        const problems = await verify(apiClient, { DOCUMENT_STORE: { bindingName: 'DOCUMENT_STORE' } });

        assertEqual(1, problems.length);
        assertEqual('environments.production.DOCUMENT_STORE.databaseId', problems[0].configPath);
        assertEqual('no ID configured', problems[0].cause);
        assertEqual(0, apiClient.callsTo('getD1Database').length);
    });

    it('propagates a lookup failure other than 404', async () => {
        const failure = new CloudflareApiError('Server error', { status: 500, method: 'GET', url: 'x' });
        const apiClient = createFakeCloudflareClient({ ...ALL_EXIST, failures: { getKVNamespace: failure } });

        let caught;
        try {
            await verify(apiClient);
        } catch (error) {
            caught = error;
        }

        assertEqual(failure, caught);
    });

    it('checks nothing when no resource blocks are configured', async () => {
        const apiClient = createFakeCloudflareClient();

        const problems = await verifyResources({
            environmentConfig: { WORKER: { name: 'w' } },
            environment: 'production',
            apiClient,
        });

        assertEqual(0, problems.length);
        assertEqual(0, apiClient.calls.length);
    });

    it('rejects a resource block that is not an object', async () => {
        let caught;
        try {
            await verify(createFakeCloudflareClient(ALL_EXIST), { DOCUMENT_STORE: 'd1-id' });
        } catch (error) {
            caught = error;
        }

        assert(caught instanceof UsageError);
        assertEqual('Invalid cloudflare-config.jsonc: environments.production.DOCUMENT_STORE must be an object', caught.message);
    });
});

function verify(apiClient, overrides) {
    return verifyResources({
        environmentConfig: { ...ENVIRONMENT_CONFIG, ...overrides },
        environment: 'production',
        apiClient,
    });
}

function describeCall(call) {
    if (call.method === 'getR2Bucket') {
        return `${ call.method }:${ call.args[0] }:${ call.args[1]?.jurisdiction ?? '' }`;
    }
    return `${ call.method }:${ call.args[0] }`;
}
