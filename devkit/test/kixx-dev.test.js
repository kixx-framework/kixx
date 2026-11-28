import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../lib/vendor/kixx-assert/mod.js';
import manifest from '../deno.json' with { type: 'json' };
import { withTemporaryDirectory, writeProjectMarker } from './helpers/temporary-project.js';
import { GENERATED_FILE_NAMES, buildProject, readGeneratedFiles, removeProject } from './conformance/built-project.js';


const ENTRY_POINT = fileURLToPath(new URL('../kixx-dev.js', import.meta.url));

// The permission set an installed `kixx-dev` gets on Deno, so these tests also
// fail if the entry point needs more than users grant it.
//
// This file covers only what a child process proves: the entry point wires
// the real streams, registry, and exit code to the runner. The command
// contract is tested in process in test/lib/run-cli.test.js.
const DENO_RUN_ARGS = [ 'run', '-RWNE', '--allow-sys=homedir', '--allow-run', '--no-prompt' ];

// Each case spawns a runtime, which can exceed the 1000ms default on a busy
// machine.
const TIMEOUT = 10000;


describe('kixx-dev.js entry point', ({ it }) => {

    it('prints the deno.json version for --version', async () => {
        const { code, stdout, stderr } = await runEntryPoint([ '--version' ]);

        assertEqual(0, code);
        assertEqual(`${ manifest.version }\n`, stdout);
        assertEqual('', stderr);
    }, { timeout: TIMEOUT });

    it('lists the registered commands in top level help', async () => {
        const { code, stdout } = await runEntryPoint([ '--help' ]);

        assertEqual(0, code);
        assertMatches(/^Usage: kixx-dev <command>/, stdout);
        assertMatches(/^ {2}generate {2}/m, stdout);
        assertMatches(/^ {2}dev {2}/m, stdout);
        assertMatches(/^ {2}deploy {2}.*\(Not available/m, stdout);
        assertMatches(/^ {2}local create {2}/m, stdout);
        assertMatches(/^ {6}--json {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('writes one JSON envelope to stdout for --help --json', async () => {
        const { code, stdout, stderr } = await runEntryPoint([ '--help', '--json' ]);
        const envelope = JSON.parse(stdout);

        assertEqual(0, code);
        assertEqual('', stderr);
        assertMatches(/^[^\n]+\n$/, stdout);
        assertEqual(true, envelope.ok);
        assertEqual(manifest.version, envelope.data.version);
    }, { timeout: TIMEOUT });

    it('exits 2 for a usage error, with the message on stderr and no stack', async () => {
        const { code, stdout, stderr } = await runEntryPoint([ 'local', 'create' ]);

        assertEqual(2, code);
        assertEqual('', stdout);
        assertMatches('Missing required argument <name>', stderr);
        assert(!stderr.includes('Failed to run command'), 'printed as a crash');
        assert(!/\n\s+at /.test(stderr), 'printed a stack');
    }, { timeout: TIMEOUT });

    it('exits 4 for a command that is not available, with one envelope under --json', async () => {
        const text = await runEntryPoint([ 'deploy', '-e', 'production' ]);
        const json = await runEntryPoint([ 'deploy', '-e', 'production', '--json' ]);

        assertEqual(4, text.code);
        assertEqual('', text.stdout);
        assertMatches('not available in this version of kixx-dev', text.stderr);
        assert(!/\n\s+at /.test(text.stderr), 'printed a stack');

        assertEqual(4, json.code);
        assertEqual('', json.stderr);
        assertEqual('CommandNotAvailable', JSON.parse(json.stdout).error.code);
    }, { timeout: TIMEOUT });

    it('shows a kept command\'s help', async () => {
        const { code, stdout } = await runEntryPoint([ 'local', 'create', '--help' ]);

        assertEqual(0, code);
        assertMatches('Usage: kixx-dev local create [options] <name> [directory]', stdout);
        assertMatches(/^Arguments:\n {2}name {7}Instance name/m, stdout);
        assertMatches(/^ {2}directory {2}A directory in the project/m, stdout);
        assertMatches(/^ {2}-t, --target <string> {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('runs a kept command against the directory argument', async () => {
        await withTemporaryDirectory(async (directory) => {
            await writeProjectMarker(directory, { version: manifest.version });

            const text = await runEntryPoint([ 'local', 'list', directory ], { cwd: os.tmpdir() });
            const json = await runEntryPoint([ 'local', 'list', directory, '--json' ], { cwd: os.tmpdir() });

            assertEqual(0, text.code);
            assertMatches('No local instances in', text.stdout);

            // The command's text moves to stderr, so stdout parses as JSON.
            assertEqual(0, json.code);
            assertMatches('No local instances in', json.stderr);
            assertEqual('local list', JSON.parse(json.stdout).command);
            assertEqual(0, JSON.parse(json.stdout).data.instances.length);
        });
    }, { timeout: TIMEOUT });

    it('exits 3 outside a project, with the message on stderr and no stack', async () => {
        await withTemporaryDirectory(async (directory) => {
            const { code, stdout, stderr } = await runEntryPoint([ 'generate' ], { cwd: directory });

            assertEqual(3, code);
            assertEqual('', stdout);
            assertMatches('kixx/plugin.json', stderr);
            assert(!/\n\s+at /.test(stderr), 'printed a stack');
        });
    }, { timeout: TIMEOUT });

    // The whole path, with the real loader: the entry point finds a project
    // built from the skeleton and this repository's core, imports that
    // project's own tooling, and runs its generator. On Deno this is also the
    // proof that the dynamic import needs no permission beyond the installed
    // set.
    it('generates a real project\'s files with the project\'s own tooling', async () => {
        const projectDirectory = await buildProject();

        try {
            const { code, stdout, stderr } = await runEntryPoint([ 'generate', '--json' ], {
                cwd: path.join(projectDirectory, 'app'),
            });

            assertEqual(0, code, stderr);

            const envelope = JSON.parse(stdout);

            assertEqual(true, envelope.ok);
            assertEqual('generate', envelope.command);
            assertEqual(projectDirectory, envelope.data.projectDirectory);
            assertEqual(GENERATED_FILE_NAMES.join(','), envelope.data.files.join(','));
            assertEqual(5, (await readGeneratedFiles(projectDirectory)).size);
        } finally {
            await removeProject(projectDirectory);
        }
    }, { timeout: 30000 });
});


// Runs the entry point with whichever runtime runs the test suite.
function runEntryPoint(args, options) {
    const runtimeArgs = process.versions.deno ? DENO_RUN_ARGS : [];

    return new Promise((resolve) => {
        execFile(process.execPath, [ ...runtimeArgs, ENTRY_POINT, ...args ], options ?? {}, (error, stdout, stderr) => {
            resolve({ code: error ? error.code : 0, stdout, stderr });
        });
    });
}
