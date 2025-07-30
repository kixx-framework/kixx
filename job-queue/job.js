/**
 * @fileoverview Job scheduling and execution utilities
 *
 * This module provides the Job class for representing units of work in a job queue system.
 * Jobs can be scheduled for immediate or deferred execution, track their state through
 * the execution lifecycle, and provide safe serialization for storage and API responses.
 */

import crypto from 'node:crypto';

import {
    isUndefined,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertValidDate,
    isNumberNotNaN
} from '../assertions/mod.js';

// Use closure to create a thread-safe incrementer for unique ID generation
// Node.js is single-threaded but this prevents race conditions during
// high-frequency job creation within the same event loop tick
const getIncrement = (function createIncrementer() {
    let n = 0;
    return function increment() {
        n += 1;
        return n;
    };
}());

/**
 * @typedef {Object} JobSpec
 * @property {string} methodName - The name of the method to be executed
 * @property {number} [executionDate] - Timestamp (ms) for when job should run
 * @property {number} [waitTime] - Milliseconds to wait before execution
 * @property {*} [params] - Parameters to pass to the method
 */

/**
 * @typedef {Object} SafeJobObject
 * @property {string} id - Unique job identifier
 * @property {string} methodName - Method name to execute
 * @property {string} executionDate - ISO string of execution date
 * @property {string} state - Current job state
 */

/**
 * @typedef {Object} DatabaseJobRecord
 * @property {string} id - Unique job identifier
 * @property {string} methodName - Method name to execute
 * @property {number} executionDate - Timestamp (ms) for execution
 * @property {string} state - Current job state
 * @property {*} [params] - Job parameters
 */

/**
 * Represents a single unit of work to be scheduled and executed by a job queue.
 *
 * Jobs have unique IDs, track their execution state, and can be scheduled for
 * immediate or deferred execution. They provide safe serialization methods
 * for storage and public API responses.
 */
export default class Job {
    /**
     * Available job states during the execution lifecycle.
     * @readonly
     * @enum {string}
     */
    static STATES = Object.freeze({
        /** Job has not started executing */
        NOT_STARTED: 'NOT_STARTED',
        /** Job is currently being executed */
        IN_PROGRESS: 'IN_PROGRESS',
        /** Job completed successfully */
        COMPLETED: 'COMPLETED',
        /** Job execution failed with an error */
        FAILED: 'FAILED',
    });

    /**
     * Unique job identifier
     * @readonly
     * @type {string}
     */
    id;

    /**
     * Timestamp (in milliseconds) when the job should execute
     * @readonly
     * @type {number}
     */
    executionDate;

    /**
     * Name of the method to execute
     * @readonly
     * @type {string}
     */
    methodName;

    /**
     * Parameters to pass to the method during execution
     * @readonly
     * @type {*}
     */
    params;

    /** @type {string} */
    #state = Job.STATES.NOT_STARTED;

    /** @type {Error|null} */
    #error = null;

    /**
     * Creates a new Job instance with immutable core properties.
     * @param {Object} spec - The job specification object
     * @param {string} spec.id - Unique job identifier
     * @param {number} spec.executionDate - Timestamp (ms) for job execution
     * @param {string} spec.methodName - Name of the method to execute
     * @param {*} [spec.params] - Optional parameters for the job
     * @throws {TypeError} When spec properties are invalid types or missing
     */
    constructor(spec) {
        // Use defineProperties to make these fields immutable after construction
        // This prevents accidental modification of core job identity properties
        // which could cause jobs to be misrouted or duplicated in queues
        Object.defineProperties(this, {
            id: {
                enumerable: true,
                writable: false,
                value: spec.id,
            },
            executionDate: {
                enumerable: true,
                writable: false,
                value: spec.executionDate,
            },
            methodName: {
                enumerable: true,
                writable: false,
                value: spec.methodName,
            },
            params: {
                enumerable: true,
                writable: false,
                value: spec.params,
            },
        });
    }

    /**
     * Returns a unique key combining method name and job ID.
     * Used for Redis keys, cache lookups, and ensuring uniqueness in job stores.
     * @returns {string} Key in format "methodName__id"
     */
    get key() {
        return `${ this.methodName }__${ this.id }`;
    }

    /**
     * Returns the execution date as an ISO string for human readability.
     * @returns {string} ISO formatted date string
     */
    get executionDateString() {
        return new Date(this.executionDate).toISOString();
    }

    /**
     * Returns the current execution state of the job.
     * @returns {string} One of the Job.STATES values
     */
    get state() {
        return this.#state;
    }

    /**
     * Returns the error associated with a failed job.
     * @returns {Error|null} Error object if job failed, null otherwise
     */
    get error() {
        return this.#error;
    }

    /**
     * Checks if the job is ready for immediate execution.
     * @returns {boolean} True if job is not started and execution time has passed
     */
    isReady() {
        return this.#state === Job.STATES.NOT_STARTED && this.getDeferredMilliseconds() === 0;
    }

    /**
     * Calculates milliseconds remaining until job should execute.
     * Used by job schedulers to determine sleep/wait times before polling again.
     * @returns {number} Milliseconds to wait, or 0 if execution time has passed
     */
    getDeferredMilliseconds() {
        const delta = this.executionDate - Date.now();
        // Return 0 if execution time has passed to indicate job is ready now
        // This prevents negative delays which would confuse setTimeout calls
        return delta > 0 ? delta : 0;
    }

