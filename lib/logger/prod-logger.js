import { isUndefined } from '../assertions.js';
import BaseLogger, { LEVELS_INTEGERS_MAP } from './base-logger.js';

/**
 * Production JSON logger that writes newline-delimited JSON to stdout.
 *
 * Each log entry is emitted as a single JSON line containing the timestamp,
 * level, logger name, message, and optional structured data. Designed for
 * machine consumption — no color codes or human-oriented formatting.
 */
export default class ProdLogger extends BaseLogger {

    /**
     * Serializes a log entry as a JSON line and writes it via the injected printWriter.
     * @param {number} level - Numeric level constant from BaseLogger.LEVELS
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional additional data
     * @param {Error} [error] - Optional error object
     */
    printMessage(level, message, info, error) {
        const entry = {
            time: new Date().toISOString(),
            level: LEVELS_INTEGERS_MAP.get(level),
            levelInt: level,
            name: this.name,
            message,
        };

        if (!isUndefined(info)) {
            entry.info = info;
        }

        if (!isUndefined(error)) {
            entry.error = this.#serializeError(error);
        }

        this.printWriter(JSON.stringify(entry) + '\n');
    }

    /**
     * Serializes an Error into a plain object suitable for JSON output.
     * Returns non-Error values unchanged for compatibility.
     * @param {Error|*} error - Error to serialize, or any value (returned as-is)
     * @returns {Object} Plain object with name, code, message, stack, and enumerable own properties
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
