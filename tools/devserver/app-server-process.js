import process from 'node:process';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, assertArray } from '../../src/kixx/assertions/mod.js';
import { OperationalError } from '../../src/kixx/errors/mod.js';


const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const NODE_SERVER_SCRIPT = path.join(THIS_DIRECTORY, '..', '..', 'src', 'node-server.js');

const READY_POLL_INTERVAL_MS = 50;
const READY_TIMEOUT_MS = 10000;

// Slightly longer than src/node-server.js's own internal SHUTDOWN_TIMEOUT_MS
// (10000ms) backstop, so a child that is draining in-flight requests gets a
// fair chance to exit on its own before this devserver gives up on it.
const STOP_TIMEOUT_MS = 11000;

// How long the app server can sit idle (no proxied response has finished)
// before the next request triggers a restart, so edits made during the idle
// gap are picked up by the very next request.
const IDLE_RESTART_THRESHOLD_MS = 5000;

// Backoff for respawning after an unexpected crash: doubles each failed
// attempt up to the cap, so a persistently broken child (e.g. a syntax error
// introduced by an edit) does not spin the CPU with rapid respawn attempts.
const INITIAL_CRASH_BACKOFF_MS = 500;
const MAX_CRASH_BACKOFF_MS = 5000;

/**
 * Manages the src/node-server.js child process lifecycle: spawning replacement
 * children on fresh ports, swapping only after readiness, and tracking old
 * children until they finish draining.
 */
export default class AppServerProcess {

    #forwardedArgs;
    #child = null;
    #children = new Set();
    #port = null;
    #restartPromise = null;
    #lastActivityAt = Date.now();
    #stopped = false;

    /**
     * @param {Object} args
     * @param {string[]} [args.forwardedArgs] - Extra CLI arguments passed through to every spawned src/node-server.js child (e.g. --config, --environment, --dotenv).
     */
    constructor(args) {
        const { forwardedArgs = [] } = args ?? {};

        assertArray(forwardedArgs, 'AppServerProcess: forwardedArgs');

        this.#forwardedArgs = forwardedArgs;
    }

    /**
     * Port the currently running child app server is reachable on, or null
     * before start() has resolved.
     * @type {number|null}
     */
    get port() {
        return this.#port;
    }

    /**
     * Spawns the child app server on a newly discovered free port and
     * resolves once it accepts TCP connections on that port.
     * @returns {Promise<void>}
     * @throws {OperationalError} When the child does not become reachable before the startup timeout elapses.
     */
    async start() {
        assert(!this.#child, 'AppServerProcess: start() called while a child process is already running');

        const { child, port } = await this.#spawnAndWaitUntilReady();

        this.#child = child;
        this.#port = port;
        this.#lastActivityAt = Date.now();
    }

    /**
     * Restarts the app server if it has sat idle (no proxied response has
     * finished) for at least the idle threshold, then resolves once a healthy
     * child is current. Resolves immediately, without restarting, when the
     * idle threshold has not elapsed. Concurrent calls made while a triggered
     * restart is already in flight await that same restart instead of each
     * starting their own.
     * @returns {Promise<void>}
     * @throws {OperationalError} When a triggered restart's replacement child does not become reachable before the startup timeout elapses.
     */
    async ensureFresh() {
        if (Date.now() - this.#lastActivityAt >= IDLE_RESTART_THRESHOLD_MS) {
            await this.#restart();
        }
    }

    /**
     * Records that a proxied response has just finished, resetting the idle
     * timer used by ensureFresh(). Call this once per proxied request, after
     * its response completes (successfully or with an error).
     */
    markActivity() {
        this.#lastActivityAt = Date.now();
    }

    /**
     * Gracefully stops every known child app server by sending SIGTERM and
     * letting each one drain in-flight requests through its own shutdown
     * handling. Resolves once all children exit or their stop timeouts elapse.
     * Safe to call when no child is running.
     * @returns {Promise<void>}
     */
    async stop() {
        // Set before signaling children so any in-flight spawn/restart path
        // that resumes during shutdown kills its candidate instead of making
        // it current.
        this.#stopped = true;

        const children = [ ...this.#children ];
        this.#child = null;
        this.#port = null;

        await Promise.all(children.map((child) => waitForExitAfterSignal(child, 'SIGTERM')));
    }

    // Spawns a new child and waits for it to accept connections, killing it
    // first if it never becomes ready so a broken startup doesn't leak an
    // orphaned process. Shared by start() and the cutover restart below,
    // since both need the identical spawn-then-confirm-ready sequence.
    async #spawnAndWaitUntilReady() {
        const port = await getFreePort();
        const child = spawnAppServer(this.#forwardedArgs, port);
        this.#children.add(child);

        // Keep a process-level error listener attached so a spawn failure never
        // becomes an uncaught 'error' event if it fires before waitUntilReady()
        // has translated it into an OperationalError.
        child.on('error', () => null);

        // An intentional removal (stop() or cutover() superseding this child
        // with a replacement) always updates #child before this child is
        // killed, so by the time exit fires here, this.#child !== child for
        // every intentional case. Only an exit that leaves this child still
        // "current" is treated as an unexpected crash.
        child.once('exit', () => {
            this.#children.delete(child);
            if (this.#child === child) {
                this.#handleCrash();
            }
        });

        try {
            await waitUntilReady(child, port);
            if (this.#stopped) {
                throw new OperationalError('App server startup was cancelled because devserver is stopping');
            }
        } catch (cause) {
            child.kill('SIGTERM');
            throw cause;
        }

        return { child, port };
    }

    // Single-flight guard: concurrent restart triggers (idle-restart requests
    // arriving in the same burst, or a crash respawn racing an idle trigger)
    // collapse into the one cutover already in flight instead of each
    // spawning their own replacement child.
    #restart() {
        if (!this.#restartPromise) {
            this.#restartPromise = this.#cutover().finally(() => {
                this.#restartPromise = null;
            });
        }

