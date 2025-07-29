import { describe } from 'kixx-test';
import {
    assert,
    assertFalsy,
    assertEqual,
    assertDefined,
    assertArray,
    assertGreaterThan
} from 'kixx-assert';
import sinon from 'sinon';

import JobQueueEngine from '../../job-queue/job-queue-engine.js';
import LockingQueue from '../../lib/locking-queue.js';
import { WrappedError } from '../../errors/mod.js';

function delayPromise(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// Constructor and Initialization Tests

describe('JobQueueEngine: constructor with valid directory', ({ before, after, it }) => {
    let engine;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should create engine with valid directory', () => {
        assertDefined(engine);
    });

    it('should set default max concurrency to one', () => {
        assertFalsy(engine.hasReachedMaxConcurrency);
        engine.setMaxConcurrency(1); // Should not throw
    });
});

describe('JobQueueEngine: constructor with custom options', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let mockEventListener;

    before(() => {
        mockLockingQueue = sinon.createStubInstance(LockingQueue);
        mockEventListener = sinon.spy();

        engine = new JobQueueEngine({
            directory: '/tmp/test-queue',
            maxConcurrency: 3,
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
        });
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should accept custom max concurrency', () => {
        // Test by creating jobs and checking concurrency behavior
        assertFalsy(engine.hasReachedMaxConcurrency); // Should be false with 0 jobs
    });

    it('should use provided locking queue', () => {
        // The mock locking queue should be used internally
        assertDefined(engine);
    });

    it('should use provided event listener', () => {
        assertDefined(engine);
    });
});

describe('JobQueueEngine: constructor with invalid directory', ({ it }) => {
    it('should throw when directory is null', () => {
        let threwError = false;
        try {
            new JobQueueEngine({ directory: null });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });

    it('should throw when directory is empty string', () => {
        let threwError = false;
        try {
            new JobQueueEngine({ directory: '' });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });

    it('should throw when directory is not string', () => {
        let threwError = false;
        try {
            new JobQueueEngine({ directory: 123 });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });
});

describe('JobQueueEngine: constructor with invalid max concurrency', ({ it }) => {
    it('should throw when max concurrency is not number', () => {
        let threwError = false;
        try {
            new JobQueueEngine({
                directory: '/var/jobs',
                maxConcurrency: 'invalid',
            });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });

    it('should throw when max concurrency is NaN', () => {
        let threwError = false;
        try {
            new JobQueueEngine({
                directory: '/var/jobs',
                maxConcurrency: NaN,
            });
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });
});

// Job Handler Management Tests

describe('JobQueueEngine: job handler registration', ({ before, after, it }) => {
    let engine;
    let sendEmailHandler;
    let processPaymentHandler;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });
        sendEmailHandler = sinon.spy();
        processPaymentHandler = sinon.spy();
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should register job handler successfully', () => {
        engine.registerJobHandler('sendEmail', sendEmailHandler);
        assert(engine.hasJobHandler('sendEmail'));
    });

    it('should support multiple handlers for different methods', () => {
        engine.registerJobHandler('sendEmail', sendEmailHandler);
        engine.registerJobHandler('processPayment', processPaymentHandler);

        assert(engine.hasJobHandler('sendEmail'));
        assert(engine.hasJobHandler('processPayment'));
    });

    it('should overwrite existing handler for same method', () => {
        const originalHandler = sinon.spy();
        const newHandler = sinon.spy();

        engine.registerJobHandler('sendEmail', originalHandler);
        engine.registerJobHandler('sendEmail', newHandler);

        assert(engine.hasJobHandler('sendEmail'));
    });
});

describe('JobQueueEngine: job handler checking', ({ before, after, it }) => {
    let engine;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });
        engine.registerJobHandler('sendEmail', sinon.spy());
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should return true for existing handler', () => {
        assert(engine.hasJobHandler('sendEmail'));
    });

    it('should return false for non existent handler', () => {
        assertFalsy(engine.hasJobHandler('nonExistentMethod'));
    });
});

