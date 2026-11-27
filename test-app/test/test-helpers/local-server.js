// Starts a test app of a test's own on this machine, for the tests in
// test/local/: a server on a free port, with its own data directory and its
// own deploy key, on the runtime the runner runs on. It is not a test file:
// the runner collects only `*.test.js`.
//
// It is lib/server-process.js handed the real spawn, fetch, and clock. It
// never writes into test-app/build/: a test that edits files starts a copy.
//
// The deploy key is a secret. It is sent only in the Authorization header,
// and nothing here prints it or its hash.

import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateDeployKey } from '../../../kixx/deploy-key/mod.js';
import { getRuntimeCommand, startServerProcess } from '../../lib/server-process.js';


// The built test app. `run-local.js` builds it before the runner starts.
export const BUILD_DIRECTORY = fileURLToPath(new URL('../../build', import.meta.url));

// Every wait here must end inside the runner's 10-second ceiling for a
// test, with room for the test's own requests.
const READY_TIMEOUT_MS = 7000;
const STOP_TIMEOUT_MS = 4000;

// What the server reads from its environment. A value in the runner's own
// environment is for some other server.
const SERVER_VARIABLES = Object.freeze([
    'BUILD_ID',
    'DATA_DIRECTORY',
    'DEPLOY_KEY_HASH',
    'NODE_ENV',
    'PORT',
    'TRUST_PROXY',
]);

// Every server started here that hasn't been seen to exit.
const running = new Set();

// A test that times out never reaches its `finally`. Nothing started here
// outlives the run.
process.on('exit', () => {
    for (const server of running) {
        server.signal('SIGKILL');
    }
});


/**
 * The environment of a server a test starts: the runner's own, without the
 * integration suite's variables (the deploy key of the target among them)
 * and without the server's, then the variables given.
 *
 * @param {Object} env - The runner's environment
 * @param {Object<string, string>} [variables] - What this server gets
 * @returns {Object<string, string>}
 */
export function createServerEnvironment(env, variables = {}) {
    const inherited = Object.entries(env).filter(([ name ]) => {
        return !name.startsWith('INTEGRATION_TESTS_') && !SERVER_VARIABLES.includes(name);
    });

    return { ...Object.fromEntries(inherited), ...variables };
}

/**
 * @param {string} [name] - Part of the directory's name
 * @returns {Promise<string>} A new, empty directory
 */
export function makeTemporaryDirectory(name = 'data') {
    return fsp.mkdtemp(path.join(os.tmpdir(), `kixx-integration-local-${ name }-`));
}

/**
 * @param {string} directory - Removed with everything in it. A missing one is no error.
 * @returns {Promise<void>}
 */
export function removeDirectory(directory) {
    return fsp.rm(directory, { recursive: true, force: true });
}

/**
 * Copies the built test app, for a test that changes a file. The build
 * itself is never written to.
 *
 * @returns {Promise<string>} The copy, in a new temporary directory. Remove it with removeDirectory().
 */
export async function copyBuild() {
    const directory = await makeTemporaryDirectory('project');

    await fsp.cp(BUILD_DIRECTORY, directory, { recursive: true });

    return directory;
}

/**
 * Asks the operating system for a port nothing listens on. Another process
 * could take it before the server binds it; a test would then fail, not
 * pass.
 *
 * @returns {Promise<number>}
 */
export function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', reject);

        server.listen(0, () => {
            const { port } = server.address();

            server.close(() => resolve(port));
        });
    });
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
export function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Writes a line to the run's output, for a measurement the log should keep.
 * Never pass it a secret.
 *
 * @param {string} line
 */
export function report(line) {
    process.stdout.write(`${ line }\n`);
}

/**
 * Starts a test app and, unless told not to, waits for it to answer.
 *
 * By default it runs the build in `production`, with a new deploy key, a
 * build id of its own, and a new data directory that close() removes.
 *
 * Call close() in a `finally`.
 *
 * @param {Object} [options]
 * @param {string} [options.projectDirectory] - The project to start. Defaults to the build.
 * @param {string} [options.environment='production']
 * @param {number} [options.port] - Defaults to a free one.
 * @param {string} [options.dataDirectory] - A directory the caller owns: close() leaves it.
 * @param {string|null} [options.buildId] - Null starts the server with no BUILD_ID.
 * @param {{ key: string, hash: string }|null} [options.deployKey] - Null starts the server with no DEPLOY_KEY_HASH.
 * @param {string} [options.deployKeyHash] - A DEPLOY_KEY_HASH to use in place of the key's, such as a malformed one.
 * @param {boolean} [options.wait=true] - False returns before the server answers, for one that isn't expected to.
 * @returns {Promise<Object>} The server: see the returned object.
 * @throws {OperationalError} `ServerExitedEarly` or `ServerNotReady` when it was waited for and didn't answer. It is dead by then.
 */
