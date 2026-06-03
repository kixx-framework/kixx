/**
 * Structured logger with severity filtering, child propagation, and pluggable output.
 * @module Logger
 */

import {
    AssertionError,
    assertNonEmptyString,
    assertFunction,
    isUndefined,
} from '../assertions/mod.js';

/**
 * Logging levels mapped to integer values for severity comparison. A logger
 * accepts an entry when its threshold is at or below the entry's level, so the
 * out-of-band NONE value silences every level.
 * @readonly
 * @enum {number}
 */
const LEVELS = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
    NONE: 100,
});

const LEVELS_NAMES = Object.freeze(Object.keys(LEVELS));

const LEVELS_INTEGERS = Object.freeze(LEVELS_NAMES.map((key) => LEVELS[key]));

/**
 * Reverse lookup from level integer to level name string (e.g., 20 → 'INFO').
 * @readonly
 * @type {Map<number, string>}
 */
const LEVELS_INTEGERS_MAP = Object.freeze(LEVELS_NAMES.reduce((map, nameKey) => {
    const intKey = LEVELS[nameKey];
    map.set(intKey, nameKey);
    return map;
}, new Map()));


/**
 * Filters log entries by severity and writes accepted messages to the console or a custom writer.
 */
export default class Logger {

    /**
     * Logging level constants for configuring logger severity thresholds. NONE
     * is a threshold-only sentinel that disables all output; it is never emitted
     * as the level of a log entry.
     * @type {{DEBUG: number, INFO: number, WARN: number, ERROR: number, NONE: number}}
     */
    static LEVELS = LEVELS;

    /**
     * Looks up the display name for a Logger.LEVELS integer.
     * @param {number} levelInteger - Integer level constant from Logger.LEVELS
     * @returns {string|undefined} Matching level name, or undefined when levelInteger is unknown
     */
    static getLevelNameFromInteger(levelInteger) {
        return LEVELS_INTEGERS_MAP.get(levelInteger);
    }

    #levelInteger = LEVELS.INFO;
    #children = new Set();
    #writer;
    #finalized = false;

    /**
     * Logger identifier included in each log entry.
     * @name name
     * @type {string}
     */

    /**
     * @param {Object} options - Logger configuration options
     * @param {string} options.name - Logger identifier used in log output
     * @param {import('./logger-writer-interface.js').LoggerWriterInterface} [options.writer] - Optional output adapter that replaces the built-in console formatter
     * @param {string|number} [options.level] - Initial log level as a name ('DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE') or integer (10, 20, 30, 40, 100). Defaults to 'INFO' when omitted.
     * @throws {AssertionError} When name is empty or not a string
     * @throws {AssertionError} When writer.write is not a function
     * @throws {AssertionError} When level is not a valid level name or integer
     */
    constructor(options) {
        const { name, level, writer } = options || {};

        assertNonEmptyString(name, 'A logger must be provided with a name');

        if (writer) {
            assertFunction(writer.write, 'A logger writer must have a write() method');
            this.#writer = writer;
        }

        Object.defineProperty(this, 'name', {
            enumerable: true,
            value: name,
        });

        if (typeof level === 'string' || Number.isInteger(level)) {
            // Assign through the setter rather than directly to #levelInteger so that
            // the value is validated and any already-registered children are updated.
            this.level = level;
        }
    }

