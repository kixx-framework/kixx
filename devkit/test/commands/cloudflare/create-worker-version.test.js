import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareCreateWorkerVersionCommand, {
    renderCreated,
    renderSkipped,
} from '../../../commands/cloudflare/create-worker-version.js';
import UsageError from '../../../lib/usage-error.js';
import { parseJsonc } from '../../../lib/parse-jsonc.js';
import captureOutput from '../../helpers/capture-output.js';
import createFakeCloudflareClient from '../../helpers/fake-cloudflare-client.js';

const FIXTURE_DIRECTORY = fileURLToPath(new URL('../../fixtures/worker-project/', import.meta.url));
const SECRETS = { cloudflare: { accountId: 'account-id', apiToken: 'api-token' } };
const NOW = new Date('2026-10-14T12:00:00.000Z');
const UNIQUE_ID = '0123456789abcdefghijkl';
const BUILD_ID = `2026-10-14T12-00-00Z-${ UNIQUE_ID }`;

const RESOURCES = {
    d1: [ 'd1-id' ],
    kv: [ 'kv-id', 'content-kv-id' ],
    r2: [ 'fixture-files|eu' ],
};
const PROVISIONED_WORKER = {
    references: { durable_objects: [ { namespace_name: 'fixture-worker_ContentAddressableIndexStore' } ] },
};
const NEW_WORKER = { references: { durable_objects: [] } };

// Parsed once from the fixture by withProject().
let CLOUDFLARE_CONFIG;


