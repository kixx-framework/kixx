import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import LockingQueue from '../../lib/local-file-datastore/locking-queue.js';


describe('LockingQueue#getLock() when lock does not exist', ({ before, it }) => {
    let lockingQueue;
    let lockPromise;

    before(async () => {
        lockingQueue = new LockingQueue();
        lockPromise = lockingQueue.getLock('test-file.json');
    });

    it('returns a Promise that resolves immediately', async () => {
        const result = await lockPromise;
        assertEqual(true, result);
    });

    it('creates a lock structure in the fileLocks Map', () => {
        assert(lockingQueue.fileLocks.has('test-file.json'));
    });

    it('sets isLocked to true', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(true, lock.isLocked);
    });

    it('initializes an empty queue', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(0, lock.queue.length);
    });
});


describe('LockingQueue#getLock() when lock is already held', ({ before, it }) => {
    let lockingQueue;
    let firstLockPromise;
    let secondLockPromise;
    let secondLockResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        // First caller acquires the lock
        firstLockPromise = lockingQueue.getLock('test-file.json');
        await firstLockPromise;

        // Second caller tries to acquire the same lock
        secondLockResolved = false;
        secondLockPromise = lockingQueue.getLock('test-file.json');
        secondLockPromise.then(() => {
            secondLockResolved = true;
        });

        // Give the Promise time to settle if it was going to resolve
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    });

    it('adds a resolve callback to the queue', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(1, lock.queue.length);
    });

    it('returns a Promise that does not resolve immediately', () => {
        assertEqual(false, secondLockResolved);
    });

    it('resolves the Promise after releaseLock() is called', async () => {
        lockingQueue.releaseLock('test-file.json');
        await secondLockPromise;
        assertEqual(true, secondLockResolved);
    });
});


describe('LockingQueue#releaseLock() when no waiters in queue', ({ before, it }) => {
    let lockingQueue;

    before(async () => {
        lockingQueue = new LockingQueue();

        // Acquire lock then release it
        await lockingQueue.getLock('test-file.json');
        lockingQueue.releaseLock('test-file.json');
    });

    it('sets isLocked to false', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(false, lock.isLocked);
    });

    it('keeps the queue empty', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(0, lock.queue.length);
    });

    it('allows next getLock() to acquire immediately', async () => {
        const lockPromise = lockingQueue.getLock('test-file.json');
        const result = await lockPromise;
        assertEqual(true, result);

        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(true, lock.isLocked);
    });
});


describe('LockingQueue#releaseLock() when waiters exist in queue', ({ before, it }) => {
    let lockingQueue;
    let secondLockPromise;
    let secondLockResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        // First caller acquires the lock
        await lockingQueue.getLock('test-file.json');

        // Second caller waits for the lock
        secondLockResolved = false;
        secondLockPromise = lockingQueue.getLock('test-file.json');
        secondLockPromise.then(() => {
            secondLockResolved = true;
        });

        // Give time for Promise to settle
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });

        // First caller releases
        lockingQueue.releaseLock('test-file.json');

        // Give time for the queued Promise to resolve
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    });

    it('resolves the queued Promise', () => {
        assertEqual(true, secondLockResolved);
    });

    it('removes the waiter from the queue', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(0, lock.queue.length);
    });

    it('keeps isLocked true (lock transferred to waiter)', () => {
        const lock = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(true, lock.isLocked);
    });
});


describe('LockingQueue with multiple concurrent waiters', ({ before, it }) => {
    let lockingQueue;
    let executionOrder;

    before(async () => {
        lockingQueue = new LockingQueue();
        executionOrder = [];

        // Operation 1 acquires the lock
        await lockingQueue.getLock('test-file.json');
        executionOrder.push(1);

        // Operations 2, 3, 4 queue up
        const op2 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(2);
        });

        const op3 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(3);
        });

        const op4 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(4);
        });

        // Release lock from operation 1
        lockingQueue.releaseLock('test-file.json');
        await op2;

        // Release lock from operation 2
        lockingQueue.releaseLock('test-file.json');
        await op3;

        // Release lock from operation 3
        lockingQueue.releaseLock('test-file.json');
        await op4;

        // Release lock from operation 4
        lockingQueue.releaseLock('test-file.json');
    });

    it('executes operations in FIFO order', () => {
        assertEqual(1, executionOrder[0]);
        assertEqual(2, executionOrder[1]);
        assertEqual(3, executionOrder[2]);
        assertEqual(4, executionOrder[3]);
    });

    it('processes all 4 operations', () => {
        assertEqual(4, executionOrder.length);
    });
});


