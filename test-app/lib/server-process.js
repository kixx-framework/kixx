/**
 * Starts a project's Node.js entry point as a child process, on Node.js or
 * Deno, and looks after it: waits for it to answer, sends it a signal,
 * resolves its exit code and output, and stops it.
 *
 * `run-local.js` starts the local integration target with it, and the local
 * process tests start their own servers with it. It takes `spawn`, `kill`,
 * `fetch`, and the clock from its caller, so the unit suite tests it with no
 * process.
 *
 * A signal is sent with `kill(pid, signal)` (`process.kill`), never with the
 * child's own `kill()`. Deno's child process reports the signal it was asked
 * to send as what ended the child, whatever the child did with it, so the
 * exit code of a server that drains and exits with 0 would be lost.
 *
 * It never prints, and it reads no environment: the child gets exactly the
 * `env` it is given.
 */
import path from 'node:path';

import { assert, isFunction, isNonEmptyString, isPlainObject } from '../../kixx/assertions/mod.js';
import { OperationalError } from '../../kixx/errors/mod.js';


const DEFAULT_ENTRY_POINT = 'node-server.js';
const DEFAULT_READY_TIMEOUT_MS = 15000;
const DEFAULT_READY_INTERVAL_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 15000;

// One readiness request may wait this long. A server that accepts a
// connection and never answers is not ready.
const REQUEST_TIMEOUT_MS = 2000;

/**
 * @typedef {Object} Clock
 * @property {function(): number} now - Milliseconds.
 * @property {function(Function, number): *} setTimeout
 * @property {function(*): void} clearTimeout
 */

/** @type {Clock} */
export const SYSTEM_CLOCK = Object.freeze({
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
});

/**
 * @typedef {Object} ServerExit
 * @property {number|null} code - The exit code, or null when a signal ended the process or it never started.
 * @property {string|null} signal - The signal that ended the process, if one did.
 * @property {Error|null} error - Why the process could not be started, if it couldn't.
 * @property {string} output - Everything the process wrote, stdout and stderr in the order received.
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {Object} ServerProcess
 * @property {string} url - The server's base URL, `http://localhost:<port>/`.
 * @property {Promise<ServerExit>} exited - Resolves when the process has ended. Never rejects.
 * @property {function(): string} output - What the process has written so far.
 * @property {function(Object=): Promise<void>} waitUntilReady - Resolves at the first HTTP answer, whatever its status.
 * @property {function(string): boolean} signal - Sends a signal. False when the process has already ended.
 * @property {function(Object=): Promise<ServerExit & { forced: boolean }>} stop - Sends a signal, waits for the exit, and kills the process if it doesn't come.
 */

/**
 * The command that runs a script on the runtime this process runs on, so a
 * Node.js run starts Node.js servers and a Deno run starts Deno servers.
 *
 * @param {Object} currentProcess - `node:process`
 * @returns {{ command: string, args: string[] }}
 */
export function getRuntimeCommand(currentProcess) {
    assert(isNonEmptyString(currentProcess?.execPath), 'getRuntimeCommand: process.execPath must be a non-empty string');

    return {
        command: currentProcess.execPath,
        args: currentProcess.versions?.deno ? [ 'run', '-A' ] : [],
    };
}

