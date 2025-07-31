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

/*
Logging features:

- Multilevel logging (DEBUG, INFO, WARN, ERROR).
- Create named child loggers which inherit the name, logging mode, and level from the parent.
- Dynamically change the log level or logging mode after the logger is created.

Supports 4 levels of logging:

| Level Name | Level Integer | Supported Methods |
|------------|---------------|-------------------|
| DEBUG      | 10            | debug()           |
| INFO       | 20            | info()            |
| WARN       | 30            | warn()            |
| ERROR      | 40            | error()           |
*/

/**
 * @fileoverview
 * Logger module providing multilevel logging (DEBUG, INFO, WARN, ERROR) with support for:
 * - Named child loggers inheriting parent configuration.
 * - Dynamic log level and mode changes.
 * - Console and stdout logging modes, plus silent mode for testing.
 *
 * @module Logger
 */

/**
 * Logging levels with integer values.
 * @readonly
 * @enum {number}
 */
const LEVELS = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
});

/**
 * Array of level string names.
 * @type {readonly string[]}
 */
const LEVELS_NAMES = Object.freeze(Object.keys(LEVELS));

/**
 * Array of level integer values.
 * @type {readonly number[]}
 */
const LEVELS_INTEGERS = Object.freeze(LEVELS_NAMES.map((key) => LEVELS[key]));

// Create a Map of level integers as keys to string names as values.
const LEVELS_INTEGERS_MAP = Object.freeze(LEVELS_NAMES.reduce((map, nameKey) => {
    const intKey = LEVELS[nameKey];
    map.set(intKey, nameKey);
    return map;
}, new Map()));

/**
 * Logging output modes.
 * @readonly
 * @enum {string}
 */
const MODES = Object.freeze({
    /** Console logging for development. */
    CONSOLE: 'console',
    /** Stdout logging for production. */
    STDOUT: 'stdout',
    /** Silent mode disables logging. */
    SILENT: 'silent',
});

/**
 * Array of accepted logging modes.
 * @type {readonly string[]}
 */
const ACCEPTED_MODES = Object.freeze(Object.values(MODES));

/**
 * Logger class supporting multilevel, multimode logging and child loggers.
 */
export default class Logger {
    /** @type {number} */
    #levelInteger = LEVELS.INFO;
    /** @type {string} */
    #mode = 'stdout';
    /** @type {Set<Logger>} */
    #children = new Set();

    /**
     * Create a new Logger instance.
     * @param {Object} [options]
     * @param {string} options.name - Logger name (required).
     * @param {string|number} [options.level] - Initial log level (string or integer).
     * @param {string} [options.mode] - Initial log mode.
     * @throws {Error} If name is not provided or not a string.
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
     * Get the current log level as a string.
     * @returns {string}
     */
    get level() {
        return LEVELS_INTEGERS_MAP.get(this.#levelInteger);
    }

    /**
     * Set the log level by string or integer.
     *
     * Possible level values:
     *
     * | Level Name | Level Integer |
     * |------------|--------------|
     * | 'DEBUG'    | 10           |
     * | 'INFO'     | 20           |
     * | 'WARN'     | 30           |
     * | 'ERROR'    | 40           |
     *
     * @param {string|number} level
     * @throws {Error} If level is invalid.
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
     * Get the current logging mode.
     * @returns {string}
     */
    get mode() {
        return this.#mode;
    }

    /**
     * Set the logging mode.
     *
     * Possible mode values:
     *
     * | Mode Name | Description                        |
     * |-----------|------------------------------------|
     * | 'console' | Console logging for development    |
     * | 'stdout'  | Stdout logging for production      |
     * | 'silent'  | Silent mode disables logging       |
     *
     * @param {string} mode
     * @throws {Error} If mode is invalid.
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
     * Create a child logger with a derived name.
     * @param {string} name - Child logger name.
     * @returns {Logger}
     * @throws {Error} If name is not a string.
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
     * Log a DEBUG level message.
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
     */
    debug(message, info, error) {
        if (this.#levelInteger <= LEVELS.DEBUG) {
            this.printMessage(LEVELS.DEBUG, message, info, error);
        }
    }

    /**
     * Log an INFO level message.
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
     */
    info(message, info, error) {
        if (this.#levelInteger <= LEVELS.INFO) {
            this.printMessage(LEVELS.INFO, message, info, error);
        }
    }

    /**
     * Log a WARN level message.
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
     */
    warn(message, info, error) {
        if (this.#levelInteger <= LEVELS.WARN) {
            this.printMessage(LEVELS.WARN, message, info, error);
        }
    }

    /**
     * Log an ERROR level message.
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
     */
    error(message, info, error) {
        if (this.#levelInteger <= LEVELS.ERROR) {
            this.printMessage(LEVELS.ERROR, message, info, error);
        }
    }

    /**
     * Print a log message according to the current mode.
     * @param {number} intLevel
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
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
     * Print a log message to the console.
     * @param {number} intLevel
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
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
     * Print a log message to stdout.
     * @param {number} intLevel
     * @param {string} message
     * @param {*} [info]
     * @param {Error} [error]
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

/**
 * Attach static LEVELS and MODES to Logger.
 */
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
 * Get the current time as a human-readable string (HH:mm:ss.SSS).
 * @returns {string}
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
 * Format an Error object for logging.
 * @param {Error} error
 * @returns {{name: string, code: string, message: string, stack: string}}
 */
function formatError(error) {
    const name = error.name || '[NO_NAME]';
    const code = error.code || '[NO_CODE]';
    const message = error.message || '[NO_MESSAGE]';
    const stack = error.stack || '[NO_STACK]';

    return { name, code, message, stack };
}

/**
 * Pad a number to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function padNumber2(n) {
    return ('00' + n).slice(-2);
}

/**
 * Pad a number to 3 digits.
 * @param {number} n
 * @returns {string}
 */
function padNumber3(n) {
    return ('000' + n).slice(-3);
}