export async function startLocalServer(options = {}) {
    const {
        projectDirectory = BUILD_DIRECTORY,
        environment = 'production',
        wait = true,
    } = options;

    const port = options.port ?? await getFreePort();
    const ownsDataDirectory = options.dataDirectory === undefined;
    const dataDirectory = options.dataDirectory ?? await makeTemporaryDirectory();
    const buildId = options.buildId === undefined ? `local-${ crypto.randomUUID() }` : options.buildId;
    const deployKey = options.deployKey === undefined ? await generateDeployKey() : options.deployKey;

    const variables = { DATA_DIRECTORY: dataDirectory };

    if (buildId !== null) {
        variables.BUILD_ID = buildId;
    }

    if (options.deployKeyHash !== undefined) {
        variables.DEPLOY_KEY_HASH = options.deployKeyHash;
    } else if (deployKey !== null) {
        variables.DEPLOY_KEY_HASH = deployKey.hash;
    }

    const serverProcess = startServerProcess({
        spawn,
        kill: (pid, signal) => process.kill(pid, signal),
        fetch: (...args) => fetch(...args),
        runtime: getRuntimeCommand(process),
        projectDirectory,
        environment,
        port,
        env: createServerEnvironment(process.env, variables),
    });

    running.add(serverProcess);
    serverProcess.exited.then(() => running.delete(serverProcess));

    // Every address the server listens on includes this one, on both
    // runtimes.
    const origin = `http://127.0.0.1:${ port }`;

    let closing = null;

    async function stopAndRemove() {
        const exit = await serverProcess.stop({ timeoutMs: STOP_TIMEOUT_MS });

        if (ownsDataDirectory) {
            await removeDirectory(dataDirectory);
        }

        return exit;
    }

    const server = {
        origin,
        port,
        buildId,
        dataDirectory,

        // Pass it on to a second server over the same data, or to the
        // publish helper. Never print it.
        deployKey,

        /** Resolves the exit code and the output. Never rejects. */
        exited: serverProcess.exited,

        /** What the server has written so far. */
        output: () => serverProcess.output(),

        /** Sends a signal. False when the process has already ended. */
        signal: (name) => serverProcess.signal(name),

        /**
         * A request to this server, with its deploy key when it has one.
         * Redirects aren't followed.
         *
         * @param {string} pathname - With a leading slash and any query string
         * @param {Object} [init] - As for `fetch`
         * @returns {Promise<Response>}
         */
        fetch(pathname, init = {}) {
            return fetch(`${ origin }${ pathname }`, { ...init, headers: server.headers(init.headers), redirect: 'manual' });
        },

        /**
         * Request headers with this server's deploy key, for a client other
         * than fetch.
         *
         * @param {Object} [headers]
         * @returns {Object<string, string>}
         */
        headers(headers = {}) {
            return deployKey === null ? { ...headers } : { ...headers, authorization: `Bearer ${ deployKey.key }` };
        },

        /**
         * Resolves the exit if it comes inside the wait, else null.
         *
         * @param {number} milliseconds
         * @returns {Promise<Object|null>}
         */
        async exitWithin(milliseconds) {
            let timer;

            const timedOut = new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), milliseconds);
            });

            try {
                return await Promise.race([ serverProcess.exited, timedOut ]);
            } finally {
                clearTimeout(timer);
            }
        },

        /**
         * Stops the server with SIGTERM if it is still running, kills it if
         * it doesn't exit, and removes the data directory this call made.
         * A second call resolves with the first.
         *
         * @returns {Promise<Object>} The exit, with `forced`
         */
        close() {
            closing ??= stopAndRemove();

            return closing;
        },
    };

    if (wait) {
        try {
            await serverProcess.waitUntilReady({ timeoutMs: READY_TIMEOUT_MS });
        } catch (error) {
            await server.close();
            throw error;
        }
    }

    return server;
}

/**
 * The last lines a server wrote, for an assertion message. A server never
 * logs a deploy key or its hash.
 *
 * @param {string} output
 * @param {number} [lines=15]
 * @returns {string}
 */
export function tail(output, lines = 15) {
    return output.trimEnd().split('\n').slice(-lines).join('\n');
}