    /**
     * Gets the current log level as a name ('DEBUG', 'INFO', 'WARN', 'ERROR', or 'NONE').
     * @returns {string} Current log level name
     */
    get level() {
        return LEVELS_INTEGERS_MAP.get(this.#levelInteger);
    }

    /**
     * Sets the minimum severity accepted by this logger and its descendants. The
     * new level cascades to every current child logger.
     * @param {string|number} level - Level name or integer value
     * @throws {AssertionError} When level is not a valid level name or integer
     */
    set level(level) {
        if (typeof level === 'string') {
            const upperLevel = level.toUpperCase();
            if (!LEVELS_NAMES.includes(upperLevel)) {
                throw new AssertionError(`Logger:set level : "${ level }" is an invalid level name`);
            }
            this.#levelInteger = LEVELS[upperLevel];
        } else if (Number.isInteger(level)) {
            if (!LEVELS_INTEGERS.includes(level)) {
                throw new AssertionError(`Logger:set level : ${ level } is an invalid level integer`);
            }
            this.#levelInteger = level;
        } else {
            throw new AssertionError(`Logger:set level : expected a level name or integer, got ${ level }`);
        }

        for (const logger of this.#children) {
            logger.level = level;
        }
    }

    /**
     * Creates a descendant logger using this logger's writer and current severity threshold.
     * @param {string} name - Suffix to append to parent logger name
     * @returns {Logger} New child logger instance of the same concrete type
     * @throws {AssertionError} When name is empty or not a string
     * @throws {Error} When this logger (or an ancestor) has been finalized
     */
    createChild(name) {
        assertNonEmptyString(name, 'Logger:createChild(name) name: must be a string');

        if (this.#finalized) {
            throw new Error('Logger:createChild() cannot add a child to a finalized logger');
        }

        // Preserve subclass behavior for applications that specialize formatting or routing.
        const logger = new this.constructor({
            name: `${ this.name }:${ name }`,
            level: this.#levelInteger,
            writer: this.#writer,
        });

        this.#children.add(logger);

        return logger;
    }

    /**
     * Prevents this logger and all current descendants from creating new child loggers.
     * @returns {Logger} this
     */
    finalize() {
        this.#finalized = true;
        for (const logger of this.#children) {
            logger.finalize();
        }
        return this;
    }

    /**
     * Logs a DEBUG level message for detailed diagnostic information.
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    debug(message, info, error) {
        if (this.#levelInteger <= LEVELS.DEBUG) {
            this.#printMessage(LEVELS.DEBUG, message, info, error);
        }
    }

    /**
     * Logs an INFO level message for general informational events.
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    info(message, info, error) {
        if (this.#levelInteger <= LEVELS.INFO) {
            this.#printMessage(LEVELS.INFO, message, info, error);
        }
    }

    /**
     * Logs a WARN level message for potentially problematic situations.
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    warn(message, info, error) {
        if (this.#levelInteger <= LEVELS.WARN) {
            this.#printMessage(LEVELS.WARN, message, info, error);
        }
    }

    /**
     * Logs an ERROR level message for error events that require attention.
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    error(message, info, error) {
        if (this.#levelInteger <= LEVELS.ERROR) {
            this.#printMessage(LEVELS.ERROR, message, info, error);
        }
    }

    /**
     * Writes an accepted log entry to the configured writer or the built-in console.
     * @param {number} level - Numeric level constant from Logger.LEVELS
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     * @returns {Logger} this
     */
    #printMessage(level, message, info, error) {
        if (this.#writer) {
            this.#writer.write(this.name, level, LEVELS_INTEGERS_MAP.get(level), message, info, error);
            return this;
        }

        const time = getCurrentHumanDateTimeString();
        const levelString = LEVELS_INTEGERS_MAP.get(level).padEnd(5);
        const messageString = `${ time } [${ levelString }] ${ this.name } ${ message }`;

        const consoleLevelKey = LEVELS_INTEGERS_MAP.get(level).toLowerCase();

        /* eslint-disable no-console */
        if (isUndefined(info)) {
            console[consoleLevelKey](messageString);
        } else {
            console[consoleLevelKey](messageString, info);
        }

        if (error) {
            console.error(error);
        }
        /* eslint-enable */

        return this;
    }
}

/**
 * Formats the current local time for console log prefixes.
 * @returns {string} Time formatted as HH:mm:ss.SSS
 */
function getCurrentHumanDateTimeString() {
    const d = new Date();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const mseconds = String(d.getMilliseconds()).padStart(3, '0');
    return `${ hours }:${ minutes }:${ seconds }.${ mseconds }`;
}
