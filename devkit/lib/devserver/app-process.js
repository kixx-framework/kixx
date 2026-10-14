import process from 'node:process';
import path from 'node:path';
import net from 'node:net';
import { spawn as defaultSpawn } from 'node:child_process';


const READY_POLL_INTERVAL_MS = 50;

// 200 polls of 50 ms is the 10 s readiness timeout. Counting polls instead of
// reading a clock keeps the timeout testable with a fake delay().
const READY_POLL_COUNT = 200;

// Just over node-server.js's own 10 s SHUTDOWN_TIMEOUT_MS, so a child that is
// draining requests gets to exit on its own before it is killed.
const STOP_TIMEOUT_MS = 11000;

const OUTPUT_LIMIT = 64 * 1024;


/**
 * Owns the child node-server.js process: spawns it on a free port, waits for
 * it to accept connections, restarts it single-flight after a change, and
 * records why it is unavailable when it fails to start.
 */
export class AppProcess {

    #projectDirectory;
    #environment;
    #dotenv;
    #stdout;
    #stderr;
    #log;
    #spawn;
    #getFreePort;
    #canConnect;
    #delay;
    #execPath;
    #isDeno;

    #child = null;
    #port = null;
    #failure = null;
    #changeCount = 0;
    #startedAtChange = -1;
    #restartPromise = null;
    #stopped = false;

    #output = '';
    #outputChild = null;

    // Children being stopped on purpose, so their exit is never logged as a
    // crash. Marked before signalling: a child may exit synchronously.
    #stoppingChildren = new WeakSet();

    // Makes stopping one child idempotent.
    #stopPromises = new WeakMap();

    /**
     * @param {Object} args
     * @param {string} args.projectDirectory - Directory holding node-server.js; the child's cwd.
     * @param {string} args.environment - Forwarded to the child as --environment.
     * @param {string} [args.dotenv] - Absolute path forwarded to the child as --dotenv.
     * @param {{ write: function }} args.stdout - Receives the child's stdout.
     * @param {{ write: function }} args.stderr - Receives the child's stderr.
     * @param {function(string): void} args.log - Writes a devserver status line.
     * @param {function} [args.spawn] - node:child_process spawn().
     * @param {function(): Promise<number>} [args.getFreePort]
     * @param {function(number): Promise<boolean>} [args.canConnect]
     * @param {function(number, AbortSignal=): Promise<void>} [args.delay]
     * @param {string} [args.execPath] - Runtime executable for the child.
     * @param {boolean} [args.isDeno] - Spawn with `deno run -A` arguments.
     */
    constructor(args) {
        const {
            projectDirectory,
            environment,
            dotenv,
            stdout,
            stderr,
            log,
            spawn = defaultSpawn,
            getFreePort: getPort = getFreePort,
            canConnect: probe = canConnect,
            delay: wait = delay,
            execPath = process.execPath,
            isDeno = Boolean(process.versions.deno),
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#environment = environment;
        this.#dotenv = dotenv;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#log = log;
        this.#spawn = spawn;
        this.#getFreePort = getPort;
        this.#canConnect = probe;
        this.#delay = wait;
        this.#execPath = execPath;
        this.#isDeno = isDeno;
    }

    /**
     * Recent stdout and stderr of the latest child (at most 64 KiB).
     * @type {string}
     */
    get output() {
        return this.#output;
    }

    /**
     * Records that a watched file changed. The next ensureReady() restarts.
     */
    markChanged() {
        this.#changeCount += 1;
    }

    /**
     * Returns a port to proxy to, starting or restarting the child first when
     * needed. Concurrent callers share one restart. Never rejects for app
     * failures.
     *
     * @returns {Promise<{ port: number }|{ failure: { reason: string, output: string } }>}
     */
    async ensureReady() {
        if (this.#stopped) {
            return this.#shutdownFailure();
        }

        if (this.#restartPromise) {
            return await this.#restartPromise;
        }

        const isUnchanged = this.#changeCount === this.#startedAtChange;

        if (isUnchanged && this.#child) {
            return { port: this.#port };
        }

        // A failed start is not retried until another change, so a broken
        // app is not respawned on every request.
        if (isUnchanged && this.#failure) {
            return { failure: this.#failure };
        }

        this.#restartPromise = this.#restart().finally(() => {
            this.#restartPromise = null;
        });

        return await this.#restartPromise;
    }

    /**
     * Stops the child and any in-flight start. Later ensureReady() calls
     * return a shutdown failure. Idempotent.
     * @returns {Promise<void>}
     */
    async stop() {
        // Set first, so an in-flight restart that resumes kills its new child
        // instead of keeping it.
        this.#stopped = true;

        if (this.#restartPromise) {
            await this.#restartPromise;
        }

        if (this.#child) {
            this.#log('stopping app server');
            await this.#stopChild(this.#child);
        }
    }

    async #restart() {
        if (this.#child) {
            this.#log('stopping app server');
            await this.#stopChild(this.#child);
        }

        if (this.#stopped) {
            return this.#shutdownFailure();
        }

        this.#failure = null;
        this.#startedAtChange = this.#changeCount;

        let port;
        let child;

        try {
            port = await this.#getFreePort();
            child = this.#spawnChild(port);
        } catch (cause) {
            return this.#recordFailure(`app server could not be spawned: ${ cause.message }`);
        }

        return await this.#waitUntilReady(child, port);
    }

