/**
 * Builds the integration suite's test app in test-app/build/: the project
 * skeleton, core as kixx/, the integration-probe plugin with the probe and
 * the suites it runs, and the generated files.
 *
 * Usage: node tools/build-test-app.js
 *
 * It takes no argument, and replaces a test app it built before. The
 * directory is git-ignored. Building runs nothing and contacts nothing.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { OperationalError, ValidationError } from '../kixx/errors/mod.js';
import { assembleTestApp } from './lib/assemble-project.js';


const USAGE = 'Usage: node tools/build-test-app.js';

const BUILD_DIRECTORY = fileURLToPath(new URL('../test-app/build', import.meta.url));


async function main() {
    if (process.argv.length > 2) {
        process.stderr.write(`${ USAGE }\n`);
        return 1;
    }

    try {
        const fileNames = await assembleTestApp(BUILD_DIRECTORY);

        process.stdout.write(`built the test app in ${ BUILD_DIRECTORY } (${ fileNames.length } files)\n`);

        return 0;
    } catch (error) {
        // A problem the developer can fix. Anything else is a bug: let it crash.
        if (error instanceof ValidationError || error instanceof OperationalError) {
            process.stderr.write(`${ error.message }\n`);
            return 1;
        }

        throw error;
    }
}

process.exitCode = await main();