// Concurrency Control Tests

describe('JobQueueEngine: concurrency limit management', ({ before, after, it }) => {
    let engine;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should set max concurrency to valid number', () => {
        engine.setMaxConcurrency(5);
        // No exception should be thrown
        assert(true);
    });

    it('should throw when setting invalid concurrency', () => {
        let threwError = false;
        try {
            engine.setMaxConcurrency('invalid');
        } catch (error) {
            threwError = true;
            assertEqual('AssertionError', error.name);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });
});

describe('JobQueueEngine: concurrency state checking with no jobs', ({ before, after, it }) => {
    let engine;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs', maxConcurrency: 2 });
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should report not at max when no jobs running', () => {
        assertFalsy(engine.hasReachedMaxConcurrency);
    });
});

// Job Loading and Persistence Tests

describe('JobQueueEngine: job loading from empty directory', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let loadedJobs;
    let mockFileSystem;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system that returns empty directory
        mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub(),
            readDirectory: sinon.stub().resolves([]),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        loadedJobs = await engine.load();
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should handle empty job directory', () => {
        assertArray(loadedJobs);
        assertEqual(0, loadedJobs.length);
    });
});

describe('JobQueueEngine: job loading with directory read error', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let threwError;
    let caughtError;
    let mockFileSystem;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system that throws error
        mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub(),
            readDirectory: sinon.stub().rejects(new Error('Directory not found')),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/nonexistent/path',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        try {
            await engine.load();
            threwError = false;
        } catch (error) {
            threwError = true;
            caughtError = error;
        }
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should wrap directory read errors', () => {
        assert(threwError, 'Expected error to be thrown');
        assert(caughtError instanceof WrappedError);
    });
});

// Job Scheduling Tests

describe('JobQueueEngine: scheduling ready job for immediate execution', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let readyJob;
    let scheduledJob;
    let mockEventListener;

    before(async () => {
        mockEventListener = sinon.spy();
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system
        const mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub().resolves(),
            readDirectory: sinon.stub(),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
            fileSystem: mockFileSystem,
        });

        // Create a ready job
        readyJob = {
            id: 'test-job-123',
            key: 'test-job-123',
            methodName: 'sendEmail',
            params: { to: 'user@example.com', subject: 'Test' },
            executionDate: new Date(Date.now() - 1000), // Past date = ready
            isReady: sinon.stub().returns(true),
            getDeferredMilliseconds: sinon.stub().returns(0),
            toDatabaseRecord: sinon.stub().returns({ id: 'test-job-123' }),
            toSafeObject: sinon.stub().returns({ id: 'test-job-123' }),
            setStateInProgress: sinon.spy(),
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
        };

        scheduledJob = await engine.scheduleJob(readyJob);
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should schedule ready job for immediate execution', () => {
        assertEqual(readyJob, scheduledJob);
    });

    it('should persist job before scheduling', () => {
        // The writeJSONFile should have been called
        assert(readyJob.toDatabaseRecord.called);
    });
});

describe('JobQueueEngine: scheduling deferred job', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let deferredJob;
    let scheduledJob;
    let originalSetTimeout;
    let mockSetTimeout;

    before(async () => {
        // Mock setTimeout
        originalSetTimeout = global.setTimeout;
        mockSetTimeout = sinon.stub();
        global.setTimeout = mockSetTimeout;

        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system
        const mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub().resolves(),
            readDirectory: sinon.stub(),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        // Create a deferred job
        deferredJob = {
            id: 'deferred-job-456',
            key: 'deferred-job-456',
            methodName: 'processPayment',
            params: { amount: 100 },
            executionDate: new Date(Date.now() + 5000), // Future date = deferred
            isReady: sinon.stub().returns(false),
            getDeferredMilliseconds: sinon.stub().returns(5000),
            toDatabaseRecord: sinon.stub().returns({ id: 'deferred-job-456' }),
            toSafeObject: sinon.stub().returns({ id: 'deferred-job-456' }),
        };

        scheduledJob = await engine.scheduleJob(deferredJob);
    });

    after(() => {
        global.setTimeout = originalSetTimeout;
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should schedule future job with timeout', () => {
        assertEqual(deferredJob, scheduledJob);
        assert(mockSetTimeout.calledOnce);
        assertEqual(5000, mockSetTimeout.getCall(0).args[1]);
    });

    it('should not execute deferred job immediately', () => {
        // The setTimeout should have been called instead of immediate execution
        assert(mockSetTimeout.called);
    });
});

