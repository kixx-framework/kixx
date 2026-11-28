/**
 * Builds a Kixx project with no plugins in a directory: the project skeleton
 * from devkit/templates/project/, core as kixx/, and the generated files.
 *
 * Usage: node tools/build-project.js <directory>
 *
 * <directory> is resolved from the working directory. It must not exist, be
 * empty, or hold a project this tool built before, which it replaces.
 */
import path from 'node:path';
import process from 'node:process';

import { OperationalError, ValidationError } from '../kixx/errors/mod.js';
import { assembleProject } from './lib/assemble-project.js';


const USAGE = 'Usage: node tools/build-project.js <directory>';


async function main() {
    const args = process.argv.slice(2);

    if (args.length !== 1 || args[0].startsWith('-')) {
        process.stderr.write(`${ USAGE }\n`);
        return 1;
    }

    const targetDirectory = path.resolve(args[0]);

    try {
        const fileNames = await assembleProject({ targetDirectory });

        process.stdout.write(`built a core-only project in ${ targetDirectory } (${ fileNames.length } files)\n`);

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
