/**
 * @fileoverview Process manager for running and restarting Node.js scripts
 *
 * Manages a child Node.js process, watches source files for changes, and
 * automatically restarts the child process when matching files change.
 * Uses EventEmitter pattern for lifecycle and status notifications.
 */

import process from 'node:process';
import { fork } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { isNonEmptyString, isNumberNotNaN } from '../assertions/mod.js';
import FileWatcher from './file-watcher.js';

/**
 * @typedef {Object} ProcessManagerOptions
 * @property {string} script - The Node.js script to run
 * @property {string} watchDirectory - The directory to watch for changes
 * @property {string} [pattern='**\/*.js'] - Glob pattern for files to watch
 * @property {number} [debounceMs=300] - Debounce delay in milliseconds
 * @property {string[]} [scriptArgs=[]] - Arguments to pass to the script
 */

/**
 * @typedef {Object} ProcessManagerEvent
 * @property {string} name - Event name identifier
 * @property {string} message - Human-readable event description
 * @property {Object} info - Additional event context data
 * @property {boolean} [fatal] - Whether this is a fatal error
 * @property {Error} [cause] - Original error that triggered this event
 */

const DEFAULT_PATTERN = '**/*.js';
const DEFAULT_DEBOUNCE_MS = 300;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * Process manager that runs a Node.js script and restarts it when
 * watched files change. Provides graceful shutdown handling.
 *
 * @extends EventEmitter
 * @fires ProcessManager#info - Process lifecycle events
 * @fires ProcessManager#warning - Non-fatal issues
 * @fires ProcessManager#error - Process errors
 * @fires ProcessManager#debug - Debug information
 */
export default class ProcessManager extends EventEmitter {

    /**
     * @type {import('node:child_process').ChildProcess|null}
     * @private
     */
    #childProcess = null;

    /**
     * @type {FileWatcher|null}
     * @private
     */
    #fileWatcher = null;

    /**
     * @type {NodeJS.Timeout|null}
     * @private
     */
    #debounceTimer = null;

    /**
     * @type {boolean}
     * @private
     */
    #isRestarting = false;

    /**
     * @type {boolean}
     * @private
     */
    #shouldRun = false;

    /**
     * Creates a new ProcessManager instance
     * @param {ProcessManagerOptions} options - Manager configuration options
     * @throws {Error} When script is not a non-empty string
     * @throws {Error} When watchDirectory is not a non-empty string
     */
    constructor({ script, watchDirectory, pattern, debounceMs, scriptArgs }) {
        super();

        if (!isNonEmptyString(script)) {
            throw new Error('ProcessManager script must be a non-empty string');
        }

        if (!isNonEmptyString(watchDirectory)) {
            throw new Error('ProcessManager watchDirectory must be a non-empty string');
        }

        Object.defineProperties(this, {
            /**
             * The script to run
             * @memberof ProcessManager#
             * @type {string}
             * @readonly
             */
            script: {
                enumerable: true,
                value: path.resolve(script),
            },
            /**
             * The directory to watch
             * @memberof ProcessManager#
             * @type {string}
             * @readonly
             */
            watchDirectory: {
                enumerable: true,
                value: path.resolve(watchDirectory),
            },
            /**
             * The glob pattern for watched files
             * @memberof ProcessManager#
             * @type {string}
             * @readonly
             */
            pattern: {
                enumerable: true,
                value: isNonEmptyString(pattern) ? pattern : DEFAULT_PATTERN,
            },
            /**
             * Debounce delay in milliseconds
             * @memberof ProcessManager#
             * @type {number}
             * @readonly
             */
            debounceMs: {
                enumerable: true,
                value: isNumberNotNaN(debounceMs) ? debounceMs : DEFAULT_DEBOUNCE_MS,
            },
            /**
             * Arguments to pass to the script
             * @memberof ProcessManager#
             * @type {string[]}
             * @readonly
             */
            scriptArgs: {
                enumerable: true,
                value: Array.isArray(scriptArgs) ? scriptArgs : [],
            },
        });
    }

    /**
     * Starts the child process and file watcher
     * @returns {Promise<void>}
     */
    async start() {
        this.#shouldRun = true;

        this.#setupSignalHandlers();
        this.#startFileWatcher();
        this.#spawnChild();
    }

    /**
     * Gracefully stops the child process and file watcher
     * @returns {Promise<void>}
     */
    async stop() {
        this.#shouldRun = false;

        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }

        if (this.#fileWatcher) {
            this.#fileWatcher.stop();
            this.#fileWatcher = null;
        }