describe('cloudflare create-worker-version', ({ it }) => {

    it('declares --environment, --force, and --deploy', () => {
        const { options } = CloudflareCreateWorkerVersionCommand;

        assertEqual('environment,force,deploy', Object.keys(options).join(','));
        assertEqual('e', options.environment.short);
        assertEqual('boolean', options.force.type);
        assertEqual('boolean', options.deploy.type);
        assertEqual('cloudflare.accountId,cloudflare.apiToken', CloudflareCreateWorkerVersionCommand.requiredSecrets.join(','));
    });

    it('bundles the project, uploads undeployed, writes the generated config, and prints next steps', async () => {
        await withProject(async (projectDirectory) => {
            const apiClient = createFakeCloudflareClient({
                ...RESOURCES,
                worker: PROVISIONED_WORKER,
                versions: [ makeVersion('v1') ],
            });
            const output = captureOutput();

            const code = await makeCommand({ projectDirectory, apiClient, output }).run({ environment: 'production' });
            const text = output.chunks.join('');

            assertEqual(0, code);
            assertEqual(0, apiClient.forbiddenCalls().length);

            assertMatches('Environment: production', text);
            assertMatches('Worker:      fixture-worker', text);
            assertMatches('Adopted latest version v1 as the secret source', text);
            assertMatches('Bundled 3 modules', text);
            assertMatches(/ {2}modules {3}changed {4}\(none\) -> \w{6}…/, text);
            assertMatches(`BUILD_ID: ${ BUILD_ID }`, text);
            assertMatches('Created version new-version-id', text);
            assertMatches('Created undeployed', text);
            assertMatches('Wrote .kixx/cloudflare-state.production.json', text);

            // Copyable: each command is on one line, never wrapped.
            assertMatches(`\n  kixx app publish -e production --build-id ${ BUILD_ID }\n`, text);
            assertMatches('\n  kixx cloudflare deploy-version -e production\n', text);

            const generated = await fsp.readFile(path.join(projectDirectory, 'cloudflare-config.generated.js'), 'utf8');
            assertMatches('export default', generated);

            const { modules } = apiClient.callsTo('createWorkerVersion')[0].args[1];
            assertEqual(
                'cloudflare-config.generated.js,cloudflare-server.js,lib/greet.js',
                modules.map((mod) => mod.name).sort().join(','),
            );

            const state = JSON.parse(await fsp.readFile(
                path.join(projectDirectory, '.kixx', 'cloudflare-state.production.json'),
                'utf8',
            ));
            assertEqual('new-version-id', state.versionId);
        });
    });

    it('skips an unchanged project and still rewrites the generated config', async () => {
        await withProject(async (projectDirectory) => {
            await makeCommand({
                projectDirectory,
                apiClient: createFakeCloudflareClient({ ...RESOURCES, worker: PROVISIONED_WORKER, versions: [ makeVersion('v1') ] }),
                output: captureOutput(),
            }).run({ environment: 'production' });

            const generatedPath = path.join(projectDirectory, 'cloudflare-config.generated.js');
            await fsp.rm(generatedPath);

            const apiClient = createFakeCloudflareClient({
                ...RESOURCES,
                worker: PROVISIONED_WORKER,
                versions: [ makeVersion('new-version-id') ],
            });
            const output = captureOutput();

            const code = await makeCommand({ projectDirectory, apiClient, output }).run({ environment: 'production' });
            const text = output.chunks.join('');

            assertEqual(0, code);
            assertMatches(`Nothing changed since version new-version-id (build\n${ BUILD_ID }).`, text);
            assertMatches('Pass --force to upload anyway.', text);
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
            assertMatches('export default', await fsp.readFile(generatedPath, 'utf8'));
        });
    });

    it('deploys with --deploy and warns, with a copyable publish command, that content is not yet assigned', async () => {
        await withProject(async (projectDirectory) => {
            const apiClient = createFakeCloudflareClient({
                ...RESOURCES,
                worker: NEW_WORKER,
                versions: [ makeVersion('v1') ],
                created: {
                    id: 'deployed-id',
                    exports_reconciliation: { created: [ { class_name: 'ContentAddressableIndexStore' } ] },
                },
            });
            const output = captureOutput();

            await makeCommand({ projectDirectory, apiClient, output }).run({ environment: 'production', deploy: true });
            const text = output.chunks.join('');

            assertEqual(true, apiClient.callsTo('createWorkerVersion')[0].args[2].deploy);
            assertMatches('Deployed to 100% of traffic (--deploy); Durable Object namespaces provisioned', text);
            assertMatches('ContentAddressableIndexStore', text);
            assertMatches('Durable Objects:\n  Created:\n    ContentAddressableIndexStore', text);
            assertMatches('Content routes return 503', text);
            assertMatches(`\n  kixx app publish -e production --build-id ${ BUILD_ID }\n`, text);
            assert(!text.includes('deploy-version'), 'a deployed version needs no deploy-version step');
        });
    });

    it('writes no generated config when preflight fails', async () => {
        await withProject(async (projectDirectory) => {
            const apiClient = createFakeCloudflareClient({ ...RESOURCES, worker: NEW_WORKER, versions: [ makeVersion('v1') ] });

            let caught;
            try {
                await makeCommand({ projectDirectory, apiClient, output: captureOutput() }).run({ environment: 'production' });
            } catch (error) {
                caught = error;
            }

            assert(caught instanceof UsageError);
            assertMatches('--deploy', caught.message);

            const generatedPath = path.join(projectDirectory, 'cloudflare-config.generated.js');
            assertEqual(false, await exists(generatedPath));
            assertEqual(0, apiClient.callsTo('createWorkerVersion').length);
        });
    });

    it('renders the skip message from the recorded state', () => {
        const text = renderSkipped({
            environment: 'production',
            workerName: 'fixture-worker',
            adoptedVersionId: null,
            previousState: { versionId: 'v9', buildId: 'b9' },
        });

        assertMatches('Nothing changed since version v9 (build b9).', text);
        assert(!text.includes('Adopted'), text);
    });

    it('renders hash lines, removable entries, and referencing scripts', () => {
        const text = renderCreated({
            environment: 'production',
            workerName: 'fixture-worker',
            adoptedVersionId: null,
            previousState: { modulesHash: 'aaaaaa11', bindingsHash: 'bbbbbb22', configHash: 'cccccc33' },
            state: { modulesHash: 'dddddd44', bindingsHash: 'bbbbbb22', configHash: 'cccccc33' },
            changes: { modules: true, bindings: false, config: false },
            moduleCount: 1,
            buildId: 'build',
            versionId: 'version',
            deployed: true,
            provisionedClasses: [ 'Counter' ],
            reconciliation: {
                info: [ { class_name: 'LegacyStore', message: 'stale', referencing_scripts: [ 'other-worker' ] } ],
                warnings: [ { unexpected: 'shape' } ],
                removable_entries: [ { class_name: 'OldStore' } ],
            },
        }, '.kixx/cloudflare-state.production.json');

        assertMatches('Bundled 1 module\n', text);
        assertMatches('  modules   changed    aaaaaa… -> dddddd…', text);
        assertMatches('  bindings  unchanged', text);
        assertMatches('LegacyStore — stale', text);
        assertMatches('still referenced by: other-worker', text);
        assertMatches('{"unexpected":"shape"}', text);
        assertMatches('safe to delete from DURABLE_OBJECT_MIGRATIONS', text);
        assert(!text.includes('Deleted:'), 'empty sections are omitted');
        assert(text.endsWith('Wrote .kixx/cloudflare-state.production.json\n'), text);
    });
});

function makeCommand({ projectDirectory, apiClient, output }) {
    return new CloudflareCreateWorkerVersionCommand({
        projectDirectory,
        cloudflareConfig: CLOUDFLARE_CONFIG,
        config: {},
        secrets: SECRETS,
        output,
        createClient: () => apiClient,
        now: () => NOW,
        generateUniqueId: () => UNIQUE_ID,
    });
}

async function withProject(fn) {
    if (!CLOUDFLARE_CONFIG) {
        CLOUDFLARE_CONFIG = parseJsonc(await fsp.readFile(path.join(FIXTURE_DIRECTORY, 'cloudflare-config.jsonc'), 'utf8'));
    }

    // realpath: the bundler resolves real paths, and macOS's tmpdir is a symlink.
    const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-devkit-worker-project-')));

    try {
        await copyDirectory(FIXTURE_DIRECTORY, directory);
        await fn(directory);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

async function copyDirectory(source, target) {
    await fsp.mkdir(target, { recursive: true });

    for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(from, to);
        } else {
            await fsp.writeFile(to, await fsp.readFile(from));
        }
    }
}

async function exists(filepath) {
    try {
        await fsp.stat(filepath);
        return true;
    } catch {
        return false;
    }
}

function makeVersion(id) {
    return { id, bindings: [ { type: 'secret_text', name: 'API_SECRET' } ] };
}
