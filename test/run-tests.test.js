import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';


const RUNNER = fileURLToPath(new URL('../run-tests.js', import.meta.url));
const TEST_ROOT = fileURLToPath(new URL('./', import.meta.url));
const TEST_V6 = fileURLToPath(new URL('../test-v6', import.meta.url));
const TEST_APP = fileURLToPath(new URL('../test-app', import.meta.url));
const TIMEOUT = 10000;


describe('run-tests.js', ({ it }) => {

    // Only invocations that fail before any test file is imported are
    // exercised: a nested run of real tests would recurse into this file.
    it('rejects a pathname outside the test root', async () => {
        const { code, stderr } = await runRunner([ TEST_V6 ]);

        assertEqual(1, code);
        assertMatches('Test pathname is outside the test root.', stderr);
        assertMatches('Usage: node run-tests.js', stderr);
    }, { timeout: TIMEOUT });

    // The integration suite has its own runner and needs a running target.
    it('rejects the integration suite in test-app/', async () => {
        const { code, stderr } = await runRunner([ TEST_APP ]);

        assertEqual(1, code);
        assertMatches('Test pathname is outside the test root.', stderr);
    }, { timeout: TIMEOUT });

    it('fails when the selection holds no test files', async () => {
        const { code, stderr } = await runRunner([ '--skip', TEST_ROOT ]);

        assertEqual(1, code);
        assertMatches('No test files found under', stderr);
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
