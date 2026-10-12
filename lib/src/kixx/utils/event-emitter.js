/**
 * Minimal platform-agnostic event emitter with no external dependencies.
 *
 * Handlers are stored per event name in Sets, so registering the same handler
 * function twice for one event is a no-op. Handlers registered with on() persist
 * across emits; handlers registered with once() fire on the next matching emit
 * and are then removed.
 *
 * Emitting an 'error' event with no registered handler throws the payload,
 * following the Node.js EventEmitter convention that an unhandled error must not
 * pass silently.
 *
 * @module EventEmitter
 */
export default class EventEmitter {

    /**
     * Persistent event handlers grouped by event name.
     * @type {Map<*, Set<Function>>}
     */
    #handlers = new Map();

    /**
     * One-time event handlers grouped by event name.
     * @type {Map<*, Set<Function>>}
     */
    #singleHandlers = new Map();

    /**
     * Registers a persistent handler for an event.
     * @param {*} eventName - Event key used to identify emitted events.
     * @param {Function} handler - Callback invoked with the emitted payload.
     * @returns {EventEmitter} This emitter instance for chaining.
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
     * Registers a one-time handler that fires on the next matching emit and is then removed.
     * @param {*} eventName - Event key used to identify emitted events.
     * @param {Function} handler - Callback invoked once with the emitted payload.
     * @returns {EventEmitter} This emitter instance for chaining.
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
     * Removes handlers from this emitter.
     *
     * When called with an event name and handler, only that handler is removed.
     * When called with only an event name, all handlers for that event are removed.
     * When called with no arguments, all handlers for all events are removed.
     *
     * @param {*} [eventName] - Event key whose handlers should be removed.
     * @param {Function} [handler] - Specific handler to remove.
     * @returns {EventEmitter} This emitter instance for chaining.
     */
    off(eventName, handler) {
        if (arguments.length > 1) {
            let handlers;

            handlers = this.#handlers.get(eventName);
            if (handlers) {
                handlers.delete(handler);
            }

            handlers = this.#singleHandlers.get(eventName);
            if (handlers) {
                handlers.delete(handler);
            }
        } else if (arguments.length === 1) {
            this.#handlers.delete(eventName);
            this.#singleHandlers.delete(eventName);
        } else {
            this.#handlers.clear();
            this.#singleHandlers.clear();
        }

        return this;
    }

    /**
     * Delivers an event payload to matching persistent and one-time handlers.
     * @param {*} eventName - Event key to emit.
     * @param {*} [eventPayload] - Payload passed to each matching handler.
     * @returns {EventEmitter} This emitter instance for chaining.
     * @throws {*} The eventPayload when eventName is 'error' and no handler is registered for it.
     * @throws Re-throws any error thrown by an invoked handler.
     */
    emit(eventName, eventPayload) {
        const handlers = this.#handlers.get(eventName);
        const singleHandlers = this.#singleHandlers.get(eventName);

        // Follow the Node.js EventEmitter convention: an unhandled 'error' event
        // throws its payload rather than being silently dropped.
        if (eventName === 'error' && !handlers && !singleHandlers) {
            throw eventPayload;
        }

        if (handlers) {
            // Snapshot before iterating so mid-emit mutations do not change which
            // persistent handlers receive the current event.
            for (const handler of [...handlers]) {
                handler(eventPayload);
            }
        }

        if (singleHandlers) {
            // Remove before invoking so re-entrant once() calls register for the
            // next emit instead of being erased after the current one finishes.
            this.#singleHandlers.delete(eventName);
            for (const handler of singleHandlers.values()) {
                handler(eventPayload);
            }
        }

        return this;
    }

    /**
     * Removes all persistent and one-time handlers from this emitter.
     * @returns {EventEmitter} This emitter instance for chaining.
     */
    clear() {
        this.#handlers.clear();
        this.#singleHandlers.clear();
        return this;
    }
}
