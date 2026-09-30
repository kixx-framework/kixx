import { DurableObject } from 'cloudflare:workers';
import JobQueueStoreCore from './job-queue-store-core.js';
import defaultHost from './job-queue-host.js';


/**
 * SQLite-backed Durable Object that owns the job queue. One instance, named
 * 'default', holds every job and schedule and runs handlers inside `alarm()`.
 * All behaviour lives in JobQueueStoreCore; this class only binds it to the
 * runtime. Its public methods are the RPC surface the Worker calls.
 * @extends DurableObject
 */
export default class JobQueueStore extends DurableObject {

    #core;

    /**
     * @param {DurableObjectState} ctx - Provided by the runtime.
     * @param {Object} env - Worker environment bindings, provided by the runtime.
     */
    constructor(ctx, env) {
        super(ctx, env);
        this.#core = new JobQueueStoreCore({ ctx, env, host: defaultHost });
    }

    ping() {
        return this.#core.ping();
    }

    enqueue(name, payload, options) {
        return this.#core.enqueue(name, payload, options);
    }

    get(id) {
        return this.#core.get(id);
    }

    list(options) {
        return this.#core.list(options);
    }

    retry(id) {
        return this.#core.retry(id);
    }

    listSchedules() {
        return this.#core.listSchedules();
    }

    alarm() {
        return this.#core.alarm();
    }
}
