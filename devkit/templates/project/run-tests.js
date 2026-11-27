// Runs every *.test.js file under test/.
//
//     node run-tests.js
//     deno run -A run-tests.js
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import util from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';


const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.join(ROOT_DIRECTORY, 'test');


async function main() {
    // Tests may rely on the project root being the working directory.
    process.chdir(ROOT_DIRECTORY);

    // Sorted, so a failing run reproduces on another machine.
    const testFiles = (await fsp.readdir(TEST_ROOT, { recursive: true }))
        .filter((name) => name.endsWith('.test.js'))
        .sort();

    if (testFiles.length === 0) {
        throw new Error(`No test files found under ${ TEST_ROOT }`);
    }

    for (const name of testFiles) {
        await import(pathToFileURL(path.join(TEST_ROOT, name)));
    }

    const startTime = Date.now();
    let testCount = 0;
    let errorCount = 0;

    const emitter = runTests();

    emitter.on('error', (error) => {
        write(`Error event while running tests:\n${ util.inspect(error) }\n`);
        process.exit(1);
    });

    emitter.on('blockComplete', ({ block, error }) => {
        if (block.disabled) {
            return;
        }

        if (block.type === 'test') {
            testCount += 1;
        }

        if (error) {
            errorCount += 1;
            write(`\nTest failed: [${ block.concatName(' - ') }]\n${ util.inspect(error, false, 2, true) }\n`);
        }
    });

    emitter.on('complete', () => {
        const result = errorCount > 0 ? `Failed with ${ errorCount } errors` : 'Passed with no errors';

        write(`\nRan ${ testCount } tests in ${ Date.now() - startTime }ms.\n${ result }\n`, () => {
            process.exit(errorCount > 0 ? 1 : 0);
        });
    });
}

function write(message, callback) {
    process.stdout.write(message, callback);
}

main().catch((error) => {
    process.stderr.write(`Error running tests:\n${ util.inspect(error) }\n`, () => {
        process.exit(1);
    });
});
