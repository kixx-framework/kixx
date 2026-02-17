/**
 * Provides per-key locking to prevent race conditions when multiple
 * async operations attempt to read or modify the same resource concurrently.
 *
 * Each key gets its own lock with a FIFO queue. When a lock is held,
 * subsequent callers are queued and their Promises resolve in order as locks
 * are released.
 */
export default class LockingQueue {

    /**
     * Map of keys to lock objects with structure: { isLocked: boolean, queue: Function[] }
     * @type {Map<string, {isLocked: boolean, queue: Function[]}>}
     */
    #fileLocks = new Map();

    /**
     * Acquires an exclusive lock for the specified key.
     *
     * If the lock is available, it's acquired immediately and the returned Promise
     * resolves right away. If the lock is held by another caller, this method queues
     * the request and returns a Promise that won't resolve until the lock is released
     * and transferred to this caller (FIFO order).
     *
     * @async
     * @param {string} key - Resource key to lock (e.g. document primary key)
     * @returns {Promise<boolean>} Resolves to true when lock is acquired
     */
    getLock(key) {
        let lock;
        if (this.#fileLocks.has(key)) {
            lock = this.#fileLocks.get(key);
        } else {
            lock = { isLocked: false, queue: [] };
            this.#fileLocks.set(key, lock);
        }

        if (lock.isLocked) {
            return new Promise((resolve) => {
                lock.queue.push(resolve);
            });
        }

        lock.isLocked = true;
        return Promise.resolve(true);
    }

    /**
     * Releases the lock for the specified key.
     *
     * If there are callers waiting in the queue, the lock is immediately transferred
     * to the next waiter (their Promise resolves). Otherwise, the lock is marked as
     * available for the next caller. Always call this after completing work to prevent
     * deadlocks.
     *
     * @param {string} key - Resource key to unlock
     * @returns {void}
     */
    releaseLock(key) {
        const lock = this.#fileLocks.get(key);

        if (lock) {
            if (lock.queue.length > 0) {
                const resolve = lock.queue.shift();
                resolve();
            } else {
                lock.isLocked = false;
            }
        }
    }
}

