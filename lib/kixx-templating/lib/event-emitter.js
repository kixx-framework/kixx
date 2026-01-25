export default class EventEmitter {

    #handlers = new Map();
    #singleHandlers = new Map();

    on(eventName, handler) {
        let set = this.#handlers.get(eventName);

        if (!set) {
            set = new Set();
            this.#handlers.set(eventName, set);
        }

        set.add(handler);
        return this;
    }

    off(eventName, handler) {
        if (eventName && handler) {
            let handlers;

            handlers = this.#handlers.get(eventName);

            if (handlers) {
                handlers.delete(handler);
            }

            handlers = this.#singleHandlers.get(eventName);

            if (handlers) {
                handlers.delete(handler);
            }
        } else if (eventName) {
            this.#handlers.delete(eventName);
            this.#singleHandlers.delete(eventName);
        } else {
            this.#handlers.clear();
            this.#singleHandlers.clear();
        }

        return this;
    }

    once(eventName, handler) {
        let set = this.#singleHandlers.get(eventName);

        if (!set) {
            set = new Set();
            this.#singleHandlers.set(eventName, set);
        }

        set.add(handler);
        return this;
    }

    emit(eventName, eventPayload) {
        const handlers = this.#handlers.get(eventName);
        const singleHandlers = this.#singleHandlers.get(eventName);

        if (handlers) {
            const iter = handlers.values();

            for (const handler of iter) {
                handler(eventPayload);
            }
        }

        if (singleHandlers) {
            const iter = singleHandlers.values();
            singleHandlers.delete(eventName);

            for (const handler of iter) {
                handler(eventPayload);
            }
        }

        return this;
    }
}
