import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { minimatch } from '../vendor/mod.js';
import { isNonEmptyString, isBoolean } from '../assertions/mod.js';
import { WrappedError, AssertionError } from '../errors/mod.js';

const { Minimatch } = minimatch;


/**
 * @typedef {Object} FileChangeEvent
 * @property {string} filepath - Absolute path to the changed file
 * @property {string} eventType - Type of change ('rename' or 'change')
 */

/**
 * Monitors a directory for file changes using glob patterns to filter events.
 *
 * Configure with include/exclude patterns to watch specific files. The watcher
 * must be started with start() and should be stopped with stop() when no longer
 * needed to release the file system handle.
 *
 * @extends EventEmitter
 * @emits FileWatcher#change - Emits a FileChangeEvent when a matching file changes
 * @emits FileWatcher#error - Emits a WrappedError when the underlying fs.watch fails
 */
export default class FileWatcher extends EventEmitter {

    /**
     * The underlying fs.FSWatcher instance, null when stopped
     * @type {fs.FSWatcher|null}
     */
    #watcher = null;

    /**
     * Compiled include glob matchers
     * @type {Minimatch[]}
     */
    #includeMatchers = [];

    /**
     * Compiled exclude glob matchers
     * @type {Minimatch[]}
     */
    #excludeMatchers = [];

    /**
     * Creates a new FileWatcher instance configured with directory and glob patterns.
     * @param {Object} options - Watcher configuration
     * @param {string} options.directory - Directory path to watch
     * @param {boolean} [options.recursive=true] - Whether to watch subdirectories
     * @param {string[]} [options.includePatterns] - Glob patterns for files to include
     * @param {string[]} [options.excludePatterns] - Glob patterns for files to exclude
     */
    constructor(options) {
        super();

        const {
            directory,
            recursive,
            includePatterns,
            excludePatterns,
        } = options || {};

        if (!isNonEmptyString(directory)) {
            throw new AssertionError('FileWatcher directory must be a non-empty string');
        }

        // Build include pattern matchers
        if (includePatterns) {
            if (!Array.isArray(includePatterns)) {
                throw new AssertionError('FileWatcher includePatterns must be an Array');
            }

            for (const pattern of includePatterns) {
                if (!isNonEmptyString(pattern)) {
                    throw new AssertionError('FileWatcher pattern must be a non-empty string');
                }
            }

            this.#includeMatchers = includePatterns.map((pattern) => {
                return new Minimatch(pattern, {
                    // Match dotfiles (e.g., `a/**/b` matches `a/.d/b`)
                    dot: true,
                });
            });
        }

        // Build exclude pattern matchers
        if (excludePatterns) {
            if (!Array.isArray(excludePatterns)) {
                throw new AssertionError('FileWatcher excludePatterns must be an Array');
            }

            for (const pattern of excludePatterns) {
                if (!isNonEmptyString(pattern)) {
                    throw new AssertionError('FileWatcher pattern must be a non-empty string');
                }
            }

            this.#excludeMatchers = excludePatterns.map((pattern) => {
                return new Minimatch(pattern, {
                    // Match dotfiles (e.g., `a/**/b` matches `a/.d/b`)
                    dot: true,
                });
            });
        }

        Object.defineProperties(this, {
            /**
             * The directory being watched
             * @name directory
             * @type {string}
             * @readonly
             */
            directory: {
                enumerable: true,
                value: path.resolve(directory),
            },
            /**
             * Whether to watch recursively. Defaults to true.
             * @name recursive
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
     * Starts watching the directory for file changes.
     *
     * After calling start(), the watcher emits 'change' events for matching files.
     * Call stop() to release the file system handle when done.
     *
     * @public
     * @throws {AssertionError} When the watcher is already started
     */
    start() {
        if (this.#watcher) {
            throw new AssertionError('FileWatcher is already started', null, this.start);
        }

        const { directory, recursive } = this;

        try {
            this.#watcher = fs.watch(directory, { recursive }, (eventType, filename) => {
                // Only emit for files matching include patterns but not exclude patterns
                if (this.#filenameMatchesIncluded(filename) && !this.#filenameMatchesExcluded(filename)) {
                    const filepath = path.join(directory, filename);

                    this.emit('change', {
                        filename,
                        filepath,
                        eventType,
                    });
                }
            });
        } catch (error) {
            // Silently ignore if the directory doesn't exist
            if (error.code === 'ENOENT') {
                return;
            }
            throw error;
        }

        if (this.#watcher) {
            this.#watcher.on('error', (cause) => {
                this.emit('error', new WrappedError('FileWatcher error event', { cause }));
            });
        }
    }

    /**
     * Stops watching and releases the file system handle.
     *
     * Safe to call multiple times or when the watcher is not started.
     * @public
     */
    stop() {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
    }

    /**
     * Tests if a filename matches any of the include patterns.
     * @param {string} filename - Relative filename to test
     * @returns {boolean} True if no include patterns specified, or filename matches at least one
     */
    #filenameMatchesIncluded(filename) {
        // No include patterns means include everything
        if (this.#includeMatchers.length === 0) {
            return true;
        }
        for (const glob of this.#includeMatchers) {
            if (glob.match(filename)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Tests if a filename matches any of the exclude patterns.
     * @param {string} filename - Relative filename to test
     * @returns {boolean} True if filename matches at least one exclude pattern
     */
    #filenameMatchesExcluded(filename) {
        for (const glob of this.#excludeMatchers) {
            if (glob.match(filename)) {
                return true;
            }
        }
        return false;
    }
}
