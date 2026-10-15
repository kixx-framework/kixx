import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import UsageError from '../../../lib/usage-error.js';
import { hashValue } from '../../../lib/canonical-hash.js';
import { parseJsonc } from '../../../lib/parse-jsonc.js';
import { createWorkerVersion, TRIGGERED_BY } from '../../../lib/cloudflare/create-worker-version.js';
import createFakeCloudflareClient from '../../helpers/fake-cloudflare-client.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';

const PROJECT = '/app';
const STATE_PATH = '/app/.kixx/cloudflare-state.production.json';
const GENERATED_PATH = '/app/cloudflare-config.generated.js';
const FIXTURE_URL = new URL('../../fixtures/worker-project/', import.meta.url);
const NOW = new Date('2026-10-14T12:00:00.000Z');
const BUILD_ID = '2026-10-14T12-00-00Z-unique';

const PROVISIONED_WORKER = {
    deployed_on: '2026-10-01T00:00:00Z',
    references: { durable_objects: [ { namespace_name: 'fixture-worker_ContentAddressableIndexStore' } ] },
};
const NEW_WORKER = { deployed_on: null, references: { durable_objects: [] } };

const RESOURCES = {
    d1: [ 'd1-id' ],
    kv: [ 'kv-id', 'content-kv-id' ],
    r2: [ 'fixture-files|eu' ],
};


