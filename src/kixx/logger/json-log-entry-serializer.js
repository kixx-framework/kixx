/**
 * Shared JSON serialization helpers for structured logger adapters.
 * @module JsonLogEntrySerializer
 */

import {
    isFunction,
    isObjectNotNull,
    isUndefined,
} from '../assertions/mod.js';

const BIGINT_TAG = '[object BigInt]';
const CIRCULAR_ERROR_CAUSE = '[CIRCULAR_ERROR_CAUSE]';
const CIRCULAR_REFERENCE = '[CIRCULAR_REFERENCE]';
const SYMBOL_TAG = '[object Symbol]';
const UNSERIALIZABLE_LOG_ENTRY = '[UNSERIALIZABLE_LOG_ENTRY]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE_VALUE]';
const UNSTRINGIFIABLE_VALUE = '[UNSTRINGIFIABLE_VALUE]';
const protoToString = Object.prototype.toString;

/**
 * Builds the structured JSON log entry shared by platform logger writers.
 * @param {Object} options - Log entry options
 * @param {string} options.timestamp - ISO 8601 timestamp for the log event
 * @param {string} options.name - Logger name
 * @param {number} options.level - Numeric severity constant from `Logger.LEVELS`
 * @param {string} options.levelName - Human-readable level name
 * @param {string} options.message - Primary log message
 * @param {*} [options.info] - Optional supplementary data
 * @param {Error} [options.error] - Optional error object
 * @returns {Object} Structured log entry
 */
export function createJSONLogEntry(options) {
    const {
        timestamp,
        name,
        level,
        levelName,
        message,
        info,
        error,
    } = options ?? {};

    const entry = {
        timestamp,
        levelName,
        level,
        name,
        message,
    };

    if (!isUndefined(info)) {
        entry.info = info;
    }

    if (!isUndefined(error)) {
        entry.error = serializeLogError(error, new WeakSet());
    }

    return entry;
}

/**
 * Serializes a complete log entry without penalizing the common JSON-safe path.
 * @param {Object} entry - Structured log entry
 * @returns {string} JSON log line
 */
export function stringifyJSONLogEntry(entry) {
    try {
        return JSON.stringify(entry);
    } catch (error) {
        return stringifyJSONLogEntrySafely(entry, error);
    }
}

function stringifyJSONLogEntrySafely(entry, nativeError) {
    try {
        return JSON.stringify(makeJSONSafeValue(entry, new WeakSet()));
    } catch (safeError) {
        return JSON.stringify({
            timestamp: toSafeString(entry.timestamp),
            levelName: toSafeString(entry.levelName),
            level: makeJSONSafeValue(entry.level, new WeakSet()),
            name: toSafeString(entry.name),
            message: toSafeString(entry.message),
            info: UNSERIALIZABLE_LOG_ENTRY,
            nativeSerializationError: toSafeString(nativeError),
            fallbackSerializationError: toSafeString(safeError),
        });
    }
}

function makeJSONSafeValue(value, seenValues) {
    if (isBigInt(value)) {
        return value.toString();
    }

    if (isFunction(value) || isSymbol(value)) {
        return undefined;
    }

    if (value instanceof Error) {
        return makeJSONSafeValue(serializeLogError(value, new WeakSet()), seenValues);
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
            return makeJSONSafeArray(value, seenValues);
        }

        return makeJSONSafeObject(value, seenValues);
    } finally {
        seenValues.delete(value);
    }
}

function makeJSONSafeArray(value, seenValues) {
    const arr = [];

    for (let index = 0; index < value.length; index += 1) {
        try {
            arr[index] = makeJSONSafeValue(value[index], seenValues);
        } catch (error) {
            arr[index] = describeUnserializableValue(error);
        }
    }

    return arr;
}

function makeJSONSafeObject(value, seenValues) {
    let keys;

    try {
        keys = Object.keys(value);
    } catch (error) {
        return describeUnserializableValue(error);
    }

    const obj = {};

    for (const key of keys) {
        try {
            obj[key] = makeJSONSafeValue(value[key], seenValues);
        } catch (error) {
            obj[key] = describeUnserializableValue(error);
        }
    }

    return obj;
}

function describeUnserializableValue(error) {
    return `${ UNSERIALIZABLE_VALUE }: ${ toSafeString(error) }`;
}

function toSafeString(value) {
    if (value instanceof Error) {
        return `${ value.name || 'Error' }: ${ value.message || '[NO_ERROR_MESSAGE]' }`;
    }

    try {
        return String(value);
    } catch {
        return UNSTRINGIFIABLE_VALUE;
    }
}

function serializeLogError(error, seenErrors) {
    if (!(error instanceof Error)) {
        return error;
    }

    if (seenErrors.has(error)) {
        return CIRCULAR_ERROR_CAUSE;
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
        obj.cause = serializeLogError(error.cause, seenErrors);
    }

    // Include any additional enumerable own properties (e.g. type).
    for (const key of Object.keys(error)) {
        if (!(key in obj)) {
            const value = error[key];
            obj[key] = value instanceof Error
                ? serializeLogError(value, seenErrors)
                : value;
        }
    }

    // Add the stack last so it prints last in the JSON output.
    obj.stack = error.stack ? error.stack : '[NO_ERROR_STACK]';

    return obj;
}

function isBigInt(value) {
    return protoToString.call(value) === BIGINT_TAG;
}

function isSymbol(value) {
    return protoToString.call(value) === SYMBOL_TAG;
}
