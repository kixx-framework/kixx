# Background Jobs

A durable job queue. Enqueue a job by name to run now, later, or on a UTC cron schedule declared in code. Port contract: `kixx/jobs/job-queue-interface.js`.

```js
const queue = context.getService('JobQueue');

await queue.enqueue(context, 'send-admin-invite-email', { inviteId }, {
    runAt: '2026-10-01T09:00:00Z', // or delaySeconds: 300, never both; omit both for "now"
    key: `invite-email:${ inviteId }`, // optional dedupe key
});
```

## Registering a job

Add an entry to the `Map` in `mod.js`, importing the handler statically (no `import()`). The registry is validated at boot. It ships empty.

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

Unknown fields, including `concurrency` and `schedule.timezone`, are rejected.

## Handlers

```js
export async function handler(context, job) {}
```

`job` is `{ id, name, payload, attempt, maxAttempts, scheduledFor, signal }`. `context` has shared services and collections, a logger stamped with `jobId`/`jobName`, and no request or user.

- Handlers sit at the presentation layer. Put business rules in Transaction Scripts. A handler may call a framework service directly when it owns the whole operation.
- **Delivery is at-least-once. Handlers MUST be idempotent.** Guard side effects with `job.id` (stable across attempts) and `job.attempt`. The queue cannot prevent duplicate external effects.
- There is no `cancel`. Re-check current state and no-op when the job is obsolete. A recurring run can compare `scheduledFor` (its occurrence time) to now to detect it is late.
- `signal` aborts at `timeoutSeconds`. Abort is cooperative; honor it in long calls.
- **A job must fit inside one Cloudflare invocation.** Split long work into chained jobs (enqueue the next from the handler).

## Enqueueing

- Enqueue *after* the domain write. There is no transaction across the DocumentStore and the queue. For critical work, record the intent on the domain record and have a recurring sweep job re-enqueue anything unprocessed.
- `key` dedupes among *active* jobs: enqueueing the key of a pending or running job returns that job with `created: false`. The key is reusable once the job finishes.
- Payload must be JSON-serializable and at most 128 KB serialized (`PayloadTooLargeError`). An unregistered name is an assertion failure.
- No ordering guarantee between an enqueue and a read from another process.

## Schedules

5-field cron, evaluated in **UTC only**: `*`, lists, ranges, steps (`*/15`, `1-5`, `0,30`). No names, `@` macros, `L`/`W`/`#`, or seconds. Day-of-month and day-of-week both restricted means either may match (standard cron).

- Missed occurrences run **once** (the most recent missed time), then resume.
- At most one active occurrence per schedule. An occurrence due while the previous is still active is skipped and logged.
- Schedules are reconciled from the registry at boot. Removing an entry removes its schedule. There is no runtime schedule API.

## Errors and retries

See `docs/server-error-handling.md`.

- Expected error (`error.expected === true`): recorded, then retried with backoff if `error.retryable` is `true`, else the job fails. `retryable` defaults to `true` for `OperationalError` and `false` for other expected classes. It is a plain property, not a constructor option: `Object.assign(error, { retryable: false })`.
- Unexpected error: the job fails without retry and is logged. Node then shuts down gracefully with exit code 1; the Durable Object stops claiming for that invocation.
- Backoff: exponential with full jitter from 10 s, capped at 1 h. A run that outlives its lease (`timeoutSeconds` + 30 s) counts as a failed attempt.
- A stored job whose name is no longer registered fails with `UnknownJob`.

## Running from the Admin Panel

Developers → Background Jobs (`/admin/jobs`) calls the same `JobQueue` as the Admin API, under `urn:kixx:admin:jobs` (Developer and Root Admin). Viewing needs `urn:kixx:list`/`urn:kixx:get`, Retry needs `urn:kixx:update`, and Run now needs `urn:kixx:create`.

- **Pages.** The jobs list (newest first, status and name filters, paging); job detail (every field, the payload, and the last error with its stack); Schedules (cron in UTC); and Registered jobs (every `mod.js` entry with defaults resolved).
- **Retry** is offered for `failed` jobs only, as in the API.
- **Run now** is panel-only. It takes a JSON payload (default `{}`) and enqueues with the dedupe key `admin-run:<name>`: while that run is pending or running, another Run now lands on it instead of queueing a second. The key frees when the job finishes. The handler sees `scheduledFor: null`. Handlers must still be idempotent.
- **Queue disabled.** With `JOB_QUEUE.enabled: false`, every jobs page warns that jobs are recorded but not run. Retry and Run now still record jobs.

## Operating

Retention is by age: completed jobs after 7 days, failed after 30 (`JOB_QUEUE.retention`). Active jobs are never purged. `JOB_QUEUE.enabled: false` records jobs without running them, on both platforms. `JOB_QUEUE.concurrency` caps jobs running at once.

Admin API v1 (Basic auth, resource `urn:kixx:admin:jobs`, developer role):

| Route | Purpose |
| --- | --- |
| `GET /admin-api/v1/jobs?status=&name=&limit=&cursor=` | List, newest first. `meta.cursor` pages. |
| `GET /admin-api/v1/jobs/:id` | One job with `lastError`. |
| `POST /admin-api/v1/jobs/:id/retry` | Re-queue a `failed` job (404 unknown, 409 not failed or key/schedule in use). |
| `GET /admin-api/v1/job-schedules` | Declared schedules with next and last run. |

Platform notes:

- **Node:** runs in-process from SQLite. When idle it polls every `JOB_QUEUE.pollIntervalSeconds` (1 in shipped config), so a new job can wait up to one interval to start.
- **Cloudflare:** runs in the `JobQueueStore` Durable Object `alarm()`. Each alarm stops claiming after `JOB_QUEUE.softDeadlineSeconds` and re-arms. Raise `WORKER_VERSION.limits.cpu_ms` in `cloudflare-config.jsonc` (default 30 s CPU) for CPU-heavy jobs.

## Testing

Use a test-only registry and drive the runner directly:

```js
await queue.processDueJobs({ now: new Date('2026-03-10T00:16:00Z') });
```

`test/fixtures/jobs/example-noop-heartbeat.js` provides a recurring registry (`*/15 * * * *`). See `test/plugins/node-job-queue/job-queue.test.js`.