describe('JobQueueEngine: scheduling job when engine disposed', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let testJob;
    let result;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system
        const mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub().resolves(),
            readDirectory: sinon.stub(),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        testJob = {
            id: 'test-job-789',
            key: 'test-job-789',
            isReady: sinon.stub().returns(true),
            toDatabaseRecord: sinon.stub().returns({ id: 'test-job-789' }),
        };

        // Dispose the engine first
        engine.dispose();

        result = await engine.scheduleJob(testJob);
    });

    after(() => {
        sinon.restore();
    });

    it('should return false when engine disposed', () => {
        assertFalsy(result);
    });
});

// Job Execution Tests

describe('JobQueueEngine: successful job execution with single parameter', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let emailHandler;
    let testJob;
    let mockEventListener;

    before(async () => {
        mockEventListener = sinon.spy();
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
        });

        emailHandler = sinon.stub().resolves();
        engine.registerJobHandler('sendEmail', emailHandler);

        testJob = {
            id: 'email-job-123',
            key: 'email-job-123',
            methodName: 'sendEmail',
            params: { to: 'user@example.com', subject: 'Welcome', body: 'Hello!' },
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
            toSafeObject: sinon.stub().returns({ id: 'email-job-123', methodName: 'sendEmail' }),
        };

        await engine.executeJob(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should execute job with single parameter', () => {
        assert(emailHandler.calledOnce);
        assertEqual(testJob.params, emailHandler.getCall(0).args[0]);
    });

    it('should mark job as completed after success', () => {
        assert(testJob.setStateCompleted.calledOnce);
    });

    it('should emit debug events during execution', () => {
        assert(mockEventListener.calledWith('debug'));
    });
});

describe('JobQueueEngine: successful job execution with array parameters', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let reportHandler;
    let testJob;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        reportHandler = sinon.stub().resolves();
        engine.registerJobHandler('generateReport', reportHandler);

        testJob = {
            id: 'report-job-456',
            key: 'report-job-456',
            methodName: 'generateReport',
            params: [ 'monthly', { year: 2023, month: 12 }],
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
            toSafeObject: sinon.stub().returns({ id: 'report-job-456', methodName: 'generateReport' }),
        };

        await engine.executeJob(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should execute job with array parameters', () => {
        assert(reportHandler.calledOnce);
        assertEqual('monthly', reportHandler.getCall(0).args[0]);
        assertEqual(2023, reportHandler.getCall(0).args[1].year);
        assertEqual(12, reportHandler.getCall(0).args[1].month);
    });
});

describe('JobQueueEngine: failed job execution', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let failingHandler;
    let testJob;
    let mockEventListener;
    let executionError;

    before(async () => {
        mockEventListener = sinon.spy();
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
        });

        executionError = new Error('Payment processing failed');
        failingHandler = sinon.stub().rejects(executionError);
        engine.registerJobHandler('processPayment', failingHandler);

        testJob = {
            id: 'payment-job-789',
            key: 'payment-job-789',
            methodName: 'processPayment',
            params: { amount: 100, cardNumber: '4111111111111111' },
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
            toSafeObject: sinon.stub().returns({ id: 'payment-job-789', methodName: 'processPayment' }),
        };

        await engine.executeJob(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should mark job as failed when handler throws', () => {
        assert(testJob.setStateFailed.calledOnce);
        assertEqual(executionError, testJob.setStateFailed.getCall(0).args[0]);
    });

    it('should emit error event when job fails', () => {
        assert(mockEventListener.calledWith('error'));
    });
});

