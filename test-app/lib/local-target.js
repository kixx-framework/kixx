/**
 * The logic of run-local.js: builds the test app, starts it on this machine
 * with production settings and a deploy key made for the run, runs the
 * integration suite against it, and stops it.
 *
 * Everything that touches the machine comes from the caller: `spawn`,
 * `fetch`, the clock, the environment, the file system, and the output. The
 * unit suite runs it with fakes and starts no process.
 *
 * The deploy key and its hash are secrets. Each goes to one child, through
 * its environment only. Neither is ever on a command line, and every printed
 * line passes through a filter that would blank them.
 */
import path from 'node:path';

import { assert, isFunction, isNonEmptyString, isPlainObject } from '../../kixx/assertions/mod.js';
import { isAnswering, startServerProcess, SYSTEM_CLOCK } from './server-process.js';


// The runner's `--local` target is http://localhost:2026/.
export const LOCAL_TARGET_PORT = 2026;

const ENVIRONMENT = 'production';
const LOG_FILE_NAME = 'server.log';
const READY_TIMEOUT_MS = 15000;

// How much of the server's log a failed run prints.
const LOG_TAIL_LINES = 60;

const REDACTED = '[redacted]';


/**
 * @param {Object} options
 * @param {Function} options.spawn - `spawn` from `node:child_process`.
 * @param {function(number, string): void} options.kill - `process.kill`.
 * @param {Function} options.fetch
 * @param {import('./server-process.js').Clock} [options.clock]
 * @param {Object} options.env - This process's environment. Both children get a copy with their own additions.
 * @param {{ command: string, args: string[] }} options.runtime - From getRuntimeCommand().
 * @param {string[]} [options.runnerArguments] - Passed on to run-tests.js after `--local`.
 * @param {string} options.buildDirectory - Where the test app is built.
 * @param {string} options.runnerFile - Absolute path of run-tests.js.
 * @param {function(string): Promise} options.assemble - Builds the test app in a directory.
 * @param {function(): Promise<{ key: string, hash: string }>} options.generateDeployKey
 * @param {Object} options.fileSystem
 * @param {function(): Promise<string>} options.fileSystem.makeTemporaryDirectory - Resolves a new, empty directory.
 * @param {function(string): Promise} options.fileSystem.removeDirectory
 * @param {function(string, string): void} options.fileSystem.appendFile - Appends text to a file, synchronously.
 * @param {function(string): void} options.print - Writes one line.
 * @returns {Promise<number>} The exit code: the runner's, or 1 when the server didn't start or didn't exit with 0.
 * @throws {AssertionError} When an option is of the wrong type.
 */
