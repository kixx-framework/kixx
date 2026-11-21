/**
 * Times one traced operation and logs its outcome and duration.
 * @module TraceLogger
 */

/**
 * Measures a single span, from construction until `ok()` or `error()` is
 * called, and writes one INFO entry with the message `trace <span>`.
 *
 * The entry's info object merges construction-time `info` with optional
 * completion-time `info`, whose fields take precedence. Neither input is
 * mutated. Logger-generated `status` (`'ok'` or `'error'`) and `duration`
 * (milliseconds, rounded to the nearest 0.1) override both inputs.
 * Call exactly one of `ok()` or `error()` per instance;
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
     * @param {Object} [info] - Fields merged over constructor info; copied, not mutated
     * @returns {void}
     */
    ok(info) {
        this.#logger.info(this.#message, this.#getEndInfo('ok', info));
    }

    /**
     * Logs the span as failed. Logged at INFO level; the caller remains
     * responsible for reporting or rethrowing the error itself.
     * @param {Object} [info] - Fields merged over constructor info; copied, not mutated
     * @returns {void}
     */
    error(info) {
        this.#logger.info(this.#message, this.#getEndInfo('error', info));
    }

    #getEndInfo(status, info) {
        const duration = Math.round((performance.now() - this.#startTime) * 10) / 10;
        return Object.assign({}, this.#info || {}, info || {}, { status, duration });
    }
}
