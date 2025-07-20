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
 * JobQueueEngine
 * ==============
 *
 * The JobQueueEngine class provides a file-backed, concurrency-limited job queue for
 * scheduling, executing, and managing asynchronous jobs. Jobs are persisted as JSON
 * files in a specified directory, and the engine supports deferred execution, custom
 * job handlers, and safe concurrent processing.
 *
 * Core Features:
 *   - Schedules jobs for immediate or deferred execution based on their executionDate
 *   - Limits the number of concurrently running jobs (maxConcurrency)
 *   - Persists jobs to disk for durability and recovery
 *   - Supports registering custom job handlers by method name
 *   - Handles job completion, failure, and cleanup
 *   - Emits events for debugging and error handling via an eventListener callback
 *   - Uses a LockingQueue to ensure safe concurrent file operations
 *
 * Usage Example:
 *   const engine = new JobQueueEngine({ directory: '/jobs', maxConcurrency: 2 });
 *   engine.registerJobHandler('sendEmail', async (params) => { ... });
 *   await engine.load(); // Loads and schedules all persisted jobs
 *   await engine.scheduleJob(new Job({ ... }));
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
     * Create a new JobQueueEngine instance.
     *
     * @param {Object} options - Configuration options
     * @param {string} options.directory - Directory path where job files will be stored
     * @param {number} [options.maxConcurrency] - Maximum number of concurrent jobs to run
     * @param {LockingQueue} [options.lockingQueue] - Custom locking queue instance
     * @param {Function} [options.eventListener] - Function to receive engine events
     * @throws {AssertionError} If directory is not a non-empty string
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
            this.#lockingQueue = new LockingQueue();
        }

        if (isFunction(options.eventListener)) {
            this.#eventListener = options.eventListener;
        } else {
            this.#eventListener = () => {};
        }
    }

    /**
     * Indicates whether the engine has reached the maximum number of concurrent jobs.
     * @returns {boolean}
     */
    get hasReachedMaxConcurrency() {
        return this.#inProgressJobs.size >= this.#maxConcurrentJobs;
    }

    /**
     * Set the maximum number of concurrent jobs allowed.
     * @param {number} max
     */
    setMaxConcurrency(max) {
        assertNumberNotNaN(max);
        this.#maxConcurrentJobs = max;
    }

    /**
     * Register a handler function for a specific job method name.
     * @param {string} methodName
     * @param {Function} handler
     */
    registerJobHandler(methodName, handler) {
        this.#jobHandlers.set(methodName, handler);
    }

    /**
     * Check if a handler is registered for the given method name.
     * @param {string} methodName
     * @returns {boolean}
     */
    hasJobHandler(methodName) {
        return this.#jobHandlers.has(methodName);
    }

    /**
     * Load all jobs from disk and schedule them for execution.
     * @returns {Promise<Array<Job>>}
     */
    async load() {
        const jobs = await this.getAllJobs();

        const promises = jobs.map((job) => {
            return this.scheduleJob(job);
        });

        return Promise.all(promises);
    }

    /**
     * Schedule a job for execution. If the job is ready, it will be started immediately.
     * If deferred, it will be scheduled to start at the appropriate time.
     * @param {Job} job
     * @returns {Promise<Job|boolean>}
     */
    async scheduleJob(job) {
        if (this.#disposed) {
            return false;
        }

        await this.saveJob(job);

        if (this.#disposed) {
            return false;
        }

        if (job.isReady()) {
            this.startNextJob();
            return job;
        }

        const milliseconds = job.getDeferredMilliseconds();
        const handle = setTimeout(this.startNextJob.bind(this), milliseconds);

        this.#scheduledJobHandles.set(job.id, handle);

        return job;
    }

    /**
     * Dispose the engine, clearing all scheduled jobs and preventing further execution.
     */
    dispose() {
        this.#disposed = true;

        for (const handle of this.#scheduledJobHandles.values()) {
            clearTimeout(handle);
        }

        this.#scheduledJobHandles.clear();
    }

    /**
     * Start the next available job if concurrency limits allow.
     * @returns {Promise<Job|boolean>}
     */
    async startNextJob() {
        if (this.#disposed || this.hasReachedMaxConcurrency) {
            return false;
        }

        const job = await this.getOldestReadyJob();

        if (!job) {
            return false;
        }

        await this.setJobStateInProgress(job);

        if (this.#disposed) {
            return false;
        }

        // Do not await these routines; we want to allow the
        // queue to run jobs in parallel up to the concurrency limit.
        this.executeJob(job)
            .catch((cause) => {
                this.#eventListener('error', {
                    message: 'error executing job',
                    info: { job: job.toSafeObject() },
                    cause,
                });
            })
            .then(() => {
                return this.completeJob(job);
            })
            .finally(() => {
                return this.startNextJob();
            });

        return job;
    }

    /**
     * Execute a job by invoking its registered handler.
     * Handles completion and error reporting.
     * @private
     * @param {Job} job
     * @returns {Promise<void>}
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
            if (Array.isArray(params)) {
                await handler(...params);
            } else {
                await handler(params);
            }

            job.setStateCompleted();
        } catch (error) {
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
     * Get the oldest job that is ready to be executed.
     * @returns {Promise<Job|null>}
     */
    async getOldestReadyJob() {
        const jobs = await this.getAllJobs();

        let oldestReadyJob = null;

        for (const job of jobs) {
            if (job.isReady() && (!oldestReadyJob || job.executionDate < oldestReadyJob.executionDate)) {
                oldestReadyJob = job;
            }
        }

        return oldestReadyJob;
    }

    /**
     * Set a job's state to IN_PROGRESS and persist it.
     * @param {Job} job
     * @returns {Promise<void>}
     */
    async setJobStateInProgress(job) {
        await this.#lockingQueue.getLock();
        job.setStateInProgress();
        this.#inProgressJobs.add(job);
        await this.saveJob(job);
        this.#lockingQueue.releaseLock();
    }

    /**
     * Complete a job and remove it from the queue and disk.
     * @param {Job} job
     * @returns {Promise<void>}
     */
    async completeJob(job) {
        this.#inProgressJobs.delete(job);
        await this.deleteJob(job);
    }

    /**
     * Persist a job to disk as a JSON file.
     * @param {Job} job
     * @returns {Promise<void>}
     */
    async saveJob(job) {
        const filepath = this.getJobFilepath(job);
        await this.#lockingQueue.getLock();
        await writeJSONFile(filepath, job.toDatabaseRecord());
        this.#lockingQueue.releaseLock();
    }

    /**
     * Delete a job's file from disk.
     * @param {Job} job
     * @returns {Promise<void>}
     */
    async deleteJob(job) {
        await this.#lockingQueue.getLock();
        await removeFile(this.getJobFilepath(job));
        this.#lockingQueue.releaseLock();
    }

    /**
     * Get all jobs currently persisted in the job queue directory.
     * @returns {Promise<Array<Job>>}
     */
    async getAllJobs() {
        const filepaths = await this.readJobQueueDirectory();

        const jobs = await Promise.all(filepaths.map((filepath) => {
            return this.loadJobByFilepath(filepath);
        }));

        return jobs;
    }

    /**
     * Read the job queue directory and return all file paths.
     * @returns {Promise<Array<string>>}
     * @throws {WrappedError} If the directory cannot be read
     */
    async readJobQueueDirectory() {
        try {
            const filepaths = await readDirectory(this.#directory);
            return filepaths;
        } catch (cause) {
            throw new WrappedError(
                `Unable to read job queue directory ${ this.#directory }`,
                { cause }
            );
        }
    }

    /**
     * Load a job from a given file path.
     * @param {string} filepath
     * @returns {Promise<Job>}
     * @throws {WrappedError} If the job file cannot be loaded
     */
    async loadJobByFilepath(filepath) {
        try {
            const json = await readJSONFile(filepath);
            return new Job(json);
        } catch (cause) {
            throw new WrappedError(`Unable to load job from ${ filepath }`, { cause });
        }
    }

    /**
     * Get the file path for a given job.
     * @param {Job} job
     * @returns {string}
     */
    getJobFilepath(job) {
        return path.join(this.#directory, `${ job.key }.json`);
    }
}
