/*
The MIT License

Copyright (c) 2017 - 2025 Kris Walker (www.kriswalker.me).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import process from 'node:process';
import { EOL } from 'node:os';

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

// Array of level string names
const LEVELS_NAMES = Object.freeze(Object.keys(LEVELS));

// Array of level integer values
const LEVELS_INTEGERS = Object.freeze(LEVELS_NAMES.map((key) => LEVELS[key]));

// Map of level integers to string names for reverse lookup
const LEVELS_INTEGERS_MAP = Object.freeze(LEVELS_NAMES.reduce((map, nameKey) => {
    const intKey = LEVELS[nameKey];
    map.set(intKey, nameKey);
    return map;
}, new Map()));

/**
 * Logging output modes controlling where log messages are written.
 * @readonly
 * @enum {string}
 */
const MODES = Object.freeze({
    /** Human-readable console output for development */
    CONSOLE: 'console',
    /** Structured stdout output for production log aggregation */
    STDOUT: 'stdout',
    /** Disables all logging output */
    SILENT: 'silent',
});

// Array of valid logging mode values
const ACCEPTED_MODES = Object.freeze(Object.values(MODES));

/**
 * Multilevel logger with support for child loggers and multiple output modes.
 *
 * Supports four logging levels (DEBUG, INFO, WARN, ERROR) with dynamic level changes
 * that propagate to child loggers. Output can be formatted for console development,
 * structured production logging, or silenced for testing.
 * @public
 */
export default class Logger {

    /**
     * Logging level constants for configuring logger severity thresholds.
     * @public
     * @type {{DEBUG: number, INFO: number, WARN: number, ERROR: number}}
     */
    static LEVELS = LEVELS;

    /**
     * Logging mode constants for configuring logger output format.
     * @public
     * @type {{CONSOLE: string, STDOUT: string, SILENT: string}}
     */
    static MODES = MODES;

    /** @type {number} */
    #levelInteger = LEVELS.INFO;
    /** @type {string} */
    #mode = 'stdout';
    /** @type {Set<Logger>} */
    #children = new Set();

