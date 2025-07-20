import EventEmitter from 'node:events';
import JobQueueEngine from './job-queue-engine.js';
import Job from './job.js';

import {
    isNumberNotNaN,
    assertNonEmptyString,
    assertFunction
} from '../assertions/mod.js';


/**
 * JobQueue
 * ========
 *
 * The JobQueue class provides a high-level, event-driven API for scheduling, executing,
 * and managing asynchronous jobs using a file-backed queue. It wraps a JobQueueEngine
 * and exposes a simple interface for registering job handlers, scheduling jobs,
 * starting the queue, and disposing resources.
 *
 * Core Features:
 *   - Register custom job handlers by method name
 *   - Schedule jobs for immediate or deferred execution
 *   - Supports queuing jobs before the queue is started
 *   - Emits events for job lifecycle and errors (inherits from EventEmitter)
 *   - Safe disposal and resource cleanup
 *
 * Usage Example:
 *   const queue = new JobQueue({ directory: '/jobs', maxConcurrency: 2 });
 *   queue.registerJobHandler('sendEmail', async (params) => { ... });
 *   await queue.scheduleJob({ methodName: 'sendEmail', params: { ... }, executionDate: new Date() });
 *   queue.start();
 *
 * Events:
 *   - 'error': Emitted when an error occurs in job scheduling or execution
 *   - Custom events as emitted by the underlying JobQueueEngine
 */
export default class JobQueue extends EventEmitter {

    /**
     * @private
     * @type {boolean}
     * Indicates if the queue has been disposed.
     */
    #disposed = false;

    /**
     * @private
     * @type {boolean}
     * Indicates if the queue has been started.
     */
    #started = false;

    /**
     * @private
     * @type {JobQueueEngine|null}
     * The underlying job queue engine instance.
     */
    #engine = null;

    /**
     * @private
     * @type {Array<Job>}
     * Jobs queued before the queue is started.
     */
    #queuedJobsBeforeStart = [];

    /**
     * Create a new JobQueue instance.
     *
     * @param {Object} options - Configuration options.
     * @param {string} options.directory - Directory path where job files will be stored.
     * @param {number} [options.maxConcurrency] - Maximum number of concurrent jobs to run.
     * @param {JobQueueEngine} [options.engine] - Optional pre-configured engine instance.
     * @throws {AssertionError} If directory is not a non-empty string.
     */
    constructor(options = {}) {
        super();

        const eventListener = this.#engineEventListener.bind(this);

        // Compose engine options, injecting the event listener for event propagation.
        const engineOptions = Object.assign({}, options, { eventListener });

        // Allow injection of a custom engine for testing/mocking.
        this.#engine = options.engine || new JobQueueEngine(engineOptions);
    }

    /**
     * Indicates if the queue has been started.
     * @returns {boolean}
     */
    get started() {
        return this.#started;
    }

    /**
     * Register a handler function for a job method name.
     *
     * @param {string} methodName - The name of the job method to handle.
     * @param {Function} handler - The function to handle jobs with this method name.
     * @returns {JobQueue} Returns this instance for chaining.
     * @throws {AssertionError} If methodName is not a non-empty string.
     * @throws {AssertionError} If handler is not a function.
     */
    registerJobHandler(methodName, handler) {
        assertNonEmptyString(methodName);
        assertFunction(handler);
        this.#engine.registerJobHandler(methodName, handler);
        return this;
    }

    /**
     * Start processing jobs in the queue.
     * Any jobs scheduled before start() are submitted to the engine.
     *
     * @param {Object} [options]
     * @param {number} [options.delay] - Optional delay (ms) before starting the first job.
     */
    start(options = {}) {
        const { delay } = options;

        this.#started = true;

        const queuedJobs = this.#queuedJobsBeforeStart;

        // Schedule all jobs that were queued before start.
        while (queuedJobs.length > 0) {
            const job = queuedJobs.pop();

            this.#engine.scheduleJob(job).catch((error) => {
                this.emit('error', {
                    message: 'Error scheduling Job at start',
                    cause: error,
                });
            });
        }

        // Start the next job, optionally after a delay.
        if (isNumberNotNaN(delay)) {
            setTimeout(() => {
                this.#engine.startNextJob().catch((error) => {
                    this.emit('error', {
                        message: 'Error starting JobQueue',
                        cause: error,
                    });
                });
            }, delay);
        } else {
            this.#engine.startNextJob().catch((error) => {
                this.emit('error', {
                    message: 'Error starting JobQueue',
                    cause: error,
                });
            });
        }
    }

    /**
     * Schedule a job for execution.
     * If the queue is not started, the job is queued until start() is called.
     *
     * @param {Object|Job} job - The job specification or Job instance.
     * @returns {Promise<Job|false>} A clone of the scheduled job, or false if disposed.
     * @throws {Error} If the job method name is not registered.
     * @throws {AssertionError} If the job spec is invalid.
     */
    async scheduleJob(job) {
        if (this.#disposed) {
            return false;
        }

        // Will throw an AssertionError if the job spec is invalid.
        job = Job.fromSpec(job);

        if (!this.#engine.hasJobHandler(job.methodName)) {
            throw new Error(`The job method name "${ job.methodName }" is not registered`);
        }

        if (this.#started) {
            job = await this.#engine.scheduleJob(job);
        } else {
            this.#queuedJobsBeforeStart.push(job);
        }

        // Return a clone so the caller cannot mutate the canonical job instance.
        return structuredClone(job);
    }

    /**
     * Remove all jobs with the specified method name from the queue.
     *
     * @param {string} methodName - The job method name to remove.
     * @returns {Promise<void>}
     */
    async removeJobsByMethodName(methodName) {
        const allJobs = await this.#engine.getAllJobs();
        const jobsToRemove = allJobs.filter((job) => job.methodName === methodName);

        await Promise.all(jobsToRemove.map((job) => this.#engine.deleteJob(job)));
    }

    /**
     * Dispose the queue and underlying engine, preventing further job scheduling.
     *
     * @returns {JobQueue} Returns this instance for chaining.
     */
    dispose() {
        this.#disposed = true;
        this.#engine.dispose();
        return this;
    }

    /**
     * Internal event listener for propagating engine events to JobQueue consumers.
     *
     * @private
     * @param {string} eventName - The event name.
     * @param {Object} event - The event payload.
     */
    #engineEventListener(eventName, event) {
        this.emit(eventName, event);
    }
}