        await this.#killChild();
    }

    /**
     * Restarts the child process
     * @returns {Promise<void>}
     */
    async restart() {
        if (this.#isRestarting) {
            return;
        }

        this.#isRestarting = true;

        this.emit('info', {
            name: 'process-restarting',
            message: 'restarting child process',
            info: { script: this.script },
        });

        await this.#killChild();
        this.#spawnChild();

        this.#isRestarting = false;
    }

    /**
     * Spawns the child process using fork()
     * @private
     */
    #spawnChild() {
        const { script, scriptArgs } = this;

        this.emit('debug', {
            name: 'process-spawning',
            message: `spawning child process: ${ script }`,
            info: { script, args: scriptArgs },
        });

        this.#childProcess = fork(script, scriptArgs, {
            stdio: 'inherit',
        });

        const pid = this.#childProcess.pid;

        this.emit('info', {
            name: 'process-started',
            message: `child process started with pid ${ pid }`,
            info: { script, pid },
        });

        this.#childProcess.on('error', (cause) => {
            this.emit('error', {
                name: 'process-error',
                message: 'child process error',
                info: { script, pid },
                cause,
            });
        });

        this.#childProcess.on('exit', (code, signal) => {
            this.emit('info', {
                name: 'process-exited',
                message: `child process exited with code ${ code } and signal ${ signal }`,
                info: { script, pid, code, signal },
            });

            this.#childProcess = null;

            // Auto-restart on crash if we should still be running
            if (this.#shouldRun && !this.#isRestarting) {
                this.emit('warning', {
                    name: 'process-crashed',
                    message: 'child process crashed, restarting',
                    info: { script, pid, code, signal },
                });

                this.#spawnChild();
            }
        });
    }

    /**
     * Kills the child process gracefully (SIGTERM, then SIGKILL after timeout)
     * @private
     * @returns {Promise<void>}
     */
    #killChild() {
        return new Promise((resolve) => {
            const child = this.#childProcess;

            if (!child) {
                resolve();
                return;
            }

            const pid = child.pid;

            this.emit('debug', {
                name: 'process-killing',
                message: `killing child process ${ pid }`,
                info: { script: this.script, pid },
            });

            // Set up force kill timeout
            const forceKillTimeout = setTimeout(() => {
                if (child.exitCode === null) {
                    this.emit('warning', {
                        name: 'process-force-kill',
                        message: `force killing child process ${ pid } after timeout`,
                        info: { script: this.script, pid },
                    });
                    child.kill('SIGKILL');
                }
            }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

            child.once('exit', () => {
                clearTimeout(forceKillTimeout);
                resolve();
            });

            // Send graceful termination signal
            child.kill('SIGTERM');
        });
    }

    /**
     * Starts the file watcher
     * @private
     */
    #startFileWatcher() {
        const { watchDirectory, pattern } = this;

        this.#fileWatcher = new FileWatcher({
            directory: watchDirectory,
            pattern,
            recursive: true,
        });

        this.#fileWatcher.on('change', (event) => {
            this.#handleFileChange(event.info.filepath);
        });

        this.#fileWatcher.on('error', (event) => {
            this.emit('error', {
                name: 'watcher-error',
                message: 'file watcher error',
                info: { watchDirectory },
                cause: event.cause,
            });
        });

        this.#fileWatcher.start();

        this.emit('info', {
            name: 'watcher-started',
            message: `watching ${ watchDirectory } for ${ pattern }`,
            info: { watchDirectory, pattern },
        });
    }

    /**
     * Handles file change events with debouncing
     * @private
     * @param {string} filepath - The path of the changed file
     */
    #handleFileChange(filepath) {
        this.emit('debug', {
            name: 'file-changed',
            message: `file changed: ${ filepath }`,
            info: { filepath },
        });

        // Clear any existing debounce timer
        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
        }

        // Set up debounced restart
        this.#debounceTimer = setTimeout(() => {
            this.#debounceTimer = null;
            this.restart();
        }, this.debounceMs);
    }

    /**
     * Sets up process signal handlers for graceful shutdown
     * @private
     */
    #setupSignalHandlers() {
        const handleSignal = async (signal) => {
            this.emit('info', {
                name: 'signal-received',
                message: `received ${ signal }, shutting down`,
                info: { signal },
            });

            await this.stop();
            process.exit(0);
        };

        process.on('SIGTERM', () => handleSignal('SIGTERM'));
        process.on('SIGINT', () => handleSignal('SIGINT'));
    }
}
