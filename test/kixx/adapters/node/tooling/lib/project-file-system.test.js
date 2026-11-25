import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createProjectFileSystem } from '../../../../../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { writeProjectFiles } from '../../../../../../kixx/tooling/mod.js';


const CORE_MANIFEST = {
    name: 'kixx',
    version: '7.0.0-alpha.0',
    description: 'Kixx core.',
    adapters: {
        node: { loggerWriter: './node-writer.js', serverRequest: './node-request.js' },
        cloudflare: { loggerWriter: './cloudflare-writer.js', serverRequest: './cloudflare-request.js' },
    },
};

const VISITS_MANIFEST = {
    name: 'visits',
    version: '7.0.0',
    core: '7.0.0',
    description: 'Counts visits.',
    lifecycle: [ './plugin.js' ],
};


async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

describe('node project file system', ({ before, after, it }) => {
    let tempDirectory;
    let projectDirectory;
    let fileSystem;

    // The project sits one level down, so a `../` path stays inside the
    // temporary directory.
    before(async () => {
        tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-project-fs-'));
        projectDirectory = path.join(tempDirectory, 'project');

        await fsp.mkdir(path.join(projectDirectory, 'plugins', 'visits'), { recursive: true });
        await fsp.mkdir(path.join(projectDirectory, 'plugins', 'admin'), { recursive: true });
        await fsp.mkdir(path.join(projectDirectory, 'plugins', 'Zeta'), { recursive: true });
        await fsp.mkdir(path.join(tempDirectory, 'core'), { recursive: true });

        await fsp.writeFile(path.join(projectDirectory, 'plugins', 'README.md'), '# Plugins\n');
        await fsp.writeFile(path.join(projectDirectory, 'plugins', 'visits', 'plugin.json'), JSON.stringify(VISITS_MANIFEST));
        await fsp.writeFile(path.join(tempDirectory, 'core', 'plugin.json'), JSON.stringify(CORE_MANIFEST));

        fileSystem = createProjectFileSystem(projectDirectory);
    });

    after(async () => {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
    });

    it('reads a file as UTF-8 text', async () => {
        await fsp.writeFile(path.join(projectDirectory, 'note.txt'), 'café\n');

        assertEqual('café\n', await fileSystem.readTextFile('note.txt'));
    });

    it('resolves null for a missing file, and for a file in a missing directory', async () => {
        assertEqual(null, await fileSystem.readTextFile('missing.json'));
        assertEqual(null, await fileSystem.readTextFile('app/app.json'));
    });

    it('rejects with an OperationalError for any other read failure', async () => {
        const caught = await catchRejection(fileSystem.readTextFile('plugins'));

        assert(caught, 'expected a rejection');
        assertEqual('OperationalError', caught.name);
        assertMatches('Unable to read file ', caught.message);
        assertMatches(path.join(projectDirectory, 'plugins'), caught.message);
        assertEqual('EISDIR', caught.cause.code);
    });

    it('lists the directories directly inside a directory, sorted, without plain files', async () => {
        assertEqual('Zeta,admin,visits', (await fileSystem.listDirectories('plugins')).join(','));
    });

    it('resolves an empty list for a missing directory', async () => {
        assertEqual(0, (await fileSystem.listDirectories('nowhere')).length);
    });

    it('rejects with an OperationalError when the listed path is a file', async () => {
        const caught = await catchRejection(fileSystem.listDirectories('plugins/README.md'));

        assertEqual('OperationalError', caught.name);
        assertMatches('Unable to read directory ', caught.message);
        assertEqual('ENOTDIR', caught.cause.code);
    });

    it('resolves a ../ path outside the project directory', async () => {
        const text = await fileSystem.readTextFile('../core/plugin.json');

        assertEqual('kixx', JSON.parse(text).name);
        assertEqual('core,project', (await fileSystem.listDirectories('..')).join(','));
    });

    it('writes UTF-8 text, replacing the file', async () => {
        await fileSystem.writeTextFile('written.txt', 'first\n');
        await fileSystem.writeTextFile('written.txt', 'naïve\n');

        assertEqual('naïve\n', await fsp.readFile(path.join(projectDirectory, 'written.txt'), 'utf8'));
    });

    it('rejects with an OperationalError when a file cannot be written', async () => {
        const caught = await catchRejection(fileSystem.writeTextFile('nowhere/file.txt', 'text'));

        assertEqual('OperationalError', caught.name);
        assertMatches('Unable to write file ', caught.message);
        assertEqual('ENOENT', caught.cause.code);
    });

    it('resolves a relative project directory against the working directory', async () => {
        const relative = path.relative(process.cwd(), projectDirectory);
        const text = await createProjectFileSystem(relative).readTextFile('plugins/visits/plugin.json');

        assertEqual('visits', JSON.parse(text).name);
    });

    it('requires a project directory', () => {
        let caught = null;

        try {
            createProjectFileSystem('');
        } catch (error) {
            caught = error;
        }

        assertEqual('AssertionError', caught.name);
    });

    it('lets the generator write a project\'s five files', async () => {
        const written = await writeProjectFiles({ fileSystem, coreDirectory: '../core' });

        assertEqual(5, written.length);

        for (const name of written) {
            const text = await fsp.readFile(path.join(projectDirectory, name), 'utf8');
            assertMatches('Generated by Kixx from the installed plugin manifests. Do not edit.', text);
        }

        const registry = await fsp.readFile(path.join(projectDirectory, 'node-registry.generated.js'), 'utf8');

        assert(registry.includes('import LoggerWriter from "../core/node-writer.js";'));
        assert(registry.includes('import * as visitsPlugin from "./plugins/visits/plugin.js";'));
    });
});
