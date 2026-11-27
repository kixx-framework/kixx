/**
 * Runs the integration suite against a test app on this machine.
 *
 * It builds the test app (test-app/build/), starts it on port 2026 with
 * production settings, a deploy key made for this run, and a temporary data
 * directory, runs `run-tests.js --local` against it, and stops it. The
 * server and the runner use the runtime this script runs on. Its exit code
 * is the runner's.
 *
 * Usage: node test-app/run-local.js [--skip <path>] [pathname ...]
 *        deno run -A test-app/run-local.js [--skip <path>] [pathname ...]
 *
 * The arguments go to run-tests.js. The logic is in lib/local-target.js.
 */
import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateDeployKey } from '../kixx/deploy-key/mod.js';
import { assembleTestApp } from '../tools/lib/assemble-project.js';
import { runLocalTarget } from './lib/local-target.js';
import { getRuntimeCommand } from './lib/server-process.js';


process.exitCode = await runLocalTarget({
    spawn,
    kill: (pid, signal) => process.kill(pid, signal),
    fetch: (...args) => fetch(...args),
    env: { ...process.env },
    runtime: getRuntimeCommand(process),
    runnerArguments: process.argv.slice(2),
    buildDirectory: fileURLToPath(new URL('./build', import.meta.url)),
    runnerFile: fileURLToPath(new URL('./run-tests.js', import.meta.url)),
    assemble: assembleTestApp,
    generateDeployKey,
    fileSystem: {
        makeTemporaryDirectory: () => fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-integration-')),
        removeDirectory: (directory) => fsp.rm(directory, { recursive: true, force: true }),
        appendFile: (file, text) => fs.appendFileSync(file, text),
    },
    print: (line) => process.stdout.write(`${ line }\n`),
});
