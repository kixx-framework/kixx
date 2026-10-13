# Admin API v1

The Admin API provides operator-only JSON endpoints for data migrations, job
queue inspection, and publishing-token creation, plus a token-authenticated endpoint for redeeming a
one-time admin invite.

The API is mounted at:

```text
/admin-api/v1
```

Examples in this document use `http://localhost:2026`, the default development
server origin.

## Endpoint summary

| Method | Path | Authentication | Required permission | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/admin-api/v1/migrations` | Admin HTTP Basic | `urn:kixx:list` on `urn:kixx:admin:migrations` | List registered migrations and their durable status |
| `POST` | `/admin-api/v1/migrations/:id/run` | Admin HTTP Basic | `urn:kixx:run` on `urn:kixx:admin:migrations` | Run one migration batch |
| `GET` | `/admin-api/v1/jobs` | Admin HTTP Basic | `urn:kixx:list` on `urn:kixx:admin:jobs` | List queued, running, and finished jobs |
| `GET` | `/admin-api/v1/jobs/:id` | Admin HTTP Basic | `urn:kixx:get` on `urn:kixx:admin:jobs` | Get one job |
| `POST` | `/admin-api/v1/jobs/:id/retry` | Admin HTTP Basic | `urn:kixx:update` on `urn:kixx:admin:jobs` | Re-queue a failed job |
| `GET` | `/admin-api/v1/job-schedules` | Admin HTTP Basic | `urn:kixx:list` on `urn:kixx:admin:jobs` | List recurring job schedules |
| `POST` | `/admin-api/v1/users/invite` | Invite bearer token | None | Redeem an invite and create an admin account |
| `POST` | `/admin-api/v1/publishing-api-tokens` | Admin HTTP Basic | `urn:kixx:create` on `urn:kixx:admin:api-tokens:publishing` | Mint a publishing API bearer token |

Every endpoint path accepts an optional trailing slash.

Only the methods shown above are allowed. A different method on a recognized
path returns `405 Method Not Allowed` with an `Allow` header.

## Protocol conventions

### JSON:API media type

Every `POST` body must use the JSON:API media type:

```http
Content-Type: application/vnd.api+json
```

Media-type parameters such as `charset=utf-8` are accepted. A missing or
different media type returns `415 Unsupported Media Type`.

Successful responses also use:

```http
Content-Type: application/vnd.api+json; charset=utf-8
```

The API does not require an `Accept` header.

### Resource documents

Write endpoints accept one JSON:API resource:

```json
{
    "data": {
        "type": "ResourceType",
        "attributes": {}
    }
}
```

Both `data` and `data.attributes` must be objects, and `data.type` must be a
non-empty string. A malformed document returns `400 Bad Request`. A valid
document with the wrong resource type returns `409 Conflict` with code
`JsonApiResourceTypeMismatch`.

Request resource IDs are not used. Attributes not documented for an endpoint
are ignored.

### Error documents

Expected errors use a JSON:API error document. A validation failure can
return more than one error object:

```json
{
    "errors": [
        {
            "status": "422",
            "code": "VALIDATION_ERROR",
            "title": "ValidationError",
            "detail": "Password must be at least 12 characters",
            "source": "password"
        }
    ]
}
```

`source` names the invalid field and may be omitted for other errors. It
usually matches the JSON attribute, except admin email validation uses
`email_address` for `emailAddress`.

Common failures:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `BAD_REQUEST_ERROR` | Invalid JSON, malformed JSON:API envelope, invalid query parameter, or invalid cursor |
| `401` | `UNAUTHENTICATED_ERROR` | Required credentials are absent or malformed |
| `401` | `InvalidCredentials` | Admin email or password was rejected |
| `403` | `FORBIDDEN_ERROR` | Authenticated admin lacks the required permission |
| `404` | `NOT_FOUND_ERROR` | A requested migration or job ID does not exist |
| `405` | `METHOD_NOT_ALLOWED_ERROR` | Method is not allowed on the recognized path |
| `409` | `JsonApiResourceTypeMismatch` | Request resource type is wrong |
| `415` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | Request `Content-Type` is not JSON:API |
| `422` | `VALIDATION_ERROR` | One or more attributes are invalid |

Endpoint-specific errors are listed with their endpoints. Unexpected failures
return a generic server error without internal details.

## Admin authentication and authorization

Every endpoint except the invite endpoint uses HTTP Basic credentials: an admin
email address and password.

```http
Authorization: Basic <base64(email:password)>
```

The email is trimmed and case-insensitive. The first colon separates the
email from the password, so passwords may contain colons. Missing, malformed, empty-username, and empty-password Basic
credentials return `401`. An unknown email and an incorrect password return the
same `InvalidCredentials` response to avoid account enumeration.

Permissions come from the account's stored role IDs on every request:

| Role | Migrations and jobs | Create publishing tokens |
| --- | --- | --- |
| `root-admin` | Yes | Yes |
| `developer` | Yes | Yes |
| `admin` | No | No |
| `editor` | No | No |

The role registry (`lib/app/permissions/roles.js`) is the authority. Unknown
role IDs grant nothing.

Basic-auth endpoints authenticate and authorize before checking the body. The
invite endpoint checks, in order: media type, Bearer credential, JSON shape,
invite state, account attributes.

## List migrations

```http
GET /admin-api/v1/migrations
```

Returns every migration registered in the deployed build, in registry order.
Ledger records for migrations not in the registry are not returned.

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": [
        {
            "type": "Migration",
            "id": "2026-07-17-example-noop",
            "attributes": {
                "description": "Verify the remote migration workflow without reading or changing application data.",
                "status": "pending",
                "stats": null,
                "batchCount": null,
                "startedBy": null,
                "startedAt": null,
                "completedAt": null,
                "error": null
            }
        }
    ]
}
```

