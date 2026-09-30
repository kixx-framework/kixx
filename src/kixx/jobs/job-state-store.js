import { nextOccurrence } from './cron.js';
import { nextRetryDelayMs } from './retry-policy.js';
import { ConflictError, NotFoundError, PayloadTooLargeError, ValidationError } from '../errors/mod.js';
import { assert, assertNonEmptyString, assertValidDate, isNonEmptyString } from '../assertions/mod.js';


/**
 * @module job-state-store
 *
 * Owns the SQLite schema and every state transition of jobs and schedules.
 * Both adapters (Node.js `DatabaseSync` and the Cloudflare Durable Object
 * `ctx.storage.sql`) are synchronous SQLite, so the queue semantics live here
 * once and the adapters only supply a `SqlExecutor`.
 *
 * Every method takes `now` (a `Date`) explicitly so callers and tests control
 * time. All times are integer epoch milliseconds in storage and ISO strings in
 * returned records.
 */

/**
 * The minimal synchronous SQL surface the store needs. Parameters are bound
 * positionally with `?` and are never `undefined`.
 *
 * @typedef {Object} SqlExecutor
 * @property {function(string, ...*): Object[]} all - Runs a statement and returns every row as a plain object.
 *   Also used for `INSERT/UPDATE/DELETE ... RETURNING`, which is how the store learns whether a write applied.
 * @property {function(string, ...*): void} run - Runs a statement, discarding results.
 * @property {function(function(): *): *} transaction - Runs the callback atomically and returns its result,
 *   rolling back if it throws. Transactions MUST NOT be nested. On Node.js this is `BEGIN IMMEDIATE`, so
 *   several processes sharing one file serialize their writers; in a Durable Object it is `transactionSync`.
 */

/**
 * @typedef {Object} JobRetention
 * @property {number} completedMaxAgeDays - Age after which completed jobs are purged.
 * @property {number} failedMaxAgeDays - Age after which failed jobs are purged.
 */

export const SCHEMA_VERSION = 1;

// Serialized payloads over this many bytes are rejected at enqueue.
export const MAX_PAYLOAD_BYTES = 128 * 1024;

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const JOB_STATUSES = [ 'pending', 'running', 'completed', 'failed' ];

const ACTIVE_STATUSES_SQL = "status IN ('pending','running')";

