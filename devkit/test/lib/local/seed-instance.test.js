import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { createInstance } from '../../../lib/local/instance-store.js';
import { ReleaseAssignmentError } from '../../../lib/publishing/publish-release.js';
import seedInstance from '../../../lib/local/seed-instance.js';
import UsageError from '../../../lib/usage-error.js';


const PORT = 4321;


describe('seedInstance', ({ before, after, it }) => {
    let root;
    let source;
    let counter = 0;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        source = path.join(root, 'app');
        await fsp.mkdir(source);
        await fsp.writeFile(path.join(source, 'node-server.js'), '');
        await fsp.writeFile(path.join(source, 'example.env.secrets'), 'SIGNING_SECRET=x\n');
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    // Each test gets its own instances directory holding a fresh "alpha".
    async function setup() {
        counter += 1;
        const instancesDirectory = path.join(root, `target-${ counter }`, 'instances');

        const instance = await createInstance({
            sourceDirectory: source,
            instancesDirectory,
            name: 'alpha',
            port: PORT,
            now: () => new Date(1700000000000),
        });

        return { instancesDirectory, directory: instance.directory };
    }

    function makeFakes(overrides) {
        const calls = {
            appProcesses: [],
            stopCount: 0,
            adminClients: [],
            tokenRequests: [],
            invites: [],
            publishingClients: [],
            publishes: [],
        };

        const fakes = {
            createAppProcess(options) {
                calls.appProcesses.push(options);
                return {
                    async ensureReady() {
                        return overrides?.readyResult ?? { port: PORT };
                    },
                    async stop() {
                        calls.stopCount += 1;
                    },
                };
            },
            createAdminClient(options) {
                calls.adminClients.push(options);
                return {
                    async createPublishingApiToken(tokenOptions) {
                        calls.tokenRequests.push(tokenOptions);
                        return { tokenId: 't1', token: 'publishing-token-secret' };
                    },
                };
            },
            createPublishingClient(options) {
                calls.publishingClients.push(options);
                return { kind: 'publishing-client' };
            },
            canConnect: async () => false,
            async acceptInvite(args) {
                calls.invites.push(args);
                if (overrides?.inviteError) {
                    throw overrides.inviteError;
                }
                return { adminUserId: 'u1' };
            },
            async publishRelease(args) {
                calls.publishes.push(args);
                if (overrides?.publishError) {
                    throw overrides.publishError;
                }
                return { releaseId: 'rel-1', buildId: args.buildId, assignmentId: 'as-1' };
            },
            generatePassword: () => 'generated-password-0123456789',
        };

        return { calls, fakes: { ...fakes, ...overrides?.fakes } };
    }

    it('seeds over HTTP and writes credentials.json', async () => {
        const { instancesDirectory, directory } = await setup();
        const { calls, fakes } = makeFakes();

        const result = await seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes });

        const env = await fsp.readFile(path.join(directory, '.env'), 'utf8');
        const secrets = await fsp.readFile(path.join(directory, '.env.secrets'), 'utf8');
        const bootstrapToken = /^ADMIN_BOOTSTRAP_TOKEN=(.+)$/m.exec(secrets)[1];

        assertEqual(1, calls.appProcesses.length);
        assertEqual(source, calls.appProcesses[0].projectDirectory);
        assertEqual('local', calls.appProcesses[0].environment);
        assertEqual(path.join(directory, '.env'), calls.appProcesses[0].dotenv);
        assertEqual(PORT, await calls.appProcesses[0].getFreePort());

        assertEqual(1, calls.invites.length);
        assertEqual(bootstrapToken, calls.invites[0].inviteToken);
        assertEqual('root@alpha.local', calls.invites[0].emailAddress);
        assertEqual('generated-password-0123456789', calls.invites[0].password);
        assertEqual('http://localhost:4321', calls.adminClients[0].origin);

        assertEqual('root@alpha.local', calls.adminClients[1].email);
        assertEqual('generated-password-0123456789', calls.adminClients[1].password);
        assertEqual('kixx local seed', calls.tokenRequests[0].description);

        assertEqual('publishing-token-secret', calls.publishingClients[0].token);
        assertEqual('http://localhost:4321', calls.publishingClients[0].origin);
        assertEqual('local-alpha-1700000000000', calls.publishes[0].buildId);
        assertMatches('BUILD_ID=local-alpha-1700000000000', env);
        assertEqual(source, calls.publishes[0].projectDirectory);

        const credentials = JSON.parse(await fsp.readFile(path.join(directory, 'credentials.json'), 'utf8'));

        assertEqual(JSON.stringify({
            baseUrl: 'http://localhost:4321/',
            username: 'root@alpha.local',
            password: 'generated-password-0123456789',
            publishingApiToken: 'publishing-token-secret',
            buildId: 'local-alpha-1700000000000',
            port: PORT,
        }), JSON.stringify(credentials));

        assertEqual(path.join(directory, 'credentials.json'), result.credentialsPath);
        assertEqual('rel-1', result.publishResult.releaseId);
        assertEqual(1, calls.stopCount);

        if (process.platform !== 'win32') {
            const { mode } = await fsp.stat(path.join(directory, 'credentials.json'));
            assertEqual(0o600, mode & 0o777);
        }
    });

    it('refuses an already seeded instance without booting', async () => {
        const { instancesDirectory, directory } = await setup();
        await fsp.writeFile(path.join(directory, 'credentials.json'), '{}');
        const { calls, fakes } = makeFakes();

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('already seeded', error.message);
        assertEqual(0, calls.appProcesses.length);
    });

    it('refuses a missing instance without booting', async () => {
        const { instancesDirectory } = await setup();
        const { calls, fakes } = makeFakes();

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'beta', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('kixx local create beta', error.message);
        assertEqual(0, calls.appProcesses.length);
    });

    it('refuses a busy port without booting', async () => {
        const { instancesDirectory } = await setup();
        const { calls, fakes } = makeFakes({ fakes: { canConnect: async (port) => port === PORT } });

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('Port 4321', error.message);
        assertEqual(0, calls.appProcesses.length);
    });

    it('refuses a missing BUILD_ID without booting', async () => {
        const { instancesDirectory, directory } = await setup();
        const dotenv = path.join(directory, '.env');
        const text = await fsp.readFile(dotenv, 'utf8');
        await fsp.writeFile(dotenv, text.replace(/^BUILD_ID=.*\n/m, ''));
        const { calls, fakes } = makeFakes();

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('BUILD_ID is missing', error.message);
        assertEqual(0, calls.appProcesses.length);
    });

    it('refuses a missing bootstrap token without booting', async () => {
        const { instancesDirectory, directory } = await setup();
        const dotenvSecrets = path.join(directory, '.env.secrets');
        const text = await fsp.readFile(dotenvSecrets, 'utf8');
        await fsp.writeFile(dotenvSecrets, text.replace(/^ADMIN_BOOTSTRAP_TOKEN=.*\n/m, ''));
        const { calls, fakes } = makeFakes();

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('ADMIN_BOOTSTRAP_TOKEN is missing', error.message);
        assertMatches('.env.secrets', error.message);
        assertEqual(0, calls.appProcesses.length);
    });

    it('reports a failed start with its output and creates no client', async () => {
        const { instancesDirectory } = await setup();
        const { calls, fakes } = makeFakes({
            readyResult: { failure: { reason: 'app server exited before accepting connections', output: 'boom: missing key' } },
        });

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assert(error instanceof UsageError, 'UsageError');
        assertMatches('exited before accepting connections', error.message);
        assertMatches('boom: missing key', error.message);
        assertEqual(0, calls.adminClients.length);
        assertEqual(0, calls.publishingClients.length);
        assertEqual(1, calls.stopCount);
    });

    it('stops the server and writes no credentials when the invite fails', async () => {
        const { instancesDirectory, directory } = await setup();
        const { calls, fakes } = makeFakes({ inviteError: new UsageError('The invite token is unknown') });

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assertMatches('invite token is unknown', error?.message);
        assertEqual(1, calls.stopCount);
        assertEqual(false, await exists(path.join(directory, 'credentials.json')));
    });

    it('keeps credentials and names the recovery when publishing fails', async () => {
        const { instancesDirectory, directory } = await setup();
        const cause = new Error('network down');
        const { calls, fakes } = makeFakes({ publishError: cause });

        const error = await catchAsyncError(() => seedInstance({
            sourceDirectory: source,
            instancesDirectory,
            name: 'alpha',
            formatCommand: (command) => `kixx local ${ command } app`,
            ...fakes,
        }));

        assert(error instanceof UsageError, 'UsageError');
        assertEqual(cause, error.cause);
        assertMatches('network down', error.message);
        assertMatches('kixx local start alpha app, then kixx local publish alpha app', error.message);
        assertEqual(1, calls.stopCount);
        assertEqual(true, await exists(path.join(directory, 'credentials.json')));
    });

    it('does not repeat the recovery line of an assignment failure', async () => {
        const { instancesDirectory } = await setup();
        const { fakes } = makeFakes({
            fakes: {
                async publishRelease(args) {
                    const message = `assign failed\n${ args.formatRecovery({ releaseId: 'r', buildId: 'b' }) }`;
                    throw new ReleaseAssignmentError(message, { releaseId: 'r', buildId: 'b', cause: new Error('x') });
                },
            },
        });

        const error = await catchAsyncError(() => seedInstance({ sourceDirectory: source, instancesDirectory, name: 'alpha', ...fakes }));

        assertEqual(1, error.message.split('Recover with:').length - 1);
        assertMatches('kixx local publish alpha', error.message);
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

async function exists(filepath) {
    try {
        await fsp.stat(filepath);
        return true;
    } catch {
        return false;
    }
}
