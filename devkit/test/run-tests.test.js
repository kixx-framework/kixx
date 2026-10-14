import os from 'node:os';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../lib/vendor/kixx-assert/mod.js';


const RUNNER = fileURLToPath(new URL('../run-tests.js', import.meta.url));
const TIMEOUT = 10000;


describe('run-tests.js', ({ it }) => {

    // Only the rejection paths are exercised: a nested run of real tests would
    // recurse into this file.
    it('rejects a pathname outside the test root', async () => {
        const { code, stderr } = await runRunner([ os.tmpdir() ]);

        assertEqual(1, code);
        assertMatches('Test pathname is outside the test root.', stderr);
        assertMatches('Usage: node run-tests.js', stderr);
    }, { timeout: TIMEOUT });

    it('rejects a --skip pathname outside the test root', async () => {
        const { code, stderr } = await runRunner([ '--skip', os.tmpdir() ]);

        assertEqual(1, code);
        assertMatches('Skip pathname is outside the test root.', stderr);
    }, { timeout: TIMEOUT });

    it('rejects an unknown flag', async () => {
        const { code, stderr } = await runRunner([ '--e2e' ]);

        assertEqual(1, code);
        assertMatches('--e2e', stderr);
    }, { timeout: TIMEOUT });
});


function runRunner(args) {
    const runtimeArgs = process.versions.deno ? [ 'run', '-A' ] : [];

    return new Promise((resolve) => {
        execFile(process.execPath, [ ...runtimeArgs, RUNNER, ...args ], (error, stdout, stderr) => {
            resolve({ code: error ? error.code : 0, stdout, stderr });
        });
    });
}
