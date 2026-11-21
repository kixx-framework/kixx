import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalPublishCommand from '../../../commands/local/publish.js';
import { createInstance, getInstancePaths, writeCredentials } from '../../../lib/local/instance-store.js';
import captureOutput from '../../helpers/capture-output.js';


const TOKEN = 'publishing-token-secret';


describe('local publish', ({ before, after, it }) => {
    let root;
    let source;
    let target;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        source = path.join(root, 'app');
        target = path.join(root, 'target');
        await fsp.mkdir(source);
        await fsp.writeFile(path.join(source, 'node-server.js'), '');
        await fsp.writeFile(path.join(source, 'example.env.secrets'), 'SIGNING_SECRET=x\n');

        const instancesDirectory = path.join(target, 'instances');

        for (const name of [ 'alpha', 'unseeded' ]) {
            // eslint-disable-next-line no-await-in-loop
            await createInstance({ sourceDirectory: source, instancesDirectory, name, port: 4321 });
        }

        await writeCredentials(getInstancePaths(instancesDirectory, 'alpha'), {
            baseUrl: 'http://localhost:4321/',
            username: 'root@alpha.local',
            password: 'generated-password-0123456789',
            publishingApiToken: TOKEN,
            buildId: 'local-alpha-1',
            port: 4321,
        });
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    const makeCommand = (overrides) => {
        const output = captureOutput();
        const clients = [];
        const publishes = [];

        const command = new LocalPublishCommand({
            projectDirectory: source,
            output,
            canConnect: async () => true,
            createPublishingClient(options) {
                clients.push(options);
                return { kind: 'client' };
            },
            async publishRelease(args) {
                publishes.push(args);
                return {
                    dryRun: args.dryRun,
                    releaseId: 'rel-1',
                    buildId: args.buildId,
                    assignmentId: args.dryRun ? undefined : 'as-1',
                    matchedCount: 0,
                    uploadedCount: 0,
                    uploadedResources: [],
                    unmatchedFiles: [],
                    resources: [],
                    objectCount: 0,
                    totalBytes: 0,
                };
            },
            ...overrides,
        });

        return { command, output, clients, publishes };
    };

    it('publishes with the saved credentials to the saved Build ID', async () => {
        const { command, output, clients, publishes } = makeCommand();

        const code = await command.run({ target }, { name: 'alpha' });
        const text = output.chunks.join('');

        assertEqual(0, code);
        assertEqual('http://localhost:4321/', clients[0].origin);
        assertEqual(TOKEN, clients[0].token);
        assertEqual('local-alpha-1', publishes[0].buildId);
        assertEqual(source, publishes[0].projectDirectory);
        assertEqual(false, publishes[0].dryRun);
        assertMatches('kixx local publish alpha', publishes[0].formatRecovery({ releaseId: 'r', buildId: 'b' }));
        assertMatches('Environment: local', text);
        assertMatches('Release: rel-1', text);
        assert(!text.includes(TOKEN), 'token printed');
    });

    it('passes --dry-run through', async () => {
        const { command, output, publishes } = makeCommand();

        await command.run({ target, 'dry-run': true }, { name: 'alpha' });

        assertEqual(true, publishes[0].dryRun);
        assertMatches('Dry run', output.chunks.join(''));
    });

    it('refuses an unseeded instance before creating a client', async () => {
        const { command, clients } = makeCommand();

        const error = await catchAsyncError(() => command.run({ target }, { name: 'unseeded' }));

        assertEqual('UsageError', error?.name);
        assertMatches('kixx local seed unseeded', error.message);
        assertEqual(0, clients.length);
    });

    it('refuses an instance that is not running before creating a client', async () => {
        const { command, clients } = makeCommand({ canConnect: async () => false });

        const error = await catchAsyncError(() => command.run({ target }, { name: 'alpha' }));

        assertEqual('UsageError', error?.name);
        assertMatches('not running on port 4321', error.message);
        assertMatches('kixx local start alpha', error.message);
        assertEqual(0, clients.length);
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