describe('cloudflare/create-worker-version', ({ describe }) => {

    describe('upload', ({ it }) => {

        it('adopts the latest version without state, uploads undeployed, and pins state', async () => {
            const project = await loadProject();
            const apiClient = createFakeCloudflareClient({
                ...RESOURCES,
                worker: PROVISIONED_WORKER,
                versions: [ makeVersion('v1', [ 'API_SECRET' ]) ],
            });

            const result = await run({ project, apiClient });

            assertEqual('created', result.outcome);
            assertEqual('v1', result.adoptedVersionId);
            assertEqual(BUILD_ID, result.buildId);
            assertEqual('new-version-id', result.versionId);
            assertEqual(false, result.deployed);
            assertEqual(0, apiClient.forbiddenCalls().length);

            const [ upload ] = apiClient.callsTo('createWorkerVersion');
            const [ workerName, payload, options ] = upload.args;

            assertEqual('fixture-worker', workerName);
            assertEqual(false, options.deploy);
            assertEqual(true, options.strictBindingsInheritance);
            assertEqual(BUILD_ID, payload.annotations['workers/tag']);
            assertEqual(TRIGGERED_BY, payload.annotations['workers/triggered_by']);
            assertEqual('2026-01-01', payload.compatibility_date);
            assertEqual('cloudflare-server.js', payload.main_module);

            const byName = Object.fromEntries(payload.bindings.map((binding) => [ binding.name, binding ]));
            assertEqual('inherit', byName.API_SECRET.type);
            assertEqual('v1', byName.API_SECRET.version_id);
            assertEqual(undefined, byName.ADMIN_BOOTSTRAP_TOKEN, 'absent optional secret is not bound');
            assertEqual(BUILD_ID, byName.BUILD_ID.text);
            assertEqual('production', byName.ENVIRONMENT.text);
            assertEqual('false', byName.TRUST_PROXY.text);
            assertEqual('eu', byName.OBJECT_STORE_FILES.jurisdiction);
            assert(payload.exports.ContentAddressableIndexStore, 'expected the Durable Object export');

            const state = JSON.parse(project.fileSystem.files.get(STATE_PATH));
            assertEqual('fixture-worker', state.workerName);
            assertEqual(BUILD_ID, state.buildId);
            assertEqual('new-version-id', state.versionId);
            assertEqual(NOW.toISOString(), state.createdAt);
            assertEqual(false, state.deployed);
            assertEqual(result.state.modulesHash, state.modulesHash);
            assertEqual(hashValue({ compatibility_date: '2026-01-01' }), state.configHash);

            assert(project.fileSystem.files.has(GENERATED_PATH), 'expected the generated config');
            assertMatches('"fixture-worker"', project.fileSystem.files.get(GENERATED_PATH));
            assert(!project.fileSystem.files.get(GENERATED_PATH).includes('fixture-worker-staging'));
        });

        it('records a bindings hash that matches the next run against the new version', async () => {
            const project = await loadProject();
            await run({ project, apiClient: provisionedClient([ makeVersion('v1', [ 'API_SECRET' ]) ]) });

            const apiClient = provisionedClient([ makeVersion('new-version-id', [ 'API_SECRET' ]) ]);
            const result = await run({ project, apiClient });

            assertEqual('skipped', result.outcome);
            assertEqual(false, result.changes.bindings);
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
            assertEqual(0, apiClient.forbiddenCalls().length);
        });

        it('skips when nothing changed, but still writes the generated config', async () => {
            const project = await seedState();
            project.fileSystem.files.delete(GENERATED_PATH);
            const before = project.fileSystem.files.get(STATE_PATH);

            const apiClient = provisionedClient([ makeVersion('new-version-id', [ 'API_SECRET' ]) ]);
            const result = await run({ project, apiClient });

            assertEqual('skipped', result.outcome);
            assertEqual('new-version-id', result.previousState.versionId);
            assertEqual(before, project.fileSystem.files.get(STATE_PATH));
            assert(project.fileSystem.files.has(GENERATED_PATH), 'expected the generated config');
            assertEqual(0, apiClient.forbiddenCalls().length);
        });

        it('uploads with --force when nothing changed', async () => {
            const project = await seedState();

            const apiClient = provisionedClient([ makeVersion('new-version-id', [ 'API_SECRET' ]) ], { id: 'forced-id' });
            const result = await run({ project, apiClient, force: true });

            assertEqual('created', result.outcome);
            assertEqual(false, result.changes.modules);
            assertEqual('new-version-id', apiClient.callsTo('createWorkerVersion')[0].args[1].bindings
                .find((binding) => binding.name === 'API_SECRET').version_id);
            assertEqual('forced-id', JSON.parse(project.fileSystem.files.get(STATE_PATH)).versionId);
        });

        it('uploads when a module changed', async () => {
            const project = await seedState();
            project.serverSource = 'export default {}; // changed';

            const apiClient = provisionedClient([ makeVersion('new-version-id', [ 'API_SECRET' ]) ]);
            const result = await run({ project, apiClient });

            assertEqual('created', result.outcome);
            assertEqual(true, result.changes.modules);
            assertEqual(false, result.changes.bindings);
            assertNotEqual(result.previousState.modulesHash, result.state.modulesHash);
        });

        it('proceeds on a Worker with no versions when no required secret is declared', async () => {
            const project = await loadProject({ secrets: '# @optional\nADMIN_BOOTSTRAP_TOKEN=\n' });
            const apiClient = provisionedClient([]);

            const result = await run({ project, apiClient });

            assertEqual('created', result.outcome);
            assertEqual(null, result.adoptedVersionId);

            const { bindings } = apiClient.callsTo('createWorkerVersion')[0].args[1];
            assertEqual(0, bindings.filter((binding) => binding.type === 'inherit').length);
            assertEqual(0, apiClient.forbiddenCalls().length);
        });
    });

    describe('Durable Object deployment', ({ it }) => {

        it('requires --deploy for an unprovisioned class and uploads nothing without it', async () => {
            const project = await loadProject();
            const apiClient = newWorkerClient();

            const error = await catchError(run({ project, apiClient }));

            assert(error instanceof UsageError);
            assertMatches('Durable Objects:', error.message);
            assertMatches('CA_STORE_DURABLE_OBJECT binds class ContentAddressableIndexStore', error.message);
            assertMatches('Re-run with --deploy', error.message);
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
            assertEqual(0, apiClient.forbiddenCalls().length);
            assert(!project.fileSystem.files.has(GENERATED_PATH), 'preflight failure writes no generated config');
            assert(!project.fileSystem.files.has(STATE_PATH), 'preflight failure writes no state');
        });

        it('uploads and deploys in one request with --deploy, recording deployed: true', async () => {
            const project = await loadProject();
            const reconciliation = { created: [ { class_name: 'ContentAddressableIndexStore' } ] };
            const apiClient = newWorkerClient({ id: 'deployed-id', exports_reconciliation: reconciliation });

            const result = await run({ project, apiClient, deploy: true });

            assertEqual(true, apiClient.callsTo('createWorkerVersion')[0].args[2].deploy);
            assertEqual(true, result.deployed);
            assertEqual('ContentAddressableIndexStore', result.provisionedClasses.join(','));
            assertEqual(reconciliation, result.reconciliation);
            assertEqual(true, JSON.parse(project.fileSystem.files.get(STATE_PATH)).deployed);
            assertEqual(0, apiClient.forbiddenCalls().length);
        });

        it('uploads for an unprovisioned class even when the hashes match', async () => {
            const project = await seedState();
            const apiClient = createFakeCloudflareClient({
                ...RESOURCES,
                worker: NEW_WORKER,
                versions: [ makeVersion('new-version-id', [ 'API_SECRET' ]) ],
            });

            const result = await run({ project, apiClient, deploy: true });

            assertEqual('created', result.outcome);
            assertEqual(false, result.changes.modules || result.changes.bindings || result.changes.config);
            assertEqual(1, apiClient.callsTo('createWorkerVersion').length);
        });

        it('refuses --deploy when every bound class is provisioned', async () => {
            const project = await loadProject();
            const apiClient = provisionedClient([ makeVersion('v1', [ 'API_SECRET' ]) ]);

            const error = await catchError(run({ project, apiClient, deploy: true }));

            assert(error instanceof UsageError);
            assertMatches('--deploy is only allowed when a version introduces an unprovisioned', error.message);
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
        });
    });

    describe('preflight', ({ it }) => {

        it('reports a secret mismatch, a missing resource, and a missing --deploy in one error', async () => {
            const project = await loadProject();
            const apiClient = createFakeCloudflareClient({
                d1: [],
                kv: RESOURCES.kv,
                r2: RESOURCES.r2,
                worker: NEW_WORKER,
                versions: [ makeVersion('v1', [ 'STRAY_SECRET' ]) ],
            });

            const error = await catchError(run({ project, apiClient }));

            assert(error instanceof UsageError);
            assertMatches('Nothing was uploaded', error.message);
            assertMatches('Secrets (source version v1, adopted as the latest version):', error.message);
            assertMatches('API_SECRET: required, but not set on the source version', error.message);
            assertMatches('STRAY_SECRET: set on the source version, but not declared', error.message);
            assertMatches('Resources:', error.message);
            assertMatches('environments.production.DOCUMENT_STORE.databaseId: D1 database "d1-id", not found in Cloudflare', error.message);
            assertMatches('Durable Objects:', error.message);
            assertMatches('--deploy', error.message);

            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
            assertEqual(0, apiClient.forbiddenCalls().length);
            assert(!project.fileSystem.files.has(GENERATED_PATH), 'preflight failure writes no generated config');
        });

        it('fails on an undeclared secret on the recorded version', async () => {
            const project = await seedState();
            const apiClient = provisionedClient([ makeVersion('new-version-id', [ 'API_SECRET', 'STRAY' ]) ]);

            const error = await catchError(run({ project, apiClient }));

            assert(error instanceof UsageError);
            assertMatches('STRAY: set on the source version, but not declared', error.message);
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
        });

        it('inherits an optional secret when the source version has it', async () => {
            const project = await loadProject();
            const apiClient = provisionedClient([ makeVersion('v1', [ 'API_SECRET', 'ADMIN_BOOTSTRAP_TOKEN' ]) ]);

            await run({ project, apiClient });

            const { bindings } = apiClient.callsTo('createWorkerVersion')[0].args[1];
            const inherited = bindings.filter((binding) => binding.type === 'inherit').map((binding) => binding.name);
            assertEqual('ADMIN_BOOTSTRAP_TOKEN,API_SECRET', inherited.join(','));
        });

        it('tells the operator to create a missing Worker', async () => {
            const project = await loadProject();
            const apiClient = createFakeCloudflareClient({ worker: null });

            const error = await catchError(run({ project, apiClient }));

            assert(error instanceof UsageError);
            assertMatches('Worker "fixture-worker" does not exist', error.message);
            assertMatches('kixx cloudflare create-worker -e production', error.message);
            assertEqual('getWorker', apiClient.calls.map((call) => call.method).join(','));
        });

        it('stops on a stale state file before checking resources', async () => {
            const project = await seedState();
            const apiClient = provisionedClient([
                makeVersion('dashboard-version', [ 'API_SECRET' ]),
                makeVersion('new-version-id', [ 'API_SECRET' ]),
            ]);

            const error = await catchError(run({ project, apiClient }));

            assertMatches('stale', error.message);
            assertEqual(0, apiClient.callsTo('getD1Database').length);
            assertEqual(0, apiClient.forbiddenCalls().length);
        });
    });

    describe('state write failure', ({ it }) => {

        it('throws with the recoverable state JSON, its path, and the traffic status', async () => {
            const project = await loadProject();
            const writeFile = project.fileSystem.writeFile;
            project.fileSystem.writeFile = async (filepath, text) => {
                if (filepath === STATE_PATH) {
                    throw new Error('EACCES');
                }
                return writeFile(filepath, text);
            };

            const apiClient = provisionedClient([ makeVersion('v1', [ 'API_SECRET' ]) ]);
            const error = await catchError(run({ project, apiClient }));

            assert(!(error instanceof UsageError));
            assertMatches('Created Worker version new-version-id', error.message);
            assertMatches('Traffic changed: no', error.message);
            assertMatches(STATE_PATH, error.message);

            const json = JSON.parse(error.message.slice(error.message.indexOf('{')));
            assertEqual('new-version-id', json.versionId);
            assertEqual(BUILD_ID, json.buildId);
            assertEqual('fixture-worker', json.workerName);
        });
    });
});

