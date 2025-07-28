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
// This ensures unique IDs even if multiple jobs are created simultaneously
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
 * @property {Object} [params] - Parameters to pass to the method
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
 * @property {Object} [params] - Job parameters
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
     * @param {Object} [spec.params] - Optional parameters for the job
     * @throws {TypeError} When spec properties are invalid types or missing
     */
    constructor(spec) {
        // Use defineProperties to make these fields immutable after construction
        // This prevents accidental modification of core job identity
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
     * Returns a unique key combining method name and job ID.
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
     * @returns {number} Milliseconds to wait, or 0 if execution time has passed
     */
    getDeferredMilliseconds() {
        const delta = this.executionDate - Date.now();
        // Return 0 if execution time has passed to indicate job is ready now
        return delta > 0 ? delta : 0;
    }

    /**
     * Marks the job as currently executing.
     * @throws {Error} If job is not in NOT_STARTED state
     */
    setStateInProgress() {
        // State transition: NOT_STARTED -> IN_PROGRESS
        // After this call, job shows as actively running in status queries
        this.#state = Job.STATES.IN_PROGRESS;
    }

    /**
     * Marks the job as successfully completed.
     * @throws {Error} If job is not in IN_PROGRESS state
     */
    setStateCompleted() {
        // State transition: IN_PROGRESS -> COMPLETED
        // Job is now eligible for cleanup and can be safely removed from active queues
        this.#state = Job.STATES.COMPLETED;
    }

    /**
     * Marks the job as failed and records the error.
     * @param {Error} error - The error that caused the job to fail
     * @throws {TypeError} If error parameter is not an Error instance
     */
    setStateFailed(error) {
        // State transition: IN_PROGRESS -> FAILED
        // Job will not be retried automatically and error is preserved for debugging
        this.#state = Job.STATES.FAILED;
        this.#error = error;
    }

    /**
     * Returns a safe representation excluding sensitive parameters.
     * @returns {SafeJobObject} Job data safe for public APIs
     */
    toSafeObject() {
        // Exclude params to prevent sensitive data from being exposed in public APIs
        // Use ISO string for execution date for better human readability
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDateString,
            state: this.#state,
        };
    }

    /**
     * Returns a complete representation suitable for database storage.
     * @returns {DatabaseJobRecord} Full job data including parameters
     */
    toDatabaseRecord() {
        // Include all data for database storage, using numeric timestamp for efficient indexing
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDate,
            state: this.#state,
            params: this.params,
        };
    }

    /**
     * Generates a unique job identifier based on timestamp and random values.
     * @param {number} timestamp - Milliseconds since epoch for the job
     * @returns {string} Unique job ID safe for use in filesystems and URLs
     */
    static generateId(timestamp) {
        const date = new Date(timestamp);
        // Replace colons and dots with dashes to create filesystem-safe ID
        // ISO format: 2023-12-01T15:30:45.123Z becomes 2023-12-01T15-30-45-123Z
        const dateString = date.toISOString().replace(/[:.]+/g, '-');

        // Combine three sources of uniqueness to prevent collisions:
        // 1. Timestamp (dateString) - time-based uniqueness
        // 2. Random number (i) - handles simultaneous creation
        // 3. Increment counter (n) - handles high-frequency creation in same millisecond
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
        const now = Date.now();
        let executionDate = now;

        // Determine final execution time based on provided specification
        if (spec.executionDate) {
            // Use explicit execution date if provided
            const d = new Date(spec.executionDate);
            assertValidDate(d);
            executionDate = d.getTime();
        } else if (isNumberNotNaN(spec.waitTime)) {
            // Calculate execution date by adding wait time to current time
            executionDate += spec.waitTime;
        }

        // Prevent jobs from being scheduled in the past to avoid immediate execution confusion
        // Jobs scheduled for past times run immediately but maintain consistent behavior
        if (executionDate < now) {
            executionDate = now;
        }

        // Create new object to avoid mutating the input spec (defensive programming)
        // This prevents unexpected side effects in calling code
        return new Job(Object.assign({}, spec, {
            id: this.generateId(executionDate),
            executionDate,
        }));
    }
}