export async function runLocalTarget(options) {
    const {
        spawn,
        kill,
        fetch: sendRequest,
        clock = SYSTEM_CLOCK,
        env,
        runtime,
        runnerArguments = [],
        buildDirectory,
        runnerFile,
        assemble,
        generateDeployKey,
        fileSystem,
        print,
    } = options ?? {};

    assert(isFunction(spawn), 'runLocalTarget: spawn must be a function');
    assert(isFunction(kill), 'runLocalTarget: kill must be a function');
    assert(isFunction(sendRequest), 'runLocalTarget: fetch must be a function');
    assert(isPlainObject(env), 'runLocalTarget: env must be a plain object');
    assert(isNonEmptyString(runtime?.command), 'runLocalTarget: runtime.command must be a non-empty string');
    assert(Array.isArray(runtime.args), 'runLocalTarget: runtime.args must be an array');
    assert(Array.isArray(runnerArguments), 'runLocalTarget: runnerArguments must be an array');
    assert(isNonEmptyString(buildDirectory), 'runLocalTarget: buildDirectory must be a non-empty string');
    assert(isNonEmptyString(runnerFile), 'runLocalTarget: runnerFile must be a non-empty string');
    assert(isFunction(assemble), 'runLocalTarget: assemble must be a function');
    assert(isFunction(generateDeployKey), 'runLocalTarget: generateDeployKey must be a function');
    assert(isFunction(fileSystem?.makeTemporaryDirectory), 'runLocalTarget: fileSystem.makeTemporaryDirectory must be a function');
    assert(isFunction(fileSystem.removeDirectory), 'runLocalTarget: fileSystem.removeDirectory must be a function');
    assert(isFunction(fileSystem.appendFile), 'runLocalTarget: fileSystem.appendFile must be a function');
    assert(isFunction(print), 'runLocalTarget: print must be a function');

    const url = `http://localhost:${ LOCAL_TARGET_PORT }/`;

    // The server would fail to bind, and the suite would then run against
    // whatever is there.
    if (await isAnswering({ fetch: sendRequest, url, clock })) {
        print(`Something already answers at ${ url }. Stop it, then run this again.`);
        return 1;
    }

    print(`Building the test app in ${ buildDirectory }`);
    await assemble(buildDirectory);

    const dataDirectory = await fileSystem.makeTemporaryDirectory();
    const logFile = path.join(dataDirectory, LOG_FILE_NAME);

    const { key, hash } = await generateDeployKey();

    // No line leaves this function without passing through here.
    function say(text) {
        print(text.replaceAll(key, REDACTED).replaceAll(hash, REDACTED));
    }

    function reportFailure(server) {
        const lines = server.output().trimEnd().split('\n').filter((line) => !isAnsweredRequest(line));

        say(`The server's log is kept at ${ logFile }`);
        say(`Its last ${ Math.min(lines.length, LOG_TAIL_LINES) } lines, but for the requests it answered:`);
        say(lines.slice(-LOG_TAIL_LINES).join('\n'));
    }

    say(`Starting the test app at ${ url } (${ ENVIRONMENT }, ${ path.basename(runtime.command) })`);

    const server = startServerProcess({
        spawn,
        kill,
        fetch: sendRequest,
        clock,
        runtime,
        projectDirectory: buildDirectory,
        environment: ENVIRONMENT,
        port: LOCAL_TARGET_PORT,
        env: {
            ...withoutIntegrationVariables(env),
            DEPLOY_KEY_HASH: hash,
            BUILD_ID: `integration-${ clock.now() }`,
            // The deploy key's rate-limit test names its own client address.
            TRUST_PROXY: 'true',
            DATA_DIRECTORY: dataDirectory,
        },
        onOutput(text) {
            fileSystem.appendFile(logFile, text);
        },
    });

    let runnerCode = null;
    let startError = null;
    let stopped;

    try {
        try {
            await server.waitUntilReady({ timeoutMs: READY_TIMEOUT_MS });
        } catch (error) {
            // Only what the process helper reports. Anything else is a bug.
            if (error.code !== 'ServerExitedEarly' && error.code !== 'ServerNotReady') {
                throw error;
            }

            startError = error;
        }

        if (!startError) {
            const runner = await runRunner({
                spawn,
                runtime,
                runnerFile,
                runnerArguments,
                env: { ...env, INTEGRATION_TESTS_DEPLOY_KEY: key },
            });

            if (runner.error) {
                say(`The runner could not be started: ${ runner.error.message }`);
            }

            runnerCode = runner.code;
        }
    } finally {
        // Whatever happened above, the server is not left running.
        stopped = await server.stop();
    }

    if (startError) {
        say(`The test app did not start: ${ startError.message }`);
        reportFailure(server);
        return 1;
    }

    let exitCode = runnerCode;

    if (stopped.code !== 0) {
        say(`The test app did not exit cleanly after SIGTERM (${ describeStop(stopped) }).`);
        exitCode = exitCode || 1;
    }

    if (exitCode === 0) {
        await fileSystem.removeDirectory(dataDirectory);
    } else {
        reportFailure(server);
    }

    return exitCode;
}


// The server logs a line for every request, and a run makes hundreds. The
// ones it answered say nothing about a failure and would push out the lines
// that do.
function isAnsweredRequest(line) {
    return line.includes('"message":"trace http-request"') && line.includes('"status":"ok"');
}

// A target or a key set in the caller's shell is for some other target. The
// local server needs neither.
function withoutIntegrationVariables(env) {
    return Object.fromEntries(
        Object.entries(env).filter(([ name ]) => !name.startsWith('INTEGRATION_TESTS_')),
    );
}

// Resolves the runner's exit code, or 1 when it has none: it was killed, or
// could not be started.
function runRunner({ spawn, runtime, runnerFile, runnerArguments, env }) {
    return new Promise((resolve) => {
        const child = spawn(
            runtime.command,
            [ ...runtime.args, runnerFile, '--local', ...runnerArguments ],
            { env, stdio: 'inherit' },
        );

        child.on('close', (code) => resolve({ code: Number.isInteger(code) ? code : 1, error: null }));
        child.on('error', (error) => resolve({ code: 1, error }));
    });
}

function describeStop(stopped) {
    if (stopped.forced) {
        return 'it had to be killed';
    }

    if (stopped.signal) {
        return `signal ${ stopped.signal }`;
    }

    return `exit code ${ stopped.code }`;
}
