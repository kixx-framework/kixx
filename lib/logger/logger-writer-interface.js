/**
 * LoggerWriterInterface — the contract for a pluggable output adapter passed
 * to Logger at construction time. Implement this interface to redirect log
 * output to any destination: a file, a remote log aggregator, a test spy, etc.
 *
 * When no writer is supplied, Logger formats entries itself and writes to the
 * built-in console. Supplying a writer transfers full control of formatting
 * and routing to the adapter — the Logger will not write to the console.
 *
 * ## Invariants
 * - `write` MUST be a function; Logger validates this at construction and
 *   throws an `AssertionError` when it is absent or not callable
 * - `write` is called synchronously on every accepted log entry (i.e., entries
 *   at or above the Logger's current level threshold); the adapter is
 *   responsible for any buffering or async I/O it needs
 * - A single writer instance is shared by a Logger and every descendant created
 *   through `createChild()`, so one adapter receives entries from multiple
 *   loggers; use the `name` argument to distinguish their sources
 * - `level` is always one of the emitted level constants (10, 20, 30, 40); the
 *   threshold-only `NONE` value (100) is never passed to `write`
 * - `info` and `error` are passed through exactly as the caller supplied them
 *   and may be `undefined`; the adapter MUST handle both absent and present
 *   values without throwing
 * - The adapter MUST NOT mutate `info` or `error` — they may be shared
 *   references from application code
 * - `write` SHOULD NOT throw; an exception propagates out of the logging call
 *   into the application code that emitted the log entry
 */

/**
 * Pluggable output adapter for Logger.
 *
 * @typedef {Object} LoggerWriterInterface
 *
 * @property {function(string, number, string, string, *, Error|undefined): void} write
 *   Called by Logger for every log entry that passes the severity threshold.
 *   Responsible for formatting, buffering, and routing the entry to its
 *   destination.
 *
 *   Parameters:
 *   - `name`      {string}           — Logger name, e.g. `'App:RequestHandler'`
 *   - `level`     {number}           — Numeric severity constant from `Logger.LEVELS`
 *                                      (10 = DEBUG, 20 = INFO, 30 = WARN, 40 = ERROR)
 *   - `levelName` {string}           — Human-readable level name matching `level`
 *                                      (e.g., `'INFO'`)
 *   - `message`   {string}           — Primary log message supplied by the caller
 *   - `info`      {*}                — Optional supplementary data; `undefined`
 *                                      when the caller omitted it
 *   - `error`     {Error|undefined}  — Optional error object; `undefined` when
 *                                      the caller omitted it
 */
