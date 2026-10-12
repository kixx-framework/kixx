import { validateJobRegistry } from '../../../kixx/jobs/job-registry.js';
import { resolveEnqueue } from '../../../kixx/jobs/enqueue-options.js';
import {
    assert,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';
import {
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    ValidationError,
} from '../../../kixx/errors/mod.js';


const DURABLE_OBJECT_NAME = 'default';

// Errors thrown inside the Durable Object arrive over RPC as plain Errors, so
// restore the application error classes callers expect by name.
const RPC_ERROR_CLASSES = {
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    ValidationError,
};


/**
 * Worker-side JobQueue service. Reaches the JobQueueStore Durable Object
 * through an RPC stub resolved from the request's environment on every call,
 * because Cloudflare bindings are resolved at request time.
 *
 * Inside a running job the context is registered with the Durable Object in
 * the host, and calls go straight to that object instead of through a stub
 * to itself.
 *
 * @implements {import('../../../kixx/jobs/job-queue-interface.js').JobQueueInterface}
 */
export default class JobQueue {

    #host;
    #bindingName;

    /**
     * @param {Object} options
     * @param {import('./job-queue-host.js').JobQueueHost} options.host
     * @param {string} options.bindingName - Durable Object namespace binding name.
     */
    constructor(options) {
        const { host, bindingName } = options ?? {};

        assert(host, 'JobQueue requires a host');
        assertNonEmptyString(bindingName, 'JobQueue options.bindingName');

        this.#host = host;
        this.#bindingName = bindingName;
    }

    /**
     * Installs the job registry. Called once from `app.register()`.
     * @param {Map} registry - Unvalidated application registry.
     * @throws {AssertionError} When the registry is invalid.
     */
    setRegistry(registry) {
        this.#host.registry = validateJobRegistry(registry);
    }

    async enqueue(context, name, payload, options) {
        // Validate here so callers get AssertionErrors rather than RPC-flattened ones.
        const { runAt, key } = resolveEnqueue(this.#requireRegistry(), name, options, new Date());

        return this.#call(context, (queue) => queue.enqueue(name, payload, {
            runAt: runAt.toISOString(),
            key,
        }));
    }

    async get(context, id) {
        return this.#call(context, (queue) => queue.get(id));
    }

    async list(context, options) {
        return this.#call(context, (queue) => queue.list(options));
    }

    async retry(context, id) {
        return this.#call(context, (queue) => queue.retry(id));
    }

    async listSchedules(context) {
        return this.#call(context, (queue) => queue.listSchedules());
    }

    /**
     * Instantiates the Durable Object so schedule changes from a deploy are
     * reconciled without waiting for the first job.
     * @param {Object} context - Request context.
     * @returns {Promise<boolean>}
     */
    async ping(context) {
        return this.#call(context, (queue) => queue.ping());
    }

    #requireRegistry() {
        assert(this.#host.registry, 'JobQueue registry has not been set; call setRegistry() first');
        return this.#host.registry;
    }

    #resolve(context) {
        const direct = this.#host.directQueues.get(context);

        if (direct) {
            return direct;
        }

        const namespace = context.env[this.#bindingName];
        assert(namespace, `JobQueue Durable Object namespace binding "${ this.#bindingName }" is not bound on context.env`);

        return namespace.get(namespace.idFromName(DURABLE_OBJECT_NAME));
    }

    async #call(context, callback) {
        try {
            return await callback(this.#resolve(context));
        } catch (error) {
            const ErrorClass = RPC_ERROR_CLASSES[error?.name];

            if (ErrorClass && !(error instanceof ErrorClass)) {
                throw new ErrorClass(error.message, { cause: error });
            }

            throw error;
        }
    }
}
