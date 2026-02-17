import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
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

    it('allows a subsequent getLock to acquire after releaseLock', async () => {
        lockingQueue.releaseLock('test-file.json');
        const secondLock = lockingQueue.getLock('test-file.json');
        const result = await secondLock;
        assertEqual(true, result);
    });
});


describe('LockingQueue#getLock() when lock is already held', ({ before, it }) => {
    let lockingQueue;
    let firstLockPromise;
    let secondLockPromise;
    let secondLockResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        firstLockPromise = lockingQueue.getLock('test-file.json');
        await firstLockPromise;

        secondLockResolved = false;
        secondLockPromise = lockingQueue.getLock('test-file.json');
        secondLockPromise.then(() => {
            secondLockResolved = true;
        });

        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
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
        await lockingQueue.getLock('test-file.json');
        lockingQueue.releaseLock('test-file.json');
    });

    it('allows next getLock() to acquire immediately', async () => {
        const lockPromise = lockingQueue.getLock('test-file.json');
        const result = await lockPromise;
        assertEqual(true, result);
    });
});


describe('LockingQueue#releaseLock() when waiters exist in queue', ({ before, it }) => {
    let lockingQueue;
    let secondLockPromise;
    let secondLockResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        await lockingQueue.getLock('test-file.json');

        secondLockResolved = false;
        secondLockPromise = lockingQueue.getLock('test-file.json');
        secondLockPromise.then(() => {
            secondLockResolved = true;
        });

        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });

        lockingQueue.releaseLock('test-file.json');

        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    });

    it('resolves the queued Promise', () => {
        assertEqual(true, secondLockResolved);
    });

    it('keeps lock held by the waiter until they release', async () => {
        let thirdResolvedWithin10ms = false;
        const thirdLockPromise = lockingQueue.getLock('test-file.json');
        thirdLockPromise.then(() => {
            thirdResolvedWithin10ms = true;
        });
        await new Promise((r) => {
            setTimeout(r, 10);
        });
        assertEqual(false, thirdResolvedWithin10ms);
        lockingQueue.releaseLock('test-file.json');
        await thirdLockPromise;
        lockingQueue.releaseLock('test-file.json');
    });
});


describe('LockingQueue with multiple concurrent waiters', ({ before, it }) => {
    let lockingQueue;
    let executionOrder;

    before(async () => {
        lockingQueue = new LockingQueue();
        executionOrder = [];

        await lockingQueue.getLock('test-file.json');
        executionOrder.push(1);

        const op2 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(2);
        });

        const op3 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(3);
        });

        const op4 = lockingQueue.getLock('test-file.json').then(() => {
            executionOrder.push(4);
        });

        lockingQueue.releaseLock('test-file.json');
        await op2;

        lockingQueue.releaseLock('test-file.json');
        await op3;

        lockingQueue.releaseLock('test-file.json');
        await op4;

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


describe('LockingQueue with different keys', ({ before, it }) => {
    let lockingQueue;
    let bothResolved;

    before(async () => {
        lockingQueue = new LockingQueue();

        const promiseA = lockingQueue.getLock('file-a.json');
        const promiseB = lockingQueue.getLock('file-b.json');

        bothResolved = false;

        await Promise.all([ promiseA, promiseB ]).then(() => {
            bothResolved = true;
        });
    });

    it('allows both locks to be acquired immediately', () => {
        assertEqual(true, bothResolved);
    });

    it('keeps locks independent (releasing one does not affect the other)', async () => {
        lockingQueue.releaseLock('file-a.json');

        const reAcquireA = lockingQueue.getLock('file-a.json');
        const acquireC = lockingQueue.getLock('file-c.json');

        const results = await Promise.all([ reAcquireA, acquireC ]);
        assertEqual(true, results[0]);
        assertEqual(true, results[1]);

        lockingQueue.releaseLock('file-b.json');
        lockingQueue.releaseLock('file-a.json');
        lockingQueue.releaseLock('file-c.json');
    });
});


describe('LockingQueue prevents race condition during lock transfer', ({ before, it }) => {
    let lockingQueue;
    let isLockedAfterThread1Release;
    let thread3WasQueued;

    before(async () => {
        lockingQueue = new LockingQueue();

        await lockingQueue.getLock('test-file.json');

        const thread2Promise = lockingQueue.getLock('test-file.json');

        lockingQueue.releaseLock('test-file.json');

        const thread3Promise = lockingQueue.getLock('test-file.json');
        let thread3ResolvedImmediately = false;
        thread3Promise.then(() => {
            thread3ResolvedImmediately = true;
        });

        await new Promise((resolve) => {
            setTimeout(resolve, 5);
        });

        isLockedAfterThread1Release = !thread3ResolvedImmediately;
        thread3WasQueued = !thread3ResolvedImmediately;

        await thread2Promise;
        lockingQueue.releaseLock('test-file.json');
        await thread3Promise;
        lockingQueue.releaseLock('test-file.json');
    });

    it('keeps lock held after thread 1 releases (lock transferred to thread 2)', () => {
        assertEqual(true, isLockedAfterThread1Release);
    });

    it('forces thread 3 to queue (cannot acquire immediately after transfer)', () => {
        assertEqual(true, thread3WasQueued);
    });
});
