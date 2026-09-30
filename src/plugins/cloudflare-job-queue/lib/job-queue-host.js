/**
 * Process-local bridge between the Worker-side JobQueue service and the
 * JobQueueStore Durable Object.
 *
 * A Durable Object is constructed by the runtime, not by the application, so
 * it cannot be handed the job registry, logger, or job-context factory. The
 * entry point boots the application at module scope, which registers the
 * plugin and installs the registry; the Durable Object, living in the same
 * isolate, reads them from the default host. This keeps `app/` out of the
 * plugin: nothing here imports application code.
 */
export class JobQueueHost {

    /** @type {Object|null} */
    logger = null;

    /** @type {{enabled: boolean, concurrency: number, softDeadlineSeconds: number, retention: Object}|null} */
    config = null;

    /** @type {Map<string, Object>|null} Resolved registry from `validateJobRegistry()`. */
    registry = null;

    /** @type {(function(Object, Object): Object)|null} `(env, job) => context` */
    createJobContext = null;

    /**
     * Maps a job context created inside a Durable Object to that Durable
     * Object, so a handler's `JobQueue.enqueue()` writes to the local store
     * instead of calling its own stub.
     * @type {WeakMap<Object, Object>}
     */
    directQueues = new WeakMap();
}

export default new JobQueueHost();
