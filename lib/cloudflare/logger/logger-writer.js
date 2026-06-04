/**
 * Cloudflare Workers log adapter that emits structured JSON via the console.
 * @module LoggerWriter
 */

import {
    isFunction,
    isObjectNotNull,
    isUndefined,
} from '../../assertions/mod.js';

const BIGINT_TAG = '[object BigInt]';
const CIRCULAR_REFERENCE = '[CIRCULAR_REFERENCE]';
const UNSERIALIZABLE_LOG_ENTRY = '[UNSERIALIZABLE_LOG_ENTRY]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE_VALUE]';
const UNSTRINGIFIABLE_VALUE = '[UNSTRINGIFIABLE_VALUE]';
const SYMBOL_TAG = '[object Symbol]';
const protoToString = Object.prototype.toString;

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
            entry.error = this.#serializeError(error, new WeakSet());
        }

        const consoleLevelKey = levelName.toLowerCase();
        // eslint-disable-next-line no-console
        console[consoleLevelKey](this.#stringifyEntry(entry));
    }

    /**
     * Serializes a complete log entry without penalizing the common JSON-safe path.
     * @param {Object} entry - Structured log entry
     * @returns {string} JSON log line
     */
    #stringifyEntry(entry) {
        try {
            return JSON.stringify(entry);
        } catch (error) {
            return this.#stringifyEntrySafely(entry, error);
        }
    }

    /**
     * Serializes values that native JSON cannot represent, with a minimal final fallback.
     * @param {Object} entry - Structured log entry
     * @param {*} nativeError - Error thrown by the native JSON.stringify call
     * @returns {string} JSON log line
     */
    #stringifyEntrySafely(entry, nativeError) {
        try {
            return JSON.stringify(this.#makeJSONSafeValue(entry, new WeakSet()));
        } catch (safeError) {
            return JSON.stringify({
                levelName: this.#toSafeString(entry.levelName),
                level: this.#makeJSONSafeValue(entry.level, new WeakSet()),
                name: this.#toSafeString(entry.name),
                message: this.#toSafeString(entry.message),
                info: UNSERIALIZABLE_LOG_ENTRY,
                nativeSerializationError: this.#toSafeString(nativeError),
                fallbackSerializationError: this.#toSafeString(safeError),
            });
        }
    }

    /**
     * Converts values into a JSON-compatible representation for fallback logging.
     * @param {*} value - Value to sanitize
     * @param {WeakSet<Object>} seenValues - Object references in the current traversal path
     * @returns {*} JSON-compatible value
     */
    #makeJSONSafeValue(value, seenValues) {
        if (isBigInt(value)) {
            return value.toString();
        }

        if (isFunction(value) || isSymbol(value)) {
            return undefined;
        }

        if (value instanceof Error) {
            return this.#makeJSONSafeValue(this.#serializeError(value, new WeakSet()), seenValues);
        }

        if (value instanceof Date) {
            return value.toJSON();
        }

        if (value instanceof URL) {
            return value.toJSON();
        }

        if (!isObjectNotNull(value)) {
            return value;
        }

        if (seenValues.has(value)) {
            return CIRCULAR_REFERENCE;
        }

        seenValues.add(value);

        try {
            if (Array.isArray(value)) {
                return this.#makeJSONSafeArray(value, seenValues);
            }

            return this.#makeJSONSafeObject(value, seenValues);
        } finally {
            seenValues.delete(value);
        }
    }

    /**
     * Converts an array into a JSON-compatible representation.
     * @param {Array} value - Array to sanitize
     * @param {WeakSet<Object>} seenValues - Object references in the current traversal path
     * @returns {Array} JSON-compatible array
     */
    #makeJSONSafeArray(value, seenValues) {
        const arr = [];

        for (let index = 0; index < value.length; index += 1) {
            try {
                arr[index] = this.#makeJSONSafeValue(value[index], seenValues);
            } catch (error) {
                arr[index] = this.#describeUnserializableValue(error);
            }
        }

        return arr;
    }

    /**
     * Converts an object into a JSON-compatible representation.
     * @param {Object} value - Object to sanitize
     * @param {WeakSet<Object>} seenValues - Object references in the current traversal path
     * @returns {Object|string} JSON-compatible object, or a placeholder when keys cannot be read
     */
    #makeJSONSafeObject(value, seenValues) {
        let keys;

        try {
            keys = Object.keys(value);
        } catch (error) {
            return this.#describeUnserializableValue(error);
        }

        const obj = {};

        for (const key of keys) {
            try {
                obj[key] = this.#makeJSONSafeValue(value[key], seenValues);
            } catch (error) {
                obj[key] = this.#describeUnserializableValue(error);
            }
        }

        return obj;
    }

    /**
     * Describes a value that could not be read safely during fallback serialization.
     * @param {*} error - Error or thrown value explaining why the value could not be read
     * @returns {string} Stable placeholder string
     */
    #describeUnserializableValue(error) {
        return `${ UNSERIALIZABLE_VALUE }: ${ this.#toSafeString(error) }`;
    }

    /**
     * Converts any value to a string without letting logging throw.
     * @param {*} value - Value to stringify
     * @returns {string} String representation
     */
    #toSafeString(value) {
        if (value instanceof Error) {
            return `${ value.name || 'Error' }: ${ value.message || '[NO_ERROR_MESSAGE]' }`;
        }

        try {
            return String(value);
        } catch {
            return UNSTRINGIFIABLE_VALUE;
        }
    }

    /**
     * Converts an Error into a plain object for JSON serialization.
     * @param {*} error
     * @param {WeakSet<Error>} seenErrors - Error objects already serialized in this chain
     * @returns {Object|*} Plain object representation, or the original value if not an Error
     */
    #serializeError(error, seenErrors) {
        if (!(error instanceof Error)) {
            return error;
        }

        if (seenErrors.has(error)) {
            return '[CIRCULAR_ERROR_CAUSE]';
        }

        seenErrors.add(error);

        const obj = {
            name: error.name || '[NO_ERROR_NAME]',
            code: error.code || '[NO_ERROR_CODE]',
            message: error.message || '[NO_ERROR_MESSAGE]',
        };

        // Error.cause is standardized as non-enumerable, so Object.keys(error)
        // will not pick it up alongside custom enumerable properties.
        if (!isUndefined(error.cause)) {
            obj.cause = this.#serializeError(error.cause, seenErrors);
        }

        // Include any additional enumerable own properties (e.g. type).
        for (const key of Object.keys(error)) {
            if (!(key in obj)) {
                const value = error[key];
                obj[key] = value instanceof Error
                    ? this.#serializeError(value, seenErrors)
                    : value;
            }
        }

        // Add the stack last so it prints last in the JSON output.
        obj.stack = error.stack ? error.stack : '[NO_ERROR_STACK]';

        return obj;
    }
}

function isBigInt(value) {
    return protoToString.call(value) === BIGINT_TAG;
}

function isSymbol(value) {
    return protoToString.call(value) === SYMBOL_TAG;
}
