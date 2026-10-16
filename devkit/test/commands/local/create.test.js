import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalCreateCommand from '../../../commands/local/create.js';
import captureOutput from '../../helpers/capture-output.js';


describe('local create', ({ before, after, it }) => {
    let root;
    let source;

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

    const makeCommand = (overrides) => {
        const output = captureOutput();
        const command = new LocalCreateCommand({
            projectDirectory: source,
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

        const code = await command.run({ target }, { name: 'alpha' });
        const text = output.chunks.join('').replace(/\s+/g, ' ');

        assertEqual(0, code);
        assertMatches('[kixx local] Created local instance "alpha"', text);
        assertMatches('Port: 5555', text);
        assertMatches('Build ID: local-alpha-1700000000000', text);
        assertMatches(`--target ${ target }`, text);
        assertMatches('Next: kixx local seed alpha', text);
        assert(!text.includes('Warning'), 'no collision warning');

        const metadata = JSON.parse(await fsp.readFile(path.join(target, 'instances', 'alpha', 'instance.json'), 'utf8'));
        assertEqual(5555, metadata.port);
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
