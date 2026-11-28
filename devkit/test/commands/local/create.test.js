import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalCreateCommand from '../../../commands/local/create.js';
import captureOutput from '../../helpers/capture-output.js';
import { parseSecretsManifest } from '../../helpers/fake-parsers.js';


describe('local create', ({ before, after, it }) => {
    let root;
    let source;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        source = path.join(root, 'app');
        await fsp.mkdir(source);
        await fsp.writeFile(path.join(source, 'node-server.js'), '');
        await fsp.writeFile(
            path.join(source, 'example.env.secrets'),
            'SIGNING_SECRET=x\n# @required-outside-development\nDEPLOY_KEY_HASH=x\n',
        );
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    const makeCommand = (overrides) => {
        const output = captureOutput();
        const command = new LocalCreateCommand({
            projectDirectory: source,
            // Shaped as the loader returns it; only the parser is called.
            tooling: { tooling: { parseSecretsManifest } },
            output,
            now: () => new Date(1700000000000),
            getFreePort: async () => 5555,
            env: {},
            ...overrides,
        });
        return { command, output };
    };

    it('creates the instance under --target and prints the next step', async () => {
        const target = path.join(root, 'target-1');
        const { command, output } = makeCommand();

        const data = await command.run({ target }, { name: 'alpha' });
        const text = output.chunks.join('').replace(/\s+/g, ' ');

        assertMatches('[kixx-dev local] Created local instance "alpha"', text);
        assertMatches('Port: 5555', text);
        assertMatches('Build ID: local-alpha-1700000000000', text);
        assertMatches(`--target ${ target }`, text);
        assertMatches('Next: kixx-dev local start alpha', text);
        assert(!text.includes('Warning'), 'no collision warning');

        const metadata = JSON.parse(await fsp.readFile(path.join(target, 'instances', 'alpha', 'instance.json'), 'utf8'));
        assertEqual(5555, metadata.port);

        assertEqual(
            JSON.stringify({
                name: 'alpha',
                port: 5555,
                buildId: 'local-alpha-1700000000000',
                directory: path.join(target, 'instances', 'alpha'),
            }),
            JSON.stringify(data),
        );
    });

    // The instance's secrets are generated here. They go to its dotenv file
    // and nowhere else.
    it('keeps every generated secret out of its data and its text', async () => {
        const target = path.join(root, 'target-secrets');
        const { command, output } = makeCommand();

        const data = await command.run({ target }, { name: 'alpha' });

        const dotenv = await fsp.readFile(path.join(target, 'instances', 'alpha', '.env.secrets'), 'utf8');
        const values = dotenv.split('\n')
            .filter((line) => line.includes('=') && !line.startsWith('#'))
            .map((line) => line.slice(line.indexOf('=') + 1))
            .filter((value) => value.length > 0);

        assertMatches(/^DEPLOY_KEY_HASH=[0-9a-f]{64}$/m, dotenv);
        assertMatches(/^SIGNING_SECRET=[0-9a-f]{64}$/m, dotenv);
        assert(values.length >= 2, 'the instance has generated secrets');

        for (const value of values) {
            assert(!JSON.stringify(data).includes(value), 'a secret value is in the data');
            assert(!output.chunks.join('').includes(value), 'a secret value was printed');
        }
    });

    it('passes --port through', async () => {
        const target = path.join(root, 'target-2');
        const { command } = makeCommand();

        await command.run({ target, port: '4100' }, { name: 'alpha' });

        const metadata = JSON.parse(await fsp.readFile(path.join(target, 'instances', 'alpha', 'instance.json'), 'utf8'));
        assertEqual(4100, metadata.port);
    });

    it('rejects a non-numeric --port', async () => {
        const { command } = makeCommand();
        const error = await catchAsyncError(() => command.run({ target: path.join(root, 'target-3'), port: 'abc' }, { name: 'alpha' }));

        assertEqual('UsageError', error?.name);
    });

    it('fails a second create of the same name', async () => {
        const target = path.join(root, 'target-4');

        await makeCommand().command.run({ target }, { name: 'alpha' });
        const error = await catchAsyncError(() => makeCommand().command.run({ target }, { name: 'alpha' }));

        assertEqual('UsageError', error?.name);
        assertMatches('already exists', error.message);
    });

    it('rejects an invalid name before touching disk', async () => {
        const target = path.join(root, 'target-5');
        const error = await catchAsyncError(() => makeCommand().command.run({ target }, { name: 'Bad' }));

        assertEqual('UsageError', error?.name);
        assertEqual(false, await exists(target));
    });

    it('warns about process environment collisions', async () => {
        const target = path.join(root, 'target-6');
        const { command, output } = makeCommand({ env: { ENVIRONMENT: 'development', OTHER: 'x' } });

        await command.run({ target }, { name: 'alpha' });
        const text = output.chunks.join('').replace(/\s+/g, ' ');

        assertMatches('Warning: ENVIRONMENT is set in this shell', text);
        assertMatches('refuse to start', text);
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
