import JobQueue from './lib/job-queue.js';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isBoolean,
    isPlainObject,
} from '../../kixx/assertions/mod.js';


export function register(context) {
    const { config, logger } = context;
    const queueConfig = config?.env?.JOB_QUEUE;

    assert(isPlainObject(queueConfig), 'node-job-queue plugin requires context.config.env.JOB_QUEUE');
    assert(
        isBoolean(queueConfig.enabled),
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.enabled to be a boolean',
    );
    assertNonEmptyString(
        queueConfig.path,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.path',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-job-queue plugin requires context.config.resolveFilepath',
    );
    assert(
        Number.isFinite(queueConfig.pollIntervalSeconds) && queueConfig.pollIntervalSeconds > 0,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.pollIntervalSeconds to be a positive number',
    );
    assert(
        Number.isInteger(queueConfig.concurrency) && queueConfig.concurrency > 0,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.concurrency to be a positive integer',
    );
    assert(
        Number.isFinite(queueConfig.drainTimeoutSeconds) && queueConfig.drainTimeoutSeconds > 0,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.drainTimeoutSeconds to be a positive number',
    );

    const { retention } = queueConfig;

    assert(isPlainObject(retention), 'node-job-queue plugin requires context.config.env.JOB_QUEUE.retention');
    assert(
        Number.isFinite(retention.completedMaxAgeDays) && retention.completedMaxAgeDays > 0,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.retention.completedMaxAgeDays to be a positive number',
    );
    assert(
        Number.isFinite(retention.failedMaxAgeDays) && retention.failedMaxAgeDays > 0,
        'node-job-queue plugin requires context.config.env.JOB_QUEUE.retention.failedMaxAgeDays to be a positive number',
    );

    const storePath = config.resolveFilepath(queueConfig.path);
    assertNonEmptyString(
        storePath,
        'node-job-queue plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('JobQueue', new JobQueue({
        logger,
        path: storePath,
        enabled: queueConfig.enabled,
        pollIntervalSeconds: queueConfig.pollIntervalSeconds,
        concurrency: queueConfig.concurrency,
        drainTimeoutSeconds: queueConfig.drainTimeoutSeconds,
        retention: {
            completedMaxAgeDays: retention.completedMaxAgeDays,
            failedMaxAgeDays: retention.failedMaxAgeDays,
        },
        // Handlers run with the application's shared services and the boot environment.
        createContext: (job) => context.createJobContext(context.env, job),
    }));
}
