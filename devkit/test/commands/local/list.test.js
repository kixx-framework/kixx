import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import LocalListCommand from '../../../commands/local/list.js';
import captureOutput from '../../helpers/capture-output.js';


describe('local list', ({ before, after, it }) => {
    let root;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));

        const instances = path.join(root, 'target', 'instances');

        for (const [ name, port ] of [ [ 'beta', 4002 ], [ 'alpha', 4001 ] ]) {
            // eslint-disable-next-line no-await-in-loop
            await fsp.mkdir(path.join(instances, name), { recursive: true });
            // eslint-disable-next-line no-await-in-loop
            await fsp.writeFile(path.join(instances, name, 'instance.json'), JSON.stringify({ port }));
        }

        await fsp.writeFile(path.join(instances, 'alpha', 'credentials.json'), '{}');
        await fsp.mkdir(path.join(instances, 'gamma'));
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('shows each instance with port, seeded, and running', async () => {
        const output = captureOutput();
        const command = new LocalListCommand({
            projectDirectory: root,
            output,
            canConnect: async (port) => port === 4001,
        });

        const code = await command.run({ target: path.join(root, 'target') });

        assertEqual(0, code);
        assertEqual(
            [
                'NAME   PORT  SEEDED  RUNNING',
                'alpha  4001  yes     yes',
                'beta   4002  no      no',
                'gamma  -     no      -',
                '',
            ].join('\n'),
            output.chunks.join(''),
        );
    });

    it('reports an empty target', async () => {
        const output = captureOutput();
        const command = new LocalListCommand({ projectDirectory: root, output, canConnect: async () => false });

        await command.run({ target: path.join(root, 'empty') });

        assertMatches('No local instances in', output.chunks.join(''));
    });

    it('defaults the target to <app>/.kixx', async () => {
        const output = captureOutput();
        const command = new LocalListCommand({ projectDirectory: root, output, canConnect: async () => false });

        await command.run({});

        assertMatches(path.join(root, '.kixx', 'instances'), output.chunks.join('').replace(/\s+/g, ''));
    });
});