/**
 * Tells whether anything answers an HTTP request at a URL. Any response
 * counts, a 503 included. A refused connection, or no answer inside the
 * timeout, doesn't.
 *
 * @param {Object} options
 * @param {Function} options.fetch
 * @param {string} options.url
 * @param {Clock} [options.clock]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isAnswering(options) {
    const {
        fetch: sendRequest,
        url,
        clock = SYSTEM_CLOCK,
        timeoutMs = REQUEST_TIMEOUT_MS,
    } = options ?? {};

    assert(isFunction(sendRequest), 'isAnswering: fetch must be a function');
    assert(isNonEmptyString(url), 'isAnswering: url must be a non-empty string');

    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(), timeoutMs);

    let response;

    try {
        response = await sendRequest(url, { redirect: 'manual', signal: controller.signal });
    } catch {
        return false;
    } finally {
        clock.clearTimeout(timer);
    }

    // Let go of the connection. The body is of no interest, and a failure to
    // cancel it doesn't undo the answer.
    try {
        await response?.body?.cancel();
    } catch {
        // Ignore it.
    }

    return true;
}

/**
 * Starts `<runtime> <projectDirectory>/<entryPoint> --environment <name>
 * --port <port>` with the project directory as its working directory.
 *
 * The caller must end what it starts: call `stop()` in a `finally`.
 * `waitUntilReady()` kills the process itself before it rejects.
 *
 * @param {Object} options
 * @param {Function} options.spawn - `spawn` from `node:child_process`.
 * @param {function(number, string): void} options.kill - `process.kill`: sends a signal to a process id.
 * @param {Function} options.fetch
 * @param {Clock} [options.clock]
 * @param {{ command: string, args: string[] }} options.runtime - From getRuntimeCommand().
 * @param {string} options.projectDirectory - Absolute path of a built project.
 * @param {string} [options.entryPoint] - Relative to the project. Defaults to `node-server.js`.
 * @param {string} options.environment - The environment name, such as `production`.
 * @param {number} options.port
 * @param {Object} options.env - The child's whole environment. Nothing is added to it.
 * @param {function(string): void} [options.onOutput] - Called with each chunk the process writes.
 * @returns {ServerProcess}
 * @throws {AssertionError} When an option is of the wrong type.
 */
