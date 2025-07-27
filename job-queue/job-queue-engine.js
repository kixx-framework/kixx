/**
 * @fileoverview Job queue engine with file-backed persistence and concurrency control
 *
 * Provides a durable job queue that persists jobs as JSON files and supports
 * deferred execution, custom handlers, and safe concurrent processing.
 */

import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import LockingQueue from '../lib/locking-queue.js';
import Job from './job.js';

import {
    readJSONFile,
    writeJSONFile,
    readDirectory,
    removeFile
} from '../lib/file-system.js';

import {
    isFunction,
    isNumberNotNaN,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertFunction
} from '../assertions/mod.js';

/**
 * @typedef {Object} JobQueueEngineOptions
 * @property {string} directory - Directory path where job files will be stored
 * @property {number} [maxConcurrency=1] - Maximum number of concurrent jobs to run
 * @property {LockingQueue} [lockingQueue] - Custom locking queue instance for file operations
 * @property {Function} [eventListener] - Callback function to receive engine events (debug, error)
 */

/**
 * @typedef {('debug'|'error')} EventType
 */

/**
 * @typedef {Object} EngineEvent
 * @property {string} message - Event description
 * @property {Object} [info] - Additional event information
 * @property {Error} [cause] - Error that triggered the event (for error events)
 */

/**
 * File-backed job queue engine with concurrency control and persistence
 *
 * Schedules and executes jobs with support for deferred execution, custom handlers,
 * and crash recovery through file persistence. Jobs are stored as JSON files and
 * processed with configurable concurrency limits.
 *
 * @example
 * const engine = new JobQueueEngine({
 *   directory: '/jobs',
 *   maxConcurrency: 2,
 *   eventListener: (type, event) => console.log(type, event)
 * });
 * engine.registerJobHandler('sendEmail', async (params) => {
 *   await sendEmail(params.to, params.subject, params.body);
 * });
 * await engine.load();
 * await engine.scheduleJob(new Job({
 *   methodName: 'sendEmail',
 *   params: { to: 'user@example.com', subject: 'Hello', body: 'Message' }
 * }));
 */
export default class JobQueueEngine {
    /**
     * @private
     * @type {string|null}
     * Directory where job files are stored.
     */
    #directory = null;

    /**
     * @private
     * @type {Set<Job>}
     * Set of jobs currently in progress.
     */
    #inProgressJobs = new Set();

    /**
     * @private
     * @type {number}
     * Maximum number of concurrent jobs allowed.
     */
    #maxConcurrentJobs = 1;

    /**
     * @private
     * @type {boolean}
     * Indicates if the engine has been disposed.
     */
    #disposed = false;

    /**
     * @private
     * @type {Map<string, Function>}
     * Map of job method names to handler functions.
     */
    #jobHandlers = new Map();

    /**
     * @private
     * @type {Map<string, Timeout>}
     * Map of job IDs to scheduled setTimeout handles for deferred jobs.
     */
    #scheduledJobHandles = new Map();

    /**
     * @private
     * @type {LockingQueue}
     * Locking queue for safe concurrent file operations.
     */
    #lockingQueue = null;

    /**
     * @private
     * @type {Function}
     * Event listener callback for debug and error events.
     */
    #eventListener = null;

    /**
     * Create a new JobQueueEngine instance
     *
     * @param {JobQueueEngineOptions} [options] - Configuration options
     * @throws {AssertionError} When directory is not a non-empty string
     * @throws {AssertionError} When maxConcurrency is provided but not a valid number
     */
    constructor(options = {}) {
        assertNonEmptyString(options.directory);
        this.#directory = options.directory;

        if (isNumberNotNaN(options.maxConcurrency)) {
            this.setMaxConcurrency(options.maxConcurrency);
        }

        if (options.lockingQueue) {
            this.#lockingQueue = options.lockingQueue;
        } else {
            // Default locking queue prevents race conditions during concurrent
            // file operations (saves, deletes, reads) across multiple jobs
            this.#lockingQueue = new LockingQueue();
        }

        if (isFunction(options.eventListener)) {
            this.#eventListener = options.eventListener;
        } else {
            // No-op listener prevents null checks throughout the codebase
            this.#eventListener = () => {};
        }
    }

    /**
     * Indicates whether the engine has reached the maximum number of concurrent jobs
     *
     * @returns {boolean} True if at maximum concurrency, false otherwise
     */
    get hasReachedMaxConcurrency() {
        return this.#inProgressJobs.size >= this.#maxConcurrentJobs;
    }

    /**
     * Set the maximum number of concurrent jobs allowed
     *
     * @param {number} max - Maximum concurrent jobs (must be a positive number)
     * @throws {AssertionError} When max is not a valid number
     */
    setMaxConcurrency(max) {
        assertNumberNotNaN(max);
        this.#maxConcurrentJobs = max;
    }

    /**
     * Register a handler function for jobs with a specific method name
     *
     * @param {string} methodName - Method name that jobs will reference
     * @param {Function} handler - Async function to handle job execution
     * @example
     * engine.registerJobHandler('processOrder', async (orderData) => {
     *   await processOrder(orderData);
     * });
     */
    registerJobHandler(methodName, handler) {
        this.#jobHandlers.set(methodName, handler);
    }

