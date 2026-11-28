import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, isFunction } from '../../lib/vendor/kixx-assert/mod.js';
import commands, { groups } from '../../commands/index.js';
import runCli from '../../lib/run-cli.js';
import loadProjectTooling, { REQUIRED_TOOLING_EXPORTS } from '../../lib/project/load-project-tooling.js';
import { OLDEST_SUPPORTED_PROJECT_VERSION, checkProjectVersion } from '../../lib/project/project-version.js';
import captureOutput from '../helpers/capture-output.js';
import { GENERATED_FILE_NAMES, buildProject, readGeneratedFiles, removeProject } from './built-project.js';
import denoManifest from '../../deno.json' with { type: 'json' };
import coreManifest from '../../../kixx/plugin.json' with { type: 'json' };


// Copying the skeleton and core, and importing core, takes longer than the
// 1000ms default on a busy machine.
const TIMEOUT = { timeout: 20000 };

// Every export of the project's kixx/tooling/mod.js that devkit code calls,
// by the module that calls it. Add to it with the call.
const TOOLING_EXPORTS_CALLED = [
    'writeProjectFiles', // commands/generate.js
];


// Runs the real registry, in process, with the real loader.
async function runKixxDev(argv) {
    const stdout = captureOutput();
    const stderr = captureOutput();

    const code = await runCli({
        argv,
        // Not a project, so only the directory argument can find one.
        cwd: os.tmpdir(),
        homeDirectory: path.join(os.tmpdir(), 'kixx-dev-no-such-home'),
        stdout,
        stderr,
        commands,
        groups,
        loadProjectTooling,
    });

    return { code, stdout: stdout.chunks.join(''), stderr: stderr.chunks.join('') };
}


// The devkit against this repository's core, as a project has it: a real
// project built from the skeleton, whose own kixx/ is loaded at run time.
describe('project tooling conformance with core', ({ before, after, it }) => {
    let projectDirectory;
    let loaded;

    before(async () => {
        projectDirectory = await buildProject();
        loaded = await loadProjectTooling(projectDirectory);
    }, TIMEOUT);

    after(async () => {
        await removeProject(projectDirectory);
    });

    it('supports the version of this repository\'s core', () => {
        const { isNewerThanCli } = checkProjectVersion({
            projectVersion: coreManifest.version,
            cliVersion: denoManifest.version,
        });

        assertEqual(false, isNewerThanCli);
        assertEqual(OLDEST_SUPPORTED_PROJECT_VERSION, coreManifest.version.split('-')[0]);
    });

    it('loads every export the devkit calls from the project\'s tooling', () => {
        assertEqual(TOOLING_EXPORTS_CALLED.join(','), REQUIRED_TOOLING_EXPORTS.join(','));

        for (const name of TOOLING_EXPORTS_CALLED) {
            assert(isFunction(loaded.tooling[name]), `kixx/tooling/mod.js exports ${ name }()`);
        }

        assert(isFunction(loaded.createProjectFileSystem), 'createProjectFileSystem()');
        assert(isFunction(loaded.createFileSystemContentSource), 'createFileSystemContentSource()');
    });

    it('names the five files the generator writes', async () => {
        const rendered = await loaded.tooling.renderProjectFiles({
            fileSystem: loaded.createProjectFileSystem(projectDirectory),
        });

        assertEqual(GENERATED_FILE_NAMES.join(','), Array.from(rendered.keys()).join(','));
    });

    it('writes nothing and exits 2 with the generator\'s message for an invalid manifest', async () => {
        const manifestFile = path.join(projectDirectory, 'app', 'app.json');
        const original = await fsp.readFile(manifestFile, 'utf8');

        await fsp.writeFile(manifestFile, '{ "secrets": "none", "colors": [] }');

        try {
            const text = await runKixxDev([ 'generate', projectDirectory ]);
            const json = await runKixxDev([ 'generate', projectDirectory, '--json' ]);
            const envelope = JSON.parse(json.stdout);

            assertEqual(2, text.code);
            assertEqual('', text.stdout);
            assertMatches('Invalid app manifest app/app.json', text.stderr);
            assert(!text.stderr.includes('Failed to run command'), 'printed as a crash');
            assert(!/\n\s+at /.test(text.stderr), 'printed a stack');

            // The message a person reads lists every problem, so text mode
            // needs nothing more than the message.
            assertEqual(2, envelope.error.problems.length);

            for (const problem of envelope.error.problems) {
                assert(envelope.error.message.includes(problem.message), `the message holds "${ problem.message }"`);
            }

            assertEqual(2, json.code);
            assertEqual('ValidationError', envelope.error.code);
            assertEqual(0, (await readGeneratedFiles(projectDirectory)).size);
        } finally {
            await fsp.writeFile(manifestFile, original);
        }
    }, TIMEOUT);

    it('writes the five files byte for byte as the project\'s own generator renders them', async () => {
        const { code, stdout, stderr } = await runKixxDev([ 'generate', projectDirectory ]);

        assertEqual('', stderr);
        assertEqual(0, code);
        assertEqual(
            GENERATED_FILE_NAMES.map((fileName) => `wrote ${ path.join(projectDirectory, fileName) }\n`).join(''),
            stdout,
        );

        const rendered = await loaded.tooling.renderProjectFiles({
            fileSystem: loaded.createProjectFileSystem(projectDirectory),
        });

        const written = await readGeneratedFiles(projectDirectory);

        assertEqual(5, written.size);

        for (const [ fileName, text ] of rendered) {
            assert(written.get(fileName) === text, `${ fileName } equals what renderProjectFiles() returns`);
        }
    }, TIMEOUT);

    it('finds the project from a directory inside it, and lists the files in its data', async () => {
        const { code, stdout, stderr } = await runKixxDev([ 'generate', path.join(projectDirectory, 'app'), '--json' ]);
        const envelope = JSON.parse(stdout);

        assertEqual(0, code);
        assertMatches(/^[^\n]+\n$/, stdout);
        assertEqual(true, envelope.ok);
        assertEqual('generate', envelope.command);
        assertEqual(projectDirectory, envelope.data.projectDirectory);
        assertEqual(GENERATED_FILE_NAMES.join(','), envelope.data.files.join(','));

        // The human text moved to stderr.
        assertMatches(/^wrote /, stderr);
    }, TIMEOUT);

    it('replaces a generated file that was edited or deleted', async () => {
        const routesFile = path.join(projectDirectory, 'routes.generated.js');
        const expected = await fsp.readFile(routesFile, 'utf8');

        await fsp.writeFile(routesFile, '// edited\n');
        await fsp.rm(path.join(projectDirectory, 'example.env.secrets'));

        const { code } = await runKixxDev([ 'generate', projectDirectory ]);

        assertEqual(0, code);
        assertEqual(expected, await fsp.readFile(routesFile, 'utf8'));
        assertEqual(5, (await readGeneratedFiles(projectDirectory)).size);
    }, TIMEOUT);
});
