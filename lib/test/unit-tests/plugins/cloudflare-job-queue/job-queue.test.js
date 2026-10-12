import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import JobQueueStoreCore from '../../../../src/plugins/cloudflare-job-queue/lib/job-queue-store-core.js';
import JobQueue from '../../../../src/plugins/cloudflare-job-queue/lib/job-queue.js';
import { JobQueueHost } from '../../../../src/plugins/cloudflare-job-queue/lib/job-queue-host.js';
import { registerJobQueue as register } from '../../../../src/plugins/cloudflare-job-queue/lib/register-job-queue.js';
import Logger from '../../../../src/kixx/logger/logger.js';
import { NotFoundError, OperationalError } from '../../../../src/kixx/errors/mod.js';
import {
    heartbeatRuns,
    createRecurringTestRegistry,
} from '../../../fixtures/jobs/example-noop-heartbeat.js';
import { validateJobRegistry } from '../../../../src/kixx/jobs/job-registry.js';


const T0 = Date.UTC(2026, 2, 10, 0, 0, 0);
const RETENTION = { completedMaxAgeDays: 7, failedMaxAgeDays: 30 };

const databases = [];

// A fake Durable Object `ctx` whose SQLite is an in-memory node:sqlite database.
function makeCtx() {
    const db = new DatabaseSync(':memory:');
    databases.push(db);

    const ctx = {
        alarm: null,
        alarmSets: [],
        storage: {
            sql: {
                exec(sql, ...params) {
                    const statement = db.prepare(sql);
                    const rows = /^\s*(SELECT|WITH)/i.test(sql) || /RETURNING/i.test(sql)
                        ? statement.all(...params)
                        : (statement.run(...params), []);
                    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
                },
            },
            transactionSync(fn) {
                db.exec('BEGIN');

                try {
                    const result = fn();
                    db.exec('COMMIT');
                    return result;
                } catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                }
            },
            async getAlarm() {
                return ctx.alarm;
            },
            async setAlarm(time) {
                ctx.alarm = time;
                ctx.alarmSets.push(time);
            },
        },
        blockConcurrencyWhile: (fn) => fn(),
    };

    return ctx;
}

function makeHost({ entries = [], enabled = true, concurrency = 2, softDeadlineSeconds = 20 } = {}) {
    const host = new JobQueueHost();

    host.logger = new Logger({ name: 'Test', level: 'NONE' });
    host.config = { enabled, concurrency, softDeadlineSeconds, retention: RETENTION };
    host.registry = validateJobRegistry(new Map(entries));
    host.createJobContext = (env, job) => ({ env, job });

    return host;
}

function entry(name, handler, extra = {}) {
    return [ name, { name, description: `Test job ${ name }.`, handler, ...extra } ];
}

async function makeCore(host, { clock } = {}) {
    const ctx = makeCtx();
    const now = clock ? () => new Date(clock.time) : () => new Date(T0);
    const core = new JobQueueStoreCore({ ctx, env: { bound: true }, host, now });

    await core.ready;
    return { core, ctx };
}

function catchAsync(promise) {
    return promise.then(() => null, (error) => error);
}