        return this.#restartPromise;
    }

    // Cutover: bring up a replacement child and only swap it in once it is
    // confirmed healthy, so a broken replacement never takes traffic away
    // from a still-working previous child. The previous child is handed
    // SIGTERM and left to drain through its own shutdown handling rather than
    // being awaited here, so in-flight requests it is still serving are not
    // interrupted by this restart.
    async #cutover() {
        if (this.#stopped) {
            throw new OperationalError('Cannot restart app server after devserver shutdown has started');
        }

        const previousChild = this.#child;

        const { child, port } = await this.#spawnAndWaitUntilReady();

        this.#child = child;
        this.#port = port;
        // Reset here, not just in markActivity(), so a request arriving in the
        // narrow window between cutover finishing and the triggering
        // request's own response completing does not see a stale idle gap
        // and trigger a second, unnecessary restart.
        this.#lastActivityAt = Date.now();

        if (previousChild) {
            previousChild.kill('SIGTERM');
        }
    }

    // Recovers from an unexpected child exit (e.g. an uncaught exception
    // crashed the app server) by respawning through the same cutover used for
    // intentional restarts, retrying with capped exponential backoff if the
    // replacement itself fails to come up. There is no previous child to
    // fall back to here, so this keeps retrying — rather than giving up after
    // a fixed number of attempts — until either it succeeds or stop() is
    // called.
    async #handleCrash() {
        if (this.#stopped) {
            return;
        }

        this.#child = null;
        this.#port = null;

        // eslint-disable-next-line no-console
        console.error('[devserver] app server exited unexpectedly; respawning...');

        let backoffMs = INITIAL_CRASH_BACKOFF_MS;

        while (!this.#stopped) {
            try {
                await this.#restart();
                return;
            } catch (cause) {
                // eslint-disable-next-line no-console
                console.error(`[devserver] respawn attempt failed; retrying in ${ backoffMs }ms`, cause);
                await delay(backoffMs);
                backoffMs = Math.min(backoffMs * 2, MAX_CRASH_BACKOFF_MS);
            }
        }
    }
}

// Binding to port 0 lets the OS assign an unused ephemeral port; closing the
// throwaway listener immediately frees it for the child app server to bind
// to next.
function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.once('error', (cause) => {
            reject(new OperationalError(
                'Failed to discover a free port for the app server child process',
                { cause },
            ));
        });

        probe.listen(0, () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function spawnAppServer(forwardedArgs, port) {
    return spawn(process.execPath, [
        NODE_SERVER_SCRIPT,
        ...forwardedArgs,
        '--port',
        String(port),
    ], { stdio: 'inherit' });
}

// Poll for an open TCP connection instead of parsing child log output, so
// devserver stays decoupled from the app server's log format and level
// configuration.
async function waitUntilReady(child, port) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let exitInfo = null;
    let spawnError = null;

    const recordExit = (code, signal) => {
        exitInfo = { code, signal };
    };
    const recordError = (cause) => {
        spawnError = cause;
    };

    child.once('exit', recordExit);
    child.once('error', recordError);

    try {
        while (Date.now() < deadline) {
            if (spawnError) {
                throw new OperationalError('Failed to start app server child process', { cause: spawnError });
            }
            if (exitInfo) {
                throw new OperationalError(
                    `App server exited before it became reachable on port ${ port } ` +
                        `(code: ${ exitInfo.code }, signal: ${ exitInfo.signal })`,
                );
            }
            if (await canConnect(port)) {
                return;
            }
            await delay(READY_POLL_INTERVAL_MS);
        }
    } finally {
        child.off('exit', recordExit);
        child.off('error', recordError);
    }

    throw new OperationalError(
        `App server did not become reachable on port ${ port } within ${ READY_TIMEOUT_MS }ms`,
    );
}

function canConnect(port) {
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

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function waitForExitAfterSignal(child, signal) {
    return new Promise((resolve) => {
        const forceTimeout = setTimeout(resolve, STOP_TIMEOUT_MS);

        child.once('exit', () => {
            clearTimeout(forceTimeout);
            resolve();
        });

        child.kill(signal);
    });
}
