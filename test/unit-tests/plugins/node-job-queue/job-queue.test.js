import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { register } from '../../../../src/plugins/node-job-queue/plugin.js';
import Logger from '../../../../src/kixx/logger/logger.js';
import { OperationalError } from '../../../../src/kixx/errors/mod.js';
import {
    heartbeatRuns,
    createRecurringTestRegistry,
} from '../../../fixtures/jobs/example-noop-heartbeat.js';


const T0 = Date.UTC(2026, 2, 10, 0, 0, 0);

const tempDirs = [];
const queues = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-job-queue-'));
    tempDirs.push(dir);
    return dir;
}

function makeConfig(overrides = {}) {
    return {
        env: {
            JOB_QUEUE: {
                enabled: true,
                path: 'job_queue.sqlite',
                pollIntervalSeconds: 0.02,
                concurrency: 2,
                drainTimeoutSeconds: 1,
                retention: { completedMaxAgeDays: 7, failedMaxAgeDays: 30 },
                ...overrides,
            },
        },
        resolveFilepath: (relative) => relative,
    };
}

// Registers the plugin against a fake application context and returns the service.
function makeQueue(directory, { registry, overrides } = {}) {
    const config = makeConfig(overrides);
    config.env.JOB_QUEUE.path = path.join(directory, 'job_queue.sqlite');

    let service;
    const context = {
        config,
        env: { fake: true },
        logger: new Logger({ name: 'Test', level: 'NONE' }),
        registerService: (name, instance) => {
            assertEqual('JobQueue', name);
            service = instance;
        },
        createJobContext: (env, job) => ({ env, job }),
    };

    register(context);
    service.setRegistry(registry ?? new Map());
    queues.push(service);
    return service;
}

