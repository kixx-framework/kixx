/**
 * Times one traced operation and logs its outcome and duration.
 * @module TraceLogger
 */

/**
 * Measures a single span, from construction until `ok()` or `error()` is
 * called, and writes one INFO entry with the message `trace <span>`.
 *
 * The entry's info object is a copy of the construction-time `info` with
 * `status` (`'ok'` or `'error'`) and `duration` (milliseconds, rounded to the
 * nearest 0.1) added. Call exactly one of `ok()` or `error()` per instance;
 * each call logs another entry, measured from the same start time.
 *
 * @example
 * const trace = new TraceLogger(context.logger, 'kv-store-get', { key });
 * try {
 *     const value = await kv.get(key);
 *     trace.ok();
 *     return value;
 * } catch (error) {
 *     trace.error();
 *     throw error;
 * }
 */
export default class TraceLogger {

    #logger;
    #message;
    #info;
    #startTime;

    /**
     * @param {import('./logger.js').default} logger - Logger that receives the trace entry
     * @param {string} span - Operation name appended to the `trace` message
     * @param {Object} [info] - Fields included in the trace entry; copied, not mutated
     */
    constructor(logger, span, info) {
        this.#logger = logger;
        this.#message = `trace ${ span }`;
        this.#info = info;
        this.#startTime = performance.now();
    }

    /**
     * Logs the span as completed successfully.
     * @returns {void}
     */
    ok() {
        this.#logger.info(this.#message, this.#getEndInfo('ok'));
    }

    /**
     * Logs the span as failed. Logged at INFO level; the caller remains
     * responsible for reporting or rethrowing the error itself.
     * @returns {void}
     */
    error() {
        this.#logger.info(this.#message, this.#getEndInfo('error'));
    }

    #getEndInfo(status) {
        const duration = Math.round((performance.now() - this.#startTime) * 10) / 10;
        return Object.assign({}, this.#info || {}, { status, duration });
    }
}
