/**
 * Platform-agnostic event emitter supporting on(), once(), off(), and emit().
 * Safe to use in Node.js, Deno, Cloudflare Workers, and AWS Lambda.
 */
export default class EventEmitter {

    #handlers = new Map();
    #singleHandlers = new Map();

    /**
     * Registers a persistent listener for the named event.
     * @param {string} eventName
     * @param {Function} handler
     * @returns {EventEmitter} This instance for chaining
     */
    on(eventName, handler) {
        let set = this.#handlers.get(eventName);

        if (!set) {
            set = new Set();
            this.#handlers.set(eventName, set);
        }

        set.add(handler);
        return this;
    }

    /**
     * Registers a one-time listener that fires at most once per event name.
     * @param {string} eventName
     * @param {Function} handler
     * @returns {EventEmitter} This instance for chaining
     */
    once(eventName, handler) {
        let set = this.#singleHandlers.get(eventName);

        if (!set) {
            set = new Set();
            this.#singleHandlers.set(eventName, set);
        }

        set.add(handler);
        return this;
    }

    /**
     * Removes a listener, all listeners for an event, or all listeners entirely.
     * - off(eventName, handler) — removes the specific handler
     * - off(eventName) — removes all handlers for eventName
     * - off() — removes all handlers for all events
     * @param {string} [eventName]
     * @param {Function} [handler]
     * @returns {EventEmitter} This instance for chaining
     */
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

    /**
     * Invokes all registered listeners for the named event.
     * One-time listeners are cleared after firing.
     * @param {string} eventName
     * @param {*} [eventPayload]
     * @returns {EventEmitter} This instance for chaining
     */
    emit(eventName, eventPayload) {
        const handlers = this.#handlers.get(eventName);
        const singleHandlers = this.#singleHandlers.get(eventName);

        if (handlers) {
            for (const handler of handlers.values()) {
                handler(eventPayload);
            }
        }

        if (singleHandlers) {
            // Clear before invoking so re-entrant once() calls aren't lost
            this.#singleHandlers.delete(eventName);
            for (const handler of singleHandlers.values()) {
                handler(eventPayload);
            }
        }

        return this;
    }
}
