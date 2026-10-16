import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalDestroyCommand from '../../../commands/local/destroy.js';
import captureOutput from '../../helpers/capture-output.js';


describe('local destroy', ({ before, after, it }) => {
    let root;
    let target;
    let directory;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        target = path.join(root, 'target');
        directory = path.join(target, 'instances', 'alpha');
        await fsp.mkdir(directory, { recursive: true });
        await fsp.writeFile(path.join(directory, 'instance.json'), JSON.stringify({ port: 4001 }));
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('refuses while the instance is running, then removes it once stopped', async () => {
        const running = new LocalDestroyCommand({
            projectDirectory: root,
            output: captureOutput(),
            canConnect: async () => true,
        });

        let error = null;

        try {
            await running.run({ target }, { name: 'alpha' });
        } catch (cause) {
            error = cause;
        }

        assertEqual('UsageError', error?.name);
        assertMatches('stop it before running destroy', error.message);

        const output = captureOutput();
        const stopped = new LocalDestroyCommand({ projectDirectory: root, output, canConnect: async () => false });

        assertEqual(0, await stopped.run({ target }, { name: 'alpha' }));
        assertMatches('[kixx local] Destroyed local instance "alpha"', output.chunks.join(''));

        let exists = true;

        try {
            await fsp.stat(directory);
        } catch {
            exists = false;
        }

        assert(!exists, 'removed the instance directory');
    });
});