async function loadProject(overrides) {
    const read = (name) => fsp.readFile(new URL(name, FIXTURE_URL), 'utf8');
    const configText = await read('cloudflare-config.jsonc');

    const fileSystem = createMemoryFileSystem({
        '/app/example.env.secrets': overrides?.secrets ?? await read('example.env.secrets'),
        '/app/.env.production': await read('.env.production'),
    });

    return { fileSystem, cloudflareConfig: parseJsonc(configText), serverSource: 'export default {};' };
}

// A first upload against a provisioned Worker, leaving state recording
// version "new-version-id".
async function seedState() {
    const project = await loadProject();
    await run({ project, apiClient: provisionedClient([ makeVersion('v1', [ 'API_SECRET' ]) ]) });
    return project;
}

function run({ project, apiClient, force, deploy }) {
    return createWorkerVersion({
        projectDirectory: PROJECT,
        environment: 'production',
        cloudflareConfig: project.cloudflareConfig,
        apiClient,
        force,
        deploy,
        fileSystem: project.fileSystem,
        // Reads the generated config through the file system, so a bundle
        // can only succeed after the file was written.
        bundleModules: async ({ entryFilepath, fileSystem }) => {
            assertEqual('/app/cloudflare-server.js', entryFilepath);
            const generated = await fileSystem.readFile(GENERATED_PATH);

            return {
                entry: './cloudflare-server.js',
                modules: new Map([
                    [ './cloudflare-server.js', { name: './cloudflare-server.js', source: project.serverSource } ],
                    [ './cloudflare-config.generated.js', { name: './cloudflare-config.generated.js', source: generated } ],
                ]),
            };
        },
        now: () => NOW,
        generateUniqueId: () => 'unique',
    });
}

function provisionedClient(versions, created) {
    return createFakeCloudflareClient({ ...RESOURCES, worker: PROVISIONED_WORKER, versions, created });
}

function newWorkerClient(created) {
    return createFakeCloudflareClient({
        ...RESOURCES,
        worker: NEW_WORKER,
        versions: [ makeVersion('v1', [ 'API_SECRET' ]) ],
        created,
    });
}

function makeVersion(id, secretNames) {
    return {
        id,
        bindings: secretNames.map((name) => ({ type: 'secret_text', name })),
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
