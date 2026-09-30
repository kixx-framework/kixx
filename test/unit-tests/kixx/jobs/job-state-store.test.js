import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import JobStateStore, { MAX_PAYLOAD_BYTES } from '../../../../src/kixx/jobs/job-state-store.js';
import { validateJobRegistry } from '../../../../src/kixx/jobs/job-registry.js';


const LEASE_MS = 60 * 1000;
const RETENTION = { completedMaxAgeDays: 7, failedMaxAgeDays: 30 };
const ERROR_RECORD = { name: 'OperationalError', message: 'down', expected: true };
const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed jitter of 0.5 makes attempt N wait 5s * 2^(N - 1).
const HALF = () => 0.5;


describe('JobStateStore', ({ describe }) => {

    describe('migrate()', ({ it }) => {
        it('is idempotent and records the schema version', () => {
            const { store, sql } = makeStore();

            store.migrate();
            store.migrate();

            assertEqual('1', sql.all("SELECT value FROM job_queue_meta WHERE key = 'schema_version'")[0].value);
        });

        it('refuses a database written by a newer schema', () => {
            const { store, sql } = makeStore();

            sql.run("UPDATE job_queue_meta SET value = '99' WHERE key = 'schema_version'");

            const error = catchError(() => store.migrate());

            assert(error, 'expected an error');
            assertEqual('AssertionError', error.name);
        });
    });

    describe('enqueue()', ({ it }) => {
        it('records a pending job due now by default', () => {
            const { store } = makeStore();
            const result = store.enqueue(at(0), { name: 'one', payload: { a: 1 }, maxAttempts: 5 });

            assertEqual(true, result.created);
            assertEqual('pending', result.status);
            assertEqual(at(0).toISOString(), result.runAt);

            const job = store.get(result.id);

            assertEqual(1, job.payload.a);
            assertEqual(0, job.attempt);
            assertEqual(5, job.maxAttempts);
            assertEqual(null, job.finishedAt);
            assertEqual(undefined, job.claimToken);
        });

        it('honors runAt and stores an undefined payload as null', () => {
            const { store } = makeStore();
            const result = store.enqueue(at(0), { name: 'one', runAt: at(5000), maxAttempts: 1 });

            assertEqual(at(5000).toISOString(), result.runAt);
            assertEqual(null, store.get(result.id).payload);
        });

        it('returns the existing active job for a duplicate key', () => {
            const { store } = makeStore();
            const first = store.enqueue(at(0), { name: 'one', key: 'k', payload: 1, maxAttempts: 5 });
            const second = store.enqueue(at(10), { name: 'one', key: 'k', payload: 2, maxAttempts: 5 });

            assertEqual(false, second.created);
            assertEqual(first.id, second.id);
            assertEqual(1, store.get(first.id).payload);
            assertEqual(1, store.list().jobs.length);
        });

        it('dedupes against a running job and frees the key once it completes', () => {
            const { store } = makeStore();
            const first = store.enqueue(at(0), { name: 'one', key: 'k', maxAttempts: 5 });
            const claimed = store.claimNext(at(0), { leaseMs: LEASE_MS });

            assertEqual(false, store.enqueue(at(1), { name: 'one', key: 'k', maxAttempts: 5 }).created);

            store.complete(at(2), claimed.id, claimed.claimToken);

            const third = store.enqueue(at(3), { name: 'one', key: 'k', maxAttempts: 5 });

            assertEqual(true, third.created);
            assert(third.id !== first.id);
        });

        it('rejects an oversize payload with PayloadTooLargeError', () => {
            const { store } = makeStore();
            const payload = 'x'.repeat(MAX_PAYLOAD_BYTES);
            const error = catchError(() => store.enqueue(at(0), { name: 'one', payload, maxAttempts: 1 }));

            assert(error, 'expected an error');
            assertEqual('PayloadTooLargeError', error.name);
            assertEqual(0, store.list().jobs.length);
        });

        it('accepts a payload at the size limit', () => {
            const { store } = makeStore();
            // Two bytes of quotes surround the string.
            const payload = 'x'.repeat(MAX_PAYLOAD_BYTES - 2);

            assertEqual(true, store.enqueue(at(0), { name: 'one', payload, maxAttempts: 1 }).created);
        });

        it('counts payload size in bytes, not characters', () => {
            const { store } = makeStore();
            const payload = 'é'.repeat(MAX_PAYLOAD_BYTES / 2);
            const error = catchError(() => store.enqueue(at(0), { name: 'one', payload, maxAttempts: 1 }));

            assertEqual('PayloadTooLargeError', error?.name);
        });

        it('fails an assertion for a payload that is not serializable', () => {
            const { store } = makeStore();
            const circular = {};
            circular.self = circular;

            for (const payload of [ circular, () => {}, 10n ]) {
                const error = catchError(() => store.enqueue(at(0), { name: 'one', payload, maxAttempts: 1 }));

                assertEqual('AssertionError', error?.name);
            }
        });
    });

    describe('claimNext()', ({ it }) => {
        it('returns null when nothing is due', () => {
            const { store } = makeStore();

            assertEqual(null, store.claimNext(at(0), { leaseMs: LEASE_MS }));

            store.enqueue(at(0), { name: 'one', runAt: at(1000), maxAttempts: 1 });

            assertEqual(null, store.claimNext(at(999), { leaseMs: LEASE_MS }));
            assert(store.claimNext(at(1000), { leaseMs: LEASE_MS }));
        });

        it('claims in run_at order and marks the job running', () => {
            const { store } = makeStore();
            const late = store.enqueue(at(0), { name: 'one', runAt: at(200), maxAttempts: 1 });
            const early = store.enqueue(at(1), { name: 'one', runAt: at(100), maxAttempts: 1 });

            const first = store.claimNext(at(300), { leaseMs: LEASE_MS });
            const second = store.claimNext(at(300), { leaseMs: LEASE_MS });

            assertEqual(early.id, first.id);
            assertEqual(late.id, second.id);
            assertEqual('running', first.status);
            assertEqual(1, first.attempt);
            assertEqual(null, store.claimNext(at(300), { leaseMs: LEASE_MS }));
        });

        it('derives the lease from the claimed job name when leaseMs is a function', () => {
            const { store } = makeStore();

            store.purgeExpired(at(0), RETENTION);
            store.enqueue(at(0), { name: 'slow', maxAttempts: 1 });

            const claimed = store.claimNext(at(0), { leaseMs: (name) => (name === 'slow' ? 5000 : 1000) });

            assertEqual(false, store.complete(at(5000), claimed.id, claimed.claimToken));
            assertEqual(at(5000).toISOString(), store.nextWakeTime(at(1)).toISOString());
        });

        it('issues a unique token per claim and keeps it out of public reads', () => {
            const { store } = makeStore();

            store.enqueue(at(0), { name: 'one', maxAttempts: 5 });

            const first = store.claimNext(at(0), { leaseMs: 1000 });
            store.failAttempt(at(1), first.id, first.claimToken, ERROR_RECORD, at(2));
            const second = store.claimNext(at(2), { leaseMs: 1000 });

            assert(first.claimToken);
            assert(first.claimToken !== second.claimToken);
            assertEqual(2, second.attempt);
            assertEqual(undefined, store.get(first.id).claimToken);
            assertEqual(undefined, store.list().jobs[0].claimToken);
        });

        it('turns an expired lease into a retry attempt with backoff', () => {
            const { store } = makeStore({ random: HALF });
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 3 });

            store.claimNext(at(0), { leaseMs: 1000 });

            // Lease expired at t=1000; recovery runs on the next claim.
            assertEqual(null, store.claimNext(at(1000), { leaseMs: 1000 }));

            const job = store.get(id);

            assertEqual('pending', job.status);
            assertEqual(1, job.attempt);
            assertEqual(at(6000).toISOString(), job.runAt);
            assertEqual('LeaseExpiredError', job.lastError.name);
            assertEqual(true, job.lastError.expected);

            assertEqual(null, store.claimNext(at(5999), { leaseMs: 1000 }));
            assertEqual(2, store.claimNext(at(6000), { leaseMs: 1000 }).attempt);
        });

        it('fails a job whose lease expires on its last attempt', () => {
            const { store } = makeStore({ random: HALF });
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 1 });

            store.claimNext(at(0), { leaseMs: 1000 });
            store.claimNext(at(1000), { leaseMs: 1000 });

            const job = store.get(id);

            assertEqual('failed', job.status);
            assertEqual(at(1000).toISOString(), job.finishedAt);
        });

        it('applies recovery once per expired claim', () => {
            const { store } = makeStore({ random: HALF });
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });

            store.claimNext(at(0), { leaseMs: 1000 });
            store.claimNext(at(1000), { leaseMs: 1000 });
            store.claimNext(at(1001), { leaseMs: 1000 });
            store.claimNext(at(1002), { leaseMs: 1000 });

            const job = store.get(id);

            assertEqual(1, job.attempt);
            assertEqual(at(6000).toISOString(), job.runAt);
        });
    });

    describe('claim outcomes', ({ it }) => {
        it('completes a running job and clears the claim', () => {
            const { store, sql } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const claimed = store.claimNext(at(0), { leaseMs: 1000 });

            assertEqual(true, store.complete(at(500), id, claimed.claimToken));

            const job = store.get(id);

            assertEqual('completed', job.status);
            assertEqual(at(500).toISOString(), job.finishedAt);

            const [ row ] = sql.all('SELECT claim_token, lease_expires_at FROM jobs WHERE id = ?', id);

            assertEqual(null, row.claim_token);
            assertEqual(null, row.lease_expires_at);
        });

        it('rejects an outcome once the lease has expired, even before recovery runs', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const claimed = store.claimNext(at(0), { leaseMs: 1000 });

            assertEqual(false, store.complete(at(1000), id, claimed.claimToken));
            assertEqual('running', store.get(id).status);
        });

        it('records a retryable failure as pending with the error', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const claimed = store.claimNext(at(0), { leaseMs: 1000 });

            assertEqual(true, store.failAttempt(at(10), id, claimed.claimToken, ERROR_RECORD, at(5000)));

            const job = store.get(id);

            assertEqual('pending', job.status);
            assertEqual(1, job.attempt);
            assertEqual(at(5000).toISOString(), job.runAt);
            assertEqual(null, job.finishedAt);
            assertEqual('down', job.lastError.message);
            assertEqual(true, job.lastError.expected);
        });

        it('records a terminal failure, and failAttempt with a null retryAt is terminal', () => {
            const { store } = makeStore();
            const a = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const b = store.enqueue(at(1), { name: 'one', maxAttempts: 5 });
            const claimedA = store.claimNext(at(2), { leaseMs: 1000 });
            const claimedB = store.claimNext(at(2), { leaseMs: 1000 });

            assertEqual(true, store.failTerminal(at(3), a.id, claimedA.claimToken, ERROR_RECORD));
            assertEqual(true, store.failAttempt(at(3), b.id, claimedB.claimToken, ERROR_RECORD, null));

            assertEqual('failed', store.get(a.id).status);
            assertEqual('failed', store.get(b.id).status);
            assertEqual(at(3).toISOString(), store.get(a.id).finishedAt);
        });

        it('ignores an outcome carrying the wrong token', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });

            store.claimNext(at(0), { leaseMs: 1000 });

            assertEqual(false, store.complete(at(1), id, 'not-the-token'));
            assertEqual('running', store.get(id).status);
        });

        it('ignores a late outcome after the lease expired and the job was reclaimed', () => {
            const { store } = makeStore({ random: HALF });
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const stale = store.claimNext(at(0), { leaseMs: 1000 });

            // Recovery at t=1000 schedules the retry for t=6000.
            assertEqual(null, store.claimNext(at(1000), { leaseMs: 1000 }));

            const current = store.claimNext(at(6000), { leaseMs: 1000 });

            assertEqual(2, current.attempt);
            assertEqual(false, store.complete(at(6100), id, stale.claimToken));
            assertEqual(false, store.failTerminal(at(6100), id, stale.claimToken, ERROR_RECORD));
            assertEqual(false, store.failAttempt(at(6100), id, stale.claimToken, ERROR_RECORD, at(9000)));

            const job = store.get(id);

            assertEqual('running', job.status);
            assertEqual(2, job.attempt);
            assertEqual('LeaseExpiredError', job.lastError.name);
            assertEqual(true, store.complete(at(6200), id, current.claimToken));
        });

        it('ignores a stale outcome when a manual retry repeats the attempt number', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });
            const stale = store.claimNext(at(0), { leaseMs: 1000 });

            store.failTerminal(at(10), id, stale.claimToken, ERROR_RECORD);
            store.retry(at(20), id);

            const current = store.claimNext(at(20), { leaseMs: 1000 });

            // Both claims are attempt 1; only the token tells them apart.
            assertEqual(stale.attempt, current.attempt);
            assertEqual(false, store.complete(at(30), id, stale.claimToken));
            assertEqual('running', store.get(id).status);
            assertEqual(true, store.complete(at(40), id, current.claimToken));
        });
    });

    describe('retry()', ({ it }) => {
        it('resets a failed job to attempt 0, due now', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 2 });
            const claimed = store.claimNext(at(0), { leaseMs: 1000 });

            store.failTerminal(at(5), id, claimed.claimToken, ERROR_RECORD);

            const job = store.retry(at(100), id);

            assertEqual('pending', job.status);
            assertEqual(0, job.attempt);
            assertEqual(at(100).toISOString(), job.runAt);
            assertEqual(null, job.finishedAt);
            assertEqual('down', job.lastError.message);
        });

        it('throws NotFoundError for an unknown id', () => {
            const { store } = makeStore();

            assertEqual('NotFoundError', catchError(() => store.retry(at(0), 'missing'))?.name);
        });

        it('throws ConflictError for a job that is not failed', () => {
            const { store } = makeStore();
            const { id } = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });

            assertEqual('ConflictError', catchError(() => store.retry(at(0), id))?.name);
        });

        it('conflicts with an active job holding the same key, leaving the failed row unchanged', () => {
            const { store } = makeStore();
            const failed = failJob(store, { name: 'one', key: 'k' });

            store.enqueue(at(50), { name: 'one', key: 'k', maxAttempts: 5 });

            const before = store.get(failed.id);
            const error = catchError(() => store.retry(at(100), failed.id));

            assertEqual('ConflictError', error?.name);
            assertEqual(JSON.stringify(before), JSON.stringify(store.get(failed.id)));
        });

        it('conflicts with an active occurrence of the same schedule, leaving the failed row unchanged', () => {
            const { store } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);
            store.materializeDueSchedules(atMinute(60), registry);

            const claimed = store.claimNext(atMinute(60), { leaseMs: LEASE_MS });

            store.failTerminal(atMinute(60), claimed.id, claimed.claimToken, ERROR_RECORD);
            store.materializeDueSchedules(atMinute(120), registry);

            const before = store.get(claimed.id);
            const error = catchError(() => store.retry(atMinute(121), claimed.id));

            assertEqual('ConflictError', error?.name);
            assertEqual(JSON.stringify(before), JSON.stringify(store.get(claimed.id)));
        });
    });

    describe('get() and list()', ({ it }) => {
        it('returns null for a missing job', () => {
            assertEqual(null, makeStore().store.get('missing'));
        });

        it('lists newest first and pages with an opaque cursor', () => {
            const { store } = makeStore();
            const ids = [];

            for (let i = 0; i < 5; i += 1) {
                ids.push(store.enqueue(at(i), { name: 'one', maxAttempts: 1 }).id);
            }

            const page1 = store.list({ limit: 2 });
            const page2 = store.list({ limit: 2, cursor: page1.cursor });
            const page3 = store.list({ limit: 2, cursor: page2.cursor });

            assertEqual(ids.slice().reverse().join(','), [ ...page1.jobs, ...page2.jobs, ...page3.jobs ].map((j) => j.id).join(','));
            assert(page1.cursor);
            assert(page2.cursor);
            assertEqual(null, page3.cursor);
            assertEqual(1, page3.jobs.length);
        });

        it('pages across jobs created in the same millisecond', () => {
            const { store } = makeStore();

            for (let i = 0; i < 5; i += 1) {
                store.enqueue(at(0), { name: 'one', maxAttempts: 1 });
            }

            const seen = new Set();
            let cursor;

            do {
                const page = store.list({ limit: 2, cursor });

                page.jobs.forEach((job) => seen.add(job.id));
                cursor = page.cursor ?? undefined;
            } while (cursor);

            assertEqual(5, seen.size);
        });

        it('filters by status and name', () => {
            const { store } = makeStore();

            store.enqueue(at(0), { name: 'one', maxAttempts: 1 });
            store.enqueue(at(1), { name: 'two', maxAttempts: 1 });
            store.claimNext(at(2), { leaseMs: LEASE_MS });

            assertEqual(1, store.list({ status: 'running' }).jobs.length);
            assertEqual(1, store.list({ status: 'pending' }).jobs.length);
            assertEqual('two', store.list({ name: 'two' }).jobs[0].name);
            assertEqual(0, store.list({ status: 'failed' }).jobs.length);
        });

        it('rejects an invalid status, limit, or cursor', () => {
            const { store } = makeStore();

            assertEqual('ValidationError', catchError(() => store.list({ status: 'bogus' }))?.name);
            assertEqual('ValidationError', catchError(() => store.list({ limit: 0 }))?.name);
            assertEqual('ValidationError', catchError(() => store.list({ limit: 201 }))?.name);
            assertEqual('ValidationError', catchError(() => store.list({ cursor: '!!!' }))?.name);
        });
    });

    describe('schedules', ({ it }) => {
        it('reconciles added, changed, and removed schedules', () => {
            const { store } = makeStore();

            store.reconcileSchedules(at(0), makeRegistry(
                { name: 'a-sweep', schedule: { cron: '0 * * * *' } },
                { name: 'b-sweep', schedule: { cron: '*/10 * * * *' } },
                { name: 'not-scheduled' },
            ));

            let schedules = store.listSchedules();

            assertEqual('a-sweep,b-sweep', schedules.map((s) => s.name).join(','));
            assertEqual(atMinute(60).toISOString(), schedules[0].nextRunAt);
            assertEqual(atMinute(10).toISOString(), schedules[1].nextRunAt);
            assertEqual(null, schedules[0].lastEnqueuedAt);

            // An unchanged cron keeps its next_run_at; a changed one recomputes from now.
            store.reconcileSchedules(atMinute(5), makeRegistry(
                { name: 'a-sweep', schedule: { cron: '0 * * * *' } },
                { name: 'b-sweep', schedule: { cron: '*/30 * * * *' } },
            ));

            schedules = store.listSchedules();

            assertEqual(atMinute(60).toISOString(), schedules[0].nextRunAt);
            assertEqual('*/30 * * * *', schedules[1].cron);
            assertEqual(atMinute(30).toISOString(), schedules[1].nextRunAt);

            store.reconcileSchedules(atMinute(6), makeRegistry({ name: 'a-sweep', schedule: { cron: '0 * * * *' } }));

            assertEqual('a-sweep', store.listSchedules().map((s) => s.name).join(','));
        });

        it('leaves active occurrence jobs alone when a schedule is removed', () => {
            const { store } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);
            store.materializeDueSchedules(atMinute(60), registry);
            store.reconcileSchedules(atMinute(61), makeRegistry());

            assertEqual(0, store.listSchedules().length);
            assertEqual('pending', store.list().jobs[0].status);
        });

        it('materializes a due occurrence and advances the schedule', () => {
            const { store } = makeStore();
            const registry = makeRegistry({ name: 'sweep', maxAttempts: 3, schedule: { cron: '*/15 * * * *' } });

            store.reconcileSchedules(at(0), registry);

            assertEqual(0, store.materializeDueSchedules(atMinute(14), registry).enqueued);
            assertEqual(1, store.materializeDueSchedules(atMinute(15), registry).enqueued);

            const [ job ] = store.list().jobs;
            const [ schedule ] = store.listSchedules();

            assertEqual('sweep', job.name);
            assertEqual('sweep', job.scheduleName);
            assertEqual(`schedule:sweep:${ atMinute(15).toISOString() }`, job.key);
            assertEqual(atMinute(15).toISOString(), job.scheduledFor);
            assertEqual(3, job.maxAttempts);
            assertEqual(0, Object.keys(job.payload).length);
            assertEqual(atMinute(30).toISOString(), schedule.nextRunAt);
            assertEqual(atMinute(15).toISOString(), schedule.lastEnqueuedAt);
            assertEqual(job.id, schedule.lastJobId);
        });

        it('runs once at the most recent missed time after a long gap', () => {
            const { store } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);

            // Down for 5.5 hours: occurrences at 01:00 through 05:00 were missed.
            const now = atMinute((5 * 60) + 30);

            assertEqual(1, store.materializeDueSchedules(now, registry).enqueued);
            assertEqual(1, store.list().jobs.length);
            assertEqual(atMinute(5 * 60).toISOString(), store.list().jobs[0].scheduledFor);
            assertEqual(atMinute(6 * 60).toISOString(), store.listSchedules()[0].nextRunAt);
            assertEqual(0, store.materializeDueSchedules(now, registry).enqueued);
        });

        it('skips and logs an occurrence while the previous one is active, then resumes', () => {
            const { store, logs } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);
            store.materializeDueSchedules(atMinute(60), registry);

            // The 01:00 occurrence is still pending when 02:00 comes due.
            const skipped = store.materializeDueSchedules(atMinute(120), registry);

            assertEqual(0, skipped.enqueued);
            assertEqual(1, skipped.skipped);
            assertEqual(1, store.list().jobs.length);
            assertEqual(atMinute(180).toISOString(), store.listSchedules()[0].nextRunAt);
            assertEqual(1, logs.info.length);
            assertEqual('sweep', logs.info[0].scheduleName);

            // Once the occurrence finishes, the next one materializes normally.
            const claimed = store.claimNext(atMinute(120), { leaseMs: LEASE_MS });

            store.complete(atMinute(120), claimed.id, claimed.claimToken);

            assertEqual(1, store.materializeDueSchedules(atMinute(180), registry).enqueued);
            assertEqual(2, store.list().jobs.length);
        });

        it('treats an occurrence waiting to retry as active', () => {
            const { store } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);
            store.materializeDueSchedules(atMinute(60), registry);

            const claimed = store.claimNext(atMinute(60), { leaseMs: LEASE_MS });

            store.failAttempt(atMinute(60), claimed.id, claimed.claimToken, ERROR_RECORD, atMinute(90));

            assertEqual(1, store.materializeDueSchedules(atMinute(120), registry).skipped);
            assertEqual(1, store.list().jobs.length);
        });

        it('ignores a due schedule the registry no longer declares', () => {
            const { store } = makeStore();

            store.reconcileSchedules(at(0), makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } }));

            assertEqual(0, store.materializeDueSchedules(atMinute(120), makeRegistry()).enqueued);
            assertEqual(0, store.list().jobs.length);
        });

        it('does not duplicate occurrences when two executors share a database', () => {
            const { first, second } = makeSharedStores();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            first.reconcileSchedules(at(0), registry);
            second.reconcileSchedules(at(0), registry);

            const a = first.materializeDueSchedules(atMinute(60), registry);
            const b = second.materializeDueSchedules(atMinute(60), registry);

            assertEqual(1, a.enqueued + b.enqueued);
            assertEqual(1, second.list().jobs.length);

            // Even after the first occurrence completes, the advanced schedule
            // prevents a second processor from re-materializing it.
            const claimed = second.claimNext(atMinute(60), { leaseMs: LEASE_MS });

            second.complete(atMinute(60), claimed.id, claimed.claimToken);

            assertEqual(0, first.materializeDueSchedules(atMinute(60), registry).enqueued);
            assertEqual(1, first.list().jobs.length);
        });

        it('rolls back the enqueue and the schedule advance together', () => {
            const { store, sql } = makeStore();
            const registry = makeRegistry({ name: 'sweep', schedule: { cron: '0 * * * *' } });

            store.reconcileSchedules(at(0), registry);

            const before = JSON.stringify(store.listSchedules());
            const failing = new JobStateStore({
                sql: {
                    ...sql,
                    // The schedule advance is the second write in the transaction.
                    run(statement, ...params) {
                        if (statement.startsWith('UPDATE job_schedules SET next_run_at')) {
                            throw new Error('disk full');
                        }
                        sql.run(statement, ...params);
                    },
                },
                logger: makeLogger().logger,
            });

            const error = catchError(() => failing.materializeDueSchedules(atMinute(60), registry));

            assertEqual('disk full', error?.message);
            assertEqual(0, store.list().jobs.length);
            assertEqual(before, JSON.stringify(store.listSchedules()));
        });
    });

    describe('purgeExpired()', ({ it }) => {
        it('deletes only terminal jobs past their age', () => {
            const { store } = makeStore();
            const oldCompleted = finishJob(store, at(0), 'complete');
            const oldFailed = finishJob(store, at(0), 'fail');
            const active = store.enqueue(at(0), { name: 'one', maxAttempts: 5 });

            // 8 days later: completed (7d) is expired, failed (30d) is not.
            assertEqual(1, store.purgeExpired(at(8 * DAY_MS), RETENTION));
            assertEqual(null, store.get(oldCompleted.id));
            assert(store.get(oldFailed.id));
            assert(store.get(active.id));

            // 31 days later, the hour gate has long passed.
            assertEqual(1, store.purgeExpired(at(31 * DAY_MS), RETENTION));
            assertEqual(null, store.get(oldFailed.id));
            assert(store.get(active.id), 'active jobs are never purged');
        });

        it('keeps terminal jobs younger than the retention age', () => {
            const { store } = makeStore();
            const job = finishJob(store, at(0), 'complete');

            assertEqual(0, store.purgeExpired(at((7 * DAY_MS) - 1), RETENTION));
            assert(store.get(job.id));
        });

        it('runs at most once per hour', () => {
            const { store } = makeStore();
            const hour = 60 * 60 * 1000;

            const first = finishJob(store, at(0), 'complete');

            assertEqual(1, store.purgeExpired(at(8 * DAY_MS), RETENTION));
            assertEqual(null, store.get(first.id));

            // Eligible, but inside the hour after the previous purge.
            const second = finishJob(store, at(0), 'complete');

            assertEqual(0, store.purgeExpired(at((8 * DAY_MS) + (30 * 60 * 1000)), RETENTION));
            assert(store.get(second.id));

            assertEqual(1, store.purgeExpired(at((8 * DAY_MS) + hour + 1000), RETENTION));
            assertEqual(null, store.get(second.id));
        });

        it('deletes in batches of 500 and leaves the gate open until drained', () => {
            const { store, sql } = makeStore();

            sql.transaction(() => {
                for (let i = 0; i < 620; i += 1) {
                    sql.run(
                        `INSERT INTO jobs (id, name, payload, status, attempt, max_attempts, run_at,
                                created_at, updated_at, finished_at)
                            VALUES (?, 'one', 'null', 'completed', 1, 1, 0, 0, 0, 0)`,
                        `job-${ i }`,
                    );
                }
            });

            const now = at(8 * DAY_MS);

            assertEqual(500, store.purgeExpired(now, RETENTION));
            assertEqual(120, store.list({ limit: 200 }).jobs.length);

            // The gate stayed open, so the same instant continues the purge.
            assertEqual(120, store.purgeExpired(now, RETENTION));
            assertEqual(0, store.list().jobs.length);

            // Now drained, so it is gated for an hour.
            assertEqual(0, store.purgeExpired(now, RETENTION));
        });
    });

    describe('nextWakeTime()', ({ it }) => {
        it('is now when the queue has never purged and holds nothing else', () => {
            assertEqual(at(1000).toISOString(), makeStore().store.nextWakeTime(at(1000)).toISOString());
        });

        it('is the next purge time when the queue is otherwise idle', () => {
            const { store } = makeStore();

            store.purgeExpired(at(1000), RETENTION);

            assertEqual(at(1000 + (60 * 60 * 1000)).toISOString(), store.nextWakeTime(at(2000)).toISOString());
        });

        it('takes the earliest pending run_at', () => {
            const { store } = makeStore();

            store.purgeExpired(at(0), RETENTION);
            store.enqueue(at(0), { name: 'one', runAt: at(50000), maxAttempts: 1 });
            store.enqueue(at(0), { name: 'one', runAt: at(40000), maxAttempts: 1 });

            assertEqual(at(40000).toISOString(), store.nextWakeTime(at(0)).toISOString());
        });

        it('takes a running job lease expiry', () => {
            const { store } = makeStore();

            store.purgeExpired(at(0), RETENTION);
            store.enqueue(at(0), { name: 'one', maxAttempts: 1 });
            store.claimNext(at(0), { leaseMs: 30000 });

            assertEqual(at(30000).toISOString(), store.nextWakeTime(at(1)).toISOString());
        });

        it('takes the earliest schedule occurrence', () => {
            const { store } = makeStore();

            store.purgeExpired(at(0), RETENTION);
            store.reconcileSchedules(at(0), makeRegistry({ name: 'sweep', schedule: { cron: '*/15 * * * *' } }));

            assertEqual(atMinute(15).toISOString(), store.nextWakeTime(at(0)).toISOString());
        });

        it('reports an already-due time when work is waiting', () => {
            const { store } = makeStore();

            store.purgeExpired(at(0), RETENTION);
            store.enqueue(at(0), { name: 'one', runAt: at(100), maxAttempts: 1 });

            assertEqual(at(100).toISOString(), store.nextWakeTime(at(5000)).toISOString());
        });
    });
});