describe('cloudflare-job-queue', ({ after, describe }) => {

    after(() => {
        for (const db of databases) {
            db.close();
        }
    });

    describe('JobQueueStoreCore', ({ it }) => {
        it('migrates, reconciles schedules, and arms the alarm at construction', async () => {
            const host = makeHost();
            host.registry = validateJobRegistry(createRecurringTestRegistry());

            const { core, ctx } = await makeCore(host);
            const [ schedule ] = await core.listSchedules();

            assertEqual('2026-03-10T00:15:00.000Z', schedule.nextRunAt);

            // The first retention purge is due at once, so the alarm is armed a
            // second out; after that pass it moves to the schedule.
            assertEqual(T0 + 1000, ctx.alarm);

            await core.alarm();

            assertEqual(Date.UTC(2026, 2, 10, 0, 15), ctx.alarm);
        });

        it('does not arm an alarm when disabled, but still records jobs', async () => {
            const host = makeHost({ enabled: false, entries: [ entry('one', async () => {}) ] });
            const { core, ctx } = await makeCore(host);

            const result = await core.enqueue('one', null);

            assertEqual(true, result.created);
            assertEqual(null, ctx.alarm);

            await core.alarm();

            assertEqual('pending', (await core.get(result.id)).status);
        });

        it('pulls the alarm earlier for an immediate job but never later', async () => {
            const host = makeHost({ entries: [ entry('one', async () => {}) ] });
            const { core, ctx } = await makeCore(host);

            await core.enqueue('one', null, { delaySeconds: 3600 });
            const afterDelayed = ctx.alarm;

            await core.enqueue('one', null, { delaySeconds: 7200 });
            assertEqual(afterDelayed, ctx.alarm);

            await core.enqueue('one', null);
            assertEqual(T0, ctx.alarm);
        });

        it('runs due jobs in alarm() and re-arms for the next wake time', async () => {
            const clock = { time: T0 };
            const ran = [];
            const host = makeHost({ entries: [ entry('one', async (_context, job) => ran.push(job.id)) ] });
            const { core, ctx } = await makeCore(host, { clock });

            const now = await core.enqueue('one', null);
            const later = await core.enqueue('one', null, { delaySeconds: 600 });

            await core.alarm();

            assertEqual(1, ran.length);
            assertEqual(now.id, ran[0]);
            assertEqual('completed', (await core.get(now.id)).status);
            assertEqual('pending', (await core.get(later.id)).status);
            assertEqual(T0 + 600000, ctx.alarm);
        });

        it('re-arms for now when the soft deadline leaves work behind', async () => {
            const clock = { time: T0 };
            const host = makeHost({
                concurrency: 1,
                softDeadlineSeconds: 10,
                entries: [ entry('one', async () => {
                    clock.time += 11000;
                }) ],
            });
            const { core, ctx } = await makeCore(host, { clock });

            // Distinct run_at values make the claim order deterministic.
            const first = await core.enqueue('one', null, { runAt: new Date(T0) });
            const second = await core.enqueue('one', null, { runAt: new Date(T0 + 1) });

            await core.alarm();

            assertEqual('completed', (await core.get(first.id)).status);
            assertEqual('pending', (await core.get(second.id)).status);
            assertEqual(clock.time, ctx.alarm);
        });

        it('runs a UTC recurring occurrence from the alarm', async () => {
            const clock = { time: T0 };
            const host = makeHost();
            host.registry = validateJobRegistry(createRecurringTestRegistry());
            const { core } = await makeCore(host, { clock });

            heartbeatRuns.length = 0;
            clock.time = T0 + (16 * 60 * 1000);
            await core.alarm();

            assertEqual(1, heartbeatRuns.length);
            assertEqual('2026-03-10T00:15:00.000Z', heartbeatRuns[0].scheduledFor);
        });

        it('logs an unexpected error after re-arming, without throwing', async () => {
            const clock = { time: T0 };
            const host = makeHost({ entries: [ entry('one', async () => {
                throw new TypeError('bug');
            }) ] });
            const logged = [];

            host.logger = { info() {}, warn() {}, error: (message, _info, error) => logged.push({ message, error }) };

            const { core, ctx } = await makeCore(host, { clock });
            const { id } = await core.enqueue('one', null);
            const setsBefore = ctx.alarmSets.length;

            assertEqual(null, await catchAsync(core.alarm()));

            assertEqual('failed', (await core.get(id)).status);
            assert(ctx.alarmSets.length > setsBefore);
            assert(logged.some((l) => l.error?.message === 'bug'));
        });

        it('registers a job context with the host so handlers reach this object directly', async () => {
            const clock = { time: T0 };
            const seen = {};
            const host = makeHost({ entries: [
                entry('parent', async (context) => {
                    seen.direct = host.directQueues.get(context);
                    seen.env = context.env;
                }),
            ] });
            const { core } = await makeCore(host, { clock });

            await core.enqueue('parent', null);
            await core.alarm();

            assertEqual(core, seen.direct);
            assertEqual(true, seen.env.bound);
        });

        it('retries a failed job and arms the alarm', async () => {
            const clock = { time: T0 };
            const host = makeHost({ entries: [ entry('one', async () => {
                throw Object.assign(new OperationalError('x'), { retryable: false });
            }, { maxAttempts: 1 }) ] });
            const { core, ctx } = await makeCore(host, { clock });

            const { id } = await core.enqueue('one', null);
            await core.alarm();

            assertEqual('failed', (await core.get(id)).status);

            ctx.alarm = null;
            const retried = await core.retry(id);

            assertEqual('pending', retried.status);
            assertEqual(T0, ctx.alarm);
        });
    });

    describe('JobQueue service', ({ it }) => {
        function makeService(entries = [ entry('one', async () => {}) ]) {
            const host = makeHost({ entries });
            host.registry = null;

            const service = new JobQueue({ host, bindingName: 'JOBS' });
            service.setRegistry(new Map(entries));

            const calls = [];
            const stub = {
                enqueue: async (...args) => {
                    calls.push([ 'enqueue', ...args ]);
                    return { id: 'x', created: true };
                },
                get: async (id) => {
                    calls.push([ 'get', id ]);
                    throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
                },
                list: async () => ({ jobs: [], cursor: null }),
                retry: async () => ({}),
                listSchedules: async () => [],
                ping: async () => {
                    calls.push([ 'ping' ]);
                    return true;
                },
            };
            const namespace = { idFromName: (name) => ({ name }), get: (id) => {
                calls.push([ 'stub', id.name ]);
                return stub;
            } };
            const requestContext = { env: { JOBS: namespace } };

            return { host, service, calls, stub, requestContext };
        }

        it('resolves the stub from context.env on every call', async () => {
            const { service, calls, requestContext } = makeService();

            await service.enqueue(requestContext, 'one', { a: 1 }, { key: 'k', delaySeconds: 60 });

            assertEqual('stub', calls[0][0]);
            assertEqual('default', calls[0][1]);
            assertEqual('enqueue', calls[1][0]);
            assertEqual('one', calls[1][1]);
            assertEqual('k', calls[1][3].key);
            assert(!Number.isNaN(Date.parse(calls[1][3].runAt)));
        });

        it('rejects unregistered names locally as an AssertionError', async () => {
            const { service, requestContext } = makeService();
            const error = await catchAsync(service.enqueue(requestContext, 'nope', null));

            assertEqual('AssertionError', error.name);
        });

        it('enqueues straight into the Durable Object from a job context, never through a stub', async () => {
            const { host, service, calls } = makeService();
            const direct = { enqueue: async (...args) => ({ id: 'direct', args }) };
            const jobContext = { env: {} };

            host.directQueues.set(jobContext, direct);

            const result = await service.enqueue(jobContext, 'one', null);

            assertEqual('direct', result.id);
            assertEqual(0, calls.length);
        });

        it('restores application error classes thrown over RPC', async () => {
            const { service, requestContext } = makeService();
            const error = await catchAsync(service.get(requestContext, 'missing'));

            assert(error instanceof NotFoundError);
            assertEqual('missing', error.message);
        });

        it('pings the Durable Object', async () => {
            const { service, calls, requestContext } = makeService();

            assertEqual(true, await service.ping(requestContext));
            assertEqual('ping', calls[1][0]);
        });

        it('fails when the binding is missing', async () => {
            const { service } = makeService();
            const error = await catchAsync(service.get({ env: {} }, 'id'));

            assertMatches('JOBS', error.message);
        });
    });

    describe('plugin register()', ({ it }) => {
        function makeConfig(overrides = {}) {
            return {
                env: {
                    JOB_QUEUE: {
                        enabled: true,
                        durableObjectBindingName: 'JOBS',
                        durableObjectClassName: 'JobQueueStore',
                        concurrency: 4,
                        softDeadlineSeconds: 20,
                        retention: { completedMaxAgeDays: 7, failedMaxAgeDays: 30 },
                        ...overrides,
                    },
                },
            };
        }

        it('registers the JobQueue service', () => {
            const registered = {};

            register({
                config: makeConfig(),
                logger: {},
                createJobContext: () => ({}),
                registerService: (name, service) => {
                    registered[name] = service;
                },
            });

            assert(registered.JobQueue instanceof JobQueue);
        });

        it('names the invalid config field', () => {
            let error = null;

            try {
                register({ config: makeConfig({ softDeadlineSeconds: 0 }), logger: {}, registerService: () => {} });
            } catch (e) {
                error = e;
            }

            assertMatches('context.config.env.JOB_QUEUE.softDeadlineSeconds', error.message);
        });
    });
});