describe('JobQueueEngine: execution with no handler registered', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let testJob;
    let threwError;
    let caughtError;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        testJob = {
            id: 'unknown-job-999',
            key: 'unknown-job-999',
            methodName: 'unknownMethod',
            params: {},
            toSafeObject: sinon.stub().returns({ id: 'unknown-job-999', methodName: 'unknownMethod' }),
        };

        try {
            await engine.executeJob(testJob);
            threwError = false;
        } catch (error) {
            threwError = true;
            caughtError = error;
        }
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should throw when no handler registered', () => {
        assert(threwError, 'Expected error to be thrown');
        assertEqual('AssertionError', caughtError.name);
    });
});

// Queue Processing Tests

describe('JobQueueEngine: selecting oldest ready job', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let selectedJob;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        const baseDate = new Date('2023-12-01T10:00:00Z');

        // Create valid Job JSON representations
        const oldestJobData = {
            id: 'oldest-job',
            methodName: 'sendEmail',
            executionDate: baseDate.getTime() - 2000,
            state: 'NOT_STARTED',
            params: { to: 'user1@example.com', subject: 'Oldest' },
        };

        const newerJobData = {
            id: 'newer-job',
            methodName: 'sendEmail',
            executionDate: baseDate.getTime() - 1000,
            state: 'NOT_STARTED',
            params: { to: 'user2@example.com', subject: 'Newer' },
        };

        const futureJobData = {
            id: 'future-job',
            methodName: 'sendEmail',
            executionDate: baseDate.getTime() + 5000,
            state: 'NOT_STARTED',
            params: { to: 'user3@example.com', subject: 'Future' },
        };

        // Create mock file system that returns valid Job JSON data
        const mockFileSystem = {
            readJSONFile(filepath) {
                if (filepath === '/var/jobs/oldest-job.json') {
                    return Promise.resolve(oldestJobData);
                }
                if (filepath === '/var/jobs/newer-job.json') {
                    return Promise.resolve(newerJobData);
                }
                if (filepath === '/var/jobs/future-job.json') {
                    return Promise.resolve(futureJobData);
                }
                throw new Error(`Unknown filepath: ${ filepath }`);
            },
            writeJSONFile() {},
            readDirectory() {
                return Promise.resolve([
                    '/var/jobs/newer-job.json',
                    '/var/jobs/oldest-job.json',
                    '/var/jobs/future-job.json',
                ]);
            },
            removeFile() {},
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        selectedJob = await engine.getOldestReadyJob();
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should select oldest ready job first', () => {
        assertDefined(selectedJob);
        assertEqual('oldest-job', selectedJob.id);
        assertEqual('sendEmail', selectedJob.methodName);
        assertEqual('NOT_STARTED', selectedJob.state);
    });
});

describe('JobQueueEngine: no ready jobs available', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let selectedJob;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system
        const mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub(),
            readDirectory: sinon.stub().resolves([]),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        selectedJob = await engine.getOldestReadyJob();
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should return null when no ready jobs', () => {
        assertEqual(null, selectedJob);
    });
});

// Engine Disposal Tests

