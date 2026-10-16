import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalStartCommand from '../../../commands/local/start.js';
import { createInstance } from '../../../lib/local/instance-store.js';
import captureOutput from '../../helpers/capture-output.js';


describe('local start', ({ before, after, it }) => {
    let root;
    let source;
    let target;
    let directory;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        source = path.join(root, 'app');
        target = path.join(root, 'target');
        await fsp.mkdir(source);
        await fsp.writeFile(path.join(source, 'node-server.js'), '');
        await fsp.writeFile(path.join(source, 'example.env.secrets'), 'SIGNING_SECRET=x\n');

        ({ directory } = await createInstance({
            sourceDirectory: source,
            instancesDirectory: path.join(target, 'instances'),
            name: 'alpha',
            port: 4321,
        }));
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    const makeCommand = (overrides) => {
        const output = captureOutput();
        const runs = [];

        const command = new LocalStartCommand({
            projectDirectory: source,
            output,
            env: {},
            canConnect: async () => false,
            runDevServer: async (args) => {
                runs.push(args);
                return 0;
            },
            ...overrides,
        });

        return { command, output, runs };
    };

    it('runs the devserver on the instance port with its dotenv', async () => {
        const { command, output, runs } = makeCommand();

        const code = await command.run({ target }, { name: 'alpha' });

        assertEqual(0, code);
        assertEqual(1, runs.length);
        assertEqual(source, runs[0].projectDirectory);
        assertEqual(4321, runs[0].port);
        assertEqual('local', runs[0].environment);
        assertEqual(path.join(directory, '.env'), runs[0].dotenv);
        assert(path.isAbsolute(runs[0].dotenv), 'absolute dotenv');
        assertEqual('kixx local', runs[0].label);
        assertMatches('application directory the instance was created from', runs[0].missingServerHint);

        const text = output.chunks.join('').replace(/\s+/g, ' ');
        assertMatches('is not seeded; run kixx local seed alpha', text);
    });

    it('omits the unseeded hint once seeded', async () => {
        const credentials = path.join(directory, 'credentials.json');
        await fsp.writeFile(credentials, '{}');

        try {
            const { command, output } = makeCommand();
            await command.run({ target }, { name: 'alpha' });
            assert(!output.chunks.join('').includes('not seeded'), 'unseeded hint printed');
        } finally {
            await fsp.rm(credentials);
        }
    });

    it('refuses a running instance without starting', async () => {
        const { command, runs } = makeCommand({ canConnect: async (port) => port === 4321 });

        const error = await catchAsyncError(() => command.run({ target }, { name: 'alpha' }));

        assertEqual('UsageError', error?.name);
        assertMatches('already running on port 4321', error.message);
        assertEqual(0, runs.length);
    });

    it('refuses a missing instance without starting', async () => {
        const { command, runs } = makeCommand();

        const error = await catchAsyncError(() => command.run({ target }, { name: 'beta' }));

        assertEqual('UsageError', error?.name);
        assertEqual(0, runs.length);
    });

    it('warns about process environment collisions', async () => {
        const { command, output } = makeCommand({ env: { ENVIRONMENT: 'development' } });

        await command.run({ target }, { name: 'alpha' });

        assertMatches('Warning: ENVIRONMENT is set in this shell', output.chunks.join('').replace(/\s+/g, ' '));
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
