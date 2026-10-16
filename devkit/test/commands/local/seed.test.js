import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalSeedCommand from '../../../commands/local/seed.js';
import { createInstance } from '../../../lib/local/instance-store.js';
import captureOutput from '../../helpers/capture-output.js';


const PASSWORD = 'generated-password-0123456789';
const TOKEN = 'publishing-token-secret';


describe('local seed', ({ before, after, it }) => {
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

    async function setup() {
        counter += 1;
        const target = path.join(root, `target-${ counter }`);

        await createInstance({
            sourceDirectory: source,
            instancesDirectory: path.join(target, 'instances'),
            name: 'alpha',
            port: 4321,
            now: () => new Date(1700000000000),
        });

        return target;
    }

    const makeCommand = (overrides) => {
        const output = captureOutput();
        const appOutput = captureOutput();
        const appProcesses = [];

        const command = new LocalSeedCommand({
            projectDirectory: source,
            output,
            stdout: appOutput,
            stderr: appOutput,
            env: {},
            createAppProcess(options) {
                appProcesses.push(options);
                options.stdout.write('app says hello\n');
                return {
                    ensureReady: async () => ({ port: 4321 }),
                    stop: async () => {},
                };
            },
            createAdminClient: () => ({
                createPublishingApiToken: async () => ({ token: TOKEN }),
            }),
            createPublishingClient: () => ({}),
            canConnect: async () => false,
            acceptInvite: async () => ({}),
            publishRelease: async ({ buildId }) => ({ releaseId: 'rel-1', buildId }),
            generatePassword: () => PASSWORD,
            ...overrides,
        });

        return { command, output, appOutput, appProcesses };
    };

    it('prints the result without the password or token', async () => {
        const target = await setup();
        const { command, output, appOutput } = makeCommand();

        const code = await command.run({ target }, { name: 'alpha' });
        const text = output.chunks.join('').replace(/\s+/g, ' ');

        assertEqual(0, code);
        assertMatches('[kixx local] Seeded local instance "alpha"', text);
        assertMatches('Base URL: http://localhost:4321/', text);
        assertMatches('Username: root@alpha.local', text);
        assertMatches('Build ID: local-alpha-1700000000000', text);
        assertMatches('Release: rel-1', text);
        assertMatches('credentials.json is plain text; do not commit or share it.', text);
        assertMatches('Next: kixx local start alpha', text);
        assertMatches(`--target ${ target }`, text);
        assert(!text.includes(PASSWORD), 'password printed');
        assert(!text.includes(TOKEN), 'token printed');

        // Without --verbose the app server output goes nowhere.
        assertEqual(0, appOutput.chunks.length);
    });

    it('streams the app server output with --verbose', async () => {
        const target = await setup();
        const { command, appOutput } = makeCommand();

        await command.run({ target, verbose: true }, { name: 'alpha' });

        assertMatches('app says hello', appOutput.chunks.join(''));
    });

    it('warns about process environment collisions before booting', async () => {
        const target = await setup();
        const { command, output } = makeCommand({ env: { BUILD_ID: 'x' } });

        await command.run({ target }, { name: 'alpha' });

        const text = output.chunks.join('').replace(/\s+/g, ' ');

        assertMatches('Warning: BUILD_ID is set in this shell', text);
    });

    it('refuses a missing instance without booting', async () => {
        const target = await setup();
        const { command, appProcesses } = makeCommand();

        const error = await catchAsyncError(() => command.run({ target }, { name: 'beta' }));

        assertEqual('UsageError', error?.name);
        assertEqual(0, appProcesses.length);
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