    /**
     * Creates a logger instance with the specified name and optional level and mode.
     * @param {Object} options - Logger configuration options
     * @param {string} options.name - Logger identifier used in log output
     * @param {string|number} [options.level] - Initial log level as string ('DEBUG', 'INFO', 'WARN', 'ERROR') or integer (10, 20, 30, 40)
     * @param {string} [options.mode='stdout'] - Output mode ('console', 'stdout', or 'silent')
     * @throws {Error} When name is not provided or not a string
     */
    constructor(options) {
        const { name, level, mode } = options || {};

        if (!name || typeof name !== 'string') {
            throw new Error('A logger must be provided with a name');
        }

        Object.defineProperty(this, 'name', {
            enumerable: true,
            value: name,
        });

        if (typeof level === 'string' || Number.isInteger(level)) {
            // Invoke `set level()` below.
            this.level = level;
        }

        if (mode && typeof mode === 'string') {
            // Invoke `set mode()` below.
            this.mode = mode;
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
        if (level && typeof level === 'string') {
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
     * Gets the current logging mode ('console', 'stdout', or 'silent').
     * @public
     * @returns {string} Current logging mode
     */
    get mode() {
        return this.#mode;
    }

    /**
     * Sets the logging mode, propagating the change to all child loggers.
     *
     * Available modes:
     * - 'console': Human-readable output for development with console.log()
     * - 'stdout': Structured JSON output for production log aggregation
     * - 'silent': Disables all log output (useful for testing)
     * @public
     * @param {string} mode - One of 'console', 'stdout', or 'silent'
     * @throws {Error} When mode is not a valid mode value
     */
    set mode(mode) {
        if (!ACCEPTED_MODES.includes(mode)) {
            throw new Error(`Logger:set mode : "${ mode }" is an invalid mode`);
        }

        this.#mode = mode;

        for (const logger of this.#children) {
            logger.mode = mode;
        }
    }

    /**
     * Creates a child logger that inherits level and mode from this logger.
     *
     * Child name is derived by appending to the parent name with a colon separator.
     * For example, if parent name is 'app' and child name is 'database', the child's
     * full name becomes 'app:database'. Changes to parent level or mode automatically
     * propagate to all children.
     * @public
     * @param {string} name - Suffix to append to parent logger name
     * @returns {Logger} New child logger instance
     * @throws {Error} When name is not a non-empty string
     */
    createChild(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Logger:createChild(name) name: must be a string');
        }

        const logger = new Logger({
            name: `${ this.name }:${ name }`,
            level: this.#levelInteger,
            mode: this.#mode,
        });

        this.#children.add(logger);

        return logger;
    }

    /**
     * Logs a DEBUG level message for detailed diagnostic information.
     * @public
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data (will be JSON serialized in stdout mode)
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
     * @param {*} [info] - Optional additional data (will be JSON serialized in stdout mode)
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
     * @param {*} [info] - Optional additional data (will be JSON serialized in stdout mode)
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
     * @param {*} [info] - Optional additional data (will be JSON serialized in stdout mode)
     * @param {Error} [error] - Optional error object
     */
    error(message, info, error) {
        if (this.#levelInteger <= LEVELS.ERROR) {
            this.printMessage(LEVELS.ERROR, message, info, error);
        }
    }

    /**
     * Routes the log message to the appropriate output method based on current mode.
     * @param {number} intLevel - Log level as integer value
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    printMessage(intLevel, message, info, error) {
        switch (this.#mode) {
            case MODES.CONSOLE:
                this.printConsoleMessage(intLevel, message, info, error);
                break;
            case MODES.STDOUT:
                this.printStdoutMessage(intLevel, message, info, error);
                break;
        }
    }

    /**
     * Outputs a human-readable log message to the console for development.
     * Format: HH:mm:ss.SSS LEVEL name message [- info] [- error]
     * @param {number} intLevel - Log level as integer value
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    printConsoleMessage(intLevel, message, info, error) {
        const datetime = getCurrentHumanDateTimeString();
        const { name } = this;
        // Convert the level integer to a padded string.
        const level = `${ LEVELS_INTEGERS_MAP.get(intLevel) } `.slice(0, 5);

        if (info && error) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', info, '-', error);
        } else if (info) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', info);
        } else if (error) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', error);
        } else {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message);
        }
    }

    /**
     * Outputs a structured log message to stdout for production log aggregation.
     * Format: ISO8601 - LEVEL - PID - name - message - infoJSON - errorJSON
     * @param {number} intLevel - Log level as integer value
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data (JSON serialized)
     * @param {Error} [error] - Optional error object (JSON serialized)
     */
    printStdoutMessage(intLevel, message, info, error) {
        const now = new Date();
        const datetime = now.toISOString();
        const { name } = this;
        const { pid } = process;
        // Convert the level integer to a padded string.
        const level = `${ LEVELS_INTEGERS_MAP.get(intLevel) } `.slice(0, 5);

        const infoString = info
            ? JSON.stringify(info)
            : 'null';

        const errorString = error
            ? JSON.stringify(formatError(error))
            : 'null';

        const line = [
            datetime,
            level,
            pid,
            name,
            message,
            infoString,
            errorString,
        ].join(' - ');

        process.stdout.write(line + EOL);
    }
}

// Attach static LEVELS and MODES constants to Logger class
Object.defineProperties(Logger, {
    LEVELS: {
        enumerable: true,
        value: LEVELS,
    },
    MODES: {
        enumerable: true,
        value: MODES,
    },
});

/**
 * Formats the current time as HH:mm:ss.SSS for console log output.
 * @returns {string} Time string with millisecond precision
 */
function getCurrentHumanDateTimeString() {
    const d = new Date();
    const hours = padNumber2(d.getHours());
    const minutes = padNumber2(d.getMinutes());
    const seconds = padNumber2(d.getSeconds());
    const mseconds = padNumber3(d.getMilliseconds());
    return `${ hours }:${ minutes }:${ seconds }.${ mseconds }`;
}

/**
 * Extracts error properties into a plain object for JSON serialization.
 * @param {Error} error - Error object to format
 * @returns {{name: string, code: string, message: string, stack: string}} Error properties with fallback values
 */
function formatError(error) {
    const name = error.name || '[NO_NAME]';
    const code = error.code || '[NO_CODE]';
    const message = error.message || '[NO_MESSAGE]';
    const stack = error.stack || '[NO_STACK]';

    return { name, code, message, stack };
}

/**
 * Zero-pads a number to 2 digits for time formatting.
 * @param {number} n - Number to pad
 * @returns {string} Two-digit string
 */
function padNumber2(n) {
    return ('00' + n).slice(-2);
}

/**
 * Zero-pads a number to 3 digits for millisecond formatting.
 * @param {number} n - Number to pad
 * @returns {string} Three-digit string
 */
function padNumber3(n) {
    return ('000' + n).slice(-3);
}
