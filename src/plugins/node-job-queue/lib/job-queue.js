import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import JobStateStore from '../../../kixx/jobs/job-state-store.js';
import JobRunner from '../../../kixx/jobs/job-runner.js';
import { validateJobRegistry } from '../../../kixx/jobs/job-registry.js';
import { resolveEnqueue } from '../../../kixx/jobs/enqueue-options.js';
import { createSqliteExecutor } from './sqlite-executor.js';
import {
    AssertionError,
    assert,
    assertFunction,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';


// How long a write waits for another process's lock before SQLite raises
// SQLITE_BUSY. The devserver briefly overlaps two app processes on one file.
const BUSY_TIMEOUT_MS = 5000;


/**
 * Node.js SQLite-backed JobQueue service with an in-process runner loop.
 *
 * All queue semantics live in the shared JobStateStore and JobRunner; this
 * adapter supplies the SQLite file, the loop, and lifecycle. The loop runs one
 * pass at a time: a pass keeps filling slots while work is due, and when a
 * pass finds nothing the loop waits a fixed polling interval. There is no
 * enqueue nudge, so newly due work on an idle loop waits up to one interval.
 *
 * @implements {import('../../../kixx/jobs/job-queue-interface.js').JobQueueInterface}
 */
export default class JobQueue {

    #logger;
    #path;
    #sqliteOptions;
    #enabled;
    #pollIntervalMs;
    #concurrency;
    #drainTimeoutMs;
    #retention;
    #createContext;

    #database = null;
    #store = null;
    #runner = null;
    #registry = new Map();
    #isReconciled = false;
    #isClosed = false;

    #isStopping = false;
    #loopPromise = null;
    #sleepTimer = null;
    #wakeSleep = null;

    /**
     * @param {Object} options
     * @param {Object} options.logger
     * @param {string} options.path - Resolved SQLite file path.
     * @param {boolean} options.enabled - When false, jobs are recorded but never run.
     * @param {number} options.pollIntervalSeconds - Idle wait between passes.
     * @param {number} options.concurrency - Maximum jobs running at once.
     * @param {number} options.drainTimeoutSeconds - Longest stop() waits for in-flight jobs.
     * @param {import('../../../kixx/jobs/job-state-store.js').JobRetention} options.retention
     * @param {function(Object): Object} options.createContext - Builds a handler context from a claimed job.
     * @param {Object} [options.sqliteOptions] - Forwarded to the `DatabaseSync` constructor.
     */
    constructor(options) {
        const {
            logger,
            path: filepath,
            enabled,
            pollIntervalSeconds,
            concurrency,
            drainTimeoutSeconds,
            retention,
            createContext,
            sqliteOptions = {},
        } = options ?? {};

        assert(logger, 'JobQueue requires a logger');
        assertNonEmptyString(filepath, 'JobQueue options.path');
        assertFunction(createContext, 'JobQueue options.createContext');

        this.#logger = logger;
        this.#path = filepath;
        this.#sqliteOptions = sqliteOptions;
        this.#enabled = enabled === true;
        this.#pollIntervalMs = pollIntervalSeconds * 1000;
        this.#concurrency = concurrency;
        this.#drainTimeoutMs = drainTimeoutSeconds * 1000;
        this.#retention = retention;
        this.#createContext = createContext;
    }

    /**
     * Installs the job registry. Called once from `app.register()`.
     * @param {Map} registry - Unvalidated application registry.
     * @throws {AssertionError} When the registry is invalid.
     */
    setRegistry(registry) {
        this.#registry = validateJobRegistry(registry);
        this.#runner = null;
        this.#isReconciled = false;
    }

    /**
     * Records a job to run as soon as possible, at `runAt`, or after `delaySeconds`.
     * @param {Object} _context - Request or job context; unused by this adapter.
     * @param {string} name - Registered job name.
     * @param {*} payload - JSON-serializable payload.
     * @param {import('../../../kixx/jobs/job-queue-interface.js').JobEnqueueOptions} [options]
     * @returns {Promise<import('../../../kixx/jobs/job-queue-interface.js').JobEnqueueResult>}
     */
    async enqueue(_context, name, payload, options) {
        const now = new Date();
        const { entry, runAt, key } = resolveEnqueue(this.#registry, name, options, now);

        return this.#getStore().enqueue(now, {
            name,
            payload,
            runAt,
            key,
            maxAttempts: entry.maxAttempts,
        });
    }

    async get(_context, id) {
        return this.#getStore().get(id);
    }

    async list(_context, options) {
        return this.#getStore().list(options);
    }

    async retry(_context, id) {
        return this.#getStore().retry(new Date(), id);
    }

    async listSchedules(_context) {
        return this.#getStore().listSchedules();
    }

    /**
     * Migrates, reconciles schedules, and starts the runner loop. A no-op when
     * the queue is disabled or already started.
     * @param {Object} options
     * @param {function(Error): void} options.onUnexpectedError - Called once with the first unexpected job error;
     *   the loop has stopped by then. The caller owns the fatal-error policy.
     */
    start(options) {
        const { onUnexpectedError } = options ?? {};

        assertFunction(onUnexpectedError, 'JobQueue#start() options.onUnexpectedError');

        if (!this.#enabled) {
            this.#logger.info('Job queue is disabled; jobs are recorded but not run');
            return;
        }

        if (this.#loopPromise) {
            return;
        }

        this.#prepare(new Date());
        this.#isStopping = false;
        this.#loopPromise = this.#loop(onUnexpectedError);
        this.#logger.info('Job queue started', { concurrency: this.#concurrency });
    }

    /**
     * Stops claiming new jobs and waits for in-flight jobs, up to the drain
     * timeout. A job still running after that keeps its lease and is retried
     * once the lease expires.
     * @returns {Promise<void>}
     */
    async stop() {
        this.#isStopping = true;
        this.#wakeSleep?.();

        const loopPromise = this.#loopPromise;

        if (!loopPromise) {
            return;
        }

        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => {
                this.#logger.warn('Job queue drain timed out; in-flight jobs will be retried after their lease expires');
                resolve();
            }, this.#drainTimeoutMs);
        });

        await Promise.race([ loopPromise, timeout ]);
        clearTimeout(timer);
        this.#loopPromise = null;
    }

    /**
     * Runs one runner pass: due schedules, then due jobs until none is claimable.
     * Used by the loop and by tests. A no-op when the queue is disabled.
     * @param {Object} [options]
     * @param {(Date|function(): Date)} [options.now] - Clock override for tests.
     * @returns {Promise<{ran: number, unexpectedError: (Error|null)}>}
     */
    async processDueJobs(options) {
        const { now } = options ?? {};

        if (!this.#enabled) {
            return { ran: 0, unexpectedError: null };
        }

        let clock;

        if (now instanceof Date) {
            clock = () => now;
        } else if (typeof now === 'function') {
            clock = now;
        }

        this.#prepare(clock ? clock() : new Date());

        return this.#getRunner().runDueJobs({
            now: clock,
            createContext: this.#createContext,
            shouldStop: () => this.#isStopping,
        });
    }

    /**
     * Closes the database. Idempotent. Call stop() first to drain in-flight jobs.
     */
    close() {
        if (this.#isClosed) {
            return;
        }

        this.#isClosed = true;
        this.#isStopping = true;
        this.#wakeSleep?.();
        this.#database?.close();
        this.#database = null;
        this.#store = null;
        this.#runner = null;
    }

    async #loop(onUnexpectedError) {
        while (!this.#isStopping) {
            let result;

            try {
                result = await this.processDueJobs();
            } catch (error) {
                // The runner reports job failures in its result; a throw here
                // means the queue itself (the database) is broken.
                this.#logger.error('Job queue pass failed', null, error);
                onUnexpectedError(error);
                return;
            }

            if (result.unexpectedError) {
                onUnexpectedError(result.unexpectedError);
                return;
            }

            // A pass that ran jobs may have made more work due (chained jobs).
            if (result.ran === 0) {
                await this.#sleep(this.#pollIntervalMs);
            }
        }
    }

    #sleep(ms) {
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(this.#sleepTimer);
                this.#sleepTimer = null;
                this.#wakeSleep = null;
                resolve();
            };

            this.#wakeSleep = done;
            this.#sleepTimer = setTimeout(done, ms);
            this.#sleepTimer.unref();
        });
    }

    #getStore() {
        if (this.#isClosed) {
            throw new AssertionError('JobQueue has been closed');
        }

        if (!this.#store) {
            if (this.#path !== ':memory:') {
                fs.mkdirSync(path.dirname(this.#path), { recursive: true });
            }

            this.#database = new DatabaseSync(this.#path, this.#sqliteOptions);

            // WAL lets readers proceed during a write; the busy timeout makes a
            // contended writer from another process retry rather than fail.
            this.#database.exec('PRAGMA journal_mode = WAL');
            this.#database.exec(`PRAGMA busy_timeout = ${ BUSY_TIMEOUT_MS }`);

            this.#store = new JobStateStore({
                sql: createSqliteExecutor(this.#database),
                logger: this.#logger,
            });
            this.#store.migrate();
        }

        return this.#store;
    }

    // Reconciles declared schedules into the store once per registry.
    #prepare(now) {
        const store = this.#getStore();

        if (!this.#isReconciled) {
            store.reconcileSchedules(now, this.#registry);
            this.#isReconciled = true;
        }
    }

    #getRunner() {
        if (!this.#runner) {
            this.#runner = new JobRunner({
                store: this.#getStore(),
                registry: this.#registry,
                logger: this.#logger,
                concurrency: this.#concurrency,
                retention: this.#retention,
            });
        }

        return this.#runner;
    }
}
