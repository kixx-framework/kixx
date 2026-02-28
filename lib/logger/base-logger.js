import {
    assertNonEmptyString,
    isNonEmptyString
} from '../assertions.js';

/**
 * Logging levels mapped to integer values for severity comparison.
 * @readonly
 * @enum {number}
 */
const LEVELS = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
});

// Level names in definition order for validation and reverse lookup
const LEVELS_NAMES = Object.freeze(Object.keys(LEVELS));

// Level integer values for setter validation
const LEVELS_INTEGERS = Object.freeze(LEVELS_NAMES.map((key) => LEVELS[key]));

// Map of level integers to string names for reverse lookup
const LEVELS_INTEGERS_MAP = Object.freeze(LEVELS_NAMES.reduce((map, nameKey) => {
    const intKey = LEVELS[nameKey];
    map.set(intKey, nameKey);
    return map;
}, new Map()));

export { LEVELS, LEVELS_INTEGERS_MAP };

/**
 * Base class providing shared log level management and dispatch for logger implementations.
 * Subclasses implement printMessage() to define the output format.
 */
export default class BaseLogger {

    /**
     * Logging level constants for configuring logger severity thresholds.
     * @public
     * @type {{DEBUG: number, INFO: number, WARN: number, ERROR: number}}
     */
    static LEVELS = LEVELS;

    /** @type {number} */
    #levelInteger = LEVELS.INFO;

    /** @type {Set<BaseLogger>} */
    #children = new Set();

    /**
     * Logger identifier included in each log entry.
     * @name name
     * @public
     * @type {string}
     */

    /**
     * @param {Object} options - Logger configuration options
     * @param {string} options.name - Logger identifier used in log output
     * @param {string|number} [options.level] - Initial log level as string ('DEBUG', 'INFO', 'WARN', 'ERROR') or integer (10, 20, 30, 40)
     * @throws {AssertionError} When name is missing, empty, or not a string
     */
    constructor(options) {
        const { name, level } = options || {};

        assertNonEmptyString(name, 'A logger must be provided with a name');

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
     * Gets the current log level as a string ('DEBUG', 'INFO', 'WARN', or 'ERROR').
     * @public
     * @returns {string} Current log level name
     */
    get level() {
        return LEVELS_INTEGERS_MAP.get(this.#levelInteger);
    }

    /**
     * Sets the log level, propagating the change to all child loggers.
     *
     * Accepts either a level name string (case-insensitive) or integer value:
     * - 'DEBUG' or 10: Log all messages
     * - 'INFO' or 20: Log INFO, WARN, and ERROR messages
     * - 'WARN' or 30: Log WARN and ERROR messages only
     * - 'ERROR' or 40: Log ERROR messages only
     * @public
     * @param {string|number} level - Level name or integer value
     * @throws {Error} When level is not a valid level name or integer
     */
    set level(level) {
        if (isNonEmptyString(level)) {
            const upperLevel = level.toUpperCase();
            if (!LEVELS_NAMES.includes(upperLevel)) {
                throw new Error(`Logger:set level : "${ level }" is an invalid level name`);
            }
            this.#levelInteger = LEVELS[upperLevel];
        } else {
            if (!LEVELS_INTEGERS.includes(level)) {
                throw new Error(`Logger:set level : ${ level } is an invalid level integer`);
            }
            this.#levelInteger = level;
        }

        for (const logger of this.#children) {
            logger.level = level;
        }
    }

    /**
     * Creates a child logger that inherits level from this logger.
     *
     * Child name is derived by appending to the parent name with a colon separator.
     * For example, if parent name is 'app' and child name is 'database', the child's
     * full name becomes 'app:database'. Changes to parent log level automatically
     * propagate to all children.
     * @public
     * @param {string} name - Suffix to append to parent logger name
     * @returns {BaseLogger} New child logger instance of the same concrete type
     * @throws {Error} When name is empty or not a string
     */
    createChild(name) {
        assertNonEmptyString(name, 'Logger:createChild(name) name: must be a string');

        const logger = new this.constructor({
            name: `${ this.name }:${ name }`,
            level: this.#levelInteger,
        });

        this.#children.add(logger);

        return logger;
    }

    /**
     * Logs a DEBUG level message for detailed diagnostic information.
     * @public
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    debug(message, info, error) {
        if (this.#levelInteger <= LEVELS.DEBUG) {
            this.printMessage(LEVELS.DEBUG, message, info, error);
        }
    }

    /**
     * Logs an INFO level message for general informational events.
     * @public
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    info(message, info, error) {
        if (this.#levelInteger <= LEVELS.INFO) {
            this.printMessage(LEVELS.INFO, message, info, error);
        }
    }

    /**
     * Logs a WARN level message for potentially problematic situations.
     * @public
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    warn(message, info, error) {
        if (this.#levelInteger <= LEVELS.WARN) {
            this.printMessage(LEVELS.WARN, message, info, error);
        }
    }

    /**
     * Logs an ERROR level message for error events that require attention.
     * @public
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    error(message, info, error) {
        if (this.#levelInteger <= LEVELS.ERROR) {
            this.printMessage(LEVELS.ERROR, message, info, error);
        }
    }

    /**
     * Formats and writes a single log entry. Implemented by subclasses to define the output format.
     * @param {number} level - Numeric level constant from BaseLogger.LEVELS
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    printMessage(level, message, info, error) { // eslint-disable-line no-unused-vars
    }
}
