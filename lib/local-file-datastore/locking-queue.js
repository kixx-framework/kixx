/**
 * Provides per-file locking to prevent race conditions when multiple
 * async operations attempt to read or modify the same file concurrently.
 *
 * Each file path gets its own lock with a FIFO queue. When a lock is held,
 * subsequent callers are queued and their Promises resolve in order as locks
 * are released.
 */
export default class LockingQueue {

    /**
     * Map of file paths to lock objects with structure: { isLocked: boolean, queue: Function[] }
     * The queue holds resolve callbacks for Promises waiting to acquire the lock
     * @type {Map<string, {isLocked: boolean, queue: Function[]}>}
     */
    fileLocks = new Map();

    /**
     * Acquires an exclusive lock for the specified file path.
     *
     * If the lock is available, it's acquired immediately and the returned Promise
     * resolves right away. If the lock is held by another caller, this method queues
     * the request and returns a Promise that won't resolve until the lock is released
     * and transferred to this caller (FIFO order).
     *
     * @async
     * @param {string} file - File path to lock
     * @returns {Promise<boolean>} Resolves to true when lock is acquired
     */
    getLock(file) {
        // Get or create lock structure for this file
        let lock;
        if (this.fileLocks.has(file)) {
            lock = this.fileLocks.get(file);
        } else {
            lock = { isLocked: false, queue: [] };
            this.fileLocks.set(file, lock);
        }

        // If lock is held, queue this caller and return a Promise that won't
        // resolve until releaseLock() transfers ownership to this caller.
        // By storing the resolve callback in the queue array, we create FIFO behavior:
        // releaseLock() calls shift() to get the next waiter, ensuring first-in-first-out order
        if (lock.isLocked) {
            return new Promise((resolve) => {
                lock.queue.push(resolve);
            });
        }

        // Lock is available - acquire it immediately and return resolved Promise
        lock.isLocked = true;
        return Promise.resolve(true);
    }

    /**
     * Releases the lock for the specified file path.
     *
     * If there are callers waiting in the queue, the lock is immediately transferred
     * to the next waiter (their Promise resolves). Otherwise, the lock is marked as
     * available for the next caller. Always call this after completing work to prevent
     * deadlocks.
     *
     * @param {string} file - File path to unlock
     * @returns {void}
     */
    releaseLock(file) {
        const lock = this.fileLocks.get(file);

        if (lock) {
            if (lock.queue.length > 0) {
                // Transfer lock ownership to next waiter in queue
                // Important: Keep isLocked=true to prevent race conditions - the lock
                // transfers atomically to the next waiter without becoming available to
                // other callers in between
                const resolve = lock.queue.shift();
                resolve();
            } else {
                // No waiters - mark lock as available for next caller
                lock.isLocked = false;
            }
        }
    }
}