    #spawnChild(port) {
        const serverScript = path.join(this.#projectDirectory, 'node-server.js');

        const args = [
            ...(this.#isDeno ? [ 'run', '-A' ] : []),
            serverScript,
            '--environment',
            this.#environment,
            ...(this.#dotenv ? [ '--dotenv', this.#dotenv ] : []),
            '--port',
            String(port),
        ];

        this.#log('starting app server');

        this.#output = '';

        const child = this.#spawn(this.#execPath, args, {
            cwd: this.#projectDirectory,
            stdio: [ 'ignore', 'pipe', 'pipe' ],
            env: process.env,
        });

        // The latest child owns the captured output. Trailing output from an
        // older child (its pipes can drain after its exit) is not captured.
        this.#outputChild = child;

        this.#pipeOutput(child, child.stdout, this.#stdout);
        this.#pipeOutput(child, child.stderr, this.#stderr);

        this.#child = child;
        this.#port = port;

        return child;
    }

    #pipeOutput(child, source, destination) {
        source.setEncoding('utf8');

        source.on('data', (text) => {
            destination.write(text);

            if (this.#outputChild === child) {
                this.#output += text;

                if (this.#output.length > OUTPUT_LIMIT) {
                    this.#output = this.#output.slice(-OUTPUT_LIMIT);
                }
            }
        });
    }

    async #waitUntilReady(child, port) {
        let exitInfo = null;
        let spawnError = null;
        let isReady = false;

        // A permanent listener: an unhandled 'error' event would throw.
        child.on('error', (cause) => {
            spawnError = spawnError || cause;
        });

        child.once('exit', (code, signal) => {
            exitInfo = { code, signal };

            if (this.#child === child) {
                this.#child = null;
                this.#port = null;
            }

            // No respawn here: the next ensureReady() sees no live child and
            // no failure, and restarts.
            if (isReady && !this.#stoppingChildren.has(child)) {
                this.#log(`app server exited (code ${ code }, signal ${ signal }); it will restart on the next request`);
            }
        });

        for (let i = 0; i < READY_POLL_COUNT; i += 1) {
            if (spawnError) {
                this.#child = null;
                this.#port = null;
                return this.#recordFailure(`app server could not be spawned: ${ spawnError.message }`);
            }

            if (exitInfo) {
                return this.#recordFailure(
                    `app server exited before accepting connections (code ${ exitInfo.code }, signal ${ exitInfo.signal })`,
                );
            }

            if (this.#stopped) {
                // eslint-disable-next-line no-await-in-loop
                await this.#stopChild(child);
                return this.#shutdownFailure();
            }

            // eslint-disable-next-line no-await-in-loop
            const isConnectable = await this.#canConnect(port);

            // stop() may have begun while the probe was in flight.
            if (this.#stopped) {
                // eslint-disable-next-line no-await-in-loop
                await this.#stopChild(child);
                return this.#shutdownFailure();
            }

            if (isConnectable) {
                isReady = true;
                this.#log(`app server ready on port ${ port }`);
                return { port };
            }

            // eslint-disable-next-line no-await-in-loop
            await this.#delay(READY_POLL_INTERVAL_MS);
        }

        await this.#stopChild(child);

        return this.#recordFailure(`app server did not accept connections on port ${ port } within 10 s`);
    }

    #stopChild(child) {
        if (!this.#stopPromises.has(child)) {
            this.#stoppingChildren.add(child);
            this.#stopPromises.set(child, this.#signalAndWaitForExit(child));
        }

        return this.#stopPromises.get(child);
    }

    async #signalAndWaitForExit(child) {
        if (child.exitCode !== null || child.signalCode !== null) {
            return;
        }

        const exited = new Promise((resolve) => {
            child.once('exit', resolve);
        });

        // Aborting cancels the stop timeout's timer once the child exits, so
        // no timer outlives a prompt shutdown.
        const timeoutController = new AbortController();

        const timedOut = this.#delay(STOP_TIMEOUT_MS, timeoutController.signal).then(() => true);

        child.kill('SIGTERM');

        const isTimedOut = await Promise.race([ exited.then(() => false), timedOut ]);

        timeoutController.abort();

        // Checking the exit state too keeps a child that exited in the same
        // tick as the timeout from being killed.
        if (isTimedOut && child.exitCode === null && child.signalCode === null) {
            this.#log('app server did not exit within 11 s; sending SIGKILL');
            child.kill('SIGKILL');
            await exited;
        }
    }

    #recordFailure(reason) {
        this.#failure = { reason, output: this.#output };
        this.#log(`app server failed to start: ${ reason }`);
        return { failure: this.#failure };
    }

    #shutdownFailure() {
        return { failure: { reason: 'the devserver is shutting down', output: this.#output } };
    }
}


/**
 * Finds a free TCP port on 127.0.0.1 by binding port 0 and closing it.
 * @returns {Promise<number>}
 */
export function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', reject);

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}


/**
 * Reports whether 127.0.0.1:port accepts a TCP connection. Never rejects.
 * Polling the port keeps the devserver independent of the app's log format.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function canConnect(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1' });

        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}


function delay(ms, signal) {
    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, ms);

        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
        }
    });
}
