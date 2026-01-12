export default class LockingQueue {

    fileLocks = new Map();

    getLock(file) {
        let lock;
        if (this.fileLocks.has(file)) {
            lock = this.fileLocks.get(file);
        } else {
            lock = { isLocked: false, queue: [] };
            this.fileLocks.set(file, lock);
        }

        if (lock.isLocked) {
            return new Promise((resolve) => {
                lock.queue.push(resolve);
            });
        }

        lock.isLocked = true;
        return Promise.resolve(true);
    }

    releaseLock(file) {
        const lock = this.fileLocks.get(file);

        if (lock) {
            if (lock.queue.length > 0) {
                const resolve = lock.queue.shift();
                lock.isLocked = lock.queue.length > 0;
                resolve();
            } else {
                lock.isLocked = false;
            }
        }
    }
}

