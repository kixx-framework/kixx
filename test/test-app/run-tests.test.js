import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';


const RUNNER = fileURLToPath(new URL('../../test-app/run-tests.js', import.meta.url));
const INTEGRATION_TEST_ROOT = fileURLToPath(new URL('../../test-app/test', import.meta.url));
const TIMEOUT = 10000;


describe('test-app/run-tests.js', ({ it }) => {

    // Only invocations that fail before any test file is imported are
    // exercised, so nothing here ever contacts a target.
    it('requires a base URL', async () => {
        const { code, stderr } = await runRunner([]);

        assertEqual(1, code);
        assertMatches('INTEGRATION_TESTS_BASE_URL', stderr);
        assertMatches('Usage: node test-app/run-tests.js', stderr);
    }, { timeout: TIMEOUT });

    it('rejects the root credential options, which no longer exist', async () => {
        const { code, stderr } = await runRunner([ '--username', 'x' ]);

        assertEqual(1, code);
        assertMatches("Unknown option '--username'", stderr);
    }, { timeout: TIMEOUT });

    it('fails when the selection holds no test files', async () => {
        const { code, stderr } = await runRunner([
            '--base-url',
            'http://127.0.0.1:9/',
            '--skip',
            INTEGRATION_TEST_ROOT,
        ]);

        assertEqual(1, code);
        assertMatches('No test files found under', stderr);
    }, { timeout: TIMEOUT });
});


function runRunner(args) {
    const runtimeArgs = process.versions.deno ? [ 'run', '-A' ] : [];

    // A target set in the developer's shell must not reach the child: these
    // cases are about what the runner does when it is given none.
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([ name ]) => !name.startsWith('INTEGRATION_TESTS_')),
    );

    return new Promise((resolve) => {
        execFile(process.execPath, [ ...runtimeArgs, RUNNER, ...args ], { env }, (error, stdout, stderr) => {
            resolve({ code: error ? error.code : 0, stdout, stderr });
        });
    });
}
