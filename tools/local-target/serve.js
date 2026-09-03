import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { OperationalError } from '../../src/kixx/errors/mod.js';
import {
    REPO_ROOT,
    assertValidName,
    instanceExists,
    getInstanceDirectory,
    getDotenvPath,
} from './instance.js';


/**
 * Spawns `src/node-server.js --environment local --dotenv <instance>/.env` in
 * the foreground, with inherited stdio, forwarding SIGINT and SIGTERM to the
 * child. Does not restart the child on source changes; use the devserver for
 * that during ordinary read-only development.
 *
 * @param {string} name - Instance name.
 * @returns {Promise<number>} The child process's exit code.
 * @throws {OperationalError} When the instance does not exist.
 */
export function serveInstance(name) {
    assertValidName(name);

    const instanceDirectory = getInstanceDirectory(name);
    if (!instanceExists(name)) {
        throw new OperationalError(`Local target instance "${ name }" does not exist at ${ instanceDirectory }; run create first`);
    }

    const nodeServerPath = path.join(REPO_ROOT, 'src', 'node-server.js');
    const dotenvPath = getDotenvPath(name);

    const child = spawn(process.execPath, [
        nodeServerPath,
        '--environment', 'local',
        '--dotenv', dotenvPath,
    ], { stdio: 'inherit' });

    const forwardSignal = (signal) => child.kill(signal);
    process.on('SIGINT', forwardSignal);
    process.on('SIGTERM', forwardSignal);

    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code) => {
            process.off('SIGINT', forwardSignal);
            process.off('SIGTERM', forwardSignal);
            resolve(code ?? 0);
        });
    });
}
