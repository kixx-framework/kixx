import EventEmitter from 'node:events';
import JobQueueEngine from './job-queue-engine.js';
import Job from './job.js';

import {
    isNumberNotNaN,
    assertNonEmptyString,
    assertFunction
} from '../assertions/mod.js';


/**
 * @fileoverview High-level job queue with event-driven API and lifecycle management
 *
 * The JobQueue class provides an event-driven API for scheduling, executing, and
 * managing asynchronous jobs using a file-backed queue. It wraps the JobQueueEngine
 * with additional features like event propagation, pre-start job queuing, and
 * simplified lifecycle management.
 *
 * Core Features:
 *   - Register custom job handlers by method name
 *   - Schedule jobs for immediate or deferred execution
 *   - Queue jobs before starting the queue
 *   - Event-driven architecture with EventEmitter inheritance
 *   - Safe disposal and resource cleanup
 */
export default class JobQueue extends EventEmitter {

    /**
     * @private
     * @type {boolean}
     * Indicates if the queue has been disposed and cannot accept new operations
     */
    #disposed = false;

    /**
     * @private
     * @type {boolean}
     * Indicates if the queue has been started and is processing jobs
     */
    #started = false;

    /**
     * @private
     * @type {JobQueueEngine|null}
     * The underlying job queue engine that handles persistence and execution
     */
    #engine = null;

    /**
     * @private
     * @type {Array<Job>}
     * Jobs scheduled before the queue was started, waiting to be submitted to the engine
     */
    #queuedJobsBeforeStart = [];

    /**
     * Creates a new JobQueue instance
     *
     * @param {Object} options - Configuration options
     * @param {string} options.directory - Directory path where job files will be stored
     * @param {number} [options.maxConcurrency] - Maximum number of concurrent jobs to run
     * @param {JobQueueEngine} [options.engine] - Pre-configured engine instance for testing
     * @throws {AssertionError} When directory is not a non-empty string
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
     * Indicates if the queue has been started and is processing jobs
     * @returns {boolean} True if the queue is started and processing jobs
     */
    get started() {
        return this.#started;
    }

    /**
     * Registers a handler function for jobs with a specific method name
     *
     * @param {string} methodName - The name of the job method to handle
     * @param {Function} handler - The async function to handle jobs with this method name
     * @returns {JobQueue} This instance for method chaining
     * @throws {AssertionError} When methodName is not a non-empty string
     * @throws {AssertionError} When handler is not a function
     */
    registerJobHandler(methodName, handler) {
        assertNonEmptyString(methodName);
        assertFunction(handler);
        this.#engine.registerJobHandler(methodName, handler);
        return this;
    }

    /**
     * Starts processing jobs in the queue
     *
     * Submits any jobs that were scheduled before the queue was started to the engine
     * and begins processing the job queue. Jobs will be executed according to their
     * execution dates and concurrency limits.
     *
     * @param {Object} [options] - Start options
     * @param {number} [options.delay] - Delay in milliseconds before starting the first job
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
     * Schedules a job for execution
     *
     * If the queue is not started, the job is queued until start() is called.
     * If the queue is started, the job is immediately submitted to the engine.
     * Returns a deep clone of the job to prevent mutation of the internal job instance.
     *
     * @async
     * @param {Object|Job} job - The job specification or Job instance
     * @returns {Promise<Job|false>} A deep clone of the scheduled job, or false if disposed
     * @throws {Error} When the job method name is not registered
     * @throws {AssertionError} When the job specification is invalid
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
     * Removes all jobs with the specified method name from the queue
     *
     * Deletes all jobs that match the given method name from both the queue
     * and persistent storage. This operation cannot be undone.
     *
     * @async
     * @param {string} methodName - The job method name to remove
     * @returns {Promise<void>} Resolves when all matching jobs are removed
     */
    async removeJobsByMethodName(methodName) {
        const allJobs = await this.#engine.getAllJobs();
        const jobsToRemove = allJobs.filter((job) => job.methodName === methodName);

        await Promise.all(jobsToRemove.map((job) => this.#engine.deleteJob(job)));
    }

    /**
     * Disposes the queue and underlying engine
     *
     * Stops processing new jobs, cleans up resources, and prevents further
     * job scheduling. Should be called before application shutdown to avoid
     * memory leaks and ensure proper cleanup.
     *
     * @returns {JobQueue} This instance for method chaining
     */
    dispose() {
        this.#disposed = true;
        this.#engine.dispose();
        return this;
    }

    /**
     * Internal event listener for propagating engine events to JobQueue consumers
     *
     * @private
     * @param {string} eventName - The event name from the engine
     * @param {Object} event - The event payload from the engine
     */
    #engineEventListener(eventName, event) {
        this.emit(eventName, event);
    }
}
