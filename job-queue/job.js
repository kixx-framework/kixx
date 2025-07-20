import crypto from 'node:crypto';

import {
    assertNonEmptyString,
    assertNumberNotNaN,
    assertValidDate,
    isNumberNotNaN
} from '../assertions/mod.js';


const getIncrement = (function createIncrementer() {
    let n = 0;
    return function increment() {
        n += 1;
        return n;
    };
}());

/**
 * Job
 * ===
 *
 * The Job class represents a single unit of work to be scheduled and executed by the job queue.
 * Each job has a unique ID, a method name to invoke, an execution date (when it should run),
 * and optional parameters. The job tracks its own state (not started, in progress, completed, failed)
 * and can be serialized for safe storage or database persistence.
 *
 * Core Features:
 *   - Unique job ID generation based on timestamp, random, and increment
 *   - State management (not started, in progress, completed, failed)
 *   - Deferred execution support (via executionDate/waitTime)
 *   - Safe serialization for public and database use
 *   - Static factory for creating jobs from user specs
 *
 * Usage Example:
 *   const job = Job.fromSpec({
 *     methodName: 'sendEmail',
 *     params: { to: 'user@example.com' },
 *     waitTime: 5000 // Run 5 seconds from now
 *   });
 */
export default class Job {
    /**
     * Job state constants.
     * @readonly
     * @enum {string}
     */
    static STATES = Object.freeze({
        NOT_STARTED: 'NOT_STARTED',
        IN_PROGRESS: 'IN_PROGRESS',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
    });

    /** @type {string} */
    #state = Job.STATES.NOT_STARTED;
    /** @type {Error|null} */
    #error = null;

    /**
     * Construct a new Job instance.
     * @param {Object} spec - The job specification object.
     * @param {string} spec.id - Unique job ID.
     * @param {number} spec.executionDate - Timestamp (ms) for job execution.
     * @param {string} spec.methodName - Name of the method to execute.
     * @param {Object} [spec.params] - Optional parameters for the job.
     */
    constructor(spec) {
        Object.defineProperties(this, {
            id: {
                enumerable: true,
                value: spec.id,
            },
            executionDate: {
                enumerable: true,
                value: spec.executionDate,
            },
            methodName: {
                enumerable: true,
                value: spec.methodName,
            },
            params: {
                enumerable: true,
                value: spec.params,
            },
        });
    }

    /**
     * Returns a unique key for this job (methodName__id).
     * @returns {string}
     */
    get key() {
        return `${ this.methodName }__${ this.id }`;
    }

    /**
     * Returns the execution date as an ISO string.
     * @returns {string}
     */
    get executionDateString() {
        return new Date(this.executionDate).toISOString();
    }

    /**
     * Returns the current state of the job.
     * @returns {string}
     */
    get state() {
        return this.#state;
    }

    /**
     * Returns the error (if any) associated with a failed job.
     * @returns {Error|null}
     */
    get error() {
        return this.#error;
    }

    /**
     * Returns true if the job is ready to run (not started and not deferred).
     * @returns {boolean}
     */
    isReady() {
        return this.#state === Job.STATES.NOT_STARTED && this.getDeferredMilliseconds() === 0;
    }

    /**
     * Returns the number of milliseconds to wait before this job should run.
     * @returns {number}
     */
    getDeferredMilliseconds() {
        const delta = this.executionDate - Date.now();
        return delta > 0 ? delta : 0;
    }

    /**
     * Set the job state to IN_PROGRESS.
     */
    setStateInProgress() {
        this.#state = Job.STATES.IN_PROGRESS;
    }

    /**
     * Set the job state to COMPLETED.
     */
    setStateCompleted() {
        this.#state = Job.STATES.COMPLETED;
    }

    /**
     * Set the job state to FAILED and record the error.
     * @param {Error} error
     */
    setStateFailed(error) {
        this.#state = Job.STATES.FAILED;
        this.#error = error;
    }

    /**
     * Returns a safe, public representation of the job (no params).
     * @returns {Object}
     */
    toSafeObject() {
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDateString,
            state: this.#state,
        };
    }

    /**
     * Returns a database record representation of the job (includes params).
     * @returns {Object}
     */
    toDatabaseRecord() {
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDate,
            state: this.#state,
            params: this.params,
        };
    }

    /**
     * Generate a unique job ID based on timestamp, random, and increment.
     * @param {number} timestamp - Milliseconds since epoch.
     * @returns {string}
     */
    static generateId(timestamp) {
        const date = new Date(timestamp);
        const dateString = date.toISOString().replace(/[:.]+/g, '-');
        const n = getIncrement();
        const i = crypto.randomInt(10000);
        return `${ dateString }-${ i }-${ n }`;
    }

    /**
     * Creates a new Job instance from a job specification object.
     *
     * @param {Object} spec - The job specification object.
     * @param {string} spec.methodName - The name of the method to be executed.
     * @param {number} [spec.executionDate] - The timestamp for job execution.
     * @param {number} [spec.waitTime] - The time to wait before execution in milliseconds.
     * @param {Object} [spec.params] - Additional parameters for the job.
     * @returns {Job} A new Job instance.
     * @throws {AssertionError} If required fields are missing or invalid.
     */
    static fromSpec(spec) {
        assertNonEmptyString(spec.methodName, 'A job must have a methodName');

        if (spec.executionDate) {
            assertNumberNotNaN(spec.executionDate);
        }

        const now = Date.now();

        let executionDate = now;

        if (spec.executionDate) {
            const d = new Date(spec.executionDate);
            assertValidDate(d);
            executionDate = d.getTime();
        } else if (isNumberNotNaN(spec.waitTime)) {
            executionDate += spec.waitTime;
        }

        // If the execution date is set in the past, update it to present time.
        if (executionDate < now) {
            executionDate = now;
        }

        // Copy the attributes to avoid mutating the passed in spec.
        return new Job(Object.assign({}, spec, {
            id: this.generateId(executionDate),
            executionDate,
        }));
    }
}