function entry(name, handler, extra = {}) {
    return [ name, { name, description: `Test job ${ name }.`, handler, ...extra } ];
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 2000) {
    const start = Date.now();

    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor timed out');
        }

        await sleep(5);
    }
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('node-job-queue', ({ after, describe }) => {

    after(async () => {
        for (const queue of queues) {
            queue.close();
        }

        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('plugin register()', ({ it }) => {
        it('names the missing config field', () => {
            const config = makeConfig({ concurrency: 0 });
            const context = { config, logger: {}, registerService: () => {} };
            const error = catchError(() => register(context));

            assertMatches('context.config.env.JOB_QUEUE.concurrency', error.message);
        });

        it('requires the JOB_QUEUE block', () => {
            const context = { config: { env: {}, resolveFilepath: (p) => p }, logger: {}, registerService: () => {} };
            const error = catchError(() => register(context));

            assertMatches('context.config.env.JOB_QUEUE', error.message);
        });
    });

    describe('enqueue and processDueJobs()', ({ it }) => {
        it('runs an immediate job with the job context and completes it', async () => {
            const directory = await makeTempDir();
            const calls = [];
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async (context, job) => calls.push({ context, job })) ]),
            });

            const enqueued = await queue.enqueue({}, 'one', { a: 1 });

            assertEqual(true, enqueued.created);

            const result = await queue.processDueJobs();

            assertEqual(1, result.ran);
            assertEqual(1, calls.length);
            assertEqual(true, calls[0].context.env.fake);
            assertEqual(enqueued.id, calls[0].job.id);
            assertEqual('completed', (await queue.get({}, enqueued.id)).status);
        });

        it('holds a delayed job until it is due', async () => {
            const directory = await makeTempDir();
            const ran = [];
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async (_context, job) => ran.push(job.id)) ]),
            });

            const enqueued = await queue.enqueue({}, 'one', null, { delaySeconds: 300 });
            const dueAt = new Date(Date.parse(enqueued.runAt));

            assertEqual(0, (await queue.processDueJobs({ now: new Date(dueAt.getTime() - 1000) })).ran);
            assertEqual(1, (await queue.processDueJobs({ now: new Date(dueAt.getTime() + 1000) })).ran);
            assertEqual(1, ran.length);
        });

        it('rejects unknown names and conflicting timing options', async () => {
            const directory = await makeTempDir();
            const queue = makeQueue(directory, { registry: new Map([ entry('one', async () => {}) ]) });

            let error = await queue.enqueue({}, 'missing', null).catch((e) => e);
            assertEqual('AssertionError', error.name);

            error = await queue.enqueue({}, 'one', null, { runAt: new Date(), delaySeconds: 1 }).catch((e) => e);
            assertEqual('AssertionError', error.name);
        });

        it('dedupes on key while the job is active', async () => {
            const directory = await makeTempDir();
            const queue = makeQueue(directory, { registry: new Map([ entry('one', async () => {}) ]) });

            const first = await queue.enqueue({}, 'one', null, { key: 'k' });
            const second = await queue.enqueue({}, 'one', null, { key: 'k' });

            assertEqual(false, second.created);
            assertEqual(first.id, second.id);
        });

        it('runs a UTC cron occurrence once due and lists the schedule', async () => {
            const directory = await makeTempDir();
            const queue = makeQueue(directory, { registry: createRecurringTestRegistry() });

            heartbeatRuns.length = 0;

            // Reconciles the schedule from T0; the next occurrence is 00:15 UTC.
            assertEqual(0, (await queue.processDueJobs({ now: new Date(T0) })).ran);

            const [ schedule ] = await queue.listSchedules({});
            assertEqual('2026-03-10T00:15:00.000Z', schedule.nextRunAt);

            const result = await queue.processDueJobs({ now: new Date(T0 + (16 * 60 * 1000)) });

            assertEqual(1, result.ran);
            assertEqual(1, heartbeatRuns.length);
            assertEqual('2026-03-10T00:15:00.000Z', heartbeatRuns[0].scheduledFor);
        });

        it('keeps jobs across a restart', async () => {
            const directory = await makeTempDir();
            const registry = new Map([ entry('one', async () => {}) ]);
            const first = makeQueue(directory, { registry });

            const { id } = await first.enqueue({}, 'one', { n: 1 });
            first.close();

            const second = makeQueue(directory, { registry });

            assertEqual('pending', (await second.get({}, id)).status);
            assertEqual(1, (await second.processDueJobs()).ran);
            assertEqual('completed', (await second.get({}, id)).status);
        });

        it('records jobs without running them when disabled', async () => {
            const directory = await makeTempDir();
            const calls = [];
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async () => calls.push(1)) ]),
                overrides: { enabled: false },
            });

            const { id } = await queue.enqueue({}, 'one', null);

            queue.start({ onUnexpectedError: () => {} });

            assertEqual(0, (await queue.processDueJobs()).ran);
            assertEqual(0, calls.length);
            assertEqual('pending', (await queue.get({}, id)).status);

            await queue.stop();
        });

        it('retries a failed job through the retry method', async () => {
            const directory = await makeTempDir();
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async () => {
                    throw new OperationalError('nope', { retryable: false });
                }, { maxAttempts: 1 }) ]),
            });

            const { id } = await queue.enqueue({}, 'one', null);
            await queue.processDueJobs();

            assertEqual('failed', (await queue.get({}, id)).status);

            const retried = await queue.retry({}, id);

            assertEqual('pending', retried.status);
        });
    });

    describe('sharing one database file', ({ it }) => {
        it('never runs the same job in two queues', async () => {
            const directory = await makeTempDir();
            const seen = [];
            const registry = new Map([ entry('one', async (_context, job) => {
                seen.push(job.id);
                await sleep(2);
            }) ]);
            const a = makeQueue(directory, { registry });
            const b = makeQueue(directory, { registry });

            for (let i = 0; i < 20; i += 1) {
                await a.enqueue({}, 'one', { i });
            }

            const [ ra, rb ] = await Promise.all([ a.processDueJobs(), b.processDueJobs() ]);

            assertEqual(20, ra.ran + rb.ran);
            assertEqual(20, seen.length);
            assertEqual(20, new Set(seen).size);
        });

        it('retries a job abandoned by a killed process after its lease expires', async () => {
            const directory = await makeTempDir();
            const release = deferred();
            const attempts = [];
            const registry = new Map([ entry('one', async (_context, job) => {
                attempts.push(job.attempt);

                if (job.attempt === 1) {
                    await release.promise;
                }
            }, { timeoutSeconds: 1 }) ]);

            const a = makeQueue(directory, { registry });
            const b = makeQueue(directory, { registry });
            const { id } = await a.enqueue({}, 'one', null);

            // Process A claims the job and hangs, as if killed mid-run.
            const hung = a.processDueJobs();
            await waitFor(() => attempts.length === 1);

            // After the lease (timeout + 30 s) and backoff (<= 10 s), B recovers it.
            const later = Date.now() + (5 * 60 * 1000);

            await b.processDueJobs({ now: new Date(later) });
            const result = await b.processDueJobs({ now: new Date(later + (60 * 1000)) });

            assertEqual(1, result.ran);
            assertEqual(2, attempts[1]);
            assertEqual('completed', (await b.get({}, id)).status);

            release.resolve();
            await hung;
        });
    });

    describe('loop', ({ it }) => {
        it('runs jobs enqueued after start without a nudge and stops cleanly', async () => {
            const directory = await makeTempDir();
            const ran = [];
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async (_context, job) => ran.push(job.id)) ]),
            });

            queue.start({ onUnexpectedError: () => {} });

            const { id } = await queue.enqueue({}, 'one', null);

            await waitFor(() => ran.length === 1);
            await queue.stop();

            assertEqual(id, ran[0]);
            assertEqual('completed', (await queue.get({}, id)).status);
        });

        it('does not overlap passes', async () => {
            const directory = await makeTempDir();
            let active = 0;
            let peak = 0;
            let total = 0;
            const queue = makeQueue(directory, {
                overrides: { concurrency: 1 },
                registry: new Map([ entry('one', async () => {
                    active += 1;
                    peak = Math.max(peak, active);
                    await sleep(5);
                    active -= 1;
                    total += 1;
                }) ]),
            });

            for (let i = 0; i < 5; i += 1) {
                await queue.enqueue({}, 'one', { i });
            }

            queue.start({ onUnexpectedError: () => {} });
            await waitFor(() => total === 5);
            await queue.stop();

            assertEqual(1, peak);
        });

        it('drains in-flight jobs on stop() and claims no more', async () => {
            const directory = await makeTempDir();
            const release = deferred();
            const started = [];
            const queue = makeQueue(directory, {
                overrides: { concurrency: 1 },
                registry: new Map([ entry('one', async (_context, job) => {
                    started.push(job.payload.n);
                    await release.promise;
                }) ]),
            });

            const first = await queue.enqueue({}, 'one', { n: 1 });
            const second = await queue.enqueue({}, 'one', { n: 2 });

            queue.start({ onUnexpectedError: () => {} });
            await waitFor(() => started.length === 1);

            const stopped = queue.stop();
            release.resolve();
            await stopped;

            assertEqual('completed', (await queue.get({}, first.id)).status);
            assertEqual('pending', (await queue.get({}, second.id)).status);
            assertEqual(1, started.length);
        });

        it('stops waiting for a stuck job after the drain timeout', async () => {
            const directory = await makeTempDir();
            const release = deferred();
            const queue = makeQueue(directory, {
                overrides: { drainTimeoutSeconds: 0.05 },
                registry: new Map([ entry('one', () => release.promise) ]),
            });

            await queue.enqueue({}, 'one', null);
            queue.start({ onUnexpectedError: () => {} });
            await sleep(50);

            const began = Date.now();
            await queue.stop();

            assert(Date.now() - began < 1000);

            release.resolve();
        });

        it('reports an unexpected handler error, fails the job, and stops the loop', async () => {
            const directory = await makeTempDir();
            const errors = [];
            const queue = makeQueue(directory, {
                registry: new Map([ entry('one', async () => {
                    throw new TypeError('bug');
                }) ]),
            });

            const { id } = await queue.enqueue({}, 'one', null);

            queue.start({ onUnexpectedError: (error) => errors.push(error) });
            await waitFor(() => errors.length === 1);
            await queue.stop();

            assertEqual('bug', errors[0].message);
            assertEqual('failed', (await queue.get({}, id)).status);
        });
    });
});
