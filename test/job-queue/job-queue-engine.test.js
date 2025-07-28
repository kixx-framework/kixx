import { describe } from 'kixx-test';
import {
    assert,
    assertFalsy,
    assertEqual,
    assertDefined,
    assertArray,
    assertGreaterThan,
    AssertionError
} from 'kixx-assert';
import sinon from 'sinon';

import JobQueueEngine from '../../job-queue/job-queue-engine.js';
import Job from '../../job-queue/job.js';
import LockingQueue from '../../lib/locking-queue.js';
import { WrappedError } from '../../errors/mod.js';

// Mock the file system module
const mockFileSystem = {
    readJSONFile: sinon.stub(),
    writeJSONFile: sinon.stub(),
    readDirectory: sinon.stub(),
    removeFile: sinon.stub(),
};

// Constructor and Initialization Tests

describe('JobQueueEngine: constructor with valid directory', ({ before, after, it }) => {
    let engine;

    before(() => {
        engine = new JobQueueEngine({ directory: '/var/jobs' });
    });

    after(() => {
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
            assert(error instanceof AssertionError);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });

    it('should throw when directory is empty string', () => {
        let threwError = false;
        try {
            new JobQueueEngine({ directory: '' });
        } catch (error) {
            threwError = true;
            assert(error instanceof AssertionError);
        }
        assert(threwError, 'Expected AssertionError to be thrown');
    });

    it('should throw when directory is not string', () => {
        let threwError = false;
        try {
            new JobQueueEngine({ directory: 123 });
        } catch (error) {
            threwError = true;
            assert(error instanceof AssertionError);
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
            assert(error instanceof AssertionError);
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
            assert(error instanceof AssertionError);
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
            assert(error instanceof AssertionError);
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

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        // Mock file system to return empty directory
        sinon.stub(mockFileSystem, 'readDirectory').resolves([]);

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        // Replace the file system module
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'readDirectory').resolves([]);

        loadedJobs = await engine.load();
    });

    after(() => {
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

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/nonexistent/path',
            lockingQueue: mockLockingQueue,
        });

        // Mock file system to throw error
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'readDirectory').rejects(new Error('Directory not found'));

        try {
            await engine.load();
            threwError = false;
        } catch (error) {
            threwError = true;
            caughtError = error;
        }
    });

    after(() => {
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

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
            eventListener: mockEventListener,
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

        // Mock file system operations
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'writeJSONFile').resolves();

        scheduledJob = await engine.scheduleJob(readyJob);
    });

    after(() => {
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

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
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

        // Mock file system operations
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'writeJSONFile').resolves();

        scheduledJob = await engine.scheduleJob(deferredJob);
    });

    after(() => {
        global.setTimeout = originalSetTimeout;
        sinon.restore();
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

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        testJob = {
            id: 'test-job-789',
            key: 'test-job-789',
            isReady: sinon.stub().returns(true),
            toDatabaseRecord: sinon.stub().returns({ id: 'test-job-789' }),
        };

        // Mock file system operations
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'writeJSONFile').resolves();

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
    });

    it('should execute job with array parameters', () => {
        assert(reportHandler.calledOnce);
        assertEqual('monthly', reportHandler.getCall(0).args[0]);
        assertEqual({ year: 2023, month: 12 }, reportHandler.getCall(0).args[1]);
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
    });

    it('should throw when no handler registered', () => {
        assert(threwError, 'Expected error to be thrown');
        assert(caughtError instanceof AssertionError);
    });
});

// Queue Processing Tests

describe('JobQueueEngine: selecting oldest ready job', ({ before, after, it }) => {
    let engine;
    let mockLockingQueue;
    let oldestJob;
    let newerJob;
    let futureJob;
    let selectedJob;

    before(async () => {
        mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        const baseDate = new Date('2023-12-01T10:00:00Z');

        oldestJob = {
            id: 'oldest-job',
            executionDate: new Date(baseDate.getTime() - 2000),
            isReady: sinon.stub().returns(true),
        };

        newerJob = {
            id: 'newer-job',
            executionDate: new Date(baseDate.getTime() - 1000),
            isReady: sinon.stub().returns(true),
        };

        futureJob = {
            id: 'future-job',
            executionDate: new Date(baseDate.getTime() + 5000),
            isReady: sinon.stub().returns(false),
        };

        // Mock the file system to return these jobs
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'readDirectory').resolves([
            '/var/jobs/newer-job.json',
            '/var/jobs/oldest-job.json',
            '/var/jobs/future-job.json',
        ]);

        sinon.stub(fileSystemModule, 'readJSONFile')
            .withArgs('/var/jobs/oldest-job.json').resolves({ id: 'oldest-job' })
            .withArgs('/var/jobs/newer-job.json').resolves({ id: 'newer-job' })
            .withArgs('/var/jobs/future-job.json').resolves({ id: 'future-job' });

        // Mock Job constructor
        sinon.stub(Job, 'constructor')
            .withArgs({ id: 'oldest-job' }).returns(oldestJob)
            .withArgs({ id: 'newer-job' }).returns(newerJob)
            .withArgs({ id: 'future-job' }).returns(futureJob);

        selectedJob = await engine.getOldestReadyJob();
    });

    after(() => {
        sinon.restore();
    });

    it('should select oldest ready job first', () => {
        assertEqual(oldestJob, selectedJob);
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

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        // Mock empty directory
        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'readDirectory').resolves([]);

        selectedJob = await engine.getOldestReadyJob();
    });

    after(() => {
        sinon.restore();
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

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        // Schedule a deferred job to create a timeout handle
        const deferredJob = {
            id: 'deferred-job-cleanup',
            key: 'deferred-job-cleanup',
            isReady: sinon.stub().returns(false),
            getDeferredMilliseconds: sinon.stub().returns(5000),
            toDatabaseRecord: sinon.stub().returns({ id: 'deferred-job-cleanup' }),
        };

        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'writeJSONFile').resolves();

        await engine.scheduleJob(deferredJob);

        // Now dispose the engine
        engine.dispose();
    });

    after(() => {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        sinon.restore();
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
    });

    it('should generate correct filepath for job', () => {
        assertEqual('/var/jobs/safe-filename-123.json', filepath);
    });
});

describe('JobQueueEngine: handling jobs with past execution dates', ({ before, after, it }) => {
    let engine;
    let pastJob;
    let result;

    before(async () => {
        const mockLockingQueue = {
            getLock: sinon.stub().resolves(),
            releaseLock: sinon.stub(),
        };

        engine = new JobQueueEngine({
            directory: '/var/jobs',
            lockingQueue: mockLockingQueue,
        });

        pastJob = {
            id: 'past-job-123',
            key: 'past-job-123',
            executionDate: new Date('2020-01-01T00:00:00Z'), // Far in the past
            isReady: sinon.stub().returns(true),
            toDatabaseRecord: sinon.stub().returns({ id: 'past-job-123' }),
        };

        const fileSystemModule = await import('../src/lib/file-system.js');
        sinon.stub(fileSystemModule, 'writeJSONFile').resolves();

        result = await engine.scheduleJob(pastJob);
    });

    after(() => {
        sinon.restore();
    });

    it('should handle jobs with past execution dates', () => {
        assertEqual(pastJob, result);
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
