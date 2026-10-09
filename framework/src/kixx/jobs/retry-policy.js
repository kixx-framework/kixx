import { OperationalError } from '../errors/mod.js';
import { assert } from '../assertions/mod.js';


const BASE_DELAY_MS = 10 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;


/**
 * Decides what a failed handler attempt means for the job, following
 * `src/docs/server-error-handling.md`.
 *
 * - `'unexpected'`: not an expected error, so a bug. The job fails immediately
 *   without retry and the platform's fatal-error policy runs.
 * - `'retryable'`: an expected error worth retrying with backoff.
 * - `'terminal'`: an expected error retrying cannot fix. The job fails.
 *
 * An explicit boolean `error.retryable` wins. Otherwise `OperationalError`
 * (I/O, integration, storage) is retryable and every other expected class
 * (validation, not found, conflict) is terminal.
 * @param {*} error - Whatever the handler threw.
 * @returns {('retryable'|'terminal'|'unexpected')}
 */
export function classifyError(error) {
    if (error?.expected !== true) {
        return 'unexpected';
    }

    if (typeof error.retryable === 'boolean') {
        return error.retryable ? 'retryable' : 'terminal';
    }

    return error instanceof OperationalError ? 'retryable' : 'terminal';
}

/**
 * Computes the delay before the next attempt using exponential backoff with
 * full jitter: a uniform random value in `[0, min(1h, 10s * 2^(attempt - 1)))`.
 * Jitter spreads retries so a shared outage does not produce a thundering herd.
 * @param {number} attempt - The attempt that just failed, starting at 1.
 * @param {function(): number} [random=Math.random] - Returns a number in `[0, 1)`; injectable for tests.
 * @returns {number} Delay in milliseconds.
 */
export function nextRetryDelayMs(attempt, random = Math.random) {
    assert(Number.isInteger(attempt) && attempt >= 1, 'nextRetryDelayMs() attempt must be an integer >= 1');

    // The exponent is clamped so very large attempt counts cannot overflow to
    // Infinity before the cap is applied.
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** Math.min(attempt - 1, 20)));

    return Math.floor(random() * ceiling);
}
