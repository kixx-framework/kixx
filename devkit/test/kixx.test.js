import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../lib/vendor/kixx-assert/mod.js';
import manifest from '../deno.json' with { type: 'json' };


const ENTRY_POINT = fileURLToPath(new URL('../kixx.js', import.meta.url));

// The permission set an installed `kixx` gets on Deno, so these tests also
// fail if the entry point needs more than users grant it.
const DENO_RUN_ARGS = [ 'run', '-RWNE', '--allow-sys=homedir', '--no-prompt' ];

// Each case spawns a runtime, which can exceed the 1000ms default on a busy
// machine.
const TIMEOUT = 10000;


describe('kixx.js entry point', ({ it }) => {

    it('prints the deno.json version for --version', async () => {
        const { code, stdout } = await runEntryPoint([ '--version' ]);

        assertEqual(0, code);
        assertEqual(`${ manifest.version }\n`, stdout);
    }, { timeout: TIMEOUT });

    it('prints the version for -v, even after a sub-command name', async () => {
        const { code, stdout } = await runEntryPoint([ 'admin', 'gen-secure-token', '-v' ]);

        assertEqual(0, code);
        assertEqual(`${ manifest.version }\n`, stdout);
    }, { timeout: TIMEOUT });

    it('lists the command families in top level help', async () => {
        const { code, stdout } = await runEntryPoint([ '--help' ]);

        assertEqual(0, code);
        assertMatches(/^Usage: kixx <command>/, stdout);
        assertMatches(/--version/, stdout);
        assertMatches(/^ {2}admin {2}/m, stdout);
        assertMatches(/^ {2}app {2}/m, stdout);
        assertMatches(/^ {2}cloudflare {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('lists the families and fails when no command is given', async () => {
        const { code, stdout } = await runEntryPoint([]);

        assertEqual(1, code);
        assertMatches('A top level command name is required', stdout);
        assertMatches(/^ {2}cloudflare {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('lists admin sub-commands', async () => {
        const { code, stdout } = await runEntryPoint([ 'admin', '--help' ]);

        assertEqual(0, code);
        assertMatches(/^ {2}gen-secure-token {2}/m, stdout);
    }, { timeout: TIMEOUT });

    it('runs admin gen-secure-token with a prefix', async () => {
        const { code, stdout } = await runEntryPoint([ 'admin', 'gen-secure-token', '--prefix', 'x_' ]);

        assertEqual(0, code);
        assertMatches(/^x_[0-9a-f]{64}\n$/, stdout);
    }, { timeout: TIMEOUT });

    it('reports an unknown option as a usage message without a stack', async () => {
        const { code, stderr } = await runEntryPoint([ 'admin', 'gen-secure-token', '--nope' ]);

        assertEqual(1, code);
        assertMatches('--nope', stderr);
        assertMatches('kixx admin gen-secure-token --help', stderr);
        assert(!stderr.includes('Failed to run command'), 'printed as a crash');
    }, { timeout: TIMEOUT });

    it('shows cloudflare help in a project with a malformed config file', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-devkit-entry-'));

        try {
            await fsp.mkdir(path.join(directory, '.kixx'));
            await fsp.writeFile(path.join(directory, '.kixx', 'config.json'), '{ broken');
            await fsp.writeFile(path.join(directory, 'cloudflare-config.jsonc'), '{ broken');

            const help = await runEntryPoint([ 'cloudflare', '--help' ], { cwd: directory });
            const unknown = await runEntryPoint([ 'cloudflare', 'missing' ], { cwd: directory });

            assertEqual(0, help.code);
            assertMatches('Usage: kixx cloudflare <subcommand>', help.stdout);
            assertEqual(1, unknown.code);
            assertMatches('"cloudflare missing" sub command does not exist', unknown.stdout);
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
