import JobQueue from './job-queue.js';
import defaultHost from './job-queue-host.js';
import {
    assert,
    assertNonEmptyString,
    isBoolean,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';


/**
 * Validates the JOB_QUEUE config, wires the host the Durable Object reads, and
 * registers the JobQueue service. Split from plugin.js so it can be tested
 * without importing the Durable Object (which needs `cloudflare:workers`).
 * @param {Object} context - Application context.
 */
export function registerJobQueue(context) {
    const { config, logger } = context;
    const queueConfig = config?.env?.JOB_QUEUE;

    assert(isPlainObject(queueConfig), 'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE');
    assertNonEmptyString(
        queueConfig.durableObjectBindingName,
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.durableObjectBindingName',
    );
    assert(
        isBoolean(queueConfig.enabled),
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.enabled to be a boolean',
    );
    assert(
        Number.isInteger(queueConfig.concurrency) && queueConfig.concurrency > 0,
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.concurrency to be a positive integer',
    );
    assert(
        Number.isFinite(queueConfig.softDeadlineSeconds) && queueConfig.softDeadlineSeconds > 0,
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.softDeadlineSeconds to be a positive number',
    );

    const { retention } = queueConfig;

    assert(isPlainObject(retention), 'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.retention');
    assert(
        Number.isFinite(retention.completedMaxAgeDays) && retention.completedMaxAgeDays > 0,
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.retention.completedMaxAgeDays to be a positive number',
    );
    assert(
        Number.isFinite(retention.failedMaxAgeDays) && retention.failedMaxAgeDays > 0,
        'cloudflare-job-queue plugin requires context.config.env.JOB_QUEUE.retention.failedMaxAgeDays to be a positive number',
    );

    // The Durable Object is built by the runtime, so it reads these from the host.
    defaultHost.logger = logger;
    defaultHost.config = {
        enabled: queueConfig.enabled,
        concurrency: queueConfig.concurrency,
        softDeadlineSeconds: queueConfig.softDeadlineSeconds,
        retention: {
            completedMaxAgeDays: retention.completedMaxAgeDays,
            failedMaxAgeDays: retention.failedMaxAgeDays,
        },
    };
    defaultHost.createJobContext = (env, job) => context.createJobContext(env, job);

    context.registerService('JobQueue', new JobQueue({
        host: defaultHost,
        bindingName: queueConfig.durableObjectBindingName,
    }));
}
