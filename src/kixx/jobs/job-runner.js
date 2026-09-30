import { classifyError, nextRetryDelayMs } from './retry-policy.js';
import { DEFAULT_TIMEOUT_SECONDS } from './job-registry.js';
import { assert, assertFunction, isUndefined } from '../assertions/mod.js';


// Added to a job's timeout so a handler that aborts right at its timeout still
// has time to record its outcome before the lease expires.
const LEASE_MARGIN_MS = 30 * 1000;


/**
 * Runs claimed jobs through their registered handlers with a slot pool, a
 * soft deadline, per-job timeouts, and error classification. Platform
 * neutral: adapters supply the store, the clock, the deadline, and the
 * context factory, and decide what to do with an unexpected error.
 */
export default class JobRunner {

    #store;
    #registry;
    #logger;
    #concurrency;
    #retention;
    #random;

    /**
     * @param {Object} options
     * @param {import('./job-state-store.js').default} options.store
     * @param {Map<string, import('./job-registry.js').ResolvedJobEntry>} options.registry - Output of `validateJobRegistry()`.
     * @param {Object} options.logger
     * @param {number} options.concurrency - Maximum jobs running at once; a positive integer.
     * @param {import('./job-state-store.js').JobRetention} options.retention
     * @param {function(): number} [options.random=Math.random] - Backoff jitter source; injectable for tests.
     */
    constructor(options) {
        const { store, registry, logger, concurrency, retention, random = Math.random } = options ?? {};

        assert(store, 'JobRunner requires a store');
        assert(registry instanceof Map, 'JobRunner requires a registry Map');
        assert(logger, 'JobRunner requires a logger');
        assert(Number.isInteger(concurrency) && concurrency > 0, 'JobRunner concurrency must be a positive integer');
        assert(retention, 'JobRunner requires retention settings');

        this.#store = store;
        this.#registry = registry;
        this.#logger = logger;
        this.#concurrency = concurrency;
        this.#retention = retention;
        this.#random = random;
    }

    /**
     * Runs every job that is due, then returns.
     *
     * Materializes due schedules, then keeps up to `concurrency` jobs in
     * flight: whenever a job settles its slot is refilled at once rather than
     * waiting for a whole batch. Claiming stops when the deadline passes,
     * nothing more is claimable, or a handler raises an unexpected error.
     * In-flight jobs are always awaited, so the deadline bounds new work, not
     * running work. Retention purge runs last.
     * @param {Object} [options]
     * @param {function(): Date} [options.now] - Clock; a function so tests can advance time. Defaults to the system clock.
     * @param {Date} [options.deadline] - Stop claiming once `now()` reaches this time. No deadline when omitted.
     * @param {function(Object): Object} options.createContext - Builds the handler context from the claimed job record.
     * @returns {Promise<{ran: number, unexpectedError: (Error|null)}>} Jobs settled, and the first unexpected error if any.
     *   The caller owns the platform's fatal-error policy.
     */
    async runDueJobs(options) {
        const { now = () => new Date(), deadline, createContext } = options ?? {};

        assertFunction(createContext, 'JobRunner#runDueJobs() options.createContext');

        this.#store.materializeDueSchedules(now(), this.#registry);

        const inFlight = new Set();
        const result = { ran: 0, unexpectedError: null };

        const canClaim = () => {
            return result.unexpectedError === null
                && inFlight.size < this.#concurrency
                && (isUndefined(deadline) || now().getTime() < deadline.getTime());
        };

        for (;;) {
            while (canClaim()) {
                const claimed = this.#store.claimNext(now(), { leaseMs: (name) => this.#leaseMs(name) });

                if (!claimed) {
                    break;
                }

                const task = this.#runJob(claimed, now, createContext).then((unexpectedError) => {
                    inFlight.delete(task);
                    result.ran += 1;

                    // Keep the first one; later failures are still logged where they occur.
                    result.unexpectedError = result.unexpectedError ?? unexpectedError;
                });

                inFlight.add(task);
            }

            if (inFlight.size === 0) {
                break;
            }

