import JobStateStore from '../../../kixx/jobs/job-state-store.js';
import JobRunner from '../../../kixx/jobs/job-runner.js';
import { resolveEnqueue } from '../../../kixx/jobs/enqueue-options.js';
import { assert } from '../../../kixx/assertions/mod.js';
import { createDurableObjectSqlExecutor } from './durable-object-sql-executor.js';


// When a pass ran nothing, never re-arm sooner than this, so a wake time that
// stays in the past cannot spin the alarm in a hot loop.
const MIN_IDLE_REARM_MS = 1000;


/**
 * The behaviour of the JobQueueStore Durable Object, kept free of the
 * `cloudflare:workers` import so it can be tested with a fake `ctx`.
 *
 * The constructor migrates the schema, reconciles declared schedules, and
 * re-arms the alarm under `blockConcurrencyWhile`, so a deploy's registry
 * changes are picked up as soon as the object is instantiated.
 *
 * `alarm()` runs due jobs inside one invocation with a soft deadline, then
 * re-arms: immediately when work remains, otherwise at the next wake time.
 */
export default class JobQueueStoreCore {

    #ctx;
    #env;
    #host;
    #now;
    #store;
    #runner;

    /**
     * @param {Object} options
     * @param {Object} options.ctx - Durable Object state.
     * @param {Object} options.env - Worker environment bindings; passed to job contexts.
     * @param {import('./job-queue-host.js').JobQueueHost} options.host
     * @param {function(): Date} [options.now] - Clock; injectable for tests.
     */
    constructor(options) {
        const { ctx, env, host, now = () => new Date() } = options;

        assert(host.registry, 'JobQueueStore requires the application to have installed a job registry');
        assert(host.config, 'JobQueueStore requires the job queue plugin to have been registered');

        this.#ctx = ctx;
        this.#env = env;
        this.#host = host;
        this.#now = now;

        this.#store = new JobStateStore({
            sql: createDurableObjectSqlExecutor(ctx.storage),
            logger: host.logger,
        });

        this.#runner = new JobRunner({
            store: this.#store,
            registry: host.registry,
            logger: host.logger,
            concurrency: host.config.concurrency,
            retention: host.config.retention,
        });

        // Requests must not observe a partially initialized schema or stale schedules.
        this.ready = ctx.blockConcurrencyWhile(async () => {
            this.#store.migrate();

            if (host.config.enabled) {
                this.#store.reconcileSchedules(this.#now(), host.registry);
                await this.#rearm(this.#now(), 0);
            }
        });
    }

    /**
     * Instantiates the object. Called by the Worker once per isolate so a
     * deploy's schedule changes are picked up without waiting for a job.
     * @returns {Promise<boolean>}
     */
    async ping() {
        return true;
    }

    async enqueue(name, payload, options) {
        const now = this.#now();
        const { entry, runAt, key } = resolveEnqueue(this.#host.registry, name, options, now);

        const result = this.#store.enqueue(now, {
            name,
            payload,
            runAt,
            key,
            maxAttempts: entry.maxAttempts,
        });

        if (result.created) {
            await this.#armNoLaterThan(runAt, now);
        }

        return result;
    }

    async get(id) {
        return this.#store.get(id);
    }

    async list(options) {
        return this.#store.list(options);
    }

    async retry(id) {
        const now = this.#now();
        const job = this.#store.retry(now, id);

        await this.#armNoLaterThan(now, now);
        return job;
    }

    async listSchedules() {
        return this.#store.listSchedules();
    }

    /**
     * Runs due jobs until the soft deadline, then re-arms the alarm.
     *
     * An unexpected job error is logged at error level and NOT rethrown: the
     * job is already failed terminally, and a rethrow would make the platform
     * retry the alarm, which cannot help. The alarm is re-armed first so the
     * remaining queue keeps draining.
     * @returns {Promise<void>}
     */
    async alarm() {
        const { config, logger } = this.#host;

        if (!config.enabled) {
            return;
        }

        const deadline = new Date(this.#now().getTime() + (config.softDeadlineSeconds * 1000));

        const result = await this.#runner.runDueJobs({
            now: this.#now,
            deadline,
            createContext: (job) => this.#createContext(job),
        });

        await this.#rearm(this.#now(), result.ran);

        if (result.unexpectedError) {
            logger.error('Unexpected job error; the job queue stopped claiming for this invocation', null, result.unexpectedError);
        }
    }

    #createContext(job) {
        const context = this.#host.createJobContext(this.#env, job);
        this.#host.directQueues.set(context, this);
        return context;
    }

    async #rearm(now, ran) {
        const wake = this.#store.nextWakeTime(now).getTime();
        const floor = now.getTime() + (ran > 0 ? 0 : MIN_IDLE_REARM_MS);

        await this.#ctx.storage.setAlarm(Math.max(wake, floor));
    }

    async #armNoLaterThan(time, now) {
        if (!this.#host.config.enabled) {
            return;
        }

        const target = Math.max(time.getTime(), now.getTime());
        const current = await this.#ctx.storage.getAlarm();

        if (current === null || current > target) {
            await this.#ctx.storage.setAlarm(target);
        }
    }
}