Migration attributes are:

| Attribute | Type | Meaning |
| --- | --- | --- |
| `description` | string | Operator-facing description from the deployed registry |
| `status` | `pending`, `running`, `applied`, or `failed` | Current lifecycle state |
| `stats` | object or `null` | Finite numeric counters accumulated across committed real batches |
| `batchCount` | integer or `null` | Number of successfully committed real batches |
| `startedBy` | string or `null` | Admin ID that started the current real run |
| `startedAt` | ISO date-time string or `null` | Time the current real run began |
| `completedAt` | ISO date-time string or `null` | Time the run applied or failed |
| `error` | string or `null` | Client-safe failure message for a failed run |

A migration with no ledger record is `pending` with all nullable fields
`null`. Dry runs never write the ledger, so they never change this output.

### Example

```bash
curl --user 'admin@example.com:password' \
    http://localhost:2026/admin-api/v1/migrations
```

## Run a migration batch

```http
POST /admin-api/v1/migrations/:id/run
Content-Type: application/vnd.api+json
```

One request runs one bounded batch. Repeat until the response has
`done: true`. An unregistered `:id` returns `404`.

### Request

The required resource type is `MigrationRun`.

```json
{
    "data": {
        "type": "MigrationRun",
        "attributes": {
            "dryRun": false,
            "force": false,
            "cursor": null
        }
    }
}
```

All attributes are optional:

| Attribute | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dryRun` | boolean | `false` | Preview one batch without application-data, external, or ledger mutations |
| `force` | boolean | `false` | Restart an applied or failed real run from the beginning |
| `cursor` | non-empty string or `null` | `null` | Opaque caller-owned cursor for a dry run |

`dryRun` and `force` cannot both be `true` (`422` on `force`). Real runs
ignore `cursor` and load progress from the ledger. Return a dry-run cursor
unchanged; do not parse it.

An empty attributes object starts or resumes a real run:

```json
{
    "data": {
        "type": "MigrationRun",
        "attributes": {}
    }
}
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "MigrationRun",
        "id": "2026-07-17-example-noop",
        "attributes": {
            "done": true,
            "cursor": null,
            "stats": {
                "scanned": 0
            },
            "status": "applied",
            "dryRun": false
        }
    }
}
```

| Attribute | Type | Meaning |
| --- | --- | --- |
| `done` | boolean | Whether this migration run has completed |
| `cursor` | non-empty string or `null` | Next dry-run cursor, or the stored real-run cursor; `null` on completion |
| `stats` | object | Dry-run counters for this batch, or accumulated counters for a real run |
| `status` | `dry-run`, `running`, or `applied` | Outcome after this batch |
| `dryRun` | boolean | Whether this was a dry-run batch |

### Real-run lifecycle

- The first real request creates a `running` ledger record before invoking the
  migration.
- A successful non-terminal batch commits its cursor, accumulates its numeric
  stats, increments `batchCount`, and remains `running`.
- A successful terminal batch stores a null cursor and becomes `applied`.
- A `running` migration resumes at its last successfully committed cursor.
- A `failed` migration resumes at its last successfully committed cursor when
  `force` is false. Its accumulated stats and original start identity/time are
  preserved.
- `force: true` resets an `applied` or `failed` migration to a fresh run. Its
  cursor, stats, batch count, start identity, and timestamps are reset.
  `force` is ignored for a `running` migration, which resumes.
- Running an already-applied migration without force returns `409` with code
  `MigrationAlreadyAppliedError`.

Real batches use optimistic concurrency (each write checks that nobody else
changed the record first). If another operator advanced the migration, the
request returns `409` with code `MigrationConcurrencyError`; reload and retry. If a real run's stored
cursor is invalid, the ledger becomes failed and the request returns `409` with
code `MigrationCursorConflictError`; restart it with `force: true`.

If a migration batch fails, failure bookkeeping is best effort. The ledger
preserves the last committed cursor and stats and normally becomes `failed` with
a safe error message. Application writes and the ledger commit are not atomic,
so migration implementations must be idempotent in case a batch is replayed.

### Dry-run lifecycle

A dry run does the migration's normal reads and counting but no
application-data, external, or ledger writes. Its `status` is always
`dry-run`. The caller owns progress: start with `cursor: null` and pass each
returned cursor to the next request until `done`. An invalid cursor returns
`400`.

### Examples

Run one real batch:

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"MigrationRun","attributes":{}}}' \
    http://localhost:2026/admin-api/v1/migrations/2026-07-17-example-noop/run
```

