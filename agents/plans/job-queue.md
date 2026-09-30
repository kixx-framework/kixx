# Durable Job Queue

## Implementation Approach

Add a durable background job queue that runs on Node.js and Cloudflare Workers
through the ports-and-adapters plugin model (`src/plugins/README.md`).
Application code enqueues jobs by name; jobs run as soon as possible, at a
later time, or on a recurring cron schedule declared in code.

```js
const queue = context.getService('JobQueue');

await queue.enqueue(context, 'send-admin-invite-email', { inviteId }, {
    runAt: '2026-10-01T09:00:00Z', // or delaySeconds: 300; omit for "as soon as possible"
    key: `invite-email:${ inviteId }`, // optional dedupe key
});
```

### Decisions (settled with the project owner; do not relitigate)

1. **Cloudflare substrate:** one SQLite-backed Durable Object class,
   `JobQueueStore`, addressed by `idFromName('default')`, using `alarm()` for
   all timing. No Cloudflare Queues, no Cron Triggers.
2. **Delivery:** at-least-once. Handlers MUST be idempotent. Each run receives
   a stable `job.id`, `job.attempt`, `job.scheduledFor`, and an `AbortSignal`.
3. **Cloudflare execution:** handlers run inside `alarm()` using a slot pool
   (claim the next due job whenever a slot frees; never batch-and-wait). Each
   invocation stops claiming after a soft deadline and re-arms the alarm, so
   each alarm gets a fresh CPU budget. **A single job must fit inside one
   invocation's limits**; long work is split into chained jobs.
4. **Node execution:** in-process in `node-server.js`, as a loop service with
   `start()`/`stop()`. One non-overlapping loop keeps filling available slots
   while work is due and polls at a fixed interval when idle. No enqueue nudge
   or precise wake-time timer; idle dispatch can wait one polling interval.
5. **Handler registry:** a static `Map` in `src/app/jobs/mod.js`, following the
   `src/app/migrations/mod.js` pattern. Per-job options (retry, timeout,
   schedule) live on the registry entry. Enqueuing an unknown
   name fails with an assertion.
6. **Recurring schedules:** declared in code on registry entries and
   reconciled into the store. No runtime schedule API yet, but the schema is
   keyed so one can be added without migrating data.
7. **Schedule syntax:** 5-field cron evaluated in UTC only. A project-owned
   parser supports `*`, lists, ranges, and steps only. One-minute granularity.
   Local calendar time, timezone options, and DST policies are deferred.
8. **Missed occurrences:** run once to catch up (at the most recent missed time),
   then resume.
9. **Overlap:** at most one active occurrence per schedule. An occurrence that
   comes due while the previous one is active is skipped and logged.
   A partial unique index on active `schedule_name` values enforces this.
   Materializing or skipping an occurrence and advancing its schedule are atomic.
10. **Dedupe key:** unique among *active* jobs. `enqueue` with the key of an
    active job returns that job unchanged with `created: false`. No `cancel`
    in v1 (handlers re-check state and no-op when obsolete).
11. **Atomicity:** there is no transaction across DocumentStore and the queue.
    Transaction Scripts enqueue *after* the domain write; critical work records
    intent on the domain record so a recurring sweep job can re-enqueue.
12. **Errors:** follow `src/docs/server-error-handling.md`.
    - Expected error (`error.expected === true`): record it, then retry with
      backoff unless `error.retryable === false`. `retryable` defaults to `true`
      for `OperationalError` and `false` for every other expected class.
    - Unexpected error: fail the job immediately (no retry) and log it at
      error. Then:
      - Node: graceful `shutdown(..., exitCode: 1)`.
      - Durable Object: stop claiming new jobs in this invocation and report
        the exception to the platform.
    - Defaults: `maxAttempts: 5`, exponential backoff with full jitter from
      10 s capped at 1 h, `timeoutSeconds: 60`. The lease is the timeout plus a
      margin.
13. **Operator surface:** port methods `get`, `list`, `retry` (failed jobs
    only) and `listSchedules`. Admin API v1 routes: `GET /jobs`,
    `GET /jobs/:id`, `POST /jobs/:id/retry`, `GET /job-schedules`. Retention
    is by age only: `completed` after 7 days, `failed` after 30 days,
    configurable.
14. **Devkit:** add a `JOB_QUEUE` resource block, mirroring `CONTENT_STORE`,
    in the separate devkit repository.
15. **Environments:** jobs run automatically everywhere. `JOB_QUEUE.enabled:
    false` means jobs are recorded but never run. Tests drive
    `processDueJobs({ now })` directly.
16. **Schedule pickup on Cloudflare:** the Durable Object constructor runs
    schema migration, schedule reconciliation, and alarm re-arming inside
    `ctx.blockConcurrencyWhile()`. The Worker sends a background `ping()` once
    per isolate (via `waitUntil`) so the Durable Object is instantiated soon
    after a deploy. No fingerprint hash. A deploy followed by zero traffic
    picks up changes on the first request.
17. **Claim ownership:** every claim gets a fresh token. Handler outcomes may
    update only the running row with that token and an unexpired lease. Lease
    recovery invalidates the token. Stale outcomes cannot overwrite a newer
    attempt; handlers must still be idempotent because tokens do not fence
    external side effects.
18. **Examples:** the shipped application registry is empty. Recurring examples
    live in tests; manual checks use an explicit temporary test registration.

**Out of scope for v1:**
- Priorities.
- Named queues and sharding.
- `cancel`.
- Runtime or per-user schedules.
- Local-time scheduling, timezone configuration, and DST policies.
- Per-name concurrency limits; retain runner concurrency and schedule no-overlap.
- Admin panel HTML pages.
- Count-based retention.
- Bulk retry.

### Architecture

Both backends are synchronous SQLite (`node:sqlite` `DatabaseSync` and Durable
Object `ctx.storage.sql`). All queue semantics therefore live once, in
platform-neutral code under `src/kixx/jobs/`, over a minimal SQL executor.

```
src/kixx/jobs/
    job-queue-interface.js   port: JobQueue service contract (JSDoc only)
    cron.js                  parse + nextOccurrence(parsed, after)
    job-registry.js          validate registry, resolve per-job options/defaults
    retry-policy.js          backoff + error classification
    job-state-store.js       schema, enqueue, claim, complete/fail, schedules, retention, reads
    job-runner.js            slot pool, deadline, timeout signal, outcome -> store
src/plugins/node-job-queue/        plugin.js + lib/ (executor over DatabaseSync, loop)
src/plugins/cloudflare-job-queue/  plugin.js + lib/ (JobQueueStore Durable Object, Worker-side service)
src/app/jobs/                      mod.js registry + handler modules + README.md
```

