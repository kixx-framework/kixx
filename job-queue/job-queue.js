import EventEmitter from 'node:events';
import JobQueueEngine from './job-queue-engine.js';
import Job from './job.js';

import {
    isNumberNotNaN,
    assertNonEmptyString,
    assertFunction
} from '../assertions/mod.js';


export default class JobQueue extends EventEmitter {

    #disposed = false;
    #started = false;
    #engine = null;
    #queuedJobsBeforeStart = [];

    /**
     * Create a new JobQueue instance
     *
     * @param {Object} options - Configuration options
     * @param {string} options.directory - Directory path where job files will be stored
     * @param {number} [options.maxConcurrency] - Maximum number of concurrent jobs to run
     * @throws {AssertionError} If directory is not a non-empty string
     */
    constructor(options = {}) {
        super();

        const eventListener = this.#engineEventListener.bind(this);

        const engineOptions = Object.assign({}, options, { eventListener });

        this.#engine = options.engine || new JobQueueEngine(engineOptions);
    }

    get started() {
        return this.#started;
    }

    /**
     * Register a handler function for a job method name.
     *
     * @param {string} methodName - The name of the job method to handle
     * @param {Function} handler - The function to handle jobs with this method name
     * @returns {JobQueue} Returns this instance for chaining
     * @throws {AssertionError} If methodName is not a non-empty string
     * @throws {AssertionError} If handler is not a function
     */
    registerJobHandler(methodName, handler) {
        assertNonEmptyString(methodName);
        assertFunction(handler);
        this.#engine.registerJobHandler(methodName, handler);
        return this;
    }

    start(options = {}) {
        const { delay } = options;

        this.#started = true;

        const queuedJobs = this.#queuedJobsBeforeStart;

        while (queuedJobs.length > 0) {
            const job = queuedJobs.pop();

            this.#engine.scheduleJob(job).catch((error) => {
                this.emit('error', {
                    message: 'Error scheduling Job at start',
                    cause: error,
                });
            });
        }

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

    async removeJobsByMethodName(methodName) {
        const allJobs = await this.#engine.getAllJobs();
        const jobsToRemove = allJobs.filter((job) => job.methodName === methodName);

        await Promise.all(jobsToRemove.map((job) => this.#engine.deleteJob(job)));
    }

    dispose() {
        this.#disposed = true;
        this.#engine.dispose();
        return this;
    }

    #engineEventListener(eventName, event) {
        this.emit(eventName, event);
    }
}