            await Promise.race(inFlight);
        }

        if (result.unexpectedError === null) {
            this.#store.purgeExpired(now(), this.#retention);
        }

        return result;
    }

    #leaseMs(name) {
        const timeoutSeconds = this.#registry.get(name)?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
        return (timeoutSeconds * 1000) + LEASE_MARGIN_MS;
    }

    // Never rejects: resolves to the unexpected error, or null. A failure
    // outside the handler (a store write, for instance) is unexpected too.
    async #runJob(claimed, now, createContext) {
        const logInfo = { jobId: claimed.id, name: claimed.name, attempt: claimed.attempt };

        try {
            this.#logger.info('Job claimed', logInfo);

            const entry = this.#registry.get(claimed.name);

            // Deploy drift: the job was enqueued by a version that knew the name.
            if (!entry) {
                const error = { name: 'UnknownJob', message: `No job is registered under "${ claimed.name }"`, expected: true };

                this.#store.failTerminal(now(), claimed.id, claimed.claimToken, error);
                this.#logger.warn('Job failed; its name is not registered', logInfo);
                return null;
            }

            return await this.#runHandler(claimed, entry, now, createContext, logInfo);
        } catch (error) {
            this.#logger.error('Job runner failed unexpectedly', logInfo, error);
            return error;
        }
    }

    async #runHandler(claimed, entry, now, createContext, logInfo) {
        const controller = new AbortController();

        // Abort is cooperative: the handler is still awaited, and if it
        // ignores the signal and outlives its lease the outcome is discarded.
        const timer = setTimeout(() => {
            controller.abort(new DOMException(`Job timed out after ${ entry.timeoutSeconds }s`, 'TimeoutError'));
        }, entry.timeoutSeconds * 1000);

        const job = Object.freeze({
            id: claimed.id,
            name: claimed.name,
            payload: claimed.payload,
            attempt: claimed.attempt,
            maxAttempts: claimed.maxAttempts,
            scheduledFor: claimed.scheduledFor,
            signal: controller.signal,
        });

        try {
            await entry.handler(createContext(claimed), job);
        } catch (error) {
            return this.#recordFailure(claimed, error, now, logInfo);
        } finally {
            clearTimeout(timer);
        }

        // The claim token guards the write: false means the lease expired or
        // the job was reclaimed, so a newer attempt owns it now.
        if (this.#store.complete(now(), claimed.id, claimed.claimToken)) {
            this.#logger.info('Job completed', logInfo);
        } else {
            this.#logger.warn('Job finished after its claim expired; outcome discarded', logInfo);
        }

        return null;
    }

    #recordFailure(claimed, error, now, logInfo) {
        const kind = classifyError(error);
        const errorRecord = {
            name: error?.name ?? 'Error',
            message: error?.message ?? String(error),
            stack: error?.stack,
            expected: error?.expected === true,
        };

        const { id, claimToken } = claimed;

        let isApplied;
        let message;

        if (kind === 'retryable' && claimed.attempt < claimed.maxAttempts) {
            const delayMs = nextRetryDelayMs(claimed.attempt, this.#random);
            const retryAt = new Date(now().getTime() + delayMs);

            isApplied = this.#store.failAttempt(now(), id, claimToken, errorRecord, retryAt);
            message = 'Job attempt failed; retry scheduled';
            logInfo = { ...logInfo, retryAt: retryAt.toISOString() };
        } else {
            isApplied = this.#store.failTerminal(now(), id, claimToken, errorRecord);
            message = kind === 'retryable' ? 'Job failed; attempts exhausted' : 'Job failed';
        }

        if (!isApplied) {
            this.#logger.warn('Job failed after its claim expired; outcome discarded', logInfo, error);
        } else if (kind === 'unexpected') {
            this.#logger.error(message, logInfo, error);
        } else {
            this.#logger.warn(message, logInfo, error);
        }

        // An unexpected error is a bug whether or not this attempt still owned
        // the job, so it always reaches the platform's fatal-error policy.
        return kind === 'unexpected' ? error : null;
    }
}
