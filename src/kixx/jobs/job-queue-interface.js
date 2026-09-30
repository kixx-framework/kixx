/**
 * JobQueueInterface — the contract for the durable background job queue. The
 * implementation changes with the platform (SQLite in the Node.js process, a
 * SQLite-backed Durable Object on Cloudflare) but the interface stays the same
 * so application code remains runtime-agnostic.
 *
 * Application code enqueues a job by registered name; the queue runs it as soon
 * as possible, at a later time, or on a recurring UTC cron schedule declared in
 * code on the registry entry.
 *
 * ```js
 * const queue = context.getService('JobQueue');
 * await queue.enqueue(context, 'send-admin-invite-email', { inviteId }, {
 *     delaySeconds: 300,
 *     key: `invite-email:${ inviteId }`,
 * });
 * ```
 *
 * ## Delivery: at-least-once
 * A job may run more than once: a process can die after a handler's side
 * effects but before the outcome is recorded, and an expired lease is retried.
 * Handlers MUST be idempotent. Every run receives a stable `job.id` and an
 * incrementing `job.attempt` to build idempotency keys from.
 *
 * Claim tokens protect queue state only: a stale run cannot overwrite the
 * outcome of a newer attempt. They cannot fence side effects a handler already
 * caused outside the queue.
 *
 * ## A job must fit one Cloudflare invocation
 * On Cloudflare handlers run inside a Durable Object `alarm()` invocation and
 * must finish within its CPU and wall-clock limits. The contract promises the
 * weakest guarantee any adapter can keep, so every job MUST fit one invocation,
 * even on Node.js where it would not have to. Split long work into chained
 * jobs that each enqueue the next.
 *
 * ## No atomicity with other stores
 * There is no transaction spanning the queue and the DocumentStore, so
 * enqueueing is not atomic with a domain write. Enqueue AFTER the domain write.
 * When the work is critical, record the intent on the domain record and let a
 * recurring sweep job re-enqueue anything still outstanding; a lost enqueue is
 * then delayed, not dropped.
 *
 * ## No read-after-enqueue ordering
 * Across processes and isolates there is no guarantee that a job enqueued by
 * one caller is visible to another's `get()`/`list()` in any particular order
 * relative to other writes. Node.js adapters poll at a fixed interval, so an
 * idle queue may take up to one polling interval to start a newly due job.
 *
 * ## Dedupe keys
 * A `key` is unique among ACTIVE (`pending` or `running`) jobs. Enqueueing with
 * the key of an active job returns that job unchanged with `created: false`.
 * Once the job completes or fails the key is reusable. There is deliberately no
 * `cancel()`: handlers re-check the state they act on and no-op when the work
 * is obsolete. This keeps the contract to what every adapter can enforce
 * atomically.
 *
 * ## Time
 * All times cross the API as ISO 8601 UTC strings. Cron is evaluated in UTC
 * only, at one-minute granularity. Local time, timezone options, and DST
 * policies are not part of the contract.
 *
 * ## Recurring schedules
 * Schedules are declared on registry entries (see `job-registry.js`) and
 * reconciled into the store at startup. A schedule that falls behind runs ONCE
 * to catch up, then resumes. At most one occurrence of a schedule is active at
 * a time; an occurrence that comes due while its predecessor is still active
 * (including waiting to retry) is skipped and logged.
 *
 * ## Errors
 * Errors thrown by a handler follow `src/docs/server-error-handling.md`.
 * Expected errors are recorded and retried with backoff unless
 * `error.retryable === false` (see `retry-policy.js`). An unexpected error
 * fails the job immediately and reaches the platform's fatal-error policy.
 *
 * ## Context pass-through
 * Every method receives an execution `context` as its first argument.
 * Cloudflare adapters resolve their Durable Object binding from `context.env`
 * on every call. Node.js adapters resolve their database at registration and
 * accept `context` for interface compatibility. Implementations MUST accept the
 * argument so callers stay runtime-agnostic.
 *
 * ## Why these capabilities are (not) in the contract
 * - `retry()` covers failed jobs only, so an operator can recover from a bug
 *   without a schema-level "reset" that would race a running job.
 * - Priorities, named queues, per-name concurrency, runtime schedules, and bulk
 *   retry are absent: none is required by the portable floor and each would
 *   widen what every adapter must implement.
 * - `start()`, `stop()`, and `processDueJobs()` are adapter lifecycle, not part
 *   of the port: application code enqueues and inspects, and never drives
 *   execution.
 *
 * @see JobQueue in ../../plugins/node-job-queue/lib/job-queue.js for the Node.js implementation
 * @see JobQueue in ../../plugins/cloudflare-job-queue/lib/job-queue.js for the Cloudflare implementation
 */

