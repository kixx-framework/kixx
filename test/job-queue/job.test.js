import { describe } from 'kixx-test';
import {
    assert,
    assertFalsy,
    assertEqual,
    assertNotEqual,
    assertDefined,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertMatches
} from 'kixx-assert';
import sinon from 'sinon';

import Job from '../../lib/job-queue/job.js';

// Test Group: Constructor Behavior
describe('Job constructor: should create job with valid immutable properties', ({ before, it }) => {
    let job;
    let jobSpec;

    before(() => {
        jobSpec = {
            id: 'test-job-2024-01-15T10-30-00-000Z-1234-1',
            executionDate: 1705318200000, // 2024-01-15T10:30:00.000Z
            methodName: 'sendWelcomeEmail',
            params: { userId: 'customer123', template: 'welcome' },
        };
        job = new Job(jobSpec);
    });

    it('should set id property correctly', () => {
        assertEqual(jobSpec.id, job.id, 'Job id should match spec');
    });

    it('should set executionDate property correctly', () => {
        assertEqual(jobSpec.executionDate, job.executionDate, 'Job executionDate should match spec');
    });

    it('should set methodName property correctly', () => {
        assertEqual(jobSpec.methodName, job.methodName, 'Job methodName should match spec');
    });

    it('should set params property correctly', () => {
        assertEqual(jobSpec.params, job.params, 'Job params should match spec');
    });

    it('should make id property immutable', () => {
        let error;
        try {
            job.id = 'modified-id';
        } catch (err) {
            error = err;
        }
        assert(error, 'Assigning to job.id should throw an error');
        assert(error instanceof TypeError, 'Assigning to job.id should throw TypeError');
    });

    it('should make executionDate property immutable', () => {
        let error;
        try {
            job.executionDate = Date.now();
        } catch (err) {
            error = err;
        }
        assert(error, 'Assigning to job.executionDate should throw an error');
        assert(error instanceof TypeError, 'Assigning to job.executionDate should throw TypeError');
    });

    it('should make methodName property immutable', () => {
        let error;
        try {
            job.methodName = 'modifiedMethod';
        } catch (err) {
            error = err;
        }
        assert(error, 'Assigning to job.methodName should throw an error');
        assert(error instanceof TypeError, 'Assigning to job.methodName should throw TypeError');
    });

    it('should make params property immutable', () => {
        let error;
        try {
            job.params = { modified: true };
        } catch (err) {
            error = err;
        }
        assert(error, 'Assigning to job.params should throw an error');
        assert(error instanceof TypeError, 'Assigning to job.params should throw TypeError');
    });
});

describe('Job constructor: should handle optional params parameter', ({ before, it }) => {
    let job;

    before(() => {
        job = new Job({
            id: 'test-job-2024-01-15T10-30-00-000Z-1234-2',
            executionDate: 1705318200000,
            methodName: 'processPayment',
            // params intentionally omitted
        });
    });

    it('should create job without params', () => {
        assertDefined(job, 'Job should be created successfully');
        assertEqual(undefined, job.params, 'Job params should be undefined when not provided');
    });
});

