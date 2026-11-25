/**
 * Generates a project's registries and its example.env.secrets from the
 * manifests it holds: core's, each installed plugin's, and the app's. Run it
 * after a manifest changes, and commit what it writes.
 *
 * Usage: node tools/generate-registries.js <project-directory> [--core <path>]
 *
 * <project-directory> is resolved from the working directory. --core is where
 * core lives, as a POSIX path relative to the project (default: kixx).
 */
import path from 'node:path';
import process from 'node:process';
import util from 'node:util';

import { writeProjectFiles } from '../kixx/tooling/mod.js';
import { OperationalError, ValidationError } from '../kixx/errors/mod.js';
import { createProjectFileSystem } from '../kixx/adapters/node/tooling/lib/project-file-system.js';


const USAGE = 'Usage: node tools/generate-registries.js <project-directory> [--core <path>]';


function readArguments() {
    try {
        const { values, positionals } = util.parseArgs({
            args: process.argv.slice(2),
            options: { core: { type: 'string' } },
            allowPositionals: true,
        });

        return positionals.length === 1 ? { projectDirectory: positionals[0], coreDirectory: values.core } : null;
    } catch {
        // An unknown flag, or --core without a value.
        return null;
    }
}

async function main() {
    const args = readArguments();

    if (!args) {
        process.stderr.write(`${ USAGE }\n`);
        return 1;
    }

    const projectDirectory = path.resolve(args.projectDirectory);
    const fileSystem = createProjectFileSystem(projectDirectory);

    try {
        const fileNames = await writeProjectFiles({ fileSystem, coreDirectory: args.coreDirectory });

        for (const fileName of fileNames) {
            process.stdout.write(`wrote ${ path.join(projectDirectory, fileName) }\n`);
        }

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