`SqlExecutor` (internal to `src/kixx/jobs/`, documented in `job-state-store.js`):

- `all(sql, ...params) -> Object[]`
- `run(sql, ...params) -> void`
- `transaction(fn) -> result`

On Node, `transaction` is `BEGIN IMMEDIATE … COMMIT`/`ROLLBACK`, so several
processes can safely share one file (the devserver briefly overlaps children).
In the Durable Object it is `ctx.storage.transactionSync`.

### Data model (shared schema)

- **`jobs` table:**
  - Columns: `id` (UUID via `crypto.randomUUID()`), `name`, `key` (nullable),
    `schedule_name` (nullable), `payload` (JSON text), `status`
    (`pending | running | completed | failed`), `attempt`, `max_attempts`,
    `run_at`, `scheduled_for`, `lease_expires_at`, `claim_token` (nullable), `created_at`,
    `updated_at`, `finished_at`, `last_error` (JSON: `name`, `message`,
    `stack`, `expected`).
  - All times are integer epoch milliseconds in storage and ISO strings in
    the API.
  - **Active** means `status IN ('pending','running')`. A job waiting to retry
    is `pending` with `attempt > 0`.
  - Partial unique index on `key WHERE status IN ('pending','running')`
    enforces dedupe among active jobs (decision 10).
  - Separate partial unique index on `schedule_name WHERE status IN
    ('pending','running') AND schedule_name IS NOT NULL` enforces schedule
    no-overlap (decision 9), including jobs waiting to retry.
  - `claim_token` is a fresh UUID on every claim, not the attempt counter
    (manual retry resets that counter). It is internal to the store and runner,
    excluded from handler objects and public job representations, and cleared
    whenever a job leaves `running`.
  - Indexes on `(status, run_at)`, `(status, finished_at)`, and
    `(name, status)`.
- **`job_schedules` table:** `name` (PK = registry job name), `cron`,
  `next_run_at`, `last_enqueued_at`, `last_job_id`. Cron is always UTC.
- **`job_queue_meta` table:** `schema_version`, `last_purge_at`.
- **Scheduled occurrence:**
  - Key: `schedule:<name>:<scheduledFor ISO>`.
  - Payload: `{}`.
  - `max_attempts` and timeout come from the registry entry.

### Cross-cutting invariants

- `app/` never names a platform. Handlers use only `context.getService` and
  `context.getCollection`.
- Job handlers sit at the presentation/entry-point layer. Business rules and
  application orchestration belong in Transaction Scripts. Handlers may call
  a framework service directly when it owns the complete operation; do not
  introduce a pass-through Transaction Script solely to preserve a layer.
- Job handler signature: `async function handler(context, job)`, where
  `job = { id, name, payload, attempt, maxAttempts, scheduledFor, signal }`.
- `context` comes from `ApplicationContext#createJobContext(env, job)`: shared
  services and collections, a job-scoped child logger, and no request.
- Payload: JSON-serializable, at most 128 KB serialized. Oversize payloads
  reject with `PayloadTooLargeError`. A non-serializable payload is an
  assertion failure.
- A job whose name is no longer in the registry at claim time (deploy drift) is
  marked `failed` with an `UnknownJob` error record, logged at warn level, and
  does not crash the process.
- An expired lease on a `running` job counts as a failed attempt with an
  expected "lease expired" error, and follows the retry policy. Recovery and
  token invalidation are atomic. Late completion or failure from an expired
  or replaced claim is a no-op; it cannot change the job's state.
- Retention purge runs inside normal processing, at most once per hour
  (tracked in `job_queue_meta.last_purge_at`), deleting in bounded batches.
  Active jobs are never purged.

---

### Task JQ-1: Devkit `JOB_QUEUE` resource block

**Status:** Complete
**Depends on:** None
**Documentation:** `devkit/AGENTS.md`; `kixx/docs/configuration.md` "Worker and resource configuration"

**Objective**

The Kixx deployment CLI binds a `JobQueueStore` Durable Object namespace and
exports its class with SQLite storage when `cloudflare-config.js` contains a
`JOB_QUEUE` block. This mirrors the existing `CONTENT_STORE` handling, so the
Cloudflare adapter (JQ-8) can be deployed.

**Scope**

- In: the `JOB_QUEUE` binding source in `devkit/lib/cloudflare/worker-bindings.js`; class export in `devkit/lib/cloudflare/durable-object-exports.js`; devkit tests and docs.
- Out: the `kixx` repository's `cloudflare-config.js` block (JQ-8). A generic `DURABLE_OBJECTS` block (rejected).

**Design and invariants**

- Required fields: `JOB_QUEUE.durableObjectBindingName` and `JOB_QUEUE.durableObjectClassName`. Every other `JOB_QUEUE` key is runtime config and is ignored by devkit.
- Emitted binding: `{ type: 'durable_object_namespace', name, class_name }`, with `source: 'JOB_QUEUE'`.
- The class is added to the SQLite-storage export list next to `CONTENT_STORE.durableObjectClassName`. `DURABLE_OBJECT_MIGRATIONS` rename, delete, and transfer declarations must work for it unchanged.
- Absent `JOB_QUEUE` block: no binding and no export. Existing environments are unaffected.

**Expected touch points**

- `devkit/lib/cloudflare/worker-bindings.js` — new binding source
- `devkit/lib/cloudflare/durable-object-exports.js` — include the class
- `devkit/test/unit-tests/lib/cloudflare/worker-bindings.test.js`, `durable-object-exports.test.js` — coverage
- `devkit/docs/` or README — document the block

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] With a `JOB_QUEUE` block, the version upload includes the Durable Object binding and the SQLite class export.
- [x] Missing required fields fail with a `UsageError` that names the exact field path.
- [x] Without the block, output is byte-identical to before.
- [x] Tests and docs updated.

**Validation**