Run the first dry-run batch:

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"MigrationRun","attributes":{"dryRun":true}}}' \
    http://localhost:2026/admin-api/v1/migrations/2026-07-17-example-noop/run
```

## Jobs

Inspect and recover background jobs. Job behavior (retries, backoff,
retention) is described in `lib/app/jobs/README.md`.

`lib/` is published separately, so that README keeps its own copy of these
endpoints. Update both when either changes.

### List jobs

```http
GET /admin-api/v1/jobs?status=failed&name=send-email&limit=50&cursor=<cursor>
```

Returns jobs newest first. All query parameters are optional; an empty value
is treated as absent, and a repeated parameter returns `400`.

| Parameter | Meaning |
| --- | --- |
| `status` | `pending`, `running`, `completed`, or `failed` |
| `name` | Registered job name |
| `limit` | Integer from 1 through 200; default 50 |
| `cursor` | Opaque cursor from the previous page's `meta.cursor` |

```json
{
    "data": [
        {
            "type": "Job",
            "id": "<uuid>",
            "attributes": {
                "name": "send-email",
                "key": null,
                "scheduleName": null,
                "payload": {},
                "status": "failed",
                "attempt": 3,
                "maxAttempts": 3,
                "runAt": "2026-10-13T12:00:00.000Z",
                "scheduledFor": null,
                "createdAt": "2026-10-13T11:59:00.000Z",
                "updatedAt": "2026-10-13T12:00:05.000Z",
                "finishedAt": "2026-10-13T12:00:05.000Z",
                "lastError": {
                    "name": "OperationalError",
                    "message": "Upstream timed out",
                    "expected": true
                }
            }
        }
    ],
    "meta": {
        "cursor": null
    }
}
```

`meta.cursor` is `null` on the last page. An invalid cursor returns `400`.

### Get a job

```http
GET /admin-api/v1/jobs/:id
```

Returns one `Job` resource. An unknown or purged ID returns `404`.

### Retry a job

```http
POST /admin-api/v1/jobs/:id/retry
```

No request body is needed. Resets a `failed` job to attempt 0, due now, and
returns the re-queued `Job` resource. An unknown ID returns `404`. A job that
is not `failed`, or whose dedupe key or schedule is held by an active job,
returns `409` with code `CONFLICT_ERROR` and is left unchanged.

### List job schedules

```http
GET /admin-api/v1/job-schedules
```

```json
{
    "data": [
        {
            "type": "JobSchedule",
            "id": "<job-name>",
            "attributes": {
                "cron": "*/15 * * * *",
                "nextRunAt": "2026-10-13T12:15:00.000Z",
                "lastEnqueuedAt": "2026-10-13T12:00:00.000Z",
                "lastJobId": "<uuid>"
            }
        }
    ]
}
```

`cron` is a UTC 5-field expression. `lastEnqueuedAt` and `lastJobId` are
`null` before the first occurrence.

## Accept an admin invite

```http
POST /admin-api/v1/users/invite
Authorization: Bearer <invite-token>
Content-Type: application/vnd.api+json
```

The one-time invite token is the credential; Basic credentials are not
accepted.

### Request

The required resource type is `AdminUser`.

```json
{
    "data": {
        "type": "AdminUser",
        "attributes": {
            "emailAddress": "new-admin@example.com",
            "password": "at-least-12-chars"
        }
    }
}
```

| Attribute | Requirements |
| --- | --- |
| `emailAddress` | Required string in a basic email-address shape; trimmed and lowercased before storage |
| `password` | Required string, 12 to 256 characters; preserved exactly as submitted |

An absent or malformed Bearer header returns `401`. An unknown, expired,
revoked, used, or concurrently redeemed token returns the same `403` with code
`InvalidInvite`, so clients can't probe invite state.

Stored invites grant their configured roles. `ADMIN_BOOTSTRAP_TOKEN`, when
configured and unused, grants `root-admin`. It is single-use: consumption is
recorded even while the environment value stays configured.

### Response

The endpoint creates the account but does not create a login session.

```http
HTTP/1.1 201 Created
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "AdminUser",
        "id": "<admin-user-id>",
        "attributes": {
            "emailAddress": "new-admin@example.com",
            "userCreationDate": "2026-08-27T12:00:00.000Z"
        }
    }
}
```

The response never includes the password, password hash, invite token, or
assigned roles.

### Conflict and consumption behavior

- If the email already exists when checked, the response is `409` with code
  `NewUserConflictError`; the invite is not consumed.
- The invite is consumed before the user is written, so one token can't
  create two admins under concurrent redemption.
- If another signup claims the email between the initial check and user write,
  the response is `409` with code `InviteSpentInEmailRace`; the invite has been
  consumed and a new invite is required.
- If the account write fails after consumption, the invite stays consumed.
  Reopening it could let one token create multiple accounts.

### Example

```bash
curl \
    --header 'Authorization: Bearer invite-secret' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"AdminUser","attributes":{"emailAddress":"new-admin@example.com","password":"at-least-12-chars"}}}' \
    http://localhost:2026/admin-api/v1/users/invite