export function startServerProcess(options) {
    const {
        spawn,
        kill: sendSignal,
        fetch: sendRequest,
        clock = SYSTEM_CLOCK,
        runtime,
        projectDirectory,
        entryPoint = DEFAULT_ENTRY_POINT,
        environment,
        port,
        env,
        onOutput,
    } = options ?? {};

    assert(isFunction(spawn), 'startServerProcess: spawn must be a function');
    assert(isFunction(sendSignal), 'startServerProcess: kill must be a function');
    assert(isFunction(sendRequest), 'startServerProcess: fetch must be a function');
    assert(isNonEmptyString(runtime?.command), 'startServerProcess: runtime.command must be a non-empty string');
    assert(Array.isArray(runtime.args), 'startServerProcess: runtime.args must be an array');
    assert(isNonEmptyString(projectDirectory), 'startServerProcess: projectDirectory must be a non-empty string');
    assert(isNonEmptyString(entryPoint), 'startServerProcess: entryPoint must be a non-empty string');
    assert(isNonEmptyString(environment), 'startServerProcess: environment must be a non-empty string');
    assert(Number.isInteger(port) && port > 0, 'startServerProcess: port must be a positive integer');
    assert(isPlainObject(env), 'startServerProcess: env must be a plain object');
    assert(onOutput === undefined || isFunction(onOutput), 'startServerProcess: onOutput must be a function when given');

    const url = `http://localhost:${ port }/`;

    const chunks = { output: [], stdout: [], stderr: [] };

    let exit = null;
    let stopping = null;
    let resolveExited;

    const exited = new Promise((resolve) => {
        resolveExited = resolve;
    });

    const child = spawn(
        runtime.command,
        [
            ...runtime.args,
            path.join(projectDirectory, entryPoint),
            '--environment',
            environment,
            '--port',
            String(port),
        ],
        {
            cwd: projectDirectory,
            env,
            stdio: [ 'ignore', 'pipe', 'pipe' ],
        },
    );

    capture('stdout');
    capture('stderr');

    // 'close' follows 'exit' once both streams have ended, so the output is
    // complete. A process that could not be started emits only 'error'.
    child.on('close', (code, signal) => {
        finish({ code: code ?? null, signal: signal ?? null, error: null });
    });

    child.on('error', (error) => {
        finish({ code: null, signal: null, error });
    });

    function capture(name) {
        const stream = child[name];

        stream.setEncoding('utf8');

        stream.on('data', (text) => {
            chunks.output.push(text);
            chunks[name].push(text);

            if (onOutput) {
                onOutput(text);
            }
        });
    }

    function finish(result) {
        if (exit) {
            return;
        }

        exit = {
            ...result,
            output: chunks.output.join(''),
            stdout: chunks.stdout.join(''),
            stderr: chunks.stderr.join(''),
        };

        resolveExited(exit);
    }

    function signal(name) {
        assert(isNonEmptyString(name), 'ServerProcess#signal: the signal name must be a non-empty string');

        // A process that could not be started has no id.
        if (exit || !Number.isInteger(child.pid)) {
            return false;
        }

        try {
            sendSignal(child.pid, name);
        } catch (error) {
            // It ended a moment ago, and its 'close' is still to come.
            if (error.code === 'ESRCH') {
                return false;
            }

            throw error;
        }

        return true;
    }

    // Resolves after the wait, or as soon as the process ends.
    function waitOrExit(milliseconds) {
        return new Promise((resolve) => {
            const timer = clock.setTimeout(() => resolve(false), milliseconds);

            exited.then(() => {
                clock.clearTimeout(timer);
                resolve(true);
            });
        });
    }

    async function kill() {
        signal('SIGKILL');
        await exited;
    }

    /**
     * @param {Object} [waitOptions]
     * @param {number} [waitOptions.timeoutMs] - Defaults to 15,000.
     * @param {number} [waitOptions.intervalMs] - Defaults to 100.
     * @throws {OperationalError} `ServerExitedEarly` when the process ends first, `ServerNotReady` when the wait ends. The process is dead in both cases.
     */
    async function waitUntilReady(waitOptions) {
        const {
            timeoutMs = DEFAULT_READY_TIMEOUT_MS,
            intervalMs = DEFAULT_READY_INTERVAL_MS,
        } = waitOptions ?? {};

        const deadline = clock.now() + timeoutMs;

        for (;;) {
            if (exit) {
                throw new OperationalError(
                    `The server exited before it answered (${ describeExit(exit) })`,
                    { code: 'ServerExitedEarly' },
                );
            }

            // eslint-disable-next-line no-await-in-loop
            if (await isAnswering({ fetch: sendRequest, url, clock })) {
                // Something else on the port could have answered while the
                // process was failing to bind it. Give a failing process one
                // interval to exit before trusting the answer.
                // eslint-disable-next-line no-await-in-loop
                if (!exit && !await waitOrExit(intervalMs)) {
                    return;
                }
            } else if (!exit && clock.now() >= deadline) {
                // eslint-disable-next-line no-await-in-loop
                await kill();

                throw new OperationalError(
                    `The server did not answer at ${ url } within ${ timeoutMs } ms`,
                    { code: 'ServerNotReady' },
                );
            } else {
                // eslint-disable-next-line no-await-in-loop
                await waitOrExit(intervalMs);
            }
        }
    }

    /**
     * @param {Object} [stopOptions]
     * @param {string} [stopOptions.signal] - Defaults to SIGTERM.
     * @param {number} [stopOptions.timeoutMs] - How long to wait before SIGKILL. Defaults to 15,000.
     * @returns {Promise<ServerExit & { forced: boolean }>} `forced` is true when the process had to be killed.
     */
    function stop(stopOptions) {
        // A second call sends no second signal. It resolves with the first.
        stopping ??= sendAndWait(stopOptions);

        return stopping;
    }

    async function sendAndWait(stopOptions) {
        const {
            signal: signalName = 'SIGTERM',
            timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
        } = stopOptions ?? {};

        let forced = false;

        if (signal(signalName) && !await waitOrExit(timeoutMs)) {
            forced = true;
            await kill();
        }

        return { ...await exited, forced };
    }

    return {
        url,
        exited,
        output: () => chunks.output.join(''),
        waitUntilReady,
        signal,
        stop,
    };
}


function describeExit(exit) {
    if (exit.error) {
        return `it could not be started: ${ exit.error.message }`;
    }

    if (exit.signal) {
        return `signal ${ exit.signal }`;
    }

    return `exit code ${ exit.code }`;
}
