/**
 * Cloudflare Workers log adapter that emits structured JSON via the console.
 * @module LoggerWriter
 */

import {
    createJSONLogEntry,
    stringifyJSONLogEntry,
} from '../../../kixx/logger/json-log-entry-serializer.js';

/**
 * Cloudflare-specific implementation of the Logger writer interface. Serializes
 * each log entry to a single-line JSON object and writes it to the console at
 * the matching severity method. Cloudflare captures these console calls and
 * makes them available in Workers Logs and Tail Workers.
 *
 * @implements {import('../../logger/logger-writer-interface.js').LoggerWriterInterface}
 */
export default class LoggerWriter {

    /**
     * Serializes a log entry to JSON and writes it to the console.
     * @param {string} name - Logger name
     * @param {number} level - Numeric severity constant from `Logger.LEVELS`
     * @param {string} levelName - Human-readable level name (e.g., `'INFO'`)
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional supplementary data
     * @param {Error} [error] - Optional error object
     */
    write(name, level, levelName, message, info, error) {
        const entry = createJSONLogEntry({
            levelName,
            level,
            name,
            message,
            info,
            error,
        });

        const consoleLevelKey = levelName.toLowerCase();
        // eslint-disable-next-line no-console
        console[consoleLevelKey](stringifyJSONLogEntry(entry));
    }
}
