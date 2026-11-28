import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../lib/vendor/kixx-assert/mod.js';
import manifest from '../deno.json' with { type: 'json' };


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
        assertMatches(/^ {2}dev start {2}/m, stdout);
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

    it('shows a kept command\'s help', async () => {
        const { code, stdout } = await runEntryPoint([ 'local', 'create', '--help' ]);

        assertEqual(0, code);
        assertMatches('Usage: kixx-dev local create [options] <name> [directory]', stdout);
        assertMatches(/^Arguments:\n {2}name {7}Instance name/m, stdout);
        assertMatches(/^ {2}directory {2}Application directory/m, stdout);
        assertMatches(/^ {2}-t, --target <string> {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('runs a kept command against the directory argument', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dev-entry-'));

        try {
            const text = await runEntryPoint([ 'local', 'list', directory ], { cwd: os.tmpdir() });
            const json = await runEntryPoint([ 'local', 'list', directory, '--json' ], { cwd: os.tmpdir() });

            assertEqual(0, text.code);
            assertMatches('No local instances in', text.stdout);

            // The command's text moves to stderr, so stdout parses as JSON.
            assertEqual(0, json.code);
            assertMatches('No local instances in', json.stderr);
            assertEqual('local list', JSON.parse(json.stdout).command);
        } finally {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    }, { timeout: TIMEOUT });
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
