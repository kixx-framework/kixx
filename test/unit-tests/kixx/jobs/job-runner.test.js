import { DatabaseSync } from 'node:sqlite';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import JobRunner from '../../../../src/kixx/jobs/job-runner.js';
import JobStateStore from '../../../../src/kixx/jobs/job-state-store.js';
import { validateJobRegistry } from '../../../../src/kixx/jobs/job-registry.js';
import { OperationalError, ValidationError } from '../../../../src/kixx/errors/mod.js';


const RETENTION = { completedMaxAgeDays: 7, failedMaxAgeDays: 30 };
const T0 = Date.UTC(2026, 2, 10, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;


describe('JobRunner', ({ describe }) => {

    describe('runDueJobs()', ({ it }) => {
        it('runs a due job and completes it', async () => {
            const calls = [];
            const h = makeHarness({
                entries: [ { name: 'one', handler: async (context, job) => calls.push({ context, job }) } ],
            });

            const { id } = h.enqueue('one', { a: 1 });
            const result = await h.run();

            assertEqual(1, result.ran);
            assertEqual(null, result.unexpectedError);
            assertEqual('completed', h.store.get(id).status);
            assertEqual(1, calls.length);
            assertEqual(id, calls[0].job.id);
            assertEqual('one', calls[0].job.name);
            assertEqual(1, calls[0].job.payload.a);
            assertEqual(1, calls[0].job.attempt);
            assertEqual(5, calls[0].job.maxAttempts);
            assertEqual(null, calls[0].job.scheduledFor);
            assert(calls[0].job.signal instanceof AbortSignal);
            assert(Object.isFrozen(calls[0].job));
            assertEqual(id, calls[0].context.claimed.id);
            assert(h.logs.some((l) => l.message === 'Job completed' && l.info.jobId === id));
        });

        it('returns immediately when nothing is due', async () => {
            const h = makeHarness({ entries: [ { name: 'one', handler: async () => {} } ] });

            assertEqual(0, (await h.run()).ran);
        });

        it('refills a slot as soon as a job settles without waiting for the slow one', async () => {
            const slow = deferred();
            const started = [];
            const h = makeHarness({
                concurrency: 2,
                entries: [
                    {
                        name: 'one',
                        handler: async (_context, job) => {
                            started.push(job.payload.n);

                            if (job.payload.n === 1) {
                                await slow.promise;
                            }
                        },
                    },
                ],
            });

            const ids = [ 1, 2, 3 ].map((n) => h.enqueue('one', { n }, n).id);

            const running = h.run();

            await sleep(10);

            // Job 1 is still blocked; job 3 ran in the slot job 2 freed.
            assertEqual('1,2,3', started.join(','));
            assertEqual('running', h.store.get(ids[0]).status);
            assertEqual('completed', h.store.get(ids[1]).status);
            assertEqual('completed', h.store.get(ids[2]).status);

            slow.resolve();

            assertEqual(3, (await running).ran);
            assertEqual('completed', h.store.get(ids[0]).status);
        });

        it('never runs more jobs at once than the concurrency', async () => {
            let active = 0;
            let peak = 0;
            const h = makeHarness({
                concurrency: 2,
                entries: [ {
                    name: 'one',
                    handler: async () => {
                        active += 1;
                        peak = Math.max(peak, active);
                        await sleep(5);
                        active -= 1;
                    },
                } ],
            });

            for (let i = 0; i < 6; i += 1) {
                h.enqueue('one', null, i);
            }

            assertEqual(6, (await h.run()).ran);
            assertEqual(2, peak);
        });

        it('stops claiming at the deadline while in-flight jobs finish', async () => {
            const h = makeHarness({
                concurrency: 1,
                entries: [ { name: 'one', handler: async () => h.clock.advance(5000) } ],
            });

            const ids = [ 1, 2, 3 ].map((n) => h.enqueue('one', null, n).id);

            const result = await h.run({ deadline: new Date(T0 + 4000) });

            assertEqual(1, result.ran);
            assertEqual('completed', h.store.get(ids[0]).status);
            assertEqual('pending', h.store.get(ids[1]).status);
            assertEqual('pending', h.store.get(ids[2]).status);
        });

        it('stops claiming once shouldStop returns true while in-flight jobs finish', async () => {
            let stop = false;
            const h = makeHarness({
                concurrency: 1,
                entries: [ { name: 'one', handler: async () => {
                    stop = true;
                } } ],
            });

            const ids = [ 1, 2 ].map((n) => h.enqueue('one', null, n).id);

            const result = await h.run({ shouldStop: () => stop });

            assertEqual(1, result.ran);
            assertEqual('completed', h.store.get(ids[0]).status);
            assertEqual('pending', h.store.get(ids[1]).status);
        });

        it('does not claim anything when the deadline has already passed', async () => {
            const h = makeHarness({ entries: [ { name: 'one', handler: async () => {} } ] });

            h.enqueue('one');

            assertEqual(0, (await h.run({ deadline: new Date(T0) })).ran);
        });

        it('materializes due schedules and runs the occurrence', async () => {
            const jobs = [];
            const h = makeHarness({
                entries: [ { name: 'sweep', schedule: { cron: '*/15 * * * *' }, handler: async (_c, job) => jobs.push(job) } ],
            });

            h.store.reconcileSchedules(new Date(T0), h.registry);

            assertEqual(0, (await h.run()).ran);

            h.clock.advance(15 * 60 * 1000);

            assertEqual(1, (await h.run()).ran);
            assertEqual(new Date(T0 + (15 * 60 * 1000)).toISOString(), jobs[0].scheduledFor);
        });

        it('purges expired jobs after running', async () => {
            const h = makeHarness({ entries: [ { name: 'one', handler: async () => {} } ] });
            const { id } = h.enqueue('one');

            await h.run();
            assert(h.store.get(id));

            h.clock.advance(8 * DAY_MS);
            await h.run();

            assertEqual(null, h.store.get(id));
        });

        it('rejects a missing createContext', async () => {
            const h = makeHarness({ entries: [] });
            let caught = null;

            try {
                await h.runner.runDueJobs({});
            } catch (error) {
                caught = error;
            }

            assertEqual('AssertionError', caught?.name);
        });
    });

    describe('timeouts', ({ it }) => {
        it('aborts the signal at timeoutSeconds and clears the timer on completion', async () => {
            const timers = stubTimers();

            try {
                let signal;
                const h = makeHarness({
                    entries: [ {
                        name: 'slow',
                        timeoutSeconds: 2,
                        handler: async (_context, job) => {
                            signal = job.signal;

                            await new Promise((resolve) => {
                                job.signal.addEventListener('abort', resolve);
                            });

                            throw new OperationalError('timed out');
                        },
                    }, {
                        name: 'quick',
                        handler: async () => {},
                    } ],
                });

                const slow = h.enqueue('slow', null, 0);

                const running = h.run();

                await sleep(0);

                const [ timer ] = timers.pending;

                assertEqual(2000, timer.ms);
                assertEqual(false, signal.aborted);

                timer.fire();

                await running;

                assertEqual(true, signal.aborted);
                assertEqual('TimeoutError', signal.reason.name);
                assertEqual('pending', h.store.get(slow.id).status);
                assertEqual('timed out', h.store.get(slow.id).lastError.message);

                // A job that finishes normally clears its timer.
                h.enqueue('quick', null, 1);
                timers.cleared.length = 0;
                await h.run();

                assertEqual(1, timers.cleared.length);
            } finally {
                timers.restore();
            }
        });

        it('sets each lease to the job timeout plus a margin', async () => {
            const h = makeHarness({
                entries: [ { name: 'one', timeoutSeconds: 10, handler: async () => {} } ],
            });

            let leaseMs;
            const claimNext = h.store.claimNext.bind(h.store);

            h.store.claimNext = (now, options) => {
                leaseMs = leaseMs ?? options.leaseMs('one');
                return claimNext(now, options);
            };

            h.enqueue('one');
            await h.run();

            assertEqual(40000, leaseMs);
        });
    });

    describe('error handling', ({ it }) => {
        it('schedules a retry with jittered backoff for a retryable error', async () => {
            const h = makeHarness({
                entries: [ { name: 'one', handler: failWith(new OperationalError('down')) } ],
            });

            const { id } = h.enqueue('one');

            const result = await h.run();
            const job = h.store.get(id);

            assertEqual(null, result.unexpectedError);
            assertEqual('pending', job.status);
            assertEqual(1, job.attempt);
            // Fixed jitter 0.5 x 10s ceiling.
            assertEqual(new Date(T0 + 5000).toISOString(), job.runAt);
            assertEqual('OperationalError', job.lastError.name);
            assertEqual('down', job.lastError.message);
            assertEqual(true, job.lastError.expected);
            assert(h.logs.some((l) => l.level === 'warn' && l.message === 'Job attempt failed; retry scheduled'));
        });

        it('retries until attempts are exhausted, then fails', async () => {
            const h = makeHarness({
                entries: [ { name: 'one', maxAttempts: 2, handler: failWith(new OperationalError('down')) } ],
            });

            const { id } = h.enqueue('one');

            await h.run();
            h.clock.advance(5000);
            await h.run();

            const job = h.store.get(id);

            assertEqual('failed', job.status);
            assertEqual(2, job.attempt);
            assert(h.logs.some((l) => l.message === 'Job failed; attempts exhausted'));
        });

        it('fails an expected non-retryable error immediately', async () => {
            const h = makeHarness({
                entries: [ { name: 'one', handler: failWith(new ValidationError('bad payload')) } ],
            });

            const { id } = h.enqueue('one');

            const result = await h.run();

            assertEqual(null, result.unexpectedError);
            assertEqual('failed', h.store.get(id).status);
            assertEqual(1, h.store.get(id).attempt);
        });

        it('honors retryable overrides in both directions', async () => {
            const h = makeHarness({
                entries: [
                    {
                        name: 'stop',
                        handler: failWith(Object.assign(new OperationalError('no'), { retryable: false })),
                    },
                    {
                        name: 'go',
                        handler: failWith(Object.assign(new ValidationError('yes'), { retryable: true })),
                    },
                ],
            });

            const stop = h.enqueue('stop', null, 0);
            const go = h.enqueue('go', null, 1);

            await h.run();

            assertEqual('failed', h.store.get(stop.id).status);
            assertEqual('pending', h.store.get(go.id).status);
        });

        it('fails an unexpected error at once, stops claiming, and returns the error', async () => {
            const boom = new TypeError('boom');
            const h = makeHarness({
                concurrency: 1,
                entries: [
                    { name: 'bad', handler: failWith(boom) },
                    { name: 'one', handler: async () => {} },
                ],
            });

            const bad = h.enqueue('bad', null, 0);
            const later = h.enqueue('one', null, 1);

            const result = await h.run();

            assertEqual(boom, result.unexpectedError);
            assertEqual(1, result.ran);
            assertEqual('failed', h.store.get(bad.id).status);
            assertEqual(false, h.store.get(bad.id).lastError.expected);
            assertEqual('pending', h.store.get(later.id).status);
            assert(h.logs.some((l) => l.level === 'error' && l.error === boom));
        });

        it('lets in-flight jobs finish after an unexpected error', async () => {
            const slow = deferred();
            const h = makeHarness({
                concurrency: 2,
                entries: [
                    { name: 'bad', handler: failWith(new TypeError('boom')) },
                    { name: 'slow', handler: () => slow.promise },
                ],
            });

            const slowJob = h.enqueue('slow', null, 0);

            h.enqueue('bad', null, 1);

            const running = h.run();

            await sleep(10);
            slow.resolve();

            const result = await running;

            assertEqual(2, result.ran);
            assertEqual('completed', h.store.get(slowJob.id).status);
        });

        it('treats a thrown non-Error as unexpected', async () => {
            const thrown = { message: 'oops' };
            const h = makeHarness({ entries: [ { name: 'one', handler: failWith(thrown) } ] });

            const { id } = h.enqueue('one');
            const result = await h.run();

            assertEqual(thrown, result.unexpectedError);
            assertEqual('oops', h.store.get(id).lastError.message);
            assertEqual('Error', h.store.get(id).lastError.name);
        });

        it('fails a job whose name is no longer registered without treating it as unexpected', async () => {
            const h = makeHarness({ entries: [ { name: 'one', handler: async () => {} } ] });
            const ghost = h.store.enqueue(new Date(T0), { name: 'ghost', maxAttempts: 5 });

            const result = await h.run();
            const job = h.store.get(ghost.id);

            assertEqual(null, result.unexpectedError);
            assertEqual('failed', job.status);
            assertEqual('UnknownJob', job.lastError.name);
            assert(h.logs.some((l) => l.level === 'warn' && l.info.name === 'ghost'));
        });

        it('treats a store failure while recording an outcome as unexpected', async () => {
            const h = makeHarness({ entries: [ { name: 'one', handler: async () => {} } ] });

            h.enqueue('one');
            h.store.complete = () => {
                throw new Error('disk full');
            };

            const result = await h.run();

            assertEqual('disk full', result.unexpectedError.message);
        });
    });

    describe('claim ownership', ({ it }) => {
        it('discards a completion that arrives after the lease expired', async () => {
            const h = makeHarness({
                entries: [ { name: 'one', handler: async () => h.clock.advance(100 * 1000) } ],
            });

            const { id } = h.enqueue('one');

            await h.run();

            // Lease is 60s + 30s and the handler took 100s, so the outcome was
            // refused, and the next claim attempt recovered the expired lease.
            assertEqual('pending', h.store.get(id).status);
            assertEqual('LeaseExpiredError', h.store.get(id).lastError.name);
            assert(h.logs.some((l) => l.message === 'Job finished after its claim expired; outcome discarded'));
        });

        it('leaves a newer attempt untouched when a stale run reports an outcome', async () => {
            let attempts = 0;
            const h = makeHarness({
                entries: [ {
                    name: 'one',
                    handler: async () => {
                        attempts += 1;

                        if (attempts > 1) {
                            return;
                        }

                        // While this attempt is "hung": its lease expires, recovery
                        // schedules a retry, and another worker claims attempt 2.
                        h.clock.advance(100 * 1000);
                        h.store.claimNext(h.clock.now(), { leaseMs: 90000 });
                        h.clock.advance(6000);
                        h.store.claimNext(h.clock.now(), { leaseMs: 90000 });
                    },
                } ],
            });

            const { id } = h.enqueue('one');

            await h.run();

            const job = h.store.get(id);

            assertEqual(1, attempts);
            assertEqual('running', job.status);
            assertEqual(2, job.attempt);
            assertEqual('LeaseExpiredError', job.lastError.name);
        });

        it('still returns an unexpected error whose outcome was discarded as stale', async () => {
            const boom = new TypeError('boom');
            const h = makeHarness({
                entries: [ {
                    name: 'one',
                    handler: async () => {
                        h.clock.advance(100 * 1000);
                        throw boom;
                    },
                } ],
            });

            const { id } = h.enqueue('one');
            const result = await h.run();

            assertEqual(boom, result.unexpectedError);
            assertEqual('pending', h.store.get(id).status);
            assertEqual('LeaseExpiredError', h.store.get(id).lastError.name);
        });
    });
});

function makeHarness(options) {
    const { entries, concurrency = 4, random = () => 0.5 } = options;

    const clock = {
        ms: T0,
        now() {
            return new Date(this.ms);
        },
        advance(ms) {
            this.ms += ms;
        },
    };

    const db = new DatabaseSync(':memory:');
    const sql = {
        all: (statement, ...params) => db.prepare(statement).all(...params).map((row) => ({ ...row })),
        run: (statement, ...params) => {
            db.prepare(statement).run(...params);
        },
        transaction(fn) {
            db.exec('BEGIN IMMEDIATE');

            try {
                const result = fn();
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
    };

    const logs = [];
    const record = (level) => (message, info, error) => logs.push({ level, message, info, error });
    const logger = { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };

    const store = new JobStateStore({ sql, logger, random });

    store.migrate();

    const registry = validateJobRegistry(new Map(entries.map((entry) => [
        entry.name,
        { description: `Runs ${ entry.name }`, ...entry },
    ])));

    const runner = new JobRunner({ store, registry, logger, concurrency, retention: RETENTION, random });

    return {
        store,
        registry,
        runner,
        clock,
        logs,
        // Distinct created_at values give a deterministic claim order.
        enqueue: (name, payload, offsetMs = 0) => store.enqueue(new Date(T0 + offsetMs), {
            name,
            payload,
            maxAttempts: registry.get(name).maxAttempts,
            runAt: new Date(T0),
        }),
        run: (runOptions) => runner.runDueJobs({
            now: () => clock.now(),
            createContext: (claimed) => ({ claimed }),
            ...runOptions,
        }),
    };
}

function failWith(error) {
    return async () => {
        throw error;
    };
}

function deferred() {
    const result = {};

    result.promise = new Promise((resolve) => {
        result.resolve = resolve;
    });

    return result;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// Replaces the global timers so a test can fire a job's timeout by hand
// instead of waiting for it. Only timers with a delay of 1s or more are
// captured; short ones (such as sleep()) still run for real.
function stubTimers() {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const state = { pending: [], cleared: [] };

    globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms < 1000) {
            return realSetTimeout(fn, ms, ...args);
        }

        const timer = { ms, fire: fn, cleared: false };

        state.pending.push(timer);
        return timer;
    };

    globalThis.clearTimeout = (handle) => {
        if (state.pending.includes(handle)) {
            handle.cleared = true;
            state.cleared.push(handle);
            return;
        }

        realClearTimeout(handle);
    };

    state.restore = () => {
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    };

    return state;
}