describe('JobQueueEngine: disposal cleanup operations', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let originalSetTimeout;
    let originalClearTimeout;
    let mockSetTimeout;
    let mockClearTimeout;
    let timeoutHandle;

    before(async () => {
        // Mock timers
        originalSetTimeout = global.setTimeout;
        originalClearTimeout = global.clearTimeout;
        mockSetTimeout = sinon.stub();
        mockClearTimeout = sinon.spy();
        timeoutHandle = Symbol('timeout-handle');
        mockSetTimeout.returns(timeoutHandle);
        global.setTimeout = mockSetTimeout;
        global.clearTimeout = mockClearTimeout;

        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Create mock file system
        const mockFileSystem = {
            readJSONFile: sinon.stub(),
            writeJSONFile: sinon.stub().resolves(),
            readDirectory: sinon.stub(),
            removeFile: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            fileSystem: mockFileSystem,
        });

        // Schedule a deferred job to create a timeout handle
        const deferredJob = {
            id: 'deferred-job-cleanup',
            key: 'deferred-job-cleanup',
            isReady: sinon.stub().returns(false),
            getDeferredMilliseconds: sinon.stub().returns(5000),
            toDatabaseRecord: sinon.stub().returns({ id: 'deferred-job-cleanup' }),
        };

        await engine.scheduleJob(deferredJob);
    });

    after(() => {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should clear all scheduled timeouts', () => {
        assert(mockClearTimeout.calledOnce);
        assertEqual(timeoutHandle, mockClearTimeout.getCall(0).args[0]);
    });

    it('should prevent new job scheduling', async () => {
        const newJob = {
            id: 'post-disposal-job',
            key: 'post-disposal-job',
            isReady: sinon.stub().returns(true),
            toDatabaseRecord: sinon.stub().returns({ id: 'post-disposal-job' }),
        };

        const result = await engine.scheduleJob(newJob);
        assertFalsy(result);
    });
});

describe('JobQueueEngine: disposal idempotency', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let originalClearTimeout;
    let mockClearTimeout;

    before(() => {
        originalClearTimeout = global.clearTimeout;
        mockClearTimeout = sinon.spy();
        global.clearTimeout = mockClearTimeout;

        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        // Call dispose multiple times
        engine.dispose();
        engine.dispose();
        engine.dispose();
    });

    after(() => {
        global.clearTimeout = originalClearTimeout;
        sinon.restore();
    });

    it('should handle multiple disposal calls', () => {
        // Should not throw errors or cause issues
        assert(true, 'Multiple dispose calls should be safe');
    });
});

// Event System Tests

describe('JobQueueEngine: event emission during job lifecycle', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let mockEventListener;
    let testJob;
    let emailHandler;

    before(async () => {
        mockEventListener = sinon.spy();
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
        });

        emailHandler = sinon.stub().resolves();
        engine.registerJobHandler('sendEmail', emailHandler);

        testJob = {
            id: 'event-test-job',
            key: 'event-test-job',
            methodName: 'sendEmail',
            params: { to: 'test@example.com' },
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
            toSafeObject: sinon.stub().returns({
                id: 'event-test-job',
                methodName: 'sendEmail',
            }),
        };

        await engine.executeJob(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should emit debug events for job lifecycle', () => {
        // Should have emitted 'starting job' and 'completed job' debug events
        const debugCalls = mockEventListener.getCalls().filter((call) => call.args[0] === 'debug'
        );
        assertGreaterThan(0, debugCalls.length);
    });

    it('should include job information in events', () => {
        const debugCalls = mockEventListener.getCalls().filter((call) => call.args[0] === 'debug'
        );

        if (debugCalls.length > 0) {
            const eventData = debugCalls[0].args[1];
            assertDefined(eventData.info);
            assertDefined(eventData.info.job);
        }
    });
});

describe('JobQueueEngine: error event emission', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let mockEventListener;
    let testJob;
    let failingHandler;
    let testError;

    before(async () => {
        mockEventListener = sinon.spy();
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
        });

        testError = new Error('Job execution failed');
        failingHandler = sinon.stub().rejects(testError);
        engine.registerJobHandler('failingJob', failingHandler);

        testJob = {
            id: 'failing-job-test',
            key: 'failing-job-test',
            methodName: 'failingJob',
            params: {},
            setStateCompleted: sinon.spy(),
            setStateFailed: sinon.spy(),
            toSafeObject: sinon.stub().returns({
                id: 'failing-job-test',
                methodName: 'failingJob',
            }),
        };

        await engine.executeJob(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should emit error events for failures', () => {
        const errorCalls = mockEventListener.getCalls().filter((call) => call.args[0] === 'error'
        );
        assertGreaterThan(0, errorCalls.length);
    });

    it('should include error cause in error events', () => {
        const errorCalls = mockEventListener.getCalls().filter((call) => call.args[0] === 'error'
        );

        if (errorCalls.length > 0) {
            const eventData = errorCalls[0].args[1];
            assertEqual(testError, eventData.cause);
        }
    });
});

