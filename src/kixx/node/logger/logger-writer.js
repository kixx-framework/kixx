/**
 * Node.js log adapter that emits structured JSON to process streams.
 * @module LoggerWriter
 */

import process from 'node:process';
import {
    createJSONLogEntry,
    stringifyJSONLogEntry,
} from '../../logger/json-log-entry-serializer.js';

/**
 * Node-specific implementation of the Logger writer interface. Serializes each
 * log entry to a single-line JSON object, writing DEBUG and INFO entries to
 * stdout and WARN and ERROR entries to stderr.
 *
 * Node stream writes are invoked synchronously, but Node may buffer output after
 * `write()` returns; this adapter does not wait for drain events.
 *
 * @implements {import('../../logger/logger-writer-interface.js').LoggerWriterInterface}
 */
export default class LoggerWriter {

    /**
     * Serializes a log entry to JSON and writes it to the Node output stream.
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

        const stream = getOutputStream(levelName);

        // The LoggerWriterInterface is synchronous; Node may still buffer the
        // physical write after this stream handoff returns.
        stream.write(`${ stringifyJSONLogEntry(entry) }\n`);
    }
}

function getOutputStream(levelName) {
    if (levelName === 'WARN' || levelName === 'ERROR') {
        return process.stderr;
    }

    return process.stdout;
}
