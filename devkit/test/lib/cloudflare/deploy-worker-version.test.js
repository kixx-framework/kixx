import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareApiError from '../../../lib/cloudflare/cloudflare-api-error.js';
import { deployWorkerVersion } from '../../../lib/cloudflare/deploy-worker-version.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';

const PROJECT = '/app';
const STATE_PATH = '/app/.kixx/cloudflare-state.production.json';
const CLOUDFLARE_CONFIG = {
    environments: {
        production: { WORKER: { name: 'prod-worker' } },
    },
};
const RECORDED_STATE = {
    workerName: 'prod-worker',
    buildId: '2026-10-14T12-00-00Z-abc',
    versionId: 'recorded-version',
    createdAt: '2026-10-14T12:00:00.000Z',
    deployed: false,
    modulesHash: 'm',
    bindingsHash: 'b',
    configHash: 'c',
    futureField: 'kept',
};


describe('cloudflare/deploy-worker-version', ({ it }) => {

    it('deploys an explicit version to 100% without a force option', async () => {
        const apiClient = makeApiClient();

        const result = await deploy({ apiClient, versionId: 'explicit-version' });

        assertEqual('getWorkerVersion:prod-worker:explicit-version,createDeployment:prod-worker', apiClient.summary());

        const [ workerName, deployment, options ] = apiClient.deployments[0];
        assertEqual('prod-worker', workerName);
        assertEqual(JSON.stringify({
            strategy: 'percentage',
            versions: [ { version_id: 'explicit-version', percentage: 100 } ],
        }), JSON.stringify(deployment));
        assertEqual(undefined, options);

        assertEqual('explicit-version', result.versionId);
        assertEqual('build-explicit-version', result.buildId);
        assertEqual(null, result.stateFilepath);
    });

    it('deploys the state-recorded version and marks it deployed, keeping other fields', async () => {
        const fileSystem = stateFileSystem();
        const apiClient = makeApiClient();

        const result = await deploy({ apiClient, fileSystem });

        const written = JSON.parse(fileSystem.files.get(STATE_PATH));

        assertEqual('recorded-version', result.versionId);
        assertEqual(STATE_PATH, result.stateFilepath);
        assertEqual(true, written.deployed);
        assertEqual(JSON.stringify({ ...RECORDED_STATE, deployed: true }), JSON.stringify(written));
    });

    it('marks the recorded version undeployed when another version is deployed', async () => {
        const fileSystem = stateFileSystem({ ...RECORDED_STATE, deployed: true });

        await deploy({ apiClient: makeApiClient(), fileSystem, versionId: 'older-version' });

        const written = JSON.parse(fileSystem.files.get(STATE_PATH));

        assertEqual(false, written.deployed);
        assertEqual('recorded-version', written.versionId);
    });

    it('fails with a usage error when no version is given or recorded', async () => {
        const apiClient = makeApiClient();

        const error = await catchAsyncError(() => deploy({ apiClient }));

        assertEqual('UsageError', error.name);
        assertMatches('.kixx/cloudflare-state.production.json', error.message);
        assertEqual(0, apiClient.calls.length);
    });

    it('reports a missing remote version as a usage error and does not deploy', async () => {
        const apiClient = makeApiClient({
            getWorkerVersion() {
                throw new CloudflareApiError('Unexpected HTTP status 404', { status: 404 });
            },
        });

        const error = await catchAsyncError(() => deploy({ apiClient, versionId: 'gone' }));

        assertEqual('UsageError', error.name);
        assertMatches('Worker version gone does not exist for Worker "prod-worker"', error.message);
        assertEqual(0, apiClient.deployments.length);
    });

    it('propagates a non-404 version lookup failure', async () => {
        const failure = new CloudflareApiError('Unexpected HTTP status 500', { status: 500 });
        const apiClient = makeApiClient({
            getWorkerVersion() {
                throw failure;
            },
        });

        const error = await catchAsyncError(() => deploy({ apiClient, versionId: 'v' }));

        assertEqual(failure, error);
    });

    it('does not create a state file when none exists', async () => {
        const fileSystem = createMemoryFileSystem();

        await deploy({ apiClient: makeApiClient(), fileSystem, versionId: 'v' });

        assertEqual(0, fileSystem.files.size);
    });

    it('leaves state untouched when Cloudflare refuses the deployment', async () => {
        const original = `${ JSON.stringify(RECORDED_STATE, null, 4) }\n`;
        const fileSystem = createMemoryFileSystem({ [STATE_PATH]: original });
        const apiClient = makeApiClient({
            createDeployment() {
                throw new CloudflareApiError('API error "refused"', { status: 400 });
            },
        });

        const error = await catchAsyncError(() => deploy({ apiClient, fileSystem }));

        assertEqual('CloudflareApiError', error.name);
        assertEqual(original, fileSystem.files.get(STATE_PATH));
    });

    it('reports a null BUILD_ID instead of failing when the version has none', async () => {
        const apiClient = makeApiClient({
            getWorkerVersion: () => ({ id: 'v', bindings: [ { type: 'secret_text', name: 'BUILD_ID' } ] }),
        });

        const result = await deploy({ apiClient, versionId: 'v' });

        assertEqual(null, result.buildId);
        assertEqual(1, apiClient.deployments.length);
    });

    it('says traffic moved when the state write fails after deploying', async () => {
        const fileSystem = stateFileSystem();
        fileSystem.writeFile = async () => {
            throw new Error('EACCES');
        };

        const error = await catchAsyncError(() => deploy({ apiClient: makeApiClient(), fileSystem }));

        assertMatches('Deployed version recorded-version to 100% of traffic', error.message);
        assertMatches(STATE_PATH, error.message);
        assertMatches('"deployed" to true', error.message);
    });

    it('rejects a missing environment or WORKER.name before any request', async () => {
        const apiClient = makeApiClient();

        const noEnvironment = await catchAsyncError(() => deploy({ apiClient, environment: '' }));
        const noName = await catchAsyncError(() => deploy({
            apiClient,
            cloudflareConfig: { environments: { production: { WORKER: {} } } },
        }));

        assertMatches('--environment', noEnvironment.message);
        assertMatches('environments.production.WORKER.name', noName.message);
        assertEqual(0, apiClient.calls.length);
    });
});

function deploy(overrides) {
    return deployWorkerVersion({
        projectDirectory: PROJECT,
        environment: 'production',
        cloudflareConfig: CLOUDFLARE_CONFIG,
        fileSystem: createMemoryFileSystem(),
        ...overrides,
    });
}

function stateFileSystem(state = RECORDED_STATE) {
    return createMemoryFileSystem({ [STATE_PATH]: `${ JSON.stringify(state, null, 4) }\n` });
}

function makeApiClient(overrides) {
    const calls = [];
    const deployments = [];

    const client = {
        calls,
        deployments,
        summary() {
            return calls.join(',');
        },
        async getWorkerVersion(workerName, versionId) {
            calls.push(`getWorkerVersion:${ workerName }:${ versionId }`);
            if (overrides?.getWorkerVersion) {
                return overrides.getWorkerVersion(workerName, versionId);
            }
            return {
                id: versionId,
                bindings: [ { type: 'plain_text', name: 'BUILD_ID', text: `build-${ versionId }` } ],
            };
        },
        async createDeployment(...args) {
            calls.push(`createDeployment:${ args[0] }`);
            if (overrides?.createDeployment) {
                return overrides.createDeployment(...args);
            }
            deployments.push(args);
            return { id: 'deployment-id' };
        },
    };

    return client;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    assert(false, 'expected an error');
    return null;
}