- `cd ../devkit && node run-tests.js` — all devkit tests pass
- `cd ../devkit && node run-linter.js lib test` — clean

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete. Changes are uncommitted in the `devkit` repo (`../devkit`).
- Remaining: Nothing.
- Decisions and discoveries: Missing-field errors reuse `requireField`, so messages read `JOB_QUEUE.<field> is required and must be a non-empty string`. Binding-name collisions with other sources are caught by the existing `checkCollisions`. With no `JOB_QUEUE` block both new code paths return early, so output is unchanged.
- Actual files changed (in `../devkit`): `lib/cloudflare/worker-bindings.js`, `lib/cloudflare/durable-object-exports.js`, `docs/cloudflare.md`, `test/unit-tests/lib/cloudflare/worker-bindings.test.js`, `test/unit-tests/lib/cloudflare/durable-object-exports.test.js`.
- Validation run: `node run-tests.js` (622 tests, pass); `node run-linter.js lib test` (clean).
- Blockers: None.

---

### Task JQ-2: Cron parser and next-occurrence calculation

**Status:** Complete
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `test/unit-tests/README.md`

**Objective**

A platform-neutral module parses 5-field cron expressions and computes the
next occurrence strictly after a given instant in UTC. It is a
self-contained unit that the store (JQ-4) builds on.

**Scope**

- In: `src/kixx/jobs/cron.js` and its unit tests.
- Out: schedule persistence and reconciliation (JQ-4), timezone options, and DST policies.

**Design and invariants**

- Fields: minute, hour, day-of-month, month, day-of-week (0–7, where both 0 and 7 mean Sunday). Supports `*`, `a,b`, `a-b`, `*/n`, `a-b/n`. No names (`MON`, `JAN`), no `@` macros, no `L`, `W` or `#`, no seconds.
- Day matching follows standard cron: when both day-of-month and day-of-week are restricted, a day matches if **either** matches.
- API: `parseCron(expression)` returns a frozen parsed form, or throws `ValidationError` naming the bad field. `nextOccurrence(parsed, afterDate)` returns a `Date`.
- `nextOccurrence` is always strictly later than `afterDate` and truncated to the minute.
- Use UTC calendar operations throughout, independent of the host timezone. No timezone library or local-time conversion is needed.
- Must terminate for impossible expressions (e.g. `0 0 31 2 *`). Bound the search (e.g. 5 years) and throw `ValidationError`.

**Expected touch points**

- `src/kixx/jobs/cron.js`
- `test/unit-tests/kixx/jobs/cron.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Parses every supported form. Rejects each unsupported form with a field-specific message.
- [x] Correct UTC next occurrence across day, month, year, and leap-day boundaries, independent of the host timezone.
- [x] The day-of-month/day-of-week OR rule is covered.
- [x] Impossible expressions throw instead of looping.
- [x] JSDoc per the documentation guide.

**Validation**

- `node run-tests.js test/unit-tests/kixx/jobs` — cron tests pass
- `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` — clean

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete; uncommitted in the working tree.
- Remaining: Nothing.
- Decisions and discoveries: `ParsedCron` is `{ expression, minutes, hours, daysOfMonth, months, daysOfWeek, isDayOfMonthRestricted, isDayOfWeekRestricted }` (sorted frozen arrays; 7 folded into 0). A day field counts as restricted unless its text starts with `*`. `a/n` (step on a bare number) is rejected as ambiguous. Search bound is 8 years, not 5, because Feb 29 can be 8 years apart (2096 to 2104). Errors are `ValidationError` with the field label in the message.
- Actual files changed: `src/kixx/jobs/cron.js`, `test/unit-tests/kixx/jobs/cron.test.js`.
- Validation run: `node run-tests.js test/unit-tests/kixx/jobs` (21 pass, also under TZ=America/Los_Angeles and Pacific/Auckland); `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` clean.
- Blockers: None.

---

### Task JQ-3: Port contract, registry validation, and retry policy

**Status:** Complete
**Depends on:** JQ-2
**Documentation:** `src/plugins/README.md` ("How the Contracts Are Written"), `src/docs/server-error-handling.md`, `src/app/migrations/mod.js` (registry precedent)

**Objective**

Define the `JobQueue` port and the platform-neutral rules every adapter
shares: registry shape and defaults, and error-to-retry classification with
backoff. After this task the contract is fixed and later tasks implement it.

**Scope**

- In: `job-queue-interface.js`, `job-registry.js`, `retry-policy.js`, and tests.
- Out: storage (JQ-4), execution (JQ-5), and the app's actual registry (JQ-6).

**Design and invariants**

- The port (JSDoc only) documents the service methods, each taking `context` first:
  - `enqueue(context, name, payload, { runAt?, delaySeconds?, key? })` returns `{ id, name, key, status, runAt, created }`. `runAt` and `delaySeconds` are mutually exclusive.
  - `get(context, id)` returns the job or `null`.
  - `list(context, { status?, name?, limit?, cursor? })` returns `{ jobs, cursor }`.
  - `retry(context, id)`: failed jobs only. It resets `attempt` to 0 and sets `runAt` to now. Throws `NotFoundError` or `ConflictError`, including when an active job already holds its dedupe key or schedule name. A conflict leaves the failed job unchanged.
  - `listSchedules(context)`.
  - `setRegistry(registry)`: called once from `app.register()`.
- The port's prose must state:
  - The delivery guarantee (at-least-once), the idempotency requirement, and the "a job must fit one Cloudflare invocation" constraint.
  - That there is no atomicity with other stores.
  - That there is no read-after-enqueue ordering guarantee across processes.
- Registry entry: `{ name, description, handler, maxAttempts?, timeoutSeconds?, schedule?: { cron } }`.
  - `validateJobRegistry(map)` asserts the shape, requires the key to equal `name` (pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`), parses `schedule.cron` via JQ-2, and returns frozen, resolved entries with defaults applied.
  - Defaults: `maxAttempts: 5` and `timeoutSeconds: 60`. Schedules always use UTC. Reject per-entry `concurrency` and schedule `timezone` options rather than silently ignoring them.
  - Registry errors are `AssertionError`s at boot.
- `classifyError(error)` returns `'retryable' | 'terminal' | 'unexpected'`:
  - `'unexpected'` when `error.expected !== true`.
  - Otherwise `error.retryable` if it is a boolean.
  - Otherwise `'retryable'` for `OperationalError` and `'terminal'` for other expected classes.
- `nextRetryDelayMs(attempt, random = Math.random)`: full jitter over `min(3_600_000, 10_000 * 2 ** (attempt - 1))`. `random` is injectable for tests.

**Expected touch points**