function at(ms) {
    return new Date(Date.UTC(2026, 2, 10, 0, 0, 0) + ms);
}

function atMinute(minutes) {
    return at(minutes * 60 * 1000);
}

function makeLogger() {
    const logs = { info: [], warn: [], error: [] };
    const record = (level) => (message, info) => logs[level].push(info ?? { message });

    return {
        logs,
        logger: { info: record('info'), warn: record('warn'), error: record('error'), debug: () => {} },
    };
}

function makeExecutor(db) {
    return {
        all(statement, ...params) {
            return db.prepare(statement).all(...params).map((row) => ({ ...row }));
        },
        run(statement, ...params) {
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
}

function makeStore(options) {
    const { logs, logger } = makeLogger();
    const sql = makeExecutor(new DatabaseSync(':memory:'));
    const store = new JobStateStore({ sql, logger, ...options });

    store.migrate();

    return { store, sql, logs: logs };
}

// Two executors on separate connections to one file, like two processes.
function makeSharedStores() {
    const directory = mkdtempSync(join(tmpdir(), 'job-state-store-'));
    const path = join(directory, 'jobs.sqlite');
    const dbs = [ new DatabaseSync(path), new DatabaseSync(path) ];

    for (const db of dbs) {
        db.exec('PRAGMA busy_timeout = 5000');
    }

    const [ first, second ] = dbs.map((db) => new JobStateStore({
        sql: makeExecutor(db),
        logger: makeLogger().logger,
    }));

    first.migrate();
    second.migrate();

    // The operating system reclaims the file handles at process exit; the
    // directory is removed on exit as well.
    process.once('exit', () => {
        dbs.forEach((db) => db.close());
        rmSync(directory, { recursive: true, force: true });
    });

    return { first, second };
}

function makeRegistry(...entries) {
    return validateJobRegistry(new Map(entries.map((entry) => [
        entry.name,
        { description: `Runs ${ entry.name }`, handler: async () => {}, ...entry },
    ])));
}

function failJob(store, { name, key }) {
    const job = store.enqueue(at(0), { name, key, maxAttempts: 1 });
    const claimed = store.claimNext(at(0), { leaseMs: LEASE_MS });

    store.failTerminal(at(1), claimed.id, claimed.claimToken, ERROR_RECORD);

    return job;
}

function finishJob(store, now, outcome) {
    const job = store.enqueue(now, { name: 'one', maxAttempts: 1 });
    const claimed = store.claimNext(now, { leaseMs: LEASE_MS });

    if (outcome === 'complete') {
        store.complete(now, claimed.id, claimed.claimToken);
    } else {
        store.failTerminal(now, claimed.id, claimed.claimToken, ERROR_RECORD);
    }

    return job;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