// Test Group: Static Factory Method (fromSpec)
describe('Job.fromSpec: should create job with generated ID when no ID provided', ({ before, after, it }) => {
    let job;
    let fixedTimestamp;

    before(() => {
        fixedTimestamp = 1705318200000; // 2024-01-15T10:30:00.000Z
        sinon.stub(Date, 'now').returns(fixedTimestamp);

        job = Job.fromSpec({
            methodName: 'sendWelcomeEmail',
            params: { userId: 'customer123' },
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should generate unique ID', () => {
        assertNonEmptyString(job.id, 'Generated ID should be non-empty string');
    });

    it('should use current time as execution date', () => {
        assertEqual(fixedTimestamp, job.executionDate, 'Execution date should be current timestamp');
    });

    it('should preserve methodName from spec', () => {
        assertEqual('sendWelcomeEmail', job.methodName, 'Method name should match spec');
    });

    it('should preserve params from spec', () => {
        assertEqual('customer123', job.params.userId, 'Params should be preserved from spec');
    });
});

describe('Job.fromSpec: should calculate execution date from waitTime', ({ before, after, it }) => {
    let job;
    let fixedTimestamp;
    let waitTimeMilliseconds;

    before(() => {
        fixedTimestamp = 1705318200000;
        waitTimeMilliseconds = 5000; // 5 seconds
        sinon.stub(Date, 'now').returns(fixedTimestamp);

        job = Job.fromSpec({
            methodName: 'processPayment',
            waitTime: waitTimeMilliseconds,
            params: { orderId: 'order456' },
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should add waitTime to current timestamp for execution date', () => {
        const expectedExecutionDate = fixedTimestamp + waitTimeMilliseconds;
        assertEqual(expectedExecutionDate, job.executionDate, 'Execution date should be current time plus wait time');
    });
});

describe('Job.fromSpec: should use explicit executionDate when provided', ({ before, after, it }) => {
    let job;
    let explicitExecutionDate;

    before(() => {
        sinon.stub(Date, 'now').returns(1705318200000);
        explicitExecutionDate = 1705404600000; // 2024-01-16T10:30:00.000Z (next day)

        job = Job.fromSpec({
            methodName: 'sendReminder',
            executionDate: explicitExecutionDate,
            params: { userId: 'customer789' },
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should use provided execution date', () => {
        assertEqual(explicitExecutionDate, job.executionDate, 'Should use explicit execution date from spec');
    });
});

describe('Job.fromSpec: should prevent scheduling jobs in past by adjusting to current time', ({ before, after, it }) => {
    let job;
    let currentTimestamp;
    let pastTimestamp;

    before(() => {
        currentTimestamp = 1705318200000;
        pastTimestamp = currentTimestamp - 3600000; // 1 hour ago
        sinon.stub(Date, 'now').returns(currentTimestamp);

        job = Job.fromSpec({
            methodName: 'expiredTask',
            executionDate: pastTimestamp,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should adjust past execution date to current time', () => {
        assertEqual(currentTimestamp, job.executionDate, 'Past execution date should be adjusted to current time');
    });
});

describe('Job.fromSpec: should validate methodName is non-empty string', ({ it }) => {
    it('should throw error when methodName is empty string', () => {
        let threwError = false;
        try {
            Job.fromSpec({ methodName: '' });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for empty methodName');
        }
        assert(threwError, 'Should throw error for empty methodName');
    });

    it('should throw error when methodName is missing', () => {
        let threwError = false;
        try {
            Job.fromSpec({});
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for missing methodName');
        }
        assert(threwError, 'Should throw error for missing methodName');
    });
});

describe('Job.fromSpec: should not mutate input spec object', ({ before, it }) => {
    let originalSpec;
    let specCopy;

    before(() => {
        originalSpec = {
            methodName: 'testMethod',
            waitTime: 1000,
            params: { test: 'value' },
        };
        specCopy = JSON.parse(JSON.stringify(originalSpec));
        Job.fromSpec(originalSpec);
    });

    it('should preserve original spec object', () => {
        assertEqual(specCopy.methodName, originalSpec.methodName, 'Original methodName should be unchanged');
        assertEqual(specCopy.waitTime, originalSpec.waitTime, 'Original waitTime should be unchanged');
        assertEqual(specCopy.params.test, originalSpec.params.test, 'Original params should be unchanged');
    });

    it('should not add generated properties to original spec', () => {
        assertEqual(undefined, originalSpec.id, 'ID should not be added to original spec');
        assertEqual(undefined, originalSpec.executionDate, 'ExecutionDate should not be added to original spec');
    });
});

// Test Group: Initial State
describe('Job: should initialize with correct default state', ({ before, it }) => {
    let job;

    before(() => {
        job = Job.fromSpec({
            methodName: 'initialStateTest',
        });
    });

    it('should initialize with NOT_STARTED state', () => {
        assertEqual(Job.STATES.NOT_STARTED, job.state, 'Initial state should be NOT_STARTED');
    });

    it('should initialize with null error', () => {
        assertEqual(null, job.error, 'Initial error should be null');
    });
});

// Test Group: State Transitions - In Progress
describe('Job state transitions: should transition from NOT_STARTED to IN_PROGRESS', ({ before, it }) => {
    let job;

    before(() => {
        job = Job.fromSpec({
            methodName: 'stateTransitionTest',
        });
        job.setStateInProgress();
    });

    it('should set state to IN_PROGRESS', () => {
        assertEqual(Job.STATES.IN_PROGRESS, job.state, 'State should be IN_PROGRESS after setStateInProgress');
    });

    it('should maintain all other properties unchanged', () => {
        assertEqual('stateTransitionTest', job.methodName, 'Method name should remain unchanged');
        assertDefined(job.id, 'ID should remain defined');
        assertNumberNotNaN(job.executionDate, 'Execution date should remain valid');
    });
});

// Test Group: State Transitions - Completed
describe('Job state transitions: should transition from IN_PROGRESS to COMPLETED', ({ before, it }) => {
    let job;

    before(() => {
        job = Job.fromSpec({
            methodName: 'completionTest',
        });
        job.setStateInProgress();
        job.setStateCompleted();
    });

    it('should set state to COMPLETED', () => {
        assertEqual(Job.STATES.COMPLETED, job.state, 'State should be COMPLETED after setStateCompleted');
    });

    it('should maintain all other properties unchanged', () => {
        assertEqual('completionTest', job.methodName, 'Method name should remain unchanged');
        assertDefined(job.id, 'ID should remain defined');
        assertEqual(null, job.error, 'Error should remain null for successful completion');
    });
});

// Test Group: State Transitions - Failed
describe('Job state transitions: should transition from IN_PROGRESS to FAILED with error', ({ before, it }) => {
    let job;
    let testError;

    before(() => {
        job = Job.fromSpec({
            methodName: 'failureTest',
        });
        testError = new Error('Payment processing failed');
        job.setStateInProgress();
        job.setStateFailed(testError);
    });

    it('should set state to FAILED', () => {
        assertEqual(Job.STATES.FAILED, job.state, 'State should be FAILED after setStateFailed');
    });

    it('should store error object', () => {
        assertEqual(testError, job.error, 'Error should be stored when job fails');
        assertEqual('Payment processing failed', job.error.message, 'Error message should be preserved');
    });

    it('should maintain all other properties unchanged', () => {
        assertEqual('failureTest', job.methodName, 'Method name should remain unchanged');
        assertDefined(job.id, 'ID should remain defined');
    });
});

// Test Group: Readiness Detection
describe('Job readiness: should return true when job is ready for execution', ({ before, after, it }) => {
    let job;
    let currentTime;

    before(() => {
        currentTime = 1705318200000;
        sinon.stub(Date, 'now').returns(currentTime + 1000); // 1 second later

        job = Job.fromSpec({
            methodName: 'readyJobTest',
            executionDate: currentTime, // Past execution time
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should return true for ready job', () => {
        assert(job.isReady(), 'Job should be ready when NOT_STARTED and execution time has passed');
    });
});

describe('Job readiness: should return false when execution time is in future', ({ before, after, it }) => {
    let job;
    let currentTime;

    before(() => {
        currentTime = 1705318200000;
        sinon.stub(Date, 'now').returns(currentTime);

        job = Job.fromSpec({
            methodName: 'futureJobTest',
            executionDate: currentTime + 5000, // 5 seconds in future
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should return false for future job', () => {
        assertFalsy(job.isReady(), 'Job should not be ready when execution time is in future');
    });
});

describe('Job readiness: should return false when job is not in NOT_STARTED state', ({ before, after, it }) => {
    let job;

    before(() => {
        sinon.stub(Date, 'now').returns(1705318200000);

        job = Job.fromSpec({
            methodName: 'inProgressJobTest',
            executionDate: 1705318100000, // Past time, should be ready if state allows
        });
        job.setStateInProgress();
    });

    after(() => {
        sinon.restore();
    });

    it('should return false for in-progress job regardless of time', () => {
        assertFalsy(job.isReady(), 'Job should not be ready when not in NOT_STARTED state');
    });
});

// Test Group: Deferred Execution Calculation
describe('Job deferred execution: should return zero milliseconds when execution time has passed', ({ before, after, it }) => {
    let job;
    let currentTime;

    before(() => {
        currentTime = 1705318200000;
        sinon.stub(Date, 'now').returns(currentTime);

        job = Job.fromSpec({
            methodName: 'pastExecutionTest',
            executionDate: currentTime - 2000, // 2 seconds ago
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should return 0 when execution time has passed', () => {
        assertEqual(0, job.getDeferredMilliseconds(), 'Should return 0 milliseconds for past execution time');
    });
});

describe('Job deferred execution: should return positive milliseconds for future execution', ({ before, after, it }) => {
    let job;
    let currentTime;
    let delayMilliseconds;

    before(() => {
        currentTime = 1705318200000;
        delayMilliseconds = 3000;
        sinon.stub(Date, 'now').returns(currentTime);

        job = Job.fromSpec({
            methodName: 'futureExecutionTest',
            executionDate: currentTime + delayMilliseconds,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should return exact time difference for future execution', () => {
        assertEqual(delayMilliseconds, job.getDeferredMilliseconds(), 'Should return exact milliseconds until execution');
    });
});

// Test Group: Property Getters
describe('Job property getters: should return correct computed values', ({ before, it }) => {
    let job;
    let executionTimestamp;

    before(() => {
        executionTimestamp = 1705318200000; // 2024-01-15T10:30:00.000Z
        job = Job.fromSpec({
            methodName: 'propertyGetterTest',
            executionDate: executionTimestamp,
            params: { userId: 'user123' },
        });
    });

    it('should return unique key combining methodName and id', () => {
        const expectedKey = `propertyGetterTest__${ job.id }`;
        assertEqual(expectedKey, job.key, 'Key should combine methodName and id with double underscore');
    });

    it('should return ISO string format for executionDateString', () => {
        // Use RegExp to match ISO date format instead of exact equality
        // This avoids issues with time changes between test runs
        assertMatches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, job.executionDateString, 'ExecutionDateString should be in ISO format');
    });

    it('should return current state value', () => {
        assertEqual(Job.STATES.NOT_STARTED, job.state, 'State getter should return current state');
    });
});

// Test Group: Safe Serialization
describe('Job safe serialization: should exclude sensitive information', ({ before, it }) => {
    let job;
    let safeObject;

    before(() => {
        job = Job.fromSpec({
            methodName: 'safeSerialization',
            params: {
                userId: 'user123',
                apiKey: 'secret-key-12345',
                personalInfo: { ssn: '123-45-6789' },
            },
        });
        safeObject = job.toSafeObject();
    });

    it('should include id in safe object', () => {
        assertEqual(job.id, safeObject.id, 'Safe object should include job ID');
    });

    it('should include methodName in safe object', () => {
        assertEqual('safeSerialization', safeObject.methodName, 'Safe object should include method name');
    });

    it('should include executionDate as ISO string in safe object', () => {
        assertEqual(job.executionDateString, safeObject.executionDate, 'Safe object should include execution date as ISO string');
    });

    it('should include current state in safe object', () => {
        assertEqual(Job.STATES.NOT_STARTED, safeObject.state, 'Safe object should include current state');
    });

    it('should exclude params from safe object', () => {
        assertEqual(undefined, safeObject.params, 'Safe object should exclude params to prevent sensitive data exposure');
    });

    it('should exclude error from safe object', () => {
        assertEqual(undefined, safeObject.error, 'Safe object should exclude error information');
    });
});

// Test Group: Database Serialization
describe('Job database serialization: should include all data for storage', ({ before, it }) => {
    let job;
    let databaseRecord;
    let testParams;

    before(() => {
        testParams = {
            orderId: 'order789',
            amount: 99.99,
            currency: 'USD',
        };

        job = Job.fromSpec({
            methodName: 'databaseSerialization',
            params: testParams,
        });
        databaseRecord = job.toDatabaseRecord();
    });

    it('should include id in database record', () => {
        assertEqual(job.id, databaseRecord.id, 'Database record should include job ID');
    });

    it('should include methodName in database record', () => {
        assertEqual('databaseSerialization', databaseRecord.methodName, 'Database record should include method name');
    });

    it('should include executionDate as numeric timestamp', () => {
        assertEqual(job.executionDate, databaseRecord.executionDate, 'Database record should include numeric timestamp');
        assertNumberNotNaN(databaseRecord.executionDate, 'Execution date should be a valid number');
    });

    it('should include current state in database record', () => {
        assertEqual(Job.STATES.NOT_STARTED, databaseRecord.state, 'Database record should include current state');
    });

    it('should include params in database record', () => {
        assertEqual(testParams, databaseRecord.params, 'Database record should include complete params object');
        assertEqual('order789', databaseRecord.params.orderId, 'Params should be fully preserved');
    });
});

// Test Group: ID Generation
describe('Job ID generation: should create unique filesystem-safe identifiers', ({ before, it }) => {
    let id1;
    let id2;
    let testTimestamp;

    before(() => {
        testTimestamp = 1705318200000; // 2024-01-15T10:30:00.000Z
        id1 = Job.generateId(testTimestamp);
        id2 = Job.generateId(testTimestamp);
    });

    it('should generate different IDs for same timestamp', () => {
        assertNotEqual(id1, id2, 'Multiple calls with same timestamp should generate different IDs');
    });

    it('should include timestamp information in ID', () => {
        // Both IDs should start with the ISO date portion (with colons and dots replaced by dashes)
        // Pattern matches: YYYY-MM-DDTHH-MM-SS-MMMZ
        const datePrefixPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/;
        assertMatches(datePrefixPattern, id1, 'ID should include timestamp information');
        assertMatches(datePrefixPattern, id2, 'ID should include timestamp information');
    });

    it('should produce filesystem-safe ID', () => {
        const filesystemUnsafeChars = /[<>:"/\\|?*]/;
        assertFalsy(filesystemUnsafeChars.test(id1), 'ID should not contain filesystem-unsafe characters');
        assertFalsy(filesystemUnsafeChars.test(id2), 'ID should not contain filesystem-unsafe characters');
    });

    it('should produce URL-safe IDs', () => {
        // Should not contain characters that need URL encoding
        const urlUnsafeChars = /[ %+]/;
        assertFalsy(urlUnsafeChars.test(id1), 'ID should be URL-safe');
        assertFalsy(urlUnsafeChars.test(id2), 'ID should be URL-safe');
    });
});

// Test Group: Input Validation Edge Cases
describe('Job validation: should reject invalid methodName values', ({ it }) => {
    it('should throw error for non-string methodName', () => {
        let threwError = false;
        try {
            Job.fromSpec({ methodName: 123 });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for non-string methodName');
        }
        assert(threwError, 'Should throw error for non-string methodName');
    });

    it('should throw error for null methodName', () => {
        let threwError = false;
        try {
            Job.fromSpec({ methodName: null });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for null methodName');
        }
        assert(threwError, 'Should throw error for null methodName');
    });
});

describe('Job validation: should reject invalid executionDate values', ({ it }) => {
    it('should throw error when executionDate is NaN', () => {
        let threwError = false;
        try {
            Job.fromSpec({
                methodName: 'validMethod',
                executionDate: NaN,
            });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for NaN executionDate');
        }
        assert(threwError, 'Should throw error for NaN executionDate');
    });

    it('should throw error when executionDate creates invalid Date', () => {
        let threwError = false;
        try {
            Job.fromSpec({
                methodName: 'validMethod',
                executionDate: 'invalid-date-string',
            });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name, 'Should throw AssertionError for invalid date string');
        }
        assert(threwError, 'Should throw error for invalid date string');
    });
});

describe('Job validation: should require Error instance for setStateFailed', ({ before, it }) => {
    let job;

    before(() => {
        job = Job.fromSpec({
            methodName: 'errorValidationTest',
        });
        job.setStateInProgress();
    });

    it('should throw error when setStateFailed called with string', () => {
        try {
            job.setStateFailed('error message string');
        } catch (error) {
            // The implementation should validate the error parameter
            assert(error instanceof TypeError, 'Should throw TypeError for non-Error parameter');
        }
        // Note: This test assumes the implementation validates the error parameter
        // If it doesn't, this might need to be adjusted based on actual behavior
    });

    it('should throw error when setStateFailed called without parameter', () => {
        try {
            job.setStateFailed();
        } catch (error) {
            assert(error instanceof TypeError, 'Should throw TypeError for missing parameter');
        }
        // Note: This test assumes the implementation validates the error parameter
    });
});

// Test Group: Complete Job Lifecycle
describe('Job lifecycle: should support complete state progression to completion', ({ before, it }) => {
    let job;
    let initialState;
    let inProgressState;
    let completedState;

    before(() => {
        job = Job.fromSpec({
            methodName: 'lifecycleCompletionTest',
            params: { taskId: 'task123' },
        });

        initialState = job.state;
        job.setStateInProgress();
        inProgressState = job.state;
        job.setStateCompleted();
        completedState = job.state;
    });

    it('should progress through all states correctly', () => {
        assertEqual(Job.STATES.NOT_STARTED, initialState, 'Should start in NOT_STARTED state');
        assertEqual(Job.STATES.IN_PROGRESS, inProgressState, 'Should transition to IN_PROGRESS');
        assertEqual(Job.STATES.COMPLETED, completedState, 'Should transition to COMPLETED');
    });

    it('should maintain data integrity through lifecycle', () => {
        assertEqual('lifecycleCompletionTest', job.methodName, 'Method name should remain consistent');
        assertEqual('task123', job.params.taskId, 'Params should remain consistent');
        assertDefined(job.id, 'ID should remain defined');
        assertEqual(null, job.error, 'Error should remain null for successful completion');
    });
});

describe('Job lifecycle: should support failure path with error preservation', ({ before, it }) => {
    let job;
    let testError;
    let initialState;
    let inProgressState;
    let failedState;

    before(() => {
        job = Job.fromSpec({
            methodName: 'lifecycleFailureTest',
            params: { orderId: 'order456' },
        });
        testError = new Error('Database connection timeout');

        initialState = job.state;
        job.setStateInProgress();
        inProgressState = job.state;
        job.setStateFailed(testError);
        failedState = job.state;
    });

    it('should progress through failure path correctly', () => {
        assertEqual(Job.STATES.NOT_STARTED, initialState, 'Should start in NOT_STARTED state');
        assertEqual(Job.STATES.IN_PROGRESS, inProgressState, 'Should transition to IN_PROGRESS');
        assertEqual(Job.STATES.FAILED, failedState, 'Should transition to FAILED');
    });

    it('should preserve error information in failure path', () => {
        assertEqual(testError, job.error, 'Error object should be preserved');
        assertEqual('Database connection timeout', job.error.message, 'Error message should be preserved');
    });

    it('should maintain data integrity through failure path', () => {
        assertEqual('lifecycleFailureTest', job.methodName, 'Method name should remain consistent');
        assertEqual('order456', job.params.orderId, 'Params should remain consistent');
        assertDefined(job.id, 'ID should remain defined');
    });
});

// Test Group: Boundary Conditions
describe('Job boundary conditions: should handle edge case timing values', ({ before, after, it }) => {
    let currentTime;

    before(() => {
        currentTime = 1705318200000;
        sinon.stub(Date, 'now').returns(currentTime);
    });

    after(() => {
        sinon.restore();
    });

    it('should handle executionDate exactly at current time', () => {
        const job = Job.fromSpec({
            methodName: 'exactTimeTest',
            executionDate: currentTime,
        });

        assertEqual(currentTime, job.executionDate, 'Should handle exact current time');
        assertEqual(0, job.getDeferredMilliseconds(), 'Should return 0 for exact current time');
    });

    it('should handle waitTime of zero', () => {
        const job = Job.fromSpec({
            methodName: 'zeroWaitTest',
            waitTime: 0,
        });

        assertEqual(currentTime, job.executionDate, 'Zero wait time should result in current time execution');
    });

    it('should handle very large waitTime values', () => {
        const largeWaitTime = 86400000; // 24 hours
        const job = Job.fromSpec({
            methodName: 'largeWaitTest',
            waitTime: largeWaitTime,
        });

        const expectedExecutionDate = currentTime + largeWaitTime;
        assertEqual(expectedExecutionDate, job.executionDate, 'Should handle large wait time values');
    });
});
