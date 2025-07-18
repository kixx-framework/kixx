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


export default class JobQueueEngine {

    #directory = null;
    #inProgressJobs = new Set();
    #maxConcurrentJobs = 1;
    #disposed = false;
    #jobHandlers = new Map();
    #scheduledJobHandles = new Map();
    #lockingQueue = null;
    #eventListener = null;

    /**
     * Create a new JobQueueEngine instance
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

    get hasReachedMaxConcurrency() {
        return this.#inProgressJobs.size >= this.#maxConcurrentJobs;
    }

    setMaxConcurrency(max) {
        assertNumberNotNaN(max);
        this.#maxConcurrentJobs = max;
    }

    registerJobHandler(methodName, handler) {
        this.#jobHandlers.set(methodName, handler);
    }

    hasJobHandler(methodName) {
        return this.#jobHandlers.has(methodName);
    }

    async load() {
        const jobs = await this.getAllJobs();

        const promises = jobs.map((job) => {
            return this.scheduleJob(job);
        });

        return Promise.all(promises);
    }

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

    dispose() {
        this.#disposed = true;

        for (const handle of this.#scheduledJobHandles.values()) {
            clearTimeout(handle);
        }

        this.#scheduledJobHandles.clear();
    }

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
     * @private
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

    async setJobStateInProgress(job) {
        await this.#lockingQueue.getLock();
        job.setStateInProgress();
        this.#inProgressJobs.add(job);
        await this.saveJob(job);
        this.#lockingQueue.releaseLock();
    }

    async completeJob(job) {
        this.#inProgressJobs.delete(job);
        await this.deleteJob(job);
    }

    async saveJob(job) {
        const filepath = this.getJobFilepath(job);
        await this.#lockingQueue.getLock();
        await writeJSONFile(filepath, job.toDatabaseRecord());
        this.#lockingQueue.releaseLock();
    }

    async deleteJob(job) {
        await this.#lockingQueue.getLock();
        await removeFile(this.getJobFilepath(job));
        this.#lockingQueue.releaseLock();
    }

    async getAllJobs() {
        const filepaths = await this.readJobQueueDirectory();

        const jobs = await Promise.all(filepaths.map((filepath) => {
            return this.loadJobByFilepath(filepath);
        }));

        return jobs;
    }

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

    async loadJobByFilepath(filepath) {
        try {
            const json = await readJSONFile(filepath);
            return new Job(json);
        } catch (cause) {
            throw new WrappedError(`Unable to load job from ${ filepath }`, { cause });
        }
    }

    getJobFilepath(job) {
        return path.join(this.#directory, `${ job.key }.json`);
    }
}
