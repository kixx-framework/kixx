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

export default class Job {

    static STATES = Object.freeze({
        NOT_STARTED: 'NOT_STARTED',
        IN_PROGRESS: 'IN_PROGRESS',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
    });

    #state = Job.STATES.NOT_STARTED;
    #error = null;

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

    get key() {
        return `${ this.methodName }__${ this.id }`;
    }

    get executionDateString() {
        return new Date(this.executionDate).toISOString();
    }

    get state() {
        return this.#state;
    }

    get error() {
        return this.#error;
    }

    isReady() {
        return this.#state === Job.STATES.NOT_STARTED && this.getDeferredMilliseconds() === 0;
    }

    getDeferredMilliseconds() {
        const delta = this.executionDate - Date.now();
        return delta > 0 ? delta : 0;
    }

    setStateInProgress() {
        this.#state = Job.STATES.IN_PROGRESS;
    }

    setStateCompleted() {
        this.#state = Job.STATES.COMPLETED;
    }

    setStateFailed(error) {
        this.#state = Job.STATES.FAILED;
        this.#error = error;
    }

    toSafeObject() {
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDateString,
            state: this.#state,
        };
    }

    toDatabaseRecord() {
        return {
            id: this.id,
            methodName: this.methodName,
            executionDate: this.executionDate,
            state: this.#state,
            params: this.params,
        };
    }

    static generateId(timestamp) {
        const date = new Date(timestamp);
        const n = getIncrement();
        const i = crypto.randomInt(10000);
        return `${ date.toISOString() }-${ i }-${ n }`;
    }

    /**
     * Creates a new Job instance from a job specification object.
     *
     * @param {Object} spec - The job specification object
     * @param {string} spec.methodName - The name of the method to be executed
     * @param {number} [spec.executionDate] - The timestamp for job execution
     * @param {number} [spec.waitTime] - The time to wait before execution in milliseconds
     * @param {Object} [spec.params] - Additional parameters for the job
     * @returns {Job} A new Job instance
     * @throws {AssertionError} If required fields are missing or invalid
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