    /**
     * Marks the job as currently executing.
     * @throws {Error} When job is not in NOT_STARTED state
     */
    setStateInProgress() {
        if (this.#state !== Job.STATES.NOT_STARTED) {
            throw new Error(`Cannot start job in ${ this.#state } state`);
        }
        this.#state = Job.STATES.IN_PROGRESS;
    }

    /**
     * Marks the job as successfully completed.
     * @throws {Error} When job is not in IN_PROGRESS state
     */
    setStateCompleted() {
        if (this.#state !== Job.STATES.IN_PROGRESS) {
            throw new Error(`Cannot complete job in ${ this.#state } state`);
        }
        this.#state = Job.STATES.COMPLETED;
    }

    /**
     * Marks the job as failed and records the error.
     * @param {Error} error - The error that caused the job to fail
     * @throws {TypeError} When error parameter is not an Error instance
     * @throws {Error} When job is not in IN_PROGRESS state
     */
    setStateFailed(error) {
        if (!(error instanceof Error)) {
            throw new TypeError('error must be an Error instance');
        }
        if (this.#state !== Job.STATES.IN_PROGRESS) {
            throw new Error(`Cannot fail job in ${ this.#state } state`);
        }
        this.#state = Job.STATES.FAILED;
        this.#error = error;
    }

    /**
     * Returns a safe representation excluding sensitive parameters.
     * @returns {SafeJobObject} Job data safe for public APIs
     */
    toSafeObject() {
        // Exclude params to prevent sensitive data (passwords, API keys, PII)
        // from being exposed in public APIs, logs, or monitoring dashboards
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDateString, // Use ISO string for human readability
            state: this.#state,
        };
    }

    /**
     * Returns a complete representation suitable for database storage.
     * @returns {DatabaseJobRecord} Full job data including parameters
     */
    toDatabaseRecord() {
        // Include all data for database storage, using numeric timestamp
        // for efficient indexing and range queries on execution time
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDate, // Keep as number for DB indexing performance
            state: this.#state,
            params: this.params,
        };
    }

    /**
     * Generates a unique job identifier based on timestamp and random values.
     * @param {number} timestamp - Milliseconds since epoch for the job
     * @returns {string} Unique job ID safe for use in filesystems and URLs
     * @throws {TypeError} When timestamp is not a number
     */
    static generateId(timestamp) {
        if (typeof timestamp !== 'number' || isNaN(timestamp)) {
            throw new TypeError('timestamp must be a valid number');
        }

        const date = new Date(timestamp);
        // Replace colons and dots with dashes to create filesystem-safe ID
        // ISO format: 2023-12-01T15:30:45.123Z becomes 2023-12-01T15-30-45-123Z
        // This allows job IDs to be used safely in file names and URL paths
        const dateString = date.toISOString().replace(/[:.]+/g, '-');

        // Triple-layer uniqueness strategy to prevent ID collisions:
        // 1. Timestamp (dateString) - provides time-based uniqueness and sortability
        // 2. Random number (i) - handles multiple jobs created in same millisecond
        // 3. Increment counter (n) - handles high-frequency creation bursts
        // This combination virtually eliminates collision risk even under heavy load
        const n = getIncrement();
        const i = crypto.randomInt(10000);
        return `${ dateString }-${ i }-${ n }`;
    }

    /**
     * Creates a new Job from a specification object with validation.
     * @param {JobSpec} spec - Job specification
     * @returns {Job} New Job instance ready for scheduling
     * @throws {AssertionError} When required fields are missing or invalid
     * @throws {TypeError} When field types are incorrect
     * @example
     * // Create a job to run immediately
     * const job = Job.fromSpec({
     *   methodName: 'sendEmail',
     *   params: { to: 'user@example.com', subject: 'Welcome' }
     * });
     *
     * @example
     * // Create a job to run in 5 seconds
     * const delayedJob = Job.fromSpec({
     *   methodName: 'processPayment',
     *   waitTime: 5000,
     *   params: { orderId: '12345' }
     * });
     *
     * @example
     * // Create a job for a specific time
     * const scheduledJob = Job.fromSpec({
     *   methodName: 'sendReminder',
     *   executionDate: new Date('2024-01-01T10:00:00Z').getTime(),
     *   params: { userId: 'abc123' }
     * });
     */
    static fromSpec(spec) {
        assertNonEmptyString(spec.methodName, 'A job must have a methodName');

        if (!isUndefined(spec.executionDate)) {
            assertNumberNotNaN(spec.executionDate);
        }

        // Start with current time as baseline for execution scheduling
        // This ensures all timing calculations are relative to job creation time
        const now = Date.now();
        let executionDate = now;

        // Determine final execution time based on provided specification
        // Priority: explicit executionDate > waitTime > immediate execution
        if (spec.executionDate) {
            // Use explicit execution date if provided (for precise scheduling)
            const d = new Date(spec.executionDate);
            assertValidDate(d);
            executionDate = d.getTime();
        } else if (isNumberNotNaN(spec.waitTime)) {
            // Calculate execution date by adding wait time to current time
            // This is the most common pattern for delayed job execution
            executionDate += spec.waitTime;
        }

        // Prevent jobs from being scheduled in the past to avoid confusion
        // Past-scheduled jobs run immediately but maintain consistent behavior
        // This prevents "why didn't my job run?" debugging scenarios
        if (executionDate < now) {
            executionDate = now;
        }

        // Create new object to avoid mutating the input spec (defensive programming)
        // This prevents unexpected side effects in calling code where the same
        // spec object might be reused for multiple job creation calls
        return new Job(Object.assign({}, spec, {
            id: this.generateId(executionDate),
            executionDate,
        }));
    }
}