- `src/kixx/jobs/job-queue-interface.js`
- `src/kixx/jobs/job-registry.js`
- `src/kixx/jobs/retry-policy.js`
- `test/unit-tests/kixx/jobs/job-registry.test.js`, `retry-policy.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The interface documents every method, its invariants, and *why* each capability is or isn't in the contract.
- [x] Registry validation accepts an empty map and rejects bad names, non-function handlers, invalid option values, bad cron, and unsupported concurrency/timezone options with precise messages.
- [x] Classification and backoff are tested, including `retryable` overrides and the backoff cap.

**Validation**

- `node run-tests.js test/unit-tests/kixx/jobs` — pass
- `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` — clean

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete; uncommitted in the working tree.
- Remaining: Nothing.
- Decisions and discoveries:
  - `validateJobRegistry(map)` returns a NEW `Map` of frozen `ResolvedJobEntry` `{ name, description, handler, maxAttempts, timeoutSeconds, schedule }`. `schedule` is `null` or frozen `{ cron, parsed }` where `parsed` is the JQ-2 `ParsedCron`. Unknown entry fields and unknown `schedule` fields are rejected, with dedicated messages for `concurrency` and `timezone`. Bad cron surfaces as an `AssertionError` wrapping the `ValidationError` message. `DEFAULT_MAX_ATTEMPTS` and `DEFAULT_TIMEOUT_SECONDS` are exported.
  - `retryable` is NOT a `WrappedError` option; the base class ignores it. It is a plain property a handler assigns (`Object.assign(error, { retryable: false })`). Authoring docs (JQ-10) should say so. The error classes were not changed.
  - `nextRetryDelayMs` clamps the exponent at 20 to avoid overflow; `attempt` must be an integer >= 1.
  - The interface file exports typedefs only (`export {}`), including public `JobRecord`, `JobScheduleRecord`, `JobEnqueueOptions`, `JobEnqueueResult`, `JobHandler`, and `JobQueueInterface`. `start`/`stop`/`processDueJobs` are documented as adapter lifecycle, not port methods.
- Actual files changed: `src/kixx/jobs/job-queue-interface.js`, `src/kixx/jobs/job-registry.js`, `src/kixx/jobs/retry-policy.js`, `test/unit-tests/kixx/jobs/job-registry.test.js`, `test/unit-tests/kixx/jobs/retry-policy.test.js`.
- Validation run: `node run-tests.js test/unit-tests/kixx/jobs` (47 pass); `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` clean.
- Blockers: None.

---

### Task JQ-4: Shared SQLite job state store

**Status:** Complete
**Depends on:** JQ-2, JQ-3
**Documentation:** "Data model" and "Cross-cutting invariants" above

**Objective**

One platform-neutral module owns the schema and every state transition of jobs
and schedules, over the `SqlExecutor` abstraction. Both adapters get identical
semantics by construction.

**Scope**

- In:
  - Schema creation and migration.
  - Enqueue with dedupe.
  - Claim with leases and fresh claim tokens.
  - Complete, fail, and retry transitions.
  - Lease-expiry recovery.
  - Schedule reconciliation and occurrence materialization (catch-up once, no overlap).
  - Retention purge.
  - `get`/`list`/`retry`/`listSchedules`.
  - `nextWakeTime()`.
- Out: running handlers (JQ-5), timers and alarms (JQ-7, JQ-8).

**Design and invariants**

- `new JobStateStore({ sql, logger })`, with methods taking an explicit `now` (a `Date`) so tests control time.
- `migrate()` is idempotent and versioned through `job_queue_meta.schema_version`.
- `enqueue(now, { name, payload, runAt, key, maxAttempts, scheduleName, scheduledFor })` runs in one transaction. If an active row holds `key`, it returns that row with `created: false`.
- `claimNext(now, { leaseMs, registry })` runs in one transaction:
  - First it converts expired leases into failed attempts and clears their claim tokens, applying the retry policy exactly once per expired claim.
  - Then it selects the earliest due `pending` job and marks it `running` with `attempt + 1`, a lease, and a fresh UUID claim token. There is no per-name running-count check.
  - Returns the claimed row including its token, or `null` if nothing is claimable.
- `complete(now, id, claimToken)`, `failAttempt(now, id, claimToken, errorRecord, retryAt | null)`, and `failTerminal(now, id, claimToken, errorRecord)`:
  - Update atomically only where `status = 'running'`, `claim_token = claimToken`, and `lease_expires_at > now`.
  - Clear the token and lease when leaving `running`. Return whether the transition was applied; stale outcomes return `false` without mutating the row.
- Manual `retry` runs in one transaction and preserves active-key and active-schedule uniqueness. A conflict throws `ConflictError` without changing the failed row.
- `reconcileSchedules(now, registry)`:
  - Upserts one row per scheduled registry entry.
  - Recomputes `next_run_at` from `now` when the cron changed.
  - Deletes rows for undeclared schedules.
  - Leaves active occurrence jobs alone.
- `materializeDueSchedules(now)`: for each schedule, read and re-check `next_run_at <= now` inside one transaction:
  - If there is an active job with that `schedule_name`, it skips and logs at info level.
  - Otherwise it enqueues one occurrence for the **most recent** occurrence `<= now`.
  - Either way it sets `next_run_at = nextOccurrence(parsedCron, now)` in the same transaction. On enqueue, update `last_enqueued_at` and `last_job_id` there too.
  - The active-schedule unique index prevents overlapping rows; atomic schedule advancement prevents another processor from materializing the same occurrence after it completes. A failed transaction leaves both the schedule and jobs unchanged.
- `purgeExpired(now, retention)` is gated by `last_purge_at` (once per hour) and deletes in batches of at most 500.
- `nextWakeTime(now)` returns the minimum of the earliest pending `run_at`, the earliest `lease_expires_at`, the earliest schedule `next_run_at`, and the next purge time.
- `list` uses keyset pagination on `(created_at DESC, id DESC)` with an opaque base64url JSON cursor. `limit` defaults to 50, max 200.
- No platform imports. Uses only the executor, `crypto.randomUUID()`, and JQ-2/JQ-3 modules.

**Expected touch points**

- `src/kixx/jobs/job-state-store.js` (executor typedef documented here)
- `test/unit-tests/kixx/jobs/job-state-store.test.js` — uses a test executor over `node:sqlite` `DatabaseSync :memory:` (allowed in tests)

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Dedupe: a second enqueue with an active key returns the existing job. After completion the key is reusable.
- [x] Claim order, unique claim tokens, and lease expiry leading to a retry attempt are covered.
- [x] Late completion and failure cannot change a job after lease expiry, reclamation, or manual retry, even when attempt numbers repeat. Recovery applies once per expired claim.
- [x] Schedules: catch-up once after a long gap, skip while an occurrence is pending or running, reconcile on add/change/remove, and atomic occurrence creation plus schedule advancement.
- [x] Two executors sharing a database cannot materialize duplicate or overlapping occurrences. Rollback leaves no partial enqueue or schedule advancement.
- [x] Manual retry conflicts with an active dedupe key or schedule name without changing the failed job.
- [x] Retention deletes only terminal rows past their age, and is batched and gated.
- [x] `nextWakeTime` is correct across all sources.
- [x] Payload size limit enforced with `PayloadTooLargeError`.

**Validation**

- `node run-tests.js test/unit-tests/kixx/jobs` — pass
- `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` — clean

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete; uncommitted in the working tree.
- Remaining: Nothing.
- Decisions and discoveries (API JQ-5/7/8 must use):
  - `new JobStateStore({ sql, logger, random? })`, default export of `src/kixx/jobs/job-state-store.js`; also exports `SCHEMA_VERSION` and `MAX_PAYLOAD_BYTES`. `random` is the backoff jitter source used for lease-expiry retries.
  - `claimNext(now, { leaseMs })` has NO `registry` argument. `leaseMs` is a number OR a function of the claimed job's name, so the runner can size each lease from that job's registry timeout. It returns the public `JobRecord` plus `claimToken`, or `null`.
  - `materializeDueSchedules(now, registry)` DOES take the resolved registry (for `maxAttempts` and the parsed cron); it returns `{ enqueued, skipped }`. `reconcileSchedules(now, registry)` takes the same resolved registry from `validateJobRegistry()`.
  - `enqueue(now, { name, payload, runAt, key, maxAttempts })` takes no `scheduleName`/`scheduledFor`; those are set only by `materializeDueSchedules`. It returns the port's `{ id, name, key, status, runAt, created }`. The adapter service resolves `maxAttempts` from the registry and asserts the name is registered.
  - `complete`, `failAttempt`, `failTerminal` return a boolean (`false` = stale claim, row untouched). `failAttempt(..., retryAt)` with `retryAt === null` delegates to `failTerminal`.
  - `SqlExecutor.all` is used for `INSERT/UPDATE/DELETE ... RETURNING`, which is how the store learns whether a write applied (needs SQLite >= 3.35: Node 24 bundles 3.51, Durable Objects support it). `run` returns nothing.
  - `purgeExpired(now, retention)` deletes at most 500 per status per call and leaves `last_purge_at` unset when a batch was full, so the next pass continues; `nextWakeTime` therefore returns an already-due time until drained. It treats a never-purged queue as due now.
  - `nextWakeTime(now)` returns a `Date` that may be <= `now`; callers clamp.
  - `list()` and `retry()` throw `ValidationError` / `NotFoundError` / `ConflictError` directly.
  - Lease recovery runs inside `claimNext`; a `running` job whose lease expired but which nobody has claimed past stays `running` until the next `claimNext`, though `complete`/`fail*` already reject it via the `lease_expires_at > now` check.
  - `mostRecentOccurrence` walks forward one occurrence at a time; fine for minute-granularity crons over long gaps (O(1) per step).
  - Added an index `jobs_created_at_id` for keyset listing (not in the plan's index list).
- Actual files changed: `src/kixx/jobs/job-state-store.js`, `test/unit-tests/kixx/jobs/job-state-store.test.js`.
- Validation run: `node run-tests.js test/unit-tests/kixx/jobs` (99 pass); `node run-linter.js src/kixx/jobs test/unit-tests/kixx/jobs` clean; full `node run-tests.js` (1574 pass).
- Blockers: None.

---

### Task JQ-5: Shared job runner and job context

**Status:** Complete
**Depends on:** JQ-3, JQ-4
**Documentation:** `src/docs/server-error-handling.md`; `src/kixx/context/application-context.js`

**Objective**

A platform-neutral runner turns claimed jobs into handler calls with a slot
pool, a soft deadline, per-job timeouts, and error classification.
`ApplicationContext#createJobContext` gives handlers their context. Both
adapters drive this one runner.