    /**
     * Check if a handler is registered for the given method name
     *
     * @param {string} methodName - Method name to check
     * @returns {boolean} True if handler exists, false otherwise
     */
    hasJobHandler(methodName) {
        return this.#jobHandlers.has(methodName);
    }

    /**
     * Load all persisted jobs from disk and schedule them for execution
     *
     * @async
     * @returns {Promise<Array<Job>>} Array of loaded and scheduled jobs
     * @throws {WrappedError} When job directory cannot be read or jobs cannot be loaded
     */
    async load() {
        const jobs = await this.getAllJobs();

        // Schedule all persisted jobs concurrently - this allows deferred jobs
        // to set up their setTimeout handles without blocking other job scheduling
        const promises = jobs.map((job) => {
            return this.scheduleJob(job);
        });

        return Promise.all(promises);
    }

    /**
     * Schedule a job for execution based on its execution date
     *
     * Jobs ready for immediate execution will start if concurrency allows.
     * Deferred jobs will be scheduled to start at their execution time.
     *
     * @async
     * @param {Job} job - Job instance to schedule
     * @returns {Promise<Job|boolean>} The scheduled job or false if engine is disposed
     * @throws {Error} When job persistence fails
     */
    async scheduleJob(job) {
        // Check disposal state first to avoid unnecessary work
        if (this.#disposed) {
            return false;
        }

        // Persist job to disk before scheduling for crash recovery
        await this.saveJob(job);

        // Double-check disposal state after async operation
        // (engine could be disposed while we were saving)
        if (this.#disposed) {
            return false;
        }

        if (job.isReady()) {
            // Job can execute immediately - trigger the job processing loop
            this.startNextJob();
            return job;
        }

        // Job is deferred - schedule it using Node.js setTimeout
        // This leverages the event loop's timer phase for precise scheduling
        const milliseconds = job.getDeferredMilliseconds();
        const handle = setTimeout(this.startNextJob.bind(this), milliseconds);

        // Store handle for cleanup during disposal
        this.#scheduledJobHandles.set(job.id, handle);

        return job;
    }

    /**
     * Dispose the engine and clean up all resources
     *
     * Stops processing new jobs, clears scheduled timers, and prevents further execution.
     * Should be called before application shutdown to avoid memory leaks.
     */
    dispose() {
        // Set disposed flag first to prevent new operations
        this.#disposed = true;

        // Clean up all pending setTimeout handles to prevent memory leaks
        // and unwanted job execution after disposal
        for (const handle of this.#scheduledJobHandles.values()) {
            clearTimeout(handle);
        }

        this.#scheduledJobHandles.clear();
    }

