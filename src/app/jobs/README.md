# Background Jobs

A durable job queue. Enqueue a job by name; it runs as soon as possible, at a later time, or on a recurring UTC cron schedule declared in code. Node runs jobs in-process from a SQLite file. Cloudflare runs them in a Durable Object `alarm()`.

```js
const queue = context.getService('JobQueue');

await queue.enqueue(context, 'send-admin-invite-email', { inviteId }, {
    runAt: '2026-10-01T09:00:00Z', // or delaySeconds: 300; omit for "as soon as possible"
    key: `invite-email:${ inviteId }`, // optional dedupe key
});
```

The port contract is `src/kixx/jobs/job-queue-interface.js`.

## Registering a job

Add an entry to the static `Map` in `mod.js`. Import the handler statically (no `import()`). The service validates the registry at boot, and enqueuing an unregistered name fails.

```js
[ 'send-admin-invite-email', {
    name: 'send-admin-invite-email',   // must equal the key; lowercase kebab-case
    description: 'Send the invite email.',
    handler: sendAdminInviteEmail,
    maxAttempts: 5,                    // default 5
    timeoutSeconds: 60,                // default 60
    schedule: { cron: '0 3 * * *' },   // optional; UTC only
} ]
```

The shipped registry is empty. `concurrency` and `schedule.timezone` are rejected.

## Handlers

```js
export async function handler(context, job) {}
```

`job` is `{ id, name, payload, attempt, maxAttempts, scheduledFor, signal }`. `context` has shared services and collections, a logger stamped with `jobId`/`jobName`, and no request or user.

- Handlers sit at the presentation layer. Put business rules in Transaction Scripts. A handler may call a framework service directly when it owns the whole operation.
- **Delivery is at-least-once. Handlers MUST be idempotent.** Use `job.id` (stable across attempts) and `job.attempt` to guard side effects. Claim tokens protect queue state from stale outcomes but cannot prevent duplicate external effects.
- There is no `cancel`. Re-check current state and no-op when the job is obsolete. For recurring jobs `scheduledFor` is the occurrence time, so a stale run can detect it is late.
- `signal` aborts at `timeoutSeconds`. Abort is cooperative; honor it in long calls.
- **A job must fit inside one Cloudflare invocation.** Split long work into chained jobs (enqueue the next from the handler).
- Payload must be JSON-serializable, at most 128 KB serialized (`PayloadTooLargeError`).

## Enqueueing

- Enqueue *after* the domain write. There is no transaction across the DocumentStore and the queue. For critical work, record the intent on the domain record and have a recurring sweep job re-enqueue anything unprocessed.
- `key` dedupes among *active* jobs: enqueueing the key of a pending or running job returns that job with `created: false`. The key is reusable once the job finishes.
- `runAt` and `delaySeconds` are mutually exclusive.
- No ordering guarantee between an enqueue and a read from another process.

## Schedules

5-field cron, evaluated in **UTC only**: `*`, lists, ranges, steps (`*/15`, `1-5`, `0,30`). No names, `@` macros, `L`/`W`/`#`, or seconds. Day-of-month and day-of-week both restricted means either may match (standard cron).

- Missed occurrences run **once** (the most recent missed time), then resume.
- At most one active occurrence per schedule. An occurrence due while the previous is still active is skipped and logged.
- Schedules are reconciled from the registry at boot. Removing an entry removes its schedule. There is no runtime schedule API.
- Local-time schedules, timezones, and per-name concurrency are not supported.

## Errors and retries

See `src/docs/server-error-handling.md`.

- Expected error (`error.expected === true`): recorded, then retried with backoff unless `error.retryable === false`. `retryable` defaults to `true` for `OperationalError` and `false` for other expected classes. It is a plain property, not a constructor option: `Object.assign(error, { retryable: false })`.
- Unexpected error: the job fails immediately (no retry) and is logged at error. Node then shuts down gracefully with exit code 1. The Durable Object stops claiming for that invocation and logs the error.
- Backoff: exponential with full jitter from 10 s, capped at 1 h. A run that outlives its lease (`timeoutSeconds` + 30 s) counts as a failed attempt.
- A job whose name is no longer registered (deploy drift) is failed with an `UnknownJob` error.

## Operating

Retention is by age: completed jobs after 7 days, failed after 30 (`JOB_QUEUE.retention`). Active jobs are never purged.

Admin API v1 (Basic auth, resource `urn:kixx:admin:jobs`, developer role):

| Route | Purpose |
| --- | --- |
| `GET /admin-api/v1/jobs?status=&name=&limit=&cursor=` | List, newest first. `meta.cursor` pages. |
| `GET /admin-api/v1/jobs/:id` | One job with `lastError`. |
| `POST /admin-api/v1/jobs/:id/retry` | Re-queue a `failed` job (404 unknown, 409 not failed or key/schedule in use). |
| `GET /admin-api/v1/job-schedules` | Declared schedules with next and last run. |

Platform notes:

- **Node:** a single loop fills free slots while work is due and polls every `pollIntervalSeconds` (default 1) when idle. There is no enqueue nudge, so an idle queue can take up to one interval to start a new job. Set `JOB_QUEUE.enabled: false` to record jobs without running them.
- **Cloudflare:** jobs run in the `JobQueueStore` Durable Object. Each alarm stops claiming after `softDeadlineSeconds` and re-arms. Raise `WORKER_VERSION.limits.cpu_ms` for CPU-heavy jobs.

## Testing

Register the handler in a test-only registry and drive the runner directly; normal boot ships no recurring example.

```js
await queue.processDueJobs({ now: new Date('2026-03-10T00:16:00Z') });
```

`test/fixtures/jobs/example-noop-heartbeat.js` provides a recurring registry (`*/15 * * * *`). See `test/unit-tests/plugins/node-job-queue/job-queue.test.js`.
