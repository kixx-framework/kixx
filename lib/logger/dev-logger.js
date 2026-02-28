import process from 'node:process';
import { isUndefined } from '../assertions.js';
import BaseLogger, { LEVELS, LEVELS_INTEGERS_MAP } from './base-logger.js';

/**
 * Development console logger with configurable levels, child loggers, and colored output.
 */
export default class DevLogger extends BaseLogger {

    /**
     * Formats and writes a log entry to stdout. ANSI color (yellow for WARN, red for ERROR)
     * is applied only to the timestamp and level prefix — not to the message body.
     * @param {number} level - Numeric level constant from BaseLogger.LEVELS
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    printMessage(level, message, info, error) {
        const time = this.#getCurrentHumanDateTimeString();
        const levelString = LEVELS_INTEGERS_MAP.get(level).padEnd(5);
        const infoString = isUndefined(info) ? '' : JSON.stringify(info);

        // ANSI escape codes: 33 = yellow (WARN), 31 = red (ERROR), 0 = reset
        let prefix = `${ time } [${ levelString }]`;
        if (level === LEVELS.WARN) {
            prefix = `\x1b[33m${ prefix }\x1b[0m`;
        } else if (level === LEVELS.ERROR) {
            prefix = `\x1b[31m${ prefix }\x1b[0m`;
        }

        let messageString = `${ prefix } ${ this.name } ${ message }`;
        if (infoString) {
            messageString += ` ${ infoString }`;
        }

        process.stdout.write(messageString + '\n');

        if (error) {
            // eslint-disable-next-line no-console
            console.error(error);
        }
    }

    /**
     * Formats the current time as HH:mm:ss.SSS for console log output.
     * @returns {string} Time string with millisecond precision
     */
    #getCurrentHumanDateTimeString() {
        const d = new Date();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        const mseconds = String(d.getMilliseconds()).padStart(3, '0');
        return `${ hours }:${ minutes }:${ seconds }.${ mseconds }`;
    }
}
