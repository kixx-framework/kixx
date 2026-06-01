/**
 * Cloudflare Workers log adapter that emits structured JSON via the console.
 * @module LoggerWriter
 */

import { isUndefined } from '../../assertions/mod.js';

/**
 * Cloudflare-specific implementation of the Logger writer interface. Serializes
 * each log entry to a single-line JSON object and writes it to the console at
 * the matching severity method. Cloudflare captures these console calls and
 * makes them available in Workers Logs and Tail Workers.
 *
 * @implements {import('./logger-writer-interface.js').LoggerWriterInterface}
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
        const entry = {
            levelName,
            level,
            name,
            message,
        };

        if (!isUndefined(info)) {
            entry.info = info;
        }

        if (!isUndefined(error)) {
            entry.error = this.#serializeError(error);
        }

        const consoleLevelKey = levelName.toLowerCase();
        // eslint-disable-next-line no-console
        console[consoleLevelKey](JSON.stringify(entry));
    }

    /**
     * Converts an Error into a plain object for JSON serialization.
     * @param {*} error
     * @returns {Object|*} Plain object representation, or the original value if not an Error
     */
    #serializeError(error) {
        if (!(error instanceof Error)) {
            return error;
        }

        const obj = {
            name: error.name || '[NO_ERROR_NAME]',
            code: error.code || '[NO_ERROR_CODE]',
            message: error.message || '[NO_ERROR_MESSAGE]',
        };

        // Include any additional enumerable own properties (e.g. cause, type, etc.)
        for (const key of Object.keys(error)) {
            if (!(key in obj)) {
                obj[key] = error[key];
            }
        }

        // Add the stack last so it prints last in the JSON output.
        obj.stack = error.stack ? error.stack : '[NO_ERROR_STACK]';

        return obj;
    }
}