    /**
     * Start the next available job if concurrency limits allow
     *
     * @async
     * @returns {Promise<Job|boolean>} Started job or false if no job was started
     */
    async startNextJob() {
        // Early exit conditions to avoid unnecessary work
        if (this.#disposed || this.hasReachedMaxConcurrency) {
            return false;
        }

        const job = await this.getOldestReadyJob();

        if (!job) {
            return false;
        }

        // Atomically transition job to IN_PROGRESS state with file persistence
        // This prevents other engine instances from picking up the same job
        await this.setJobStateInProgress(job);

        // Final disposal check after state change operation
        if (this.#disposed) {
            return false;
        }

        // CRITICAL: Do not await these operations - this allows the engine
        // to start multiple jobs concurrently up to maxConcurrency limit.
        // Each job runs independently and triggers the next job when complete.
        this.executeJob(job)
            .catch((cause) => {
                // Catch execution errors to prevent unhandled promise rejections
                this.#eventListener('error', {
                    message: 'error executing job',
                    info: { job: job.toSafeObject() },
                    cause,
                });
            })
            .then(() => {
                // Clean up completed job (success or failure)
                return this.completeJob(job);
            })
            .finally(() => {
                // Always attempt to start next job to maintain queue processing
                // This ensures the queue continues even if individual jobs fail
                return this.startNextJob();
            });

        return job;
    }

    /**
     * Execute a job by invoking its registered handler
     *
     * @private
     * @async
     * @param {Job} job - Job to execute
     * @returns {Promise<void>} Resolves when job completes (successfully or with failure)
     * @throws {AssertionError} When no handler is registered for the job's method name
     */
    async executeJob(job) {
        this.#eventListener('debug', {
            message: 'starting job',
            info: { job: job.toSafeObject() },
        });

        const handler = this.#jobHandlers.get(job.methodName);

        assertFunction(handler, `No job handler registered for job methodName "${ job.methodName }"`);

        const { params } = job;

        try {
            // Support both array parameters (spread) and single parameter patterns
            // This provides flexibility for different job handler signatures
            if (Array.isArray(params)) {
                await handler(...params);
            } else {
                await handler(params);
            }

            // Job completed successfully - update state for persistence
            job.setStateCompleted();
        } catch (error) {
            // Job failed - capture error state and notify via event listener
            job.setStateFailed(error);
            this.#eventListener('error', {
                message: 'error executing job',
                info: { job: job.toSafeObject() },
                cause: error,
            });
        }

        this.#eventListener('debug', {
            message: 'completed job',
            info: { job: job.toSafeObject() },
        });
    }

    /**
     * Get the oldest job that is ready for execution
     *
     * @async
     * @returns {Promise<Job|null>} Oldest ready job or null if none available
     * @throws {WrappedError} When job directory cannot be read or jobs cannot be loaded
     */
    async getOldestReadyJob() {
        const jobs = await this.getAllJobs();

        let oldestReadyJob = null;

        // Linear scan to find oldest ready job - this is acceptable because
        // job queues are typically small and this avoids complex indexing
        for (const job of jobs) {
            if (job.isReady() && (!oldestReadyJob || job.executionDate < oldestReadyJob.executionDate)) {
                oldestReadyJob = job;
            }
        }

        return oldestReadyJob;
    }

    /**
     * Atomically set a job's state to IN_PROGRESS and persist the change
     *
     * @private
     * @async
     * @param {Job} job - Job to mark as in progress
     * @returns {Promise<void>} Resolves when state change is persisted
     * @throws {Error} When job persistence fails
     */
    async setJobStateInProgress(job) {
        // Lock required to prevent race condition between state change and file write
        // Without this, multiple engine instances could pick up the same job
        await this.#lockingQueue.getLock();

        // Update both in-memory and persistent state atomically
        job.setStateInProgress();
        this.#inProgressJobs.add(job);
        await this.saveJob(job);

        this.#lockingQueue.releaseLock();
    }

    /**
     * Complete a job and remove it from queue and disk storage
     *
     * @private
     * @async
     * @param {Job} job - Job to complete and clean up
     * @returns {Promise<void>} Resolves when job is fully cleaned up
     */
    async completeJob(job) {
        // Remove from in-memory tracking first (even if file delete fails,
        // job won't be re-executed since it's no longer in progress)
        this.#inProgressJobs.delete(job);

        // Clean up persisted job file - completed/failed jobs are removed
        // to prevent accumulating old job files on disk
        await this.deleteJob(job);
    }

    /**
     * Persist a job to disk as a JSON file
     *
     * @private
     * @async
     * @param {Job} job - Job to save
     * @returns {Promise<void>} Resolves when job is written to disk
     * @throws {Error} When file write operation fails
     */
    async saveJob(job) {
        const filepath = this.getJobFilepath(job);

        // Lock prevents concurrent writes to the same job file
        // and ensures consistency during job state transitions
        await this.#lockingQueue.getLock();
        await writeJSONFile(filepath, job.toDatabaseRecord());
        this.#lockingQueue.releaseLock();
    }

    /**
     * Delete a job's file from disk storage
     *
     * @private
     * @async
     * @param {Job} job - Job whose file should be deleted
     * @returns {Promise<void>} Resolves when file is deleted
     */
    async deleteJob(job) {
        // Lock ensures file deletion doesn't conflict with concurrent reads/writes
        await this.#lockingQueue.getLock();
        await removeFile(this.getJobFilepath(job));
        this.#lockingQueue.releaseLock();
    }

    /**
     * Load all jobs from the queue directory
     *
     * @async
     * @returns {Promise<Array<Job>>} Array of all persisted jobs
     * @throws {WrappedError} When directory cannot be read or job files cannot be loaded
     */
    async getAllJobs() {
        const filepaths = await this.readJobQueueDirectory();

        // Load all job files concurrently for better performance
        // Individual file load errors will bubble up through Promise.all
        const jobs = await Promise.all(filepaths.map((filepath) => {
            return this.loadJobByFilepath(filepath);
        }));

        return jobs;
    }

    /**
     * Read the job queue directory and return all file paths
     *
     * @private
     * @async
     * @returns {Promise<Array<string>>} Array of file paths in the job directory
     * @throws {WrappedError} When the directory cannot be read
     */
    async readJobQueueDirectory() {
        try {
            const filepaths = await readDirectory(this.#directory);
            return filepaths;
        } catch (cause) {
            // Wrap filesystem errors with context for better debugging
            throw new WrappedError(
                `Unable to read job queue directory ${ this.#directory }`,
                { cause }
            );
        }
    }

    /**
     * Load a job from a specific file path
     *
     * @private
     * @async
     * @param {string} filepath - Path to the job file
     * @returns {Promise<Job>} Loaded job instance
     * @throws {WrappedError} When the job file cannot be loaded or parsed
     */
    async loadJobByFilepath(filepath) {
        try {
            const json = await readJSONFile(filepath);
            return new Job(json);
        } catch (cause) {
            // Wrap JSON parsing/file reading errors with context
            throw new WrappedError(`Unable to load job from ${ filepath }`, { cause });
        }
    }

    /**
     * Get the filesystem path for a job's persistence file
     *
     * @param {Job} job - Job to get file path for
     * @returns {string} Full file path where job data is stored
     */
    getJobFilepath(job) {
        // Use job.key (not job.id) as filename to avoid filesystem conflicts
        // job.key is designed to be filesystem-safe
        return path.join(this.#directory, `${ job.key }.json`);
    }
}
