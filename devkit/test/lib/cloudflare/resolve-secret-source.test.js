import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import UsageError from '../../../lib/usage-error.js';
import { resolveSecretSource } from '../../../lib/cloudflare/resolve-secret-source.js';
import createFakeCloudflareClient from '../../helpers/fake-cloudflare-client.js';

const WORKER = 'fixture-worker';
const STATE_LABEL = '.kixx/cloudflare-state.production.json';
const MANIFEST = { required: [ 'API_SECRET' ], optional: [ 'ADMIN_BOOTSTRAP_TOKEN' ] };
const STATE = { workerName: WORKER, versionId: 'v2' };

const V2 = makeVersion('v2', [ 'API_SECRET' ]);
const V1 = makeVersion('v1', [ 'API_SECRET', 'ADMIN_BOOTSTRAP_TOKEN' ]);


describe('cloudflare/resolve-secret-source', ({ describe }) => {

    describe('with a state file', ({ it }) => {

        it('uses the recorded version when it is the latest', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ V2, V1 ] });

            const source = await resolve({ apiClient });

            assertEqual('v2', source.versionId);
            assertEqual(false, source.adopted);
            assertEqual('API_SECRET', source.comparison.inheritedNames.join(','));
            assertEqual(0, source.comparison.missingRequired.length);
            assertEqual(0, source.comparison.undeclared.length);
            assertEqual('getWorkerVersion,listWorkerVersions', apiClient.calls.map((c) => c.method).join(','));
            assertEqual(1, apiClient.calls[1].args[1].per_page);
        });

        it('fails as stale when a newer version exists, naming both recovery paths', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ makeVersion('v3', [ 'API_SECRET' ]), V2 ] });

            const error = await catchError(resolve({ apiClient }));

            assert(error instanceof UsageError);
            assertMatches('stale', error.message);
            assertMatches('records version v2, but the latest version is v3', error.message);
            assertMatches('restore the state file from the checkout that made the latest version', error.message);
            assertMatches(`delete ${ STATE_LABEL } so the next run adopts the latest version`, error.message);
        });

        it('fails when the recorded version does not exist', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ V1 ] });

            const error = await catchError(resolve({ apiClient }));

            assert(error instanceof UsageError);
            assertMatches('records Worker version v2, which does not exist', error.message);
            assertMatches(`delete ${ STATE_LABEL }`, error.message);
        });

        it('fails when the state names a different Worker', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ V2 ] });

            const error = await catchError(resolve({ apiClient, state: { ...STATE, workerName: 'old-worker' } }));

            assert(error instanceof UsageError);
            assertMatches('records Worker "old-worker", but cloudflare-config.jsonc names "fixture-worker"', error.message);
            assertEqual(0, apiClient.calls.length);
        });

        it('fails when the state lacks a version id', async () => {
            const error = await catchError(resolve({
                apiClient: createFakeCloudflareClient(),
                state: { workerName: WORKER },
            }));

            assert(error instanceof UsageError);
            assertEqual(`${ STATE_LABEL } requires "versionId"`, error.message);
        });

        it('reports a missing required secret and an undeclared one', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ makeVersion('v2', [ 'OTHER' ]) ] });

            const source = await resolve({ apiClient });

            assertEqual('API_SECRET', source.comparison.missingRequired.join(','));
            assertEqual('OTHER', source.comparison.undeclared.join(','));
        });
    });

    describe('without a state file', ({ it }) => {

        it('adopts the latest version and inherits a present optional secret', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ V1 ] });

            const source = await resolve({ apiClient, state: null });

            assertEqual('v1', source.versionId);
            assertEqual(true, source.adopted);
            assertEqual('ADMIN_BOOTSTRAP_TOKEN,API_SECRET', source.comparison.inheritedNames.join(','));
            assertEqual('listWorkerVersions,getWorkerVersion', apiClient.calls.map((c) => c.method).join(','));
        });

        it('adopts the latest version but reports a mismatch', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [ makeVersion('v1', [ 'STRAY' ]) ] });

            const source = await resolve({ apiClient, state: null });

            assertEqual(true, source.adopted);
            assertEqual('API_SECRET', source.comparison.missingRequired.join(','));
            assertEqual('STRAY', source.comparison.undeclared.join(','));
        });

        it('fails on a Worker with no versions when a required secret is declared', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [] });

            const error = await catchError(resolve({ apiClient, state: null }));

            assert(error instanceof UsageError);
            assertMatches('has no versions', error.message);
            assertMatches('in the Cloudflare dashboard or with Wrangler first: API_SECRET', error.message);
        });

        it('proceeds with no source on a Worker with no versions and only optional secrets', async () => {
            const apiClient = createFakeCloudflareClient({ versions: [] });

            const source = await resolve({
                apiClient,
                state: null,
                manifest: { required: [], optional: [ 'ADMIN_BOOTSTRAP_TOKEN' ] },
            });

            assertEqual(null, source.versionId);
            assertEqual(false, source.adopted);
            assertEqual(0, source.comparison.inheritedNames.length);
            assertEqual(0, source.comparison.missingRequired.length);
        });
    });
});

function resolve({ apiClient, state = STATE, manifest = MANIFEST }) {
    return resolveSecretSource({ apiClient, workerName: WORKER, environment: 'production', state, manifest });
}

function makeVersion(id, secretNames) {
    return {
        id,
        bindings: [
            { type: 'plain_text', name: 'BUILD_ID', text: `build-${ id }` },
            ...secretNames.map((name) => ({ type: 'secret_text', name })),
        ],
    };
}

async function catchError(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected the promise to reject');
}
