import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalStartCommand from '../../../commands/local/start.js';
import { createInstance } from '../../../lib/local/instance-store.js';
import captureOutput from '../../helpers/capture-output.js';
import { parseSecretsManifest } from '../../helpers/fake-parsers.js';


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
            parseSecretsManifest,
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
                return { port: args.port, environment: args.environment };
            },
            ...overrides,
        });

        return { command, output, runs };
    };

    it('runs the devserver on the instance port with its dotenv', async () => {
        const { command, output, runs } = makeCommand();

        const data = await command.run({ target }, { name: 'alpha' });

        assertEqual('{"port":4321,"environment":"local"}', JSON.stringify(data));
        assertEqual(1, runs.length);
        assertEqual(source, runs[0].projectDirectory);
        assertEqual(4321, runs[0].port);
        assertEqual('local', runs[0].environment);
        assertEqual(path.join(directory, '.env'), runs[0].dotenv);
        assert(path.isAbsolute(runs[0].dotenv), 'absolute dotenv');
        assertEqual('kixx-dev local', runs[0].label);
        assertMatches('the project the instance was created from', runs[0].missingServerHint);

        // An unseeded instance starts without a hint: the command that seeds
        // one is not available in this version.
        assertEqual('', output.chunks.join(''));
    });

    it('names kixx-dev local create when the instance does not exist', async () => {
        const { command } = makeCommand();

        const error = await catchAsyncError(() => command.run({ target }, { name: 'beta' }));

        assertMatches('run "kixx-dev local create beta" first', error.message.replace(/\s+/g, ' '));
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