**Scope**

- In: `src/kixx/jobs/job-runner.js`, `ApplicationContext#createJobContext` (and a `JobContext` class if `RequestContext` can't be reused cleanly), and tests.
- Out: timers, alarms, and process lifecycle (JQ-7, JQ-8).

**Design and invariants**

- `new JobRunner({ store, registry, logger, concurrency })`.
- `runDueJobs({ now, deadline, createContext })` behaviour:
  - Materializes due schedules.
  - Fills up to `concurrency` slots via `store.claimNext`.
  - Refills a slot as soon as a job settles, and stops claiming once `now() >= deadline`, the store has nothing claimable, or an unexpected error occurs.
  - Awaits in-flight jobs, runs purge, and returns `{ ran, unexpectedError | null }`.
- `now` is a function, so tests can advance the clock.
- Each job gets an `AbortController`. It is aborted at `timeoutSeconds`, and the lease is `timeoutSeconds + 30 s`. Abort is cooperative: the runner still awaits the handler.
- Keep each claim token internal to the runner and pass it to every outcome write. A `false` result means the claim is stale: do not overwrite state or log completion/retry as applied. An unexpected handler error still stops claiming and reaches the platform error policy even if its state update is stale.
- Outcomes:
  - Success: `complete`.
  - `'retryable'` with attempts left: `failAttempt` with a backoff `retryAt`.
  - `'retryable'` with attempts exhausted, or `'terminal'`: `failTerminal`.
  - `'unexpected'`: `failTerminal`, error log, stop claiming, and surface it in the return value.
- Unknown job name at claim: `failTerminal` with an `UnknownJob` record and a warn log. Not unexpected.
- Logs: structured info lines for claim, complete, and retry-scheduled, and warn/error for failures, all including `jobId`, `name`, `attempt`.
- `createJobContext(env, job)` shares services, collections, config, and runtime, and uses a child logger carrying `jobId` and `jobName`. It has no request.
- The job object passed to handlers is frozen: `{ id, name, payload, attempt, maxAttempts, scheduledFor, signal }`.

**Expected touch points**

- `src/kixx/jobs/job-runner.js`
- `src/kixx/context/application-context.js` (+ possibly `job-context.js`)
- `test/unit-tests/kixx/jobs/job-runner.test.js`, `test/unit-tests/kixx/context/application-context.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] A slow job doesn't block other slots, which refill independently.
- [x] The deadline stops new claims while in-flight jobs finish.
- [x] The timeout aborts the signal. Retry, terminal, and unexpected paths each reach the right store call.
- [x] An unexpected error stops further claims and is returned to the caller.
- [x] Every outcome carries the original claim token. Stale outcomes leave newer attempts untouched; stale unexpected errors still propagate to the adapter.
- [x] `createJobContext` tests.

**Validation**

- `node run-tests.js test/unit-tests/kixx` — pass
- `node run-linter.js src/kixx test/unit-tests/kixx` — clean

**Progress and handoff**

- Completed: All acceptance criteria.
- Current state: Complete; uncommitted in the working tree.
- Remaining: Nothing.
- Decisions and discoveries (API JQ-7/8 must use):
  - `new JobRunner({ store, registry, logger, concurrency, retention, random? })`; `retention` was added to the plan's constructor list because the runner runs the purge. `runDueJobs({ now?, deadline?, createContext })`: `now` is `() => Date` (defaults to the system clock), `deadline` is a `Date`, `createContext(claimedJob)` receives the claimed `JobRecord` (with `claimToken`) and returns the handler context. Adapters should pass `(job) => appContext.createJobContext(env, job)`. Returns `{ ran, unexpectedError }`.
  - The loop re-polls `claimNext` each time a job settles, so recovery of expired leases also runs then. A handler that outlives its lease therefore usually ends `pending` (lease-expired retry) rather than `running`; its own late outcome is discarded either way.
  - Purge runs only when no unexpected error occurred.
  - A store failure while recording an outcome is treated as an unexpected error (logged at error, returned from `runDueJobs`), not thrown.
  - Lease = `timeoutSeconds * 1000 + 30 s`. Unknown job names use the default 60 s timeout for the lease.
  - `createJobContext(env, job)` returns a `RequestContext` (no `JobContext` class): `requestId` undefined, `user` null. Its logger is a new `JobLogger` (`src/kixx/jobs/job-logger.js`) wrapping the app logger and adding `jobId`/`jobName`, NOT `Logger#createChild()`: children are retained by the parent forever and the finalized application logger throws on `createChild`.
  - `eslint.config.js`: added `AbortController`, `AbortSignal`, and `DOMException` to the server globals block (portable Web APIs).
  - Timeout abort reason is `DOMException` named `TimeoutError`.
- Actual files changed: `src/kixx/jobs/job-runner.js`, `src/kixx/jobs/job-logger.js`, `src/kixx/jobs/job-state-store.js` (function-valued `leaseMs`), `src/kixx/context/application-context.js`, `eslint.config.js`, `test/unit-tests/kixx/jobs/job-runner.test.js`, `test/unit-tests/kixx/jobs/job-logger.test.js`, `test/unit-tests/kixx/jobs/job-state-store.test.js`, `test/unit-tests/kixx/context/application-context.test.js`.
- Validation run: `node run-tests.js` (1608 pass); `node run-linter.js src test eslint.config.js` clean.
- Blockers: None.

---

### Task JQ-6: Application job registry

**Status:** Not started
**Depends on:** JQ-3
**Documentation:** `src/app/presentation/README.md`, `src/app/transaction-scripts/README.md`, `src/app/migrations/mod.js`

**Objective**

The application has `src/app/jobs/mod.js`, a static, validated empty registry,
and hands it to the `JobQueue` service during `app.register()`. A recurring
test fixture supports end-to-end service checks in JQ-7 and JQ-8.

**Scope**

- In: `src/app/jobs/mod.js`, the `app.js` wiring, and a recurring handler fixture under tests.
- Out: real business jobs. The authoring guide README is written in JQ-10.

**Design and invariants**

- The registry is a `Map`, with handlers statically imported. No dynamic `import()`, per devkit packaging rules.
- `app.register()` calls `context.getService('JobQueue').setRegistry(jobs)`. The service runs `validateJobRegistry`.
- The shipped registry is empty. Tests register `example-noop-heartbeat` with `schedule: { cron: '*/15 * * * *' }` and drive processing with a controlled clock. No recurring example is registered by normal application boot.
- Business rules and application orchestration belong in Transaction Scripts. A handler may call a framework service directly when it owns the complete operation; no pass-through script is required.

**Expected touch points**

- `src/app/jobs/mod.js`
- `src/app/app.js`
- `test/unit-tests/app/jobs/mod.test.js`, `test/fixtures/jobs/` — test registry and recurring example handler

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The registry validates at boot. A test proves the shipped registry is valid.
- [ ] `app.js` hands the registry to the service.
- [ ] Normal boot registers no example jobs or schedules. A validated recurring test registry is available for the adapter tests in JQ-7 and JQ-8.

**Validation**

- `node run-tests.js test/unit-tests/app` — pass
- `node run-linter.js src/app test/unit-tests/app` — clean

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Not started, but note for the next agent: `app.register()` (`src/app/app.js`) already calls `context.getService('KeyValueStore')`, so platform plugin services are registered before it runs. Wiring `context.getService('JobQueue').setRegistry(jobs)` there will throw at boot until an adapter registers the `JobQueue` service (JQ-7 Node, JQ-8 Cloudflare). Either land the `app.js` wiring together with JQ-7, or do the `mod.js` registry and its tests in JQ-6 and defer the one-line wiring to JQ-7. Use `validateJobRegistry` from `src/kixx/jobs/job-registry.js` (JQ-3); the service, not `app.js`, validates.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task JQ-7: Node.js adapter and server lifecycle

**Status:** Not started
**Depends on:** JQ-4, JQ-5, JQ-6
**Documentation:** `src/plugins/README.md` ("Adding a New Port"), `docs/configuration.md`

**Objective**

On Node, jobs are durable in a SQLite file and run in-process: the loop starts
after boot, reconciles schedules, drains on SIGTERM, and crashes the process
gracefully on unexpected job errors.

**Scope**

- In:
  - `plugins/node-job-queue/` (plugin, SQL executor over `DatabaseSync`, `JobQueue` service with loop).
  - Registration in `plugins/node.js`.
  - `JOB_QUEUE` in every `node-config.js` environment.
  - `node-server.js` start/stop/crash integration.
  - Tests.
- Out: the Cloudflare adapter (JQ-8) and admin API (JQ-9).

**Design and invariants**

- Config:
  ```
  JOB_QUEUE: {
      enabled, path, pollIntervalSeconds: 1, concurrency: 4, drainTimeoutSeconds: 8,
      retention: { completedMaxAgeDays: 7, failedMaxAgeDays: 30 },
  }
  ```
  - `path` follows existing store conventions: `../data/nodejs_app/job_queue.sqlite` in development and production, and `./job_queue.sqlite` in `local` (instance-relative).
  - `register()` asserts the config with messages naming `context.config.env.JOB_QUEUE.<field>`.
- Executor `transaction` uses `BEGIN IMMEDIATE`. Set the WAL and busy-timeout pragmas that the existing Node SQLite adapters use.
- Service methods:
  - `enqueue`, `get`, `list`, `retry`, `listSchedules`, `setRegistry`.
  - `start({ onUnexpectedError })`: a no-op when `enabled` is false. Otherwise it migrates, reconciles, and starts the loop.
  - `stop()`: stops claiming, waits up to `drainTimeoutSeconds` for in-flight jobs, then resolves.
  - `processDueJobs({ now })`: one runner pass, used by the loop and by tests.
  - `close()`: closes the database. Idempotent.
- Loop:
  - Keep filling available slots while due work is available. When idle, wait `pollIntervalSeconds` before checking again.
  - No local enqueue nudge and no timer based on `store.nextWakeTime`; that method remains for Cloudflare alarm scheduling. An idle Node loop may take one polling interval to observe newly due work.
  - Timers are `unref()`'d.
  - One pass at a time, with no overlapping passes.
- `node-server.js`:
  - Call `jobQueue.start({ onUnexpectedError })` after `listen`.
  - `onUnexpectedError` calls `shutdown('fatal job error', { force: false, exitCode: 1 })`.
  - In `shutdown`, await `jobQueue.stop()` before `appContext.close()`, inside the existing `SHUTDOWN_TIMEOUT_MS` backstop.
  - `drainTimeoutSeconds` must stay below that timeout.
- `tools/local-target.js seed` boots in-process without listening. Confirm it doesn't call `start()`, so seed doesn't run jobs.

**Expected touch points**

- `src/plugins/node-job-queue/plugin.js`, `lib/job-queue.js`, `lib/sqlite-executor.js`
- `src/plugins/node.js`, `src/node-config.js`, `src/node-server.js`
- `test/unit-tests/plugins/node-job-queue/*.test.js`, `test/unit-tests/node-config.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Immediate, delayed, and UTC cron jobs run once due and survive a restart. With free slots, an idle loop observes due work on the next poll.
- [ ] The loop never overlaps passes, refills slots while work is available, and waits the fixed interval when idle. Tests use the recurring fixture, not an application heartbeat.
- [ ] SIGTERM drains in-flight jobs. A job interrupted by a kill is retried after its lease expires.
- [ ] An unexpected handler error fails the job and exits the process with code 1 through graceful shutdown.
- [ ] `enabled: false` records jobs without running them.
- [ ] Two processes on one file never run the same claim (test with two executors on one temp-file DB).

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-job-queue test/unit-tests/node-config.test.js` — pass
- `node run-tests.js` — full suite passes
- `node run-linter.js src test` — clean
- Manual:
  - Create, seed, and serve a disposable Local Target Instance with `node tools/local-target.js`.
  - Temporarily register a no-op recurring handler in that development setup and verify UTC execution and shutdown draining. Remove the registration afterward; do not ship it in the application registry.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task JQ-8: Cloudflare adapter (Durable Object)

**Status:** Not started
**Depends on:** JQ-1, JQ-4, JQ-5, JQ-6
**Documentation:** `src/plugins/README.md`; `src/plugins/cloudflare-content-store/` (Durable Object precedent); Cloudflare "Rules of Durable Objects" (initialize in the constructor)

**Objective**

On Cloudflare, jobs are durable in the `JobQueueStore` Durable Object's SQLite
storage and run inside `alarm()`. Worker code reaches it through the same
`JobQueue` service API as Node.

**Scope**

- In:
  - `plugins/cloudflare-job-queue/`: the `JobQueueStore` Durable Object, a SQL executor over `ctx.storage.sql`, and the Worker-side `JobQueue` service using RPC stubs.
  - Registration and Durable Object export in `plugins/cloudflare.js` and `cloudflare-server.js`.
  - The `JOB_QUEUE` block in `cloudflare-config.js`.
  - The per-isolate `ping()`.
  - Tests.
- Out: devkit (JQ-1).

**Design and invariants**

- Config:
  ```
  JOB_QUEUE: {
      durableObjectBindingName: 'JOB_QUEUE_DURABLE_OBJECT', durableObjectClassName: 'JobQueueStore',
      concurrency: 4, softDeadlineSeconds: 20,
      retention: { completedMaxAgeDays: 7, failedMaxAgeDays: 30 },
  }
  ```
  `enabled` is honoured the same way as on Node.
- Constructor: `ctx.blockConcurrencyWhile(() => { migrate; reconcileSchedules(registry); setAlarm(nextWakeTime) })`.
  - The registry comes from the application module booted at module scope in `cloudflare-server.js`.
  - The Durable Object must obtain it without importing `app/` from the plugin. For example, the entry point passes it through a module-level setter before export, or the Durable Object reads it from the booted `appContext`'s `JobQueue` service. Record the chosen mechanism.
- `alarm()` behaviour:
  - Calls `runner.runDueJobs({ deadline: now + softDeadlineSeconds })` with `createContext` building a job context from the Durable Object's `env`.
  - Then `setAlarm(nextWakeTime)`, or "now" if due work remains.
  - On an unexpected error: set the next alarm first, then report the error.

  **Verify:** how throwing from `alarm()` interacts with Cloudflare's automatic alarm retries and an alarm already set in the same invocation. If a rethrow causes duplicate processing or cancels the re-arm, report through a `waitUntil` rejection as `cloudflare-server.js` does, and don't rethrow. Record the finding.
- RPC methods on the Durable Object: `enqueue`, `get`, `list`, `retry`, `listSchedules`, `ping`.
  - `enqueue` sets an earlier alarm when the new job is due before the current alarm.
- Worker-side service: resolves the binding from `context.env[bindingName]` on every call (Cloudflare resolves at request time), using `idFromName('default')`.
- Handlers running *inside* the Durable Object that call `JobQueue.enqueue` must write directly to the local store, not call their own stub. Implement through the job context (e.g. a direct-mode `JobQueue` bound to the store) and record the mechanism.
- `cloudflare-server.js`:
  - Export `JobQueueStore`.
  - On the first `fetch` per isolate, `cloudflare.waitUntil(jobQueue.ping(requestContext))`. Log a failure at warn level and never fail the request.
- Document in the config a suggested `WORKER_VERSION.limits.cpu_ms` for CPU-heavy jobs.

**Expected touch points**

- `src/plugins/cloudflare-job-queue/plugin.js`, `lib/job-queue-store.js` (Durable Object), `lib/job-queue.js` (Worker service), `lib/durable-object-sql-executor.js`
- `src/plugins/cloudflare.js`, `src/cloudflare-server.js`, `src/cloudflare-config.js`
- `test/unit-tests/plugins/cloudflare-job-queue/*.test.js` — fake `ctx.storage` whose `sql.exec` is backed by `node:sqlite` in memory, plus a fake alarm API

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The constructor migrates, reconciles, and re-arms under `blockConcurrencyWhile`.
- [ ] `alarm()` runs due jobs within the deadline and re-arms correctly: "now" when work remains, otherwise the next wake time.
- [ ] Enqueue from the Worker and from inside a handler both work, and the inside path never calls its own stub.
- [ ] The per-isolate ping fires once and doesn't affect responses.
- [ ] A test-only registry exercises UTC recurring execution with a controlled clock; normal application boot registers no example schedule.
- [ ] Deployed to a Cloudflare environment with the updated devkit. Immediate, delayed, and scheduled jobs all run.

**Validation**

- `node run-tests.js test/unit-tests/plugins/cloudflare-job-queue` — pass
- `node run-tests.js` — full suite passes
- `node run-linter.js src test` — clean
- Manual:
  - Temporarily register a no-op test handler with a UTC schedule and deploy to a test environment with devkit. Remove the registration and redeploy after verification.
  - Enqueue immediate and delayed jobs through an explicit temporary test route; JQ-9 provides inspection and retry, not enqueue.
  - Confirm execution in Workers logs and `GET /job-schedules` next-run values.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task JQ-9: Admin API for jobs and schedules

**Status:** Not started
**Depends on:** JQ-3, JQ-7 (JQ-8 for the Cloudflare manual check)
**Documentation:** `src/app/presentation/README.md`, `src/app/transaction-scripts/README.md`, `src/routes/admin-api-v1.js` (`/migrations` precedent)

**Objective**

Operators can list and inspect jobs, see declared schedules with next and last
run, and retry failed jobs through the authenticated Admin API v1.

**Scope**

- In: routes, request handlers, permissions, and tests.
- Out: admin panel HTML pages (a future plan).

**Design and invariants**

- Routes under `admin-api-v1.js`, each with `authenticateAdminApiRequest` plus `authorize` on resource `urn:kixx:admin:jobs`:
  - `GET /jobs?status=&name=&limit=&cursor=`, with action `urn:kixx:list`.
  - `GET /jobs/:id`, with `urn:kixx:get`.
  - `POST /jobs/:id/retry`, with `urn:kixx:update`.
  - `GET /job-schedules`, with `urn:kixx:list`.
- Grant the developer role `{ action: '*', resource: 'urn:kixx:admin:jobs' }`, alongside migrations.
- Request handlers validate HTTP inputs, call `context.getService('JobQueue')` directly, and format responses. Add a Transaction Script only if application policy or orchestration appears; none is needed for these service-owned operations.
  - The service owns retry eligibility: a missing id throws `NotFoundError`; a job that isn't `failed`, or whose key or schedule name is held by an active job, throws `ConflictError`.
  - Handlers validate query input with `ValidationError`, e.g. an unknown status or an out-of-range limit, and map a `null` result from `get` to a 404.
- JSON:API response shape matches the existing admin API handlers.

**Expected touch points**

- `src/routes/admin-api-v1.js`
- `src/app/presentation/request-handlers/admin-api/{list-jobs,get-job,retry-job,list-job-schedules}.js`, `mod.js`
- `src/app/permissions/roles.js`
- Tests under `test/unit-tests/app/` and `test/unit-tests/routes/`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All four endpoints work and are authorized. Unauthorized users are rejected.
- [ ] Retry resets a failed job, which then runs. Error cases return 404, 409, and 400.
- [ ] Pagination round-trips the cursor.
- [ ] Handlers call the service directly after HTTP input validation, with no pass-through Transaction Scripts.

**Validation**

- `node run-tests.js test/unit-tests/app test/unit-tests/routes` — pass
- `node run-linter.js src/app src/routes test/unit-tests` — clean
- Manual:
  - Run `node tools/local-target.js create jq && … seed jq && … serve jq`.
  - Call the endpoints with a token from `credentials.json`.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task JQ-10: Documentation

**Status:** Not started
**Depends on:** JQ-7, JQ-8, JQ-9
**Documentation:** `AGENTS.md` index format; `src/plugins/README.md`; `docs/configuration.md`

**Objective**

Developers and agents can author jobs correctly without this plan.

**Scope**

- In:
  - `src/app/jobs/README.md`, the authoring guide.
  - An `AGENTS.md` documentation index entry.
  - The `src/plugins/README.md` adapter list and a Durable Object note.
  - The `JOB_QUEUE` settings in `docs/configuration.md` for both platforms.
- Out: code changes.

**Design and invariants**

- The authoring guide covers:
  - The registry and handler signature; business rules belong in Transaction Scripts, while handlers may call framework services directly for complete service-owned operations.
  - At-least-once delivery and idempotency, using `job.id` and `job.attempt`.
  - Re-checking state and no-op'ing when obsolete, since there is no cancel.
  - `scheduledFor` for stale checks.
  - UTC-only cron syntax, catch-up-once, and no-overlap; local-time scheduling and per-name concurrency are deferred.
  - Dedupe keys.
  - Enqueue after the domain write, plus the sweep-job pattern for critical work.
  - Error classes and `retryable`.
  - Cooperative `signal` use. Claim tokens protect queue state from stale outcomes, but cannot prevent duplicate external effects.
  - The "fit one Cloudflare invocation; chain long work" rule.
  - Payload limit.
  - Retention.
  - The Admin API.
  - Node's fixed idle polling interval and its dispatch latency.
  - Testing with `processDueJobs({ now })` and a test-only recurring registry; normal boot ships no recurring example.
- Keep it short, per AGENTS.md: "use as few words as possible."

**Expected touch points**

- `src/app/jobs/README.md`, `AGENTS.md`, `src/plugins/README.md`, `docs/configuration.md`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Every decision in "Decisions" that affects authors or operators is documented where they will look.
- [ ] The `AGENTS.md` index entry follows the existing "When to use / What it provides" format.

**Validation**

- Review against the "Decisions" list above.
- `node run-linter.js` — clean (no code expected to change)

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