```

## Create a publishing API token

```http
POST /admin-api/v1/publishing-api-tokens
Content-Type: application/vnd.api+json
```

Mints a bearer token for the [Publishing API](publishing-api.md). The required
resource type is `PublishingApiToken`.

### Request

```json
{
    "data": {
        "type": "PublishingApiToken",
        "attributes": {
            "roles": ["editor"],
            "timeToLiveSeconds": 2592000,
            "description": "CMS production deploy"
        }
    }
}
```

All attributes are optional:

| Attribute | Type | Default | Requirements |
| --- | --- | --- | --- |
| `roles` | string array | `["editor"]` | One or more publishing-role IDs; currently only `editor` is valid |
| `timeToLiveSeconds` | integer | `2592000` (30 days) | From 1 through `31536000` (365 days), inclusive |
| `description` | string or `null` | `null` | Trimmed; a blank string becomes `null` |

An omitted, null, empty, or non-array `roles` becomes `["editor"]`; any other
role fails validation. A null TTL uses the default.

### Response

```http
HTTP/1.1 201 Created
Content-Type: application/vnd.api+json; charset=utf-8
```

```json
{
    "data": {
        "type": "PublishingApiToken",
        "id": "<sha256-token-digest>",
        "attributes": {
            "token": "kxpat_<secret>",
            "roles": ["editor"],
            "description": "CMS production deploy",
            "createdBy": "<admin-user-id>",
            "tokenCreationDate": "2026-08-27T12:00:00.000Z",
            "tokenExpirationDate": "2026-09-26T12:00:00.000Z"
        }
    }
}
```

**The plaintext `token` appears only in this response.** It is never stored;
the `id` is its SHA-256 hex digest. If it is lost, mint a replacement. Use the
shortest practical TTL.

### Example

```bash
curl --user 'admin@example.com:password' \
    --header 'Content-Type: application/vnd.api+json' \
    --data '{"data":{"type":"PublishingApiToken","attributes":{"description":"CMS production deploy"}}}' \
    http://localhost:2026/admin-api/v1/publishing-api-tokens
```

## Operator workflows

### Safely apply a migration

1. List migrations and select a `pending` or intended `failed` migration.
2. Dry-run batches from a null cursor until `done` is true, carrying each
   returned cursor forward.
3. Review the dry-run stats.
4. Submit real-run batches until `done` is true. Do not send the dry-run cursor;
   the server owns real-run progress.
5. List migrations again and confirm `status: "applied"` and the accumulated
   stats.

Use `force` only to restart a failed migration from the beginning or to
deliberately rerun an applied one.

### Bootstrap the first admin

1. Configure a strong, secret `ADMIN_BOOTSTRAP_TOKEN` in the deployment.
2. Redeem it once through the invite endpoint.
3. Remove the environment value after the root admin is created. The consumed
   marker prevents reuse even before removal.
