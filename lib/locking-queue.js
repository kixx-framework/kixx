export default class LockingQueue {

    #queue = [];

    getLock() {
        if (this.#queue.length > 0) {
            return new Promise((resolve) => {
                this.#queue.unshift(resolve);
            });
        }

        return true;
    }

    releaseLock() {
        if (this.#queue.length > 0) {
            const resolve = this.#queue.pop();
            // Call resolve in the next tick to avoid executing before the caller has returned.
            queueMicrotask(resolve);
        }

        return true;
    }
}

