/**
 * Node.js log adapter that emits structured JSON to process streams.
 * @module LoggerWriter
 */

import process from 'node:process';
import {
    createJSONLogEntry,
    stringifyJSONLogEntry,
} from '../../../../logger/json-log-entry-serializer.js';

/**
 * Node-specific implementation of the Logger writer interface. Serializes each
 * log entry to a single-line JSON object, writing DEBUG and INFO entries to
 * stdout and WARN and ERROR entries to stderr.
 *
 * Node stream writes are invoked synchronously, but Node may buffer output after
 * `write()` returns; this adapter does not wait for drain events.
 *
 * @implements {import('../../../../logger/logger-writer-interface.js').LoggerWriterInterface}
 */
export default class LoggerWriter {

    #stdout = null;
    #stderr = null;

    /**
     * @param {Object} [options]
     * @param {Object} [options.stdout] - Receives DEBUG and INFO lines through
     *   its `write` method. Defaults to `process.stdout`.
     * @param {Object} [options.stderr] - Receives WARN and ERROR lines through
     *   its `write` method. Defaults to `process.stderr`.
     */
    constructor(options) {
        const { stdout, stderr } = options ?? {};

        this.#stdout = stdout ?? null;
        this.#stderr = stderr ?? null;
    }

    /**
     * Serializes a log entry to JSON and writes it to the Node output stream.
     * @param {string} name - Logger name
     * @param {number} levelCode - Numeric severity constant from `Logger.LEVELS`
     * @param {string} level - Human-readable level name (e.g., `'INFO'`)
     * @param {string} message - Primary log message
     * @param {*} [info] - Optional supplementary data
     * @param {Error} [error] - Optional error object
     */
    write(name, levelCode, level, message, info, error) {
        const now = new Date();
        const entry = createJSONLogEntry({
            timestamp: now.toISOString(),
            levelCode,
            level,
            name,
            message,
            info,
            error,
        });

        const stream = this.#getOutputStream(level);

        // The LoggerWriterInterface is synchronous; Node may still buffer the
        // physical write after this stream handoff returns.
        stream.write(`${ stringifyJSONLogEntry(entry) }\n`);
    }

    #getOutputStream(level) {
        // Without an injected stream, read the process stream on every write.
        // Node.js creates each one the first time it is read, so reading them
        // in the constructor would open both before anything is logged.
        if (level === 'WARN' || level === 'ERROR') {
            return this.#stderr ?? process.stderr;
        }

        return this.#stdout ?? process.stdout;
    }
}
