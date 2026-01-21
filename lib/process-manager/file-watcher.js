/**
 * @fileoverview File watcher utility that monitors directories for changes
 *
 * Wraps Node.js fs.watch() with recursive watching and glob pattern filtering.
 * Emits 'change' events when matching files are modified and 'error' events on failures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { isNonEmptyString, isBoolean } from '../assertions/mod.js';
import GlobMatcher from './glob-matcher.js';

/**
 * @typedef {Object} FileWatcherOptions
 * @property {string} directory - The directory to watch
 * @property {string} pattern - The glob pattern to filter files
 * @property {boolean} [recursive=true] - Whether to watch recursively
 */

/**
 * @typedef {Object} FileWatcherEvent
 * @property {string} name - Event name identifier
 * @property {string} message - Human-readable event description
 * @property {Object} info - Additional event context data
 * @property {Error} [cause] - Original error that triggered this event
 */

/**
 * File watcher that monitors a directory for changes and emits events
 * when files matching a glob pattern are modified.
 *
 * @extends EventEmitter
 * @fires FileWatcher#change - When a matching file changes
 * @fires FileWatcher#error - When a watcher error occurs
 */
export default class FileWatcher extends EventEmitter {

    /**
     * @type {fs.FSWatcher|null}
     * @private
     */
    #watcher = null;

    /**
     * @type {GlobMatcher}
     * @private
     */
    #matcher = null;

    /**
     * Creates a new FileWatcher instance
     * @param {FileWatcherOptions} options - Watcher configuration options
     * @throws {Error} When directory is not a non-empty string
     * @throws {Error} When pattern is not a non-empty string
     */
    constructor({ directory, pattern, recursive }) {
        super();

        if (!isNonEmptyString(directory)) {
            throw new Error('FileWatcher directory must be a non-empty string');
        }

        if (!isNonEmptyString(pattern)) {
            throw new Error('FileWatcher pattern must be a non-empty string');
        }

        this.#matcher = new GlobMatcher(pattern);

        Object.defineProperties(this, {
            /**
             * The directory being watched
             * @memberof FileWatcher#
             * @type {string}
             * @readonly
             */
            directory: {
                enumerable: true,
                value: path.resolve(directory),
            },
            /**
             * The glob pattern for filtering files
             * @memberof FileWatcher#
             * @type {string}
             * @readonly
             */
            pattern: {
                enumerable: true,
                value: pattern,
            },
            /**
             * Whether to watch recursively
             * @memberof FileWatcher#
             * @type {boolean}
             * @readonly
             */
            recursive: {
                enumerable: true,
                value: isBoolean(recursive) ? recursive : true,
            },
        });
    }

    /**
     * Starts watching the directory for file changes
     * @throws {Error} When watcher is already started
     * @fires FileWatcher#error
     */
    start() {
        if (this.#watcher) {
            throw new Error('FileWatcher is already started');
        }

        const { directory, recursive } = this;

        this.#watcher = fs.watch(directory, { recursive }, (eventType, filename) => {
            if (filename && this.#matcher.matches(filename)) {
                const filepath = path.join(directory, filename);

                this.emit('change', {
                    name: 'file-changed',
                    message: `file changed: ${ filename }`,
                    info: { filepath, filename, eventType },
                });
            }
        });

        this.#watcher.on('error', (cause) => {
            this.emit('error', {
                name: 'watcher-error',
                message: 'file watcher error',
                info: { directory },
                cause,
            });
        });
    }

    /**
     * Stops watching the directory
     */
    stop() {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
    }
}