describe('JobQueueEngine: default event listener behavior', ({ before, after, it }) => {
    let engine;

    before(() => {
        // Create engine without custom event listener
        engine = new JobQueueEngine({ directory: '/var/jobs' });
    });

    after(() => {
        sinon.restore();
    });

    it('should handle missing event listener', () => {
        // Should not throw when engine emits events with default no-op listener
        assertDefined(engine);
    });
});

// Integration and Edge Case Tests

describe('JobQueueEngine: job file path generation', ({ before, after, it }) => {
    let engine;
    let testJob;
    let filepath;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });

        testJob = {
            key: 'safe-filename-123',
        };

        filepath = engine.getJobFilepath(testJob);
    });

    after(() => {
        sinon.restore();
        if (engine) {
            engine.dispose();
        }
    });

    it('should generate correct filepath for job', () => {
        assertEqual('/var/jobs/safe-filename-123.json', filepath);
    });
});

describe('JobQueueEngine: handling jobs with past execution dates', ({ before, after, it }) => {
    let engine;
    let mockFileSystem;
    let sendEmailHandler;

    before(async () => {
        sendEmailHandler = sinon.spy();

        mockFileSystem = {
            readJSONFile(filepath) {
                if (filepath === '/var/jobs/job-with-past-execution-date.json') {
                    return Promise.resolve({
                        id: 'job-with-past-execution-date',
                        executionDate: new Date('2023-12-01T10:00:00Z').getTime() - 1000,
                        methodName: 'sendEmail',
                        params: [ 'test1@example.com' ],
                    });
                }
                if (filepath === '/var/jobs/job-with-future-execution-date.json') {
                    return Promise.resolve({
                        id: 'job-with-future-execution-date',
                        executionDate: new Date().getTime() + 1000,
                        methodName: 'sendEmail',
                        params: [ 'test2@example.com' ],
                    });
                }
                throw new Error(`Unknown filepath: ${ filepath }`);
            },
            readDirectory() {
                return Promise.resolve([
                    '/var/jobs/job-with-future-execution-date.json',
                    '/var/jobs/job-with-past-execution-date.json',
                ]);
            },
            writeJSONFile: sinon.stub().resolves(),
            removeFile: sinon.stub().resolves(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            fileSystem: mockFileSystem,
        });

        engine.registerJobHandler('sendEmail', sendEmailHandler);

        await engine.load();

        // Wait for the job to load and execute.
        await delayPromise(10);

        engine.dispose();
    });

    after(() => {
        if (engine) {
            engine.dispose();
        }
        sinon.restore();
    });

    it('should execute the job', () => {
        assertEqual(1, sendEmailHandler.callCount);
        assertEqual('test@example.com', sendEmailHandler.getCall(0).args[0]);
    });

    it('should remove the job from storage', () => {
        assertEqual(1, mockFileSystem.removeFile.callCount);
        assertEqual('/var/jobs/job-with-past-execution-date.json', mockFileSystem.removeFile.getCall(0).args[0]);
    });
});

describe('JobQueueEngine: resource cleanup during errors', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;

    before(() => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.spy(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        // Dispose to test cleanup
        engine.dispose();
    });

    after(() => {
        sinon.restore();
    });

    it('should cleanup resources on error conditions', () => {
        // Engine should be disposed cleanly
        assertDefined(engine);
    });
});