describe('LockingQueue with different file paths', ({ before, it }) => {
    let lockingQueue;
    let lockA;
    let lockB;
    let bothResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        // Acquire locks for two different files
        const promiseA = lockingQueue.getLock('file-a.json');
        const promiseB = lockingQueue.getLock('file-b.json');

        bothResolved = false;

        // Both should resolve without waiting
        await Promise.all([ promiseA, promiseB ]).then(() => {
            bothResolved = true;
        });

        lockA = lockingQueue.fileLocks.get('file-a.json');
        lockB = lockingQueue.fileLocks.get('file-b.json');
    });

    it('allows both locks to be acquired immediately', () => {
        assertEqual(true, bothResolved);
    });

    it('creates separate lock structures', () => {
        assert(lockingQueue.fileLocks.has('file-a.json'));
        assert(lockingQueue.fileLocks.has('file-b.json'));
    });

    it('marks both locks as held', () => {
        assertEqual(true, lockA.isLocked);
        assertEqual(true, lockB.isLocked);
    });

    it('keeps locks independent (no queue cross-contamination)', () => {
        assertEqual(0, lockA.queue.length);
        assertEqual(0, lockB.queue.length);

        // Release file-a lock
        lockingQueue.releaseLock('file-a.json');

        // file-a should be unlocked, file-b still locked
        assertEqual(false, lockA.isLocked);
        assertEqual(true, lockB.isLocked);
    });
});


describe('LockingQueue prevents race condition during lock transfer', ({ before, it }) => {
    let lockingQueue;
    let isLockedAfterThread1Release;
    let queueLengthAfterThread1Release;
    let thread3WasQueued;

    before(async () => {
        lockingQueue = new LockingQueue();

        // Thread 1 acquires lock
        await lockingQueue.getLock('test-file.json');

        // Thread 2 queues for lock (Promise won't resolve until thread 1 releases)
        const thread2Promise = lockingQueue.getLock('test-file.json');

        // Verify thread 2 is queued
        const lockBeforeRelease = lockingQueue.fileLocks.get('test-file.json');
        assertEqual(1, lockBeforeRelease.queue.length);

        // Thread 1 releases (transfers lock to thread 2)
        lockingQueue.releaseLock('test-file.json');

        // Immediately capture lock state values after release
        const lockAfterRelease = lockingQueue.fileLocks.get('test-file.json');
        isLockedAfterThread1Release = lockAfterRelease.isLocked;
        queueLengthAfterThread1Release = lockAfterRelease.queue.length;

        // Thread 3 attempts to acquire RIGHT AFTER thread 1 releases
        // At this moment, lock should still be held (transferred to thread 2)
        const thread3Promise = lockingQueue.getLock('test-file.json');

        // Check if thread 3 was queued (meaning it couldn't acquire immediately)
        const lockAfterThread3Attempt = lockingQueue.fileLocks.get('test-file.json');
        thread3WasQueued = lockAfterThread3Attempt.queue.length > 0;

        // Wait for thread 2's promise to resolve
        await thread2Promise;

        // Thread 2 releases
        lockingQueue.releaseLock('test-file.json');

        // Wait for thread 3
        await thread3Promise;

        // Clean up
        lockingQueue.releaseLock('test-file.json');
    });

    it('keeps isLocked true after thread 1 releases (lock transferred)', () => {
        assertEqual(true, isLockedAfterThread1Release);
    });

    it('has empty queue after thread 1 releases (thread 2 got the lock)', () => {
        assertEqual(0, queueLengthAfterThread1Release);
    });

    it('forces thread 3 to queue (cannot acquire immediately after transfer)', () => {
        assertEqual(true, thread3WasQueued);
    });
});
