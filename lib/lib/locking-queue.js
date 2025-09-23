/**
 * LockingQueue
 * ============
 *
 * The LockingQueue class provides a simple locking mechanism for serializing asynchronous
 * operations. It allows only one operation to hold the "lock" at a time, and queues
 * additional requests until the lock is released. This is useful for ensuring that
 * critical sections of code are not executed concurrently, especially when working
 * with resources that require exclusive access (such as file systems or databases).
 *
 * Usage Example:
 *   const queue = new LockingQueue();
 *   async function criticalSection() {
 *     const lock = await queue.getLock();
 *     try {
 *       // Perform exclusive work here
 *     } finally {
 *       queue.releaseLock();
 *     }
 *   }
 */
export default class LockingQueue {
    /**
     * @private
     * @type {Array<Function>}
     * Queue of resolve functions for pending lock requests.
     */
    #queue = [];

    #isLocked = false;

    /**
     * Acquire the lock. If the lock is available, returns true immediately.
     * If the lock is held, returns a Promise that resolves when the lock is available.
     *
     * @returns {true|Promise<void>} True if lock acquired immediately, or a Promise that resolves when the lock is available.
     */
    getLock() {
        if (this.#isLocked) {
            return new Promise((resolve) => {
                this.#queue.push(resolve);
            });
        }

        this.#isLocked = true;
        return Promise.resolve(true);
    }

    /**
     * Release the lock and allow the next queued operation to proceed.
     * If there are pending requests, resolves the next one in the queue.
     *
     * @returns {true} Always returns true.
     */
    releaseLock() {
        if (this.#queue.length > 0) {
            const resolve = this.#queue.shift();
            resolve();
        } else {
            this.#isLocked = false;
        }
    }
}