const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS job_queue_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT,
        schedule_name TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_at INTEGER NOT NULL,
        scheduled_for INTEGER,
        lease_expires_at INTEGER,
        claim_token TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        last_error TEXT
    )`,
    // Dedupe among active jobs only, so a key is reusable once its job finishes.
    `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_key
        ON jobs (key) WHERE ${ ACTIVE_STATUSES_SQL } AND key IS NOT NULL`,
    // At most one active occurrence per schedule, including one waiting to retry.
    `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_schedule_name
        ON jobs (schedule_name) WHERE ${ ACTIVE_STATUSES_SQL } AND schedule_name IS NOT NULL`,
    'CREATE INDEX IF NOT EXISTS jobs_status_run_at ON jobs (status, run_at)',
    'CREATE INDEX IF NOT EXISTS jobs_status_finished_at ON jobs (status, finished_at)',
    'CREATE INDEX IF NOT EXISTS jobs_name_status ON jobs (name, status)',
    'CREATE INDEX IF NOT EXISTS jobs_created_at_id ON jobs (created_at, id)',
    // Keyed by name so a runtime schedule API can be added without migrating data.
    `CREATE TABLE IF NOT EXISTS job_schedules (
        name TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        next_run_at INTEGER NOT NULL,
        last_enqueued_at INTEGER,
        last_job_id TEXT
    )`,
];


/**
 * Platform-neutral owner of job and schedule state.
 */
export default class JobStateStore {

    #sql;
    #logger;
    #random;

    /**
     * @param {Object} options
     * @param {SqlExecutor} options.sql - Synchronous SQL executor.
     * @param {Object} options.logger - Logger for schedule decisions.
     * @param {function(): number} [options.random=Math.random] - Jitter source for retry backoff; injectable for tests.
     */
    constructor(options) {
        const { sql, logger, random = Math.random } = options ?? {};

        assert(sql, 'JobStateStore requires a sql executor');
        assert(logger, 'JobStateStore requires a logger');

        this.#sql = sql;
        this.#logger = logger;
        this.#random = random;
    }

    /**
     * Creates or upgrades the schema. Idempotent; the version lives in `job_queue_meta`.
     * @throws {AssertionError} When the database was written by a newer schema version.
     */
    migrate() {
        this.#sql.transaction(() => {
            this.#sql.run(SCHEMA_STATEMENTS[0]);

            const version = Number(this.#readMeta('schema_version') ?? 0);

            // A rolled-back deploy must not run old code against a newer schema.
            assert(
                version <= SCHEMA_VERSION,
                `JobStateStore database schema version ${ version } is newer than supported version ${ SCHEMA_VERSION }`,
            );

            if (version === SCHEMA_VERSION) {
                return;
            }

            for (const statement of SCHEMA_STATEMENTS) {
                this.#sql.run(statement);
            }

            this.#writeMeta('schema_version', String(SCHEMA_VERSION));
        });
    }

    /**
     * Records a job, or returns the active job already holding `key`.
     * @param {Date} now
     * @param {Object} job
     * @param {string} job.name - Registered job name.
     * @param {*} [job.payload] - JSON-serializable payload; `undefined` is stored as `null`.
     * @param {Date} [job.runAt=now] - When the job becomes due.
     * @param {string} [job.key] - Dedupe key among active jobs.
     * @param {number} job.maxAttempts - Resolved from the registry by the caller.
     * @returns {import('./job-queue-interface.js').JobEnqueueResult}
     * @throws {PayloadTooLargeError} When the serialized payload exceeds 128 KB.
     * @throws {AssertionError} When the payload is not JSON serializable or an argument is invalid.
     */
    enqueue(now, job) {
        assertValidDate(now, 'JobStateStore#enqueue() now');
        assertNonEmptyString(job?.name, 'JobStateStore#enqueue() job.name');
        assertPositiveInteger(job.maxAttempts, 'JobStateStore#enqueue() job.maxAttempts');

        if (job.key !== undefined && job.key !== null) {
            assertNonEmptyString(job.key, 'JobStateStore#enqueue() job.key');
        }

        const runAt = job.runAt ?? now;
        assertValidDate(runAt, 'JobStateStore#enqueue() job.runAt');

        const payload = serializePayload(job.payload);

        return this.#sql.transaction(() => {
            if (job.key) {
                const existing = this.#selectActiveByKey(job.key);

                if (existing) {
                    return toEnqueueResult(existing, false);
                }
            }

            const row = this.#insertJob(now, {
                name: job.name,
                key: job.key ?? null,
                payload,
                maxAttempts: job.maxAttempts,
                runAt: runAt.getTime(),
                scheduleName: null,
                scheduledFor: null,
            });

            return toEnqueueResult(row, true);
        });
    }

    /**
     * Claims the earliest due pending job. Expired leases are first converted
     * into failed attempts, so a crashed run is retried or failed here.
     * @param {Date} now
     * @param {Object} options
     * @param {(number|function(string): number)} options.leaseMs - How long the claim is valid, in milliseconds;
     *   the outcome must be recorded before then. A function receives the claimed job's name, so the lease can
     *   follow that job's timeout.
     * @returns {(import('./job-queue-interface.js').JobRecord & {claimToken: string})|null}
     *   The claimed job with its fresh claim token, or `null` when nothing is due.
     */
    claimNext(now, options) {
        assertValidDate(now, 'JobStateStore#claimNext() now');
        assert(
            Number.isInteger(options?.leaseMs) || typeof options?.leaseMs === 'function',
            'JobStateStore#claimNext() options.leaseMs must be an integer or a function',
        );

        const nowMs = now.getTime();

        return this.#sql.transaction(() => {
            this.#recoverExpiredLeases(nowMs);

            const [ due ] = this.#sql.all(
                `SELECT id, name FROM jobs WHERE status = 'pending' AND run_at <= ?
                    ORDER BY run_at, created_at, id LIMIT 1`,
                nowMs,
            );

            if (!due) {
                return null;
            }

            // A fresh token per claim, not the attempt counter: a manual retry
            // resets `attempt`, so attempt numbers can repeat across claims.
            const claimToken = crypto.randomUUID();
            const leaseMs = typeof options.leaseMs === 'function' ? options.leaseMs(due.name) : options.leaseMs;

            assertPositiveInteger(leaseMs, 'JobStateStore#claimNext() lease');

            const [ row ] = this.#sql.all(
                `UPDATE jobs SET status = 'running', attempt = attempt + 1, claim_token = ?,
                        lease_expires_at = ?, updated_at = ?
                    WHERE id = ? RETURNING *`,
                claimToken,
                nowMs + leaseMs,
                nowMs,
                due.id,
            );

            return { ...toJobRecord(row), claimToken };
        });
    }

    /**
     * Marks a running job completed.
     * @param {Date} now
     * @param {string} id
     * @param {string} claimToken - Token from `claimNext()`.
     * @returns {boolean} False when the claim is stale (expired, replaced, or retried); the row is untouched.
     */
    complete(now, id, claimToken) {
        return this.#finishClaim(now, id, claimToken, 'completed', null);
    }

    /**
     * Records a failed attempt that will be retried. With `retryAt` null the
     * job fails terminally instead.
     * @param {Date} now
     * @param {string} id
     * @param {string} claimToken
     * @param {{name: string, message: string, stack?: string, expected?: boolean}} errorRecord
     * @param {Date|null} retryAt - When the job becomes due again.
     * @returns {boolean} False when the claim is stale; the row is untouched.
     */
    failAttempt(now, id, claimToken, errorRecord, retryAt) {
        if (retryAt === null) {
            return this.failTerminal(now, id, claimToken, errorRecord);
        }

        assertValidDate(retryAt, 'JobStateStore#failAttempt() retryAt');

        return this.#finishClaim(now, id, claimToken, 'pending', errorRecord, retryAt.getTime());
    }

    /**
     * Marks a running job failed with no further retry.
     * @param {Date} now
     * @param {string} id
     * @param {string} claimToken
     * @param {{name: string, message: string, stack?: string, expected?: boolean}} errorRecord
     * @returns {boolean} False when the claim is stale; the row is untouched.
     */
    failTerminal(now, id, claimToken, errorRecord) {
        return this.#finishClaim(now, id, claimToken, 'failed', errorRecord);
    }

    /**
     * Resets a failed job to `attempt: 0`, due now.
     * @param {Date} now
     * @param {string} id
     * @returns {import('./job-queue-interface.js').JobRecord}
     * @throws {NotFoundError} When no job has this id.
     * @throws {ConflictError} When the job is not failed, or an active job holds its key or schedule name.
     */
    retry(now, id) {
        assertValidDate(now, 'JobStateStore#retry() now');
        assertNonEmptyString(id, 'JobStateStore#retry() id');

        const nowMs = now.getTime();

        return this.#sql.transaction(() => {
            const [ row ] = this.#sql.all('SELECT * FROM jobs WHERE id = ?', id);

            if (!row) {
                throw new NotFoundError(`Job ${ id } was not found`);
            }

            if (row.status !== 'failed') {
                throw new ConflictError(`Job ${ id } is ${ row.status }; only failed jobs can be retried`);
            }

            // The partial unique indexes would reject the update anyway; checking
            // first turns that into a clear conflict and leaves the row unchanged.
            if (row.key && this.#selectActiveByKey(row.key)) {
                throw new ConflictError(`An active job already holds the key "${ row.key }"`);
            }

            if (row.schedule_name && this.#selectActiveBySchedule(row.schedule_name)) {
                throw new ConflictError(`An active occurrence of schedule "${ row.schedule_name }" already exists`);
            }

            const [ updated ] = this.#sql.all(
                `UPDATE jobs SET status = 'pending', attempt = 0, run_at = ?, finished_at = NULL,
                        claim_token = NULL, lease_expires_at = NULL, updated_at = ?
                    WHERE id = ? RETURNING *`,
                nowMs,
                nowMs,
                id,
            );

            return toJobRecord(updated);
        });
    }

    /**
     * @param {string} id
     * @returns {import('./job-queue-interface.js').JobRecord|null}
     */
    get(id) {
        assertNonEmptyString(id, 'JobStateStore#get() id');

        const [ row ] = this.#sql.all('SELECT * FROM jobs WHERE id = ?', id);

        return row ? toJobRecord(row) : null;
    }

    /**
     * Lists jobs newest first with keyset pagination on `(created_at DESC, id DESC)`.
     * @param {Object} [options]
     * @param {string} [options.status]
     * @param {string} [options.name]
     * @param {number} [options.limit=50] - 1 to 200.
     * @param {string} [options.cursor] - Opaque cursor from a previous page.
     * @returns {{jobs: import('./job-queue-interface.js').JobRecord[], cursor: string|null}}
     * @throws {ValidationError} When `status`, `limit`, or `cursor` is invalid.
     */
    list(options) {
        const { status, name, limit = DEFAULT_LIST_LIMIT, cursor } = options ?? {};

        if (status !== undefined && !JOB_STATUSES.includes(status)) {
            throw new ValidationError(`status must be one of ${ JOB_STATUSES.join(', ') }`);
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
            throw new ValidationError(`limit must be an integer from 1 to ${ MAX_LIST_LIMIT }`);
        }

        const conditions = [];
        const params = [];

        if (status !== undefined) {
            conditions.push('status = ?');
            params.push(status);
        }

        if (name !== undefined) {
            conditions.push('name = ?');
            params.push(name);
        }

        if (cursor !== undefined) {
            const [ createdAt, id ] = decodeCursor(cursor);

            conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
            params.push(createdAt, createdAt, id);
        }

        const where = conditions.length > 0 ? `WHERE ${ conditions.join(' AND ') }` : '';

        // One extra row reveals whether another page exists.
        const rows = this.#sql.all(
            `SELECT * FROM jobs ${ where } ORDER BY created_at DESC, id DESC LIMIT ?`,
            ...params,
            limit + 1,
        );

        const page = rows.slice(0, limit);
        const last = page[page.length - 1];

        return {
            jobs: page.map(toJobRecord),
            cursor: rows.length > limit ? encodeCursor(last.created_at, last.id) : null,
        };
    }

    /**
     * @returns {import('./job-queue-interface.js').JobScheduleRecord[]} Declared schedules ordered by name.
     */
    listSchedules() {
        return this.#sql.all('SELECT * FROM job_schedules ORDER BY name').map((row) => ({
            name: row.name,
            cron: row.cron,
            nextRunAt: toIso(row.next_run_at),
            lastEnqueuedAt: toIso(row.last_enqueued_at),
            lastJobId: row.last_job_id ?? null,
        }));
    }

    /**
     * Makes stored schedules match the registry: adds new ones, recomputes
     * `next_run_at` from `now` when a cron expression changed, and deletes
     * undeclared ones. Active occurrence jobs are left alone.
     * @param {Date} now
     * @param {Map<string, import('./job-registry.js').ResolvedJobEntry>} registry - Output of `validateJobRegistry()`.
     */
    reconcileSchedules(now, registry) {
        assertValidDate(now, 'JobStateStore#reconcileSchedules() now');

        this.#sql.transaction(() => {
            const stored = new Map(this.#sql.all('SELECT * FROM job_schedules').map((row) => [ row.name, row ]));
            const declared = new Set();

            for (const entry of registry.values()) {
                if (!entry.schedule) {
                    continue;
                }

                declared.add(entry.name);

                const existing = stored.get(entry.name);

                if (existing?.cron === entry.schedule.cron) {
                    continue;
                }

                const nextRunAt = nextOccurrence(entry.schedule.parsed, now).getTime();

                if (existing) {
                    this.#sql.run(
                        'UPDATE job_schedules SET cron = ?, next_run_at = ? WHERE name = ?',
                        entry.schedule.cron,
                        nextRunAt,
                        entry.name,
                    );
                } else {
                    this.#sql.run(
                        'INSERT INTO job_schedules (name, cron, next_run_at) VALUES (?, ?, ?)',
                        entry.name,
                        entry.schedule.cron,
                        nextRunAt,
                    );
                }
            }

            for (const name of stored.keys()) {
                if (!declared.has(name)) {
                    this.#sql.run('DELETE FROM job_schedules WHERE name = ?', name);
                }
            }
        });
    }

    /**
     * Turns each due schedule into at most one occurrence job. After a long
     * gap only the most recent missed occurrence runs (catch up once). An
     * occurrence that comes due while the previous one is still active is
     * skipped and logged. Either way the schedule advances past `now`,
     * atomically with the enqueue, so no other processor can materialize the
     * same occurrence after it completes.
     * @param {Date} now
     * @param {Map<string, import('./job-registry.js').ResolvedJobEntry>} registry - Supplies `maxAttempts` and the parsed cron.
     * @returns {{enqueued: number, skipped: number}}
     */
    materializeDueSchedules(now, registry) {
        assertValidDate(now, 'JobStateStore#materializeDueSchedules() now');

        const nowMs = now.getTime();
        const dueNames = this.#sql.all(
            'SELECT name FROM job_schedules WHERE next_run_at <= ? ORDER BY next_run_at, name',
            nowMs,
        ).map((row) => row.name);

        const result = { enqueued: 0, skipped: 0 };

        for (const name of dueNames) {
            const entry = registry.get(name);

            // Not declared by this deploy; reconcileSchedules() removes it.
            if (!entry?.schedule) {
                continue;
            }

            this.#sql.transaction(() => {
                // Re-check under the write lock: another processor may have
                // materialized this schedule since the unlocked read above.
                const [ schedule ] = this.#sql.all('SELECT * FROM job_schedules WHERE name = ?', name);

                if (!schedule || schedule.next_run_at > nowMs) {
                    return;
                }

                const { parsed } = entry.schedule;
                const nextRunAt = nextOccurrence(parsed, now).getTime();

                if (this.#selectActiveBySchedule(name)) {
                    this.#logger.info('Skipping schedule occurrence; previous occurrence is still active', {
                        scheduleName: name,
                        scheduledFor: toIso(schedule.next_run_at),
                    });

                    this.#sql.run('UPDATE job_schedules SET next_run_at = ? WHERE name = ?', nextRunAt, name);
                    result.skipped += 1;
                    return;
                }

                const scheduledFor = mostRecentOccurrence(parsed, schedule.next_run_at, nowMs);

                const row = this.#insertJob(now, {
                    name,
                    key: `schedule:${ name }:${ new Date(scheduledFor).toISOString() }`,
                    payload: '{}',
                    maxAttempts: entry.maxAttempts,
                    runAt: nowMs,
                    scheduleName: name,
                    scheduledFor,
                });

                this.#sql.run(
                    'UPDATE job_schedules SET next_run_at = ?, last_enqueued_at = ?, last_job_id = ? WHERE name = ?',
                    nextRunAt,
                    nowMs,
                    row.id,
                    name,
                );

                result.enqueued += 1;
            });
        }

        return result;
    }

    /**
     * Deletes terminal jobs past their retention age, at most 500 per status
     * per call. Gated to once per hour; when a batch was full, the gate is
     * left open so the next pass continues the purge. Active jobs are never deleted.
     * @param {Date} now
     * @param {JobRetention} retention
     * @returns {number} Rows deleted; 0 when gated.
     */
    purgeExpired(now, retention) {
        assertValidDate(now, 'JobStateStore#purgeExpired() now');
        assertPositiveInteger(retention?.completedMaxAgeDays, 'JobStateStore#purgeExpired() retention.completedMaxAgeDays');
        assertPositiveInteger(retention?.failedMaxAgeDays, 'JobStateStore#purgeExpired() retention.failedMaxAgeDays');

        const nowMs = now.getTime();

        return this.#sql.transaction(() => {
            const lastPurgeAt = this.#readMeta('last_purge_at');

            if (lastPurgeAt !== null && nowMs - Number(lastPurgeAt) < PURGE_INTERVAL_MS) {
                return 0;
            }

            let deleted = 0;
            let hasMore = false;

            for (const [ status, maxAgeDays ] of [
                [ 'completed', retention.completedMaxAgeDays ],
                [ 'failed', retention.failedMaxAgeDays ],
            ]) {
                const rows = this.#sql.all(
                    `DELETE FROM jobs WHERE id IN (
                        SELECT id FROM jobs WHERE status = ? AND finished_at < ? LIMIT ?
                    ) RETURNING id`,
                    status,
                    nowMs - (maxAgeDays * MS_PER_DAY),
                    PURGE_BATCH_SIZE,
                );

                deleted += rows.length;
                hasMore = hasMore || rows.length === PURGE_BATCH_SIZE;
            }

            if (!hasMore) {
                this.#writeMeta('last_purge_at', String(nowMs));
            }

            return deleted;
        });
    }

    /**
     * The earliest time anything needs attention: a pending job's `run_at`, a
     * running job's lease expiry, a schedule's next occurrence, or the next
     * retention purge. May be at or before `now` when work is already due.
     * @param {Date} now
     * @returns {Date}
     */
    nextWakeTime(now) {
        assertValidDate(now, 'JobStateStore#nextWakeTime() now');

        const [ row ] = this.#sql.all(
            `SELECT
                (SELECT MIN(run_at) FROM jobs WHERE status = 'pending') AS pending_at,
                (SELECT MIN(lease_expires_at) FROM jobs WHERE status = 'running') AS lease_at,
                (SELECT MIN(next_run_at) FROM job_schedules) AS schedule_at`,
        );

        const lastPurgeAt = this.#readMeta('last_purge_at');
        const purgeAt = lastPurgeAt === null ? now.getTime() : Number(lastPurgeAt) + PURGE_INTERVAL_MS;

        const times = [ row.pending_at, row.lease_at, row.schedule_at, purgeAt ].filter((t) => t !== null);

        return new Date(Math.min(...times));
    }

    #insertJob(now, job) {
        const nowMs = now.getTime();

        const [ row ] = this.#sql.all(
            `INSERT INTO jobs (id, name, key, schedule_name, payload, status, attempt, max_attempts,
                    run_at, scheduled_for, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?) RETURNING *`,
            crypto.randomUUID(),
            job.name,
            job.key,
            job.scheduleName,
            job.payload,
            job.maxAttempts,
            job.runAt,
            job.scheduledFor,
            nowMs,
            nowMs,
        );

        return row;
    }

    #selectActiveByKey(key) {
        const [ row ] = this.#sql.all(`SELECT * FROM jobs WHERE key = ? AND ${ ACTIVE_STATUSES_SQL }`, key);
        return row ?? null;
    }

    #selectActiveBySchedule(name) {
        const [ row ] = this.#sql.all(
            `SELECT id FROM jobs WHERE schedule_name = ? AND ${ ACTIVE_STATUSES_SQL }`,
            name,
        );
        return row ?? null;
    }

    // One statement, so the token, status, and unexpired-lease checks and the
    // transition are atomic. Leaving `running` always clears the token and lease.
    #finishClaim(now, id, claimToken, status, errorRecord, runAt) {
        assertValidDate(now, 'JobStateStore claim outcome now');
        assertNonEmptyString(id, 'JobStateStore claim outcome id');
        assertNonEmptyString(claimToken, 'JobStateStore claim outcome claimToken');

        const nowMs = now.getTime();

        const rows = this.#sql.all(
            `UPDATE jobs SET status = ?, run_at = COALESCE(?, run_at),
                    finished_at = ?, last_error = COALESCE(?, last_error),
                    claim_token = NULL, lease_expires_at = NULL, updated_at = ?
                WHERE id = ? AND status = 'running' AND claim_token = ? AND lease_expires_at > ?
                RETURNING id`,
            status,
            runAt ?? null,
            status === 'pending' ? null : nowMs,
            errorRecord ? serializeError(errorRecord) : null,
            nowMs,
            id,
            claimToken,
            nowMs,
        );

        return rows.length > 0;
    }

    // An expired lease means the run's outcome was never recorded (crash,
    // eviction, or a handler that outlived its timeout). It counts as one
    // failed attempt with an expected error, and clearing the token in the same
    // statement invalidates the old claim so a late outcome cannot land.
    #recoverExpiredLeases(nowMs) {
        const expired = this.#sql.all(
            "SELECT id, attempt, max_attempts FROM jobs WHERE status = 'running' AND lease_expires_at <= ?",
            nowMs,
        );

        const error = serializeError({
            name: 'LeaseExpiredError',
            message: 'The job lease expired before the attempt reported an outcome',
            expected: true,
        });

        for (const job of expired) {
            const isExhausted = job.attempt >= job.max_attempts;

            this.#sql.run(
                `UPDATE jobs SET status = ?, run_at = ?, finished_at = ?, last_error = ?,
                        claim_token = NULL, lease_expires_at = NULL, updated_at = ?
                    WHERE id = ?`,
                isExhausted ? 'failed' : 'pending',
                isExhausted ? nowMs : nowMs + nextRetryDelayMs(job.attempt, this.#random),
                isExhausted ? nowMs : null,
                error,
                nowMs,
                job.id,
            );
        }
    }

    #readMeta(key) {
        const [ row ] = this.#sql.all('SELECT value FROM job_queue_meta WHERE key = ?', key);
        return row ? row.value : null;
    }

    #writeMeta(key, value) {
        this.#sql.run(
            'INSERT INTO job_queue_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
            key,
            value,
        );
    }
}

function assertPositiveInteger(value, label) {
    assert(Number.isInteger(value) && value > 0, `${ label } must be a positive integer`);
}

function serializePayload(payload) {
    let text;

    try {
        text = JSON.stringify(payload === undefined ? null : payload);
    } catch (cause) {
        assert(false, `Job payload must be JSON serializable: ${ cause.message }`);
    }

    // JSON.stringify() returns undefined for functions and symbols.
    assert(isNonEmptyString(text), 'Job payload must be JSON serializable');

    if (new TextEncoder().encode(text).length > MAX_PAYLOAD_BYTES) {
        throw new PayloadTooLargeError(`Job payload exceeds ${ MAX_PAYLOAD_BYTES } bytes when serialized`);
    }

    return text;
}

function serializeError(errorRecord) {
    return JSON.stringify({
        name: errorRecord.name,
        message: errorRecord.message,
        stack: errorRecord.stack ?? null,
        expected: Boolean(errorRecord.expected),
    });
}

function toIso(ms) {
    return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

function toEnqueueResult(row, created) {
    return {
        id: row.id,
        name: row.name,
        key: row.key ?? null,
        status: row.status,
        runAt: toIso(row.run_at),
        created,
    };
}

// The claim token is deliberately not part of the public representation.
function toJobRecord(row) {
    return {
        id: row.id,
        name: row.name,
        key: row.key ?? null,
        scheduleName: row.schedule_name ?? null,
        payload: JSON.parse(row.payload),
        status: row.status,
        attempt: row.attempt,
        maxAttempts: row.max_attempts,
        runAt: toIso(row.run_at),
        scheduledFor: toIso(row.scheduled_for),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        finishedAt: toIso(row.finished_at),
        lastError: row.last_error ? JSON.parse(row.last_error) : null,
    };
}

// Walks forward from the first missed occurrence to the last one at or before
// `nowMs`. Iterating is cheap: minute-granularity expressions match in O(1)
// per step, and sparse expressions have few occurrences to walk.
function mostRecentOccurrence(parsed, firstMs, nowMs) {
    let current = firstMs;

    for (;;) {
        const next = nextOccurrence(parsed, new Date(current)).getTime();

        if (next > nowMs) {
            return current;
        }

        current = next;
    }
}

function encodeCursor(createdAt, id) {
    return btoa(JSON.stringify([ createdAt, id ]))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function decodeCursor(cursor) {
    try {
        const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
        const [ createdAt, id ] = JSON.parse(atob(padded));

        if (Number.isInteger(createdAt) && isNonEmptyString(id)) {
            return [ createdAt, id ];
        }
    } catch {
        // Falls through to the validation error below.
    }

    throw new ValidationError('cursor is invalid');
}