/**
 * @typedef {('pending'|'running'|'completed'|'failed')} JobStatus
 *   A job waiting to retry is `pending` with `attempt > 0`.
 */

/**
 * @typedef {Object} JobErrorRecord
 * @property {string} name - Error class name.
 * @property {string} message - Error message.
 * @property {string} [stack] - Stack trace when available.
 * @property {boolean} expected - Whether the error was an expected error.
 */

/**
 * Public representation of a stored job. The internal claim token is never
 * included.
 *
 * @typedef {Object} JobRecord
 * @property {string} id - UUID, stable across attempts.
 * @property {string} name - Registered job name.
 * @property {string|null} key - Dedupe key, or `null`.
 * @property {string|null} scheduleName - Owning schedule for a recurring occurrence, or `null`.
 * @property {*} payload - The JSON payload passed to `enqueue()`.
 * @property {JobStatus} status
 * @property {number} attempt - Attempts started so far.
 * @property {number} maxAttempts
 * @property {string} runAt - ISO time the job becomes (or became) due.
 * @property {string|null} scheduledFor - ISO cron occurrence time for a recurring job, or `null`.
 * @property {string} createdAt - ISO time.
 * @property {string} updatedAt - ISO time.
 * @property {string|null} finishedAt - ISO time the job completed or failed, or `null` while active.
 * @property {JobErrorRecord|null} lastError - The most recent failed attempt, or `null`.
 */

/**
 * @typedef {Object} JobScheduleRecord
 * @property {string} name - Registry job name.
 * @property {string} cron - UTC 5-field cron expression.
 * @property {string} nextRunAt - ISO time of the next occurrence to materialize.
 * @property {string|null} lastEnqueuedAt - ISO time an occurrence was last enqueued, or `null`.
 * @property {string|null} lastJobId - Id of the last enqueued occurrence, or `null`.
 */

/**
 * @typedef {Object} JobEnqueueOptions
 * @property {(string|Date)} [runAt] - Absolute time the job becomes due. Mutually exclusive with `delaySeconds`.
 * @property {number} [delaySeconds] - Non-negative delay from now. Mutually exclusive with `runAt`.
 * @property {string} [key] - Dedupe key, unique among active jobs.
 */

/**
 * @typedef {Object} JobEnqueueResult
 * @property {string} id
 * @property {string} name
 * @property {string|null} key
 * @property {JobStatus} status
 * @property {string} runAt - ISO time.
 * @property {boolean} created - False when `key` matched an active job, which is returned unchanged.
 */

/**
 * The handler contract for a registered job.
 *
 * @callback JobHandler
 * @param {Object} context - Job context: shared services and collections, a job-scoped logger, no request.
 * @param {Object} job - Frozen description of this run.
 * @param {string} job.id - Stable across attempts.
 * @param {string} job.name
 * @param {*} job.payload
 * @param {number} job.attempt - 1 on the first run.
 * @param {number} job.maxAttempts
 * @param {string|null} job.scheduledFor - ISO cron occurrence time, or `null` for a one-off job.
 * @param {AbortSignal} job.signal - Aborted at the job's timeout. Abort is cooperative.
 * @returns {Promise<void>}
 */

/**
 * Durable background job queue service.
 *
 * @typedef {Object} JobQueueInterface
 *
 * @property {function(Object, string, *, JobEnqueueOptions=): Promise<JobEnqueueResult>} enqueue
 *   Records a job for the registered `name`. The payload MUST be JSON
 *   serializable and at most 128 KB serialized. `runAt` and `delaySeconds` are
 *   mutually exclusive; omit both to run as soon as possible. An unknown name
 *   or a non-serializable payload is an assertion failure; an oversize payload
 *   rejects with `PayloadTooLargeError`.
 *
 * @property {function(Object, string): Promise<(JobRecord|null)>} get
 *   Resolves the job with the given id, or `null` when absent (including
 *   purged by retention).
 *
 * @property {function(Object, {status?: JobStatus, name?: string, limit?: number, cursor?: string}=): Promise<{jobs: JobRecord[], cursor: (string|null)}>} list
 *   Lists jobs newest first with keyset pagination. `limit` defaults to 50 and
 *   is at most 200. `cursor` is opaque and is `null` on the last page.
 *
 * @property {function(Object, string): Promise<JobRecord>} retry
 *   Resets a FAILED job to `attempt: 0` and due now. Throws `NotFoundError` for
 *   an unknown id and `ConflictError` when the job is not failed or when an
 *   active job already holds its dedupe key or schedule name. A conflict leaves
 *   the failed job unchanged.
 *
 * @property {function(Object): Promise<JobScheduleRecord[]>} listSchedules
 *   Lists declared recurring schedules with their next and last run.
 *
 * @property {function(Map): void} setRegistry
 *   Supplies the validated job registry. Called once from `app.register()`.
 */

export {};
